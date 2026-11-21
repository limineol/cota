import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Layer, Result, Schema } from "effect";
import * as Check from "#03-domain/check.ts";
import * as Client from "#03-domain/client.ts";
import * as Paths from "#03-domain/paths.ts";
import * as Schedule from "#03-domain/schedule.ts";
import * as Shims from "#03-domain/shims.ts";
import { System } from "#03-domain/system.ts";
import * as Cota from "#05-tests/cota.ts";
import * as InMemoryFiles from "#05-tests/fakes/in-memory-files.ts";
import * as InMemoryScheduler from "#05-tests/fakes/in-memory-scheduler.ts";
import * as InMemoryUserPath from "#05-tests/fakes/in-memory-user-path.ts";
import * as ScriptedHub from "#05-tests/fakes/scripted-hub.ts";
import * as ScriptedLoginShell from "#05-tests/fakes/scripted-login-shell.ts";
import * as Doctor from "./doctor.query.ts";
import * as FindCommand from "./find-command.query.ts";
import * as LocateFiles from "./locate-files.query.ts";
import * as LocateShellFiles from "./locate-shell-files.query.ts";
import * as PlanClientFiles from "./plan-client-files.query.ts";
import * as PlanSchedule from "./plan-schedule.query.ts";
import * as ReadConfiguration from "./read-configuration.query.ts";
import * as ReadHubKeys from "./read-hub-keys.query.ts";
import * as ReadKeptAnswers from "./read-kept-answers.query.ts";
import * as ReadMachineLogins from "./read-machine-logins.query.ts";

const configurations = {
  valid: 'hub = "http://127.0.0.1:18080"\nmachine = "studio"\n',
  "no shims":
    'hub = "http://127.0.0.1:18080"\nmachine = "studio"\nshims = false\n',
  "not toml": 'hub = "http://127.0.0.1:18080\nmachine = studio\n',
  "wrong keys": 'hub = 8080\nmachin = "studio"\n',
  "plain http": 'hub = "http://cota.internal:8080"\nmachine = "studio"\n',
  "own pools":
    'hub = "http://127.0.0.1:18080"\nmachine = "studio"\n\n[clients.claude-code]\nown_pool = "personal"\n\n[clients.codex]\nown_pool = "zai"\n',
} as const;

const program = "/usr/local/bin/cota";

/** A machine in any state doctor can find it in: joined or not, its files, keys and modes, and its hub. */
const Machine = Schema.Struct({
  system: System,
  home: Schema.Boolean,
  configuration: Schema.Literals([
    "absent",
    "valid",
    "no shims",
    "not toml",
    "wrong keys",
    "plain http",
    "own pools",
  ]),
  subscription: Schema.Literals([
    "absent",
    "blank",
    "subscription",
    "keyed",
    "reader",
    "unknown",
    "failed",
    "unreachable",
  ]),
  keyed: Schema.Literals([
    "absent",
    "blank",
    "keyed",
    "subscription",
    "unknown",
    "failed",
    "unreachable",
  ]),
  health: Schema.Literals(["up", "down", "failing"]),
  directoryMode: Schema.Literals(["700", "755"]),
  fileMode: Schema.Literals(["600", "644"]),
  stateFile: Schema.Literals(["absent", "valid", "broken"]),
  shims: Schema.Literals(["absent", "installed", "not cota's", "dangling"]),
  shell: Schema.Literals(["zsh", "bash", "fish", "sh"]),
  pathLine: Schema.Literals(["last", "not last", "absent"]),
  loginShell: Schema.Literals(["shims", "elsewhere", "nowhere"]),
  clients: Schema.Literals(["absent", "programs", "scripts"]),
  login: Schema.Literals(["absent", "personal", "zai", "gone"]),
  clientFiles: Schema.Literals(["absent", "behind", "broken"]),
  userPath: Schema.Literals(["shims first", "shims later", "empty"]),
  schedule: Schema.Literals(["as given", "otherwise", "absent", "unavailable"]),
  titlesRun: Schema.Literals(["absent", "lately", "long ago", "broken"]),
  titlesError: Schema.Boolean,
});
type Machine = typeof Machine.Type;

const variablesOf = (drawn: Machine) => {
  const path = drawn.system === "win32" ? "C:\\bin" : "/usr/bin";
  const shell = `/bin/${drawn.shell}`;
  if (!drawn.home) return { PATH: path, SHELL: shell };
  return drawn.system === "win32"
    ? {
        APPDATA: "C:\\Users\\me\\AppData\\Roaming",
        LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
        PATH: path,
      }
    : { HOME: "/home/me", PATH: path, SHELL: shell };
};

