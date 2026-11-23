import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as Harness from "@cota/hub/harness";
import { expect } from "@effect/vitest";
import { Effect, type Layer } from "effect";
import type { Hub } from "#02-application/interfaces/hub.ts";
import type { RequestReports } from "#02-application/interfaces/request-reports.ts";
import type { TitleReports } from "#02-application/interfaces/title-reports.ts";
import type { Variables } from "#03-domain/system.ts";
import * as HttpHub from "#04-infrastructure/http-hub.ts";
import * as HttpRequestReports from "#04-infrastructure/http-request-reports.ts";
import * as HttpTitleReports from "#04-infrastructure/http-title-reports.ts";
import * as NodeFiles from "#04-infrastructure/node-files.ts";
import * as NodeProcesses from "#04-infrastructure/node-processes.ts";
import * as NodeRunLock from "#04-infrastructure/node-run-lock.ts";
import * as NodeTitleSources from "#04-infrastructure/node-title-sources.ts";
import * as ProcessLoginShell from "#04-infrastructure/process-login-shell.ts";
import * as SqliteClientRecords from "#04-infrastructure/sqlite-client-records.ts";
import * as SystemScheduler from "#04-infrastructure/system-scheduler.ts";
import * as Cota from "./cota.ts";
import * as RecordingRun from "./fakes/recording-run.ts";
import * as ScriptedTerminal from "./fakes/scripted-terminal.ts";

export const subscriptionKey = Harness.secrets.clientsHubKey;
export const keyedKey = Harness.secrets.fleetHubKey;
export const readerKey = Harness.secrets.readerHubKey;
/** A machine login, as `claude setup-token` would print one. */
export const machineLogin = "sk-ant-oat01-machine-login-for-claude-7c1e";
export const secrets = [...Object.values(Harness.secrets), machineLogin];

/** The remote the stand-in `git` gives, with a token in its user information that no project may hold. */
export const remote =
  "https://ci:ghp_token-in-remote-55aa@github.com/Acme/API.git";

const cliSource = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * A stand-in client, linked to from `PATH` as a package manager links a
 * client's own script: it writes the arguments and environment it was given
 * beside itself (beside the script, not the link), as JSON, and then exits with `--exit=<status>`, kills itself
 * with `--kill=<signal>`, or with `--wait` says it is ready and waits to be
 * signalled. It is never a real client.
 */
const standIn = `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
const self = fs.realpathSync(__filename);
fs.writeFileSync(self + ".seen", JSON.stringify({ args, env: process.env }));
const exit = args.find((arg) => arg.startsWith("--exit="));
const kill = args.find((arg) => arg.startsWith("--kill="));
if (args.includes("--wait")) {
  fs.writeFileSync(self + ".ready", "");
  setTimeout(() => {}, 60000);
} else if (kill !== undefined) {
  process.kill(process.pid, kill.slice("--kill=".length));
} else {
  process.exit(exit === undefined ? 0 : Number(exit.slice("--exit=".length)));
}
`;

const standInGit = `#!/bin/sh
if [ "$1 $2 $3" = "remote get-url origin" ]; then
  echo '${remote}'
  exit 0
fi
exit 1
`;

/** What a stand-in client was given. */
export interface Seen {
  readonly args: ReadonlyArray<string>;
  readonly env: Readonly<Record<string, string>>;
}

/**
 * A machine of its own, all in a temporary directory: a home, a working
 * directory, a `PATH` of stand-ins for the four clients and `git`, and a
 * `cota` that runs this checkout's `main.ts`. It is all `cota` reads and
 * writes.
 */
export const machine = () => {
  const root = mkdtempSync(join(tmpdir(), "cota-cli-"));
  const home = join(root, "home");
  const bin = join(root, "bin");
  const clients = join(root, "clients");
  const work = join(root, "work", "acme-api");
  const program = join(root, "cota");
  for (const directory of [home, bin, clients, work]) {
    mkdirSync(directory, { recursive: true });
  }
  for (const client of ["claude", "codex", "opencode", "pi"]) {
    writeFileSync(join(clients, client), standIn, { mode: 0o755 });
    symlinkSync(join(clients, client), join(bin, client));
  }
  writeFileSync(join(bin, "git"), standInGit, { mode: 0o755 });
  writeFileSync(
    program,
    `#!/bin/sh\nexec '${process.execPath}' '${join(cliSource, "main.ts")}' "$@"\n`,
    { mode: 0o755 },
  );
  const configuration = join(home, ".config", "cota");
  const shims = join(home, ".local", "share", "cota", "bin");
  const state = join(home, ".local", "state", "cota");
  return {
    root,
    home,
    bin,
    work,
    program,
    configuration,
    configurationFile: join(configuration, "config.toml"),
    hubKey: (scope: "subscription" | "keyed") =>
      join(configuration, "hub-keys", scope),
    login: (pool: string) => join(configuration, "logins", pool),
    state,
    routes: join(state, "routes.json"),
    titles: join(state, "titles.json"),
    titlesError: join(state, "titles.error"),
    requests: join(state, "requests.json"),
    requestsError: join(state, "requests.error"),
    launchAgent: join(home, "Library", "LaunchAgents", "cota.titles.plist"),
    /** The stand-in for `launchctl`, which records what it is given and runs nothing. */
    launchctl: RecordingRun.make(),
    shims,
    profile: join(home, ".profile"),
    clientFile: {
      codex: join(home, ".codex", "config.toml"),
      opencode: join(home, ".config", "opencode", "opencode.json"),
      pi: join(home, ".pi", "agent", "models.json"),
    },
    /** The environment a person's shell gives `cota` on this machine. */
    variables: {
      HOME: home,
      PATH: `${shims}:${bin}`,
      SHELL: "/bin/sh",
    } satisfies Variables,
    seen: (client: string): Seen =>
      JSON.parse(readFileSync(join(clients, `${client}.seen`), "utf8")),
    forget: (client: string) =>
      rmSync(join(clients, `${client}.seen`), { force: true }),
    wasStarted: (client: string) => existsSync(join(clients, `${client}.seen`)),
    remove: () => rmSync(root, { recursive: true, force: true }),
    uninstall: (client: string) => chmodSync(join(bin, client), 0o644),
  };
};
export type Machine = ReturnType<typeof machine>;