type Entries = Parameters<typeof InMemoryFiles.make>[0];

const filesOf = (drawn: Machine): Entries => {
  const paths = Paths.pathsOf(drawn.system, variablesOf(drawn));
  if (Result.isFailure(paths) || drawn.configuration === "absent") return [];
  const { configuration, hubKeys, logins, state, shims, separator } =
    paths.success;
  const directory = {
    kind: "directory",
    mode: Number.parseInt(drawn.directoryMode, 8),
  } as const;
  const file = (text: string) =>
    ({ kind: "file", text, mode: Number.parseInt(drawn.fileMode, 8) }) as const;
  const program_ = (text: string) =>
    ({ kind: "file", text, mode: 0o755 }) as const;
  const keyFile = (answer: string, scope: string) =>
    answer === "absent"
      ? []
      : ([
          [
            `${hubKeys}${separator}${scope}`,
            file(answer === "blank" ? "  \n" : `${scope}-key-${answer}\n`),
          ],
        ] as const);
  const bin = drawn.system === "win32" ? "C:\\bin" : "/usr/bin";
  const shimFiles = Client.commands.flatMap((command) => {
    if (drawn.shims === "absent") return [];
    const shim = Shims.shimOf(
      drawn.system,
      drawn.shims === "dangling" ? "/nowhere/cota" : program,
      command,
    );
    return [
      [
        `${shims}${separator}${shim.name}`,
        program_(drawn.shims === "not cota's" ? "#!/bin/sh\n" : shim.text),
      ],
    ] as const;
  });
  const line = Shims.pathLineOf(shims);
  const shellFile = {
    zsh: "/home/me/.zshrc",
    bash: "/home/me/.bashrc",
    sh: "/home/me/.profile",
    fish: "/home/me/.config/fish/conf.d/cota.fish",
  }[drawn.shell];
  const shellText =
    drawn.shell === "fish"
      ? drawn.pathLine === "absent"
        ? undefined
        : Shims.fishFileOf(shims)
      : {
          last: `alias l=ls\n${line}\n`,
          "not last": `${line}\nexport PATH="/opt/x:$PATH"\n`,
          absent: "alias l=ls\n",
        }[drawn.pathLine];
  return [
    [configuration, directory],
    [
      paths.success.configurationFile,
      file(configurations[drawn.configuration]),
    ],
    [hubKeys, directory],
    ...keyFile(drawn.subscription, "subscription"),
    ...keyFile(drawn.keyed, "keyed"),
    ...(drawn.login === "absent"
      ? []
      : ([
          [logins, directory],
          [`${logins}${separator}${drawn.login}`, file("a-login\n")],
        ] as const)),
    [state, directory],
    ...(drawn.stateFile === "absent"
      ? []
      : ([
          [
            `${state}${separator}routes.json`,
            file(drawn.stateFile === "valid" ? '{"answers":[]}' : "{"),
          ],
        ] as const)),
    ...(drawn.titlesRun === "absent"
      ? []
      : ([
          [
            Paths.titlesFile(paths.success),
            file(
              drawn.titlesRun === "broken"
                ? "{"
                : `{"ranAt":"${drawn.titlesRun === "lately" ? "1970-01-01T00:00:00.000Z" : "1969-12-31T23:50:00.000Z"}","goodAt":null,"transcripts":{},"codex":{"offset":0,"names":{}},"sent":{}}`,
            ),
          ],
        ] as const)),
    ...(drawn.titlesError
      ? ([
          [
            Paths.titlesErrorFile(paths.success),
            file(
              "1970-01-01T00:00:00.000Z http://127.0.0.1:18080 could not be reached within 30 seconds\n",
            ),
          ],
        ] as const)
      : []),
    [program, program_("")],
    [shims, { kind: "directory", mode: 0o755 }],
    ...shimFiles,
    ...(shellText === undefined
      ? []
      : ([
          [shellFile, { kind: "file", text: shellText, mode: 0o644 }],
        ] as const)),
    ...(drawn.clientFiles === "absent" || drawn.system === "win32"
      ? []
      : ([
          ["/home/me/.codex", { kind: "directory", mode: 0o700 }],
          [
            "/home/me/.codex/config.toml",
            file(drawn.clientFiles === "broken" ? "[model\n" : 'model = "x"\n'),
          ],
          ["/home/me/.config/opencode", { kind: "directory", mode: 0o755 }],
          [
            "/home/me/.config/opencode/opencode.json",
            file(drawn.clientFiles === "broken" ? "{" : "{}\n"),
          ],
        ] as const)),
    ...(drawn.clients === "absent"
      ? []
      : Client.commands.map(
          (command) =>
            [
              `${bin}${separator}${drawn.system === "win32" ? `${command}.exe` : command}`,
              program_(
                drawn.clients === "scripts"
                  ? '#!/bin/sh\nexec /opt/real/client "$@"\n'
                  : "",
              ),
            ] as const,
        )),
  ];
};