export const onAMachine = <A, E, R>(
  test: (on: Machine) => Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(Effect.sync(machine), test, (on) =>
    Effect.sync(on.remove),
  );

/**
 * Runs `cota` in this process on a machine, as a person would: standard
 * input holding the lines given (or a terminal, where the lines `typed` are
 * typed at its prompts), the machine's environment with the variables given
 * over it, the hub reached over HTTP or through the layer given, and its
 * clients started as children. Nothing it prints may hold a secret.
 */
export const cota = (
  on: Machine,
  argv: ReadonlyArray<string>,
  options: {
    readonly input?: ReadonlyArray<string>;
    readonly typed?: ReadonlyArray<string>;
    readonly variables?: Variables;
    readonly hub?: Layer.Layer<Hub>;
    readonly titleReports?: Layer.Layer<TitleReports>;
    readonly requestReports?: Layer.Layer<RequestReports>;
  } = {},
) =>
  Effect.gen(function* () {
    const terminal = ScriptedTerminal.make({
      input: (options.input ?? []).join("\n"),
      ...(options.typed === undefined ? {} : { typed: options.typed }),
    });
    const status = yield* Cota.run(argv, {
      files: NodeFiles.layer,
      environment: Cota.environment(
        { ...on.variables, ...options.variables },
        "darwin",
        "Studio.local",
        { workingDirectory: on.work, program: on.program },
      ),
      terminal: terminal.layer,
      hub: options.hub ?? HttpHub.layer,
      processes: NodeProcesses.layer({ replace: false }),
      loginShell: ProcessLoginShell.layer,
      titleSources: NodeTitleSources.layer,
      titleReports: options.titleReports ?? HttpTitleReports.layer,
      scheduler: SystemScheduler.layer({
        system: "darwin",
        uid: 501,
        run: on.launchctl.run,
      }),
      clientRecords: SqliteClientRecords.layer,
      requestReports: options.requestReports ?? HttpRequestReports.layer,
      runLock: NodeRunLock.layer,
    });
    const out = terminal.printed.out.join("");
    const err = terminal.printed.err.join("");
    for (const secret of secrets) {
      expect(out).not.toContain(secret);
      expect(err).not.toContain(secret);
    }
    return { status, out, err };
  });

export const joined = (on: Machine, keys: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const hub = yield* Harness.hubUrl;
    const joining = yield* cota(on, ["join", hub], { input: keys });
    expect(joining.status).toBe(0);
    return hub;
  });

/** Replaces a routed client's routes on the hub, signed in as the owner. */
export const routesOf = (
  client: "claude-code" | "codex",
  routes: ReadonlyArray<{ readonly pattern: string; readonly pool: string }>,
  defaultPool: string | null,
) =>
  Effect.gen(function* () {
    const owner = yield* Harness.signIn();
    const listed = yield* Harness.send("/api/routes", { headers: owner });
    const lists: {
      readonly clients: ReadonlyArray<{
        readonly client: string;
        readonly revision: number;
      }>;
    } = JSON.parse(yield* Harness.textOf(listed));
    const revision =
      lists.clients.find((each) => each.client === client)?.revision ?? 0;
    const stored = yield* Harness.send(`/api/routes/${client}`, {
      method: "PUT",
      headers: { ...owner, "content-type": "application/json" },
      body: JSON.stringify({ revision, routes, defaultPool }),
    });
    expect(stored.status).toBe(200);
  });

/** The models the fake provider lists for every pool's `GET /models`: one with the hub's facts, one without. */
export const listedModels = ["glm-4.6", "glm-made-up"];

/** Has the fake provider list `listedModels`, and answer `{}` to anything else. */
export const listing = Effect.gen(function* () {
  const fake = yield* Harness.FakeProvider.FakeProvider;
  fake.answer((seen) =>
    seen.method === "GET" && seen.target.endsWith("/models")
      ? {
          headers: [["content-type", "application/json"]],
          chunks: [
            JSON.stringify({
              object: "list",
              data: listedModels.map((id) => ({ id, object: "model" })),
            }),
          ],
        }
      : { chunks: ["{}"] },
  );
});

export const unusedPort = (): number => {
  const server = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = server.port ?? 9;
  server.stop(true);
  return port;
};