const fixingCommand = /\b(?:cota|chmod|rm) |^edit /;

const pools = {
  subscription: [
    {
      id: "personal",
      kind: "subscription",
      protocol: "anthropic-messages",
      displayName: null,
      models: [],
    },
    {
      id: "chatgpt",
      kind: "subscription",
      protocol: "chatgpt-codex",
      displayName: null,
      models: [],
    },
  ],
  keyed: [
    {
      id: "zai",
      kind: "keyed",
      protocol: "openai-chat",
      displayName: "Z.ai",
      models: [],
    },
  ],
} as const;

describe("doctor laws", () => {
  it.effect.prop(
    "J14: Every check that fails or warns says what is wrong and the command that fixes it.",
    { drawn: Arbitrary.schema(Machine) },
    ({ drawn }) =>
      Effect.gen(function* () {
        const { layer: files } = InMemoryFiles.make(filesOf(drawn));
        const hub = ScriptedHub.make({
          keys: new Map([
            ["subscription-key-subscription", "subscription"],
            ["subscription-key-keyed", "keyed"],
            ["subscription-key-reader", "reader"],
            ["subscription-key-failed", "failed"],
            ["subscription-key-unreachable", "unreachable"],
            ["keyed-key-keyed", "keyed"],
            ["keyed-key-subscription", "subscription"],
            ["keyed-key-failed", "failed"],
            ["keyed-key-unreachable", "unreachable"],
          ]),
          health: drawn.health,
          pools,
        });
        const shims = Result.map(
          Paths.pathsOf(drawn.system, variablesOf(drawn)),
          (paths) => paths.shims,
        );
        const where = {
          shims: Result.getOrElse(shims, () => "/nowhere"),
          elsewhere: "/opt/bin",
          nowhere: undefined,
        }[drawn.loginShell];
        const shimsDirectory = Result.getOrElse(shims, () => "C:\\nowhere");
        const userPath = InMemoryUserPath.make(
          {
            "shims first": `${shimsDirectory};C:\\bin`,
            "shims later": `C:\\bin;${shimsDirectory}`,
            empty: "",
          }[drawn.userPath],
        );
        const planned = Result.flatMap(
          Paths.pathsOf(drawn.system, variablesOf(drawn)),
          (paths) =>
            Schedule.scheduleOf(
              drawn.system,
              variablesOf(drawn),
              drawn.schedule === "otherwise" ? "/opt/old/cota" : program,
              paths,
            ),
        );
        const scheduler = InMemoryScheduler.make({
          unavailable: drawn.schedule === "unavailable",
          ...(drawn.schedule === "absent" || Result.isFailure(planned)
            ? {}
            : { installed: planned.success }),
        });
        const checks = yield* Effect.flatMap(
          Doctor.Doctor,
          (doctor) => doctor.execute,
        ).pipe(
          Effect.provide(
            Doctor.layer.pipe(
              Layer.provideMerge(
                Layer.mergeAll(PlanClientFiles.layer, PlanSchedule.layer),
              ),
              Layer.provideMerge(
                Layer.mergeAll(
                  LocateFiles.layer,
                  LocateShellFiles.layer,
                  ReadConfiguration.layer,
                  ReadHubKeys.layer,
                  ReadMachineLogins.layer,
                  ReadKeptAnswers.layer,
                  FindCommand.layer,
                ),
              ),
              Layer.provideMerge(
                Layer.mergeAll(
                  files,
                  Cota.environment(variablesOf(drawn), drawn.system, "studio", {
                    program,
                  }),
                  hub.layer,
                  userPath.layer,
                  scheduler.layer,
                  ScriptedLoginShell.make(
                    Object.fromEntries(
                      Client.commands.map((command) => [
                        command,
                        where === undefined ? undefined : `${where}/${command}`,
                      ]),
                    ),
                  ),
                ),
              ),
            ),
          ),
        );
        expect(checks.map(({ id }) => id)).toEqual(Check.CheckId.literals);
        for (const check of checks) {
          if (check.outcome !== "failed" && check.outcome !== "warned")
            continue;
          expect(check.problem.trim()).not.toBe("");
          expect(check.fix).toMatch(fixingCommand);
        }
      }),
    { arbitrary: { runs: 500 } },
  );
});
