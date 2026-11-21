import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Schema } from "effect";
import { doneWord, unfinishedLineOf } from "./agent.ts";
import {
  type DoctorReport,
  type Home,
  type Observed,
  passedOf,
  verdictsOf,
} from "./criteria.ts";
import { type Command, criterionIds, type Entry } from "./runs.ts";
import { tasks } from "./tasks.ts";

const [task] = tasks;
if (task === undefined) throw new Error("no task");

const healthy: DoctorReport = {
  ok: true,
  checks: [
    { id: "config", outcome: "passed", problem: null, fix: null },
    {
      id: "clients",
      outcome: "warned",
      problem: "opencode and pi are not installed",
      fix: "install opencode, then run cota doctor",
    },
  ],
};

const sessionOf = (machine: string) => `session-${machine}`;

const command = (
  actor: Command["actor"],
  text: string,
  stdout = "",
): Command => ({
  kind: "command",
  at: "2026-11-18T09:00:00.000Z",
  actor,
  machine: "studio",
  command: text,
  cwd: "/home/owner/cota",
  stdin: false,
  exitCode: 0,
  stdout,
  stderr: "",
  seconds: 1,
});

const bashrc = "# ~/.bashrc\nalias ll='ls -l'\n";
const codex =
  'model = "gpt-5.5"\n\n[profiles.review]\nmodel = "gpt-5.5-codex"\n';

const homeWith = (
  files: Record<string, string>,
  texts: Record<string, string> = {},
): Home => ({
  path: "/home/owner",
  files: { ".bashrc": "100644:a", ".codex/config.toml": "100600:b", ...files },
  texts: { ".bashrc": bashrc, ".codex/config.toml": codex, ...texts },
});

const before = homeWith({});
const after = homeWith(
  {
    ".bashrc": "100644:c",
    ".codex/config.toml": "100600:d",
    "cota-hub/cota.toml": "100644:e",
    ".config/cota/config.toml": "100600:f",
    ".local/share/cota/bin/claude": "100755:g",
    ".claude/projects/-home-owner-src-notes/x.jsonl": "100644:h",
  },
  {
    ".bashrc": `${bashrc}export PATH="/home/owner/.local/share/cota/bin:$PATH" # cota: keep last\n`,
    ".codex/config.toml": `${codex}\n# cota: this table is rewritten by cota configure.\n[model_providers.cota-chatgpt]\nname = "OpenAI"\nbase_url = "http://studio:8080/pools/chatgpt/backend-api/codex"\n`,
  },
);

const secret = {
  name: "secret in studio:~/cota-hub/secrets/clients",
  value: "0f1e2d3c4b5a69788796a5b4c3d2e1f0",
};

/** What the eval reads from a world where the install went as the task asked. */
const perfect = (): Observed => ({
  ending: "done",
  error: null,
  doctor: Object.fromEntries(task.machines.map(({ name }) => [name, healthy])),
  requests: task.launches.map((launch) => ({
    session: sessionOf(launch.machine),
    machine: launch.machine,
    project: launch.project,
    client: "claude-code",
    pool: launch.pool,
    outcome: "ok",
  })),
  titles: task.launches.map((launch) => ({
    session: sessionOf(launch.machine),
    title: `Stand-in: ${launch.message}`,
  })),
  routes: task.routes,
  starts: Object.fromEntries(
    task.machines.map(({ name }) => [
      name,
      task.launches
        .filter((launch) => launch.machine === name)
        .map((launch) => ({
          client: "claude",
          args: ["-p", launch.message],
          cwd: `/home/owner/${launch.directory}`,
          session: sessionOf(name),
        })),
    ]),
  ),
  homes: Object.fromEntries(
    task.machines.map(({ name }) => [name, { before, after }]),
  ),
  secrets: [secret],
  transcript: [
    command(
      "installer",
      'cat "$HOME/cota-hub/secrets/clients" | apps/cli/dist/cota join "$HUB"',
      "cota: joined",
    ),
    command("owner", "bash -lic 'cd ~/src/notes && claude -p \"Say hello\"'"),
  ],
});

const failedIds = (observed: Observed) =>
  verdictsOf(task, observed)
    .filter(({ passed }) => !passed)
    .map(({ id }) => id);

const problemsOf = (observed: Observed, id: string) =>
  verdictsOf(task, observed).find((verdict) => verdict.id === id)?.problems ??
  [];

const gapNames = [
  "a machine's doctor",
  "a machine never asked",
  "the hub's requests",
  "a launch's request",
  "the hub's titles",
  "the hub's routes",
  "a machine's stand-ins",
  "a machine's home",
  "the secrets",
] as const;
type Gap = (typeof gapNames)[number];

/** Each thing the eval may fail to read, as a change of what it read. */
const gaps: Readonly<Record<Gap, (observed: Observed) => Observed>> = {
  "a machine's doctor": (observed: Observed): Observed => ({
    ...observed,
    doctor: {
      ...observed.doctor,
      laptop: { unread: "doctor printed no JSON" },
    },
  }),
  "a machine never asked": (observed: Observed): Observed => ({
    ...observed,
    doctor: Object.fromEntries(
      Object.entries(observed.doctor).filter(([name]) => name !== "studio"),
    ),
  }),
  "the hub's requests": (observed: Observed): Observed => ({
    ...observed,
    requests: { unread: "ClickHouse did not answer" },
  }),
  "a launch's request": (observed: Observed): Observed => ({
    ...observed,
    requests: Array.isArray(observed.requests)
      ? observed.requests.slice(1)
      : observed.requests,
  }),
  "the hub's titles": (observed: Observed): Observed => ({
    ...observed,
    titles: { unread: "ClickHouse did not answer" },
  }),
  "the hub's routes": (observed: Observed): Observed => ({
    ...observed,
    routes: { unread: "the sign-in was refused" },
  }),
  "a machine's stand-ins": (observed: Observed): Observed => ({
    ...observed,
    starts: {
      ...observed.starts,
      studio: { unread: "the files did not read" },
    },
  }),
  "a machine's home": (observed: Observed): Observed => ({
    ...observed,
    homes: { ...observed.homes, laptop: { unread: "its home did not read" } },
  }),
  "the secrets": (observed: Observed): Observed => ({
    ...observed,
    secrets: { unread: "the files did not read" },
  }),
};

/** The criteria that cannot pass without each. */
const failsWithout: Readonly<Record<Gap, ReadonlyArray<string>>> = {
  "a machine's doctor": ["doctor"],
  "a machine never asked": ["doctor"],
  "the hub's requests": ["requests"],
  "a launch's request": ["requests"],
  "the hub's titles": ["titles"],
  "the hub's routes": ["routes"],
  "a machine's stand-ins": ["requests", "titles", "secrets"],
  "a machine's home": ["untouched"],
  "the secrets": ["secrets"],
};

describe("the install eval's criteria", () => {
  it("passes every criterion of a world where the install went as the task asked", () => {
    expect(verdictsOf(task, perfect())).toEqual(
      criterionIds.map((id) => ({ id, passed: true, problems: [] })),
    );
  });

  it.prop(
    "E1: A run with any criterion failed, or with none, fails.",
    {
      verdicts: Arbitrary.schema(
        Schema.Array(
          Schema.Struct({
            id: Schema.Literals(criterionIds),
            passed: Schema.Boolean,
          }),
        ),
      ),
    },
    ({ verdicts }) => {
      const run = verdicts.map((verdict) => ({
        ...verdict,
        problems: verdict.passed ? [] : ["wrong"],
      }));
      expect(passedOf(run)).toBe(
        run.length > 0 && run.every(({ passed }) => passed),
      );
    },
  );

  it.prop(
    "E2: A machine, a launch or a route the eval could not read fails its criterion; nothing unobserved passes.",
    { left: Arbitrary.schema(Schema.Array(Schema.Literals(gapNames))) },
    ({ left }) => {
      const observed = left.reduce((each, gap) => gaps[gap](each), perfect());
      const failed = failedIds(observed);
      for (const gap of left) {
        for (const id of failsWithout[gap]) expect(failed).toContain(id);
      }
      expect(passedOf(verdictsOf(task, observed))).toBe(left.length === 0);
    },
  );

  it.prop(
    "E4: A run whose installer was stopped at a limit fails `ended`, naming the limit, whatever else it did.",
    { limit: Arbitrary.schema(Schema.NonEmptyString) },
    ({ limit }) => {
      const verdicts = verdictsOf(task, {
        ...perfect(),
        ending: "stopped",
        error: limit,
      });
      expect(verdicts.find(({ id }) => id === "ended")).toEqual({
        id: "ended",
        passed: false,
        problems: [`the installer was stopped at its limit of ${limit}`],
      });
      expect(passedOf(verdicts)).toBe(false);
    },
  );

  it.prop(
    "E5: A run whose agent installer's last message does not begin with the word that says it is done fails `ended`, quoting that message's first line.",
    {
      lines: Arbitrary.schema(
        Schema.Array(
          Schema.Union([
            Schema.Literals([
              doneWord,
              ` ${doneWord} `,
              `${doneWord}.`,
              `**${doneWord}**`,
              `Not ${doneWord}`,
              "",
            ]),
            Schema.String,
          ]),
        ),
      ),
    },
    ({ lines }) => {
      const last = lines.join("\n");
      const first =
        last
          .split("\n")
          .map((line) => line.trim())
          .find((line) => line !== "") ?? "";
      const said = unfinishedLineOf(last);
      expect(said === null).toBe(first === doneWord);
      if (said === null) return;
      const verdicts = verdictsOf(task, {
        ...perfect(),
        ending: "unfinished",
        error: said,
      });
      expect(verdicts.find(({ id }) => id === "ended")).toEqual({
        id: "ended",
        passed: false,
        problems: [
          `the installer ended its turn without saying it was done: ${said === "" ? "it said nothing" : `"${said}"`}`,
        ],
      });
      expect(passedOf(verdicts)).toBe(false);
    },
  );

  it("names each failed doctor check with its problem and its fix", () => {
    const failing: DoctorReport = {
      ok: false,
      checks: [
        {
          id: "titles",
          outcome: "failed",
          problem: "its last run was 7 minutes ago",
          fix: "cota titles schedule",
        },
      ],
    };
    expect(
      problemsOf(
        { ...perfect(), doctor: { ...perfect().doctor, laptop: failing } },
        "doctor",
      ),
    ).toEqual([
      "laptop: titles failed: its last run was 7 minutes ago; fix: cota titles schedule",
    ]);
  });

  it("fails a request that billed another pool than its route names", () => {
    const observed = perfect();
    const requests = Array.isArray(observed.requests)
      ? observed.requests.map((request) =>
          request.machine === "laptop"
            ? { ...request, pool: "personal" }
            : request,
        )
      : [];
    expect(problemsOf({ ...observed, requests }, "requests")).toEqual([
      'laptop, ~/src/acme-api: its request\'s pool is "personal", not "work"',
    ]);
  });

  it("finds a secret in what the installer ran, printed or said, and in a stand-in's arguments, but not in what the owner ran", () => {
    const transcript: ReadonlyArray<Entry> = [
      command("installer", `echo ${secret.value}`),
      command(
        "installer",
        "cat ~/cota-hub/secrets/clients",
        `${secret.value}\n`,
      ),
      {
        kind: "message",
        at: "2026-11-18T09:00:00.000Z",
        from: "installer",
        text: `Your key is ${secret.value}.`,
      },
      command("owner", `printf %s ${secret.value}`),
    ];
    const observed = perfect();
    const starts = {
      ...observed.starts,
      laptop: [
        {
          client: "claude",
          args: ["--key", secret.value],
          cwd: "/home/owner",
          session: null,
        },
      ],
    };
    expect(problemsOf({ ...observed, transcript, starts }, "secrets")).toEqual([
      `the ${secret.name} is in the command #1 on studio`,
      `the ${secret.name} is in what the command #2 on studio printed`,
      `the ${secret.name} is in message #3`,
      `the ${secret.name} is in the arguments of claude on laptop`,
    ]);
  });

  it("fails a title the installer may have sent itself after the launches, and not one it only looked for", () => {
    const observed = perfect();
    const ran = [
      "apps/cli/dist/cota titles report",
      "cd ~/cota && '/home/owner/cota/apps/cli/dist/cota' titles report; echo $?",
      '"$COTA" titles report',
    ];
    for (const run of ran) {
      const transcript = [...observed.transcript, command("installer", run)];
      expect(problemsOf({ ...observed, transcript }, "titles")).toEqual([
        "the installer ran cota titles report after the launches, so a title may not have come from the schedule",
      ]);
    }
    const looked = [
      "crontab -l | grep -c 'titles report'",
      "cd ~/src/acme-api && ~/cota/apps/cli/dist/cota route; crontab -l | grep -c 'titles report'",
    ];
    for (const look of looked) {
      const transcript = [...observed.transcript, command("installer", look)];
      expect(problemsOf({ ...observed, transcript }, "titles")).toEqual([]);
    }
  });

  it("allows cota's part of the owner's shell file and Codex's configuration, and nothing else of theirs", () => {
    const changed = homeWith(
      {
        ".bashrc": "100644:c",
        ".codex/config.toml": "100600:d",
        ".gitconfig": "100644:i",
      },
      {
        ".bashrc": `alias ll='ls -la'\nexport PATH="/x:$PATH" # cota: keep last\n`,
        ".codex/config.toml": `${codex}\n# cota: this table is rewritten by cota configure.\n[model_providers.cota-chatgpt]\nname = "OpenAI"\n\n[features]\nweb_search = true\n`,
      },
    );
    const observed = perfect();
    expect(
      problemsOf(
        {
          ...observed,
          homes: { ...observed.homes, studio: { before, after: changed } },
        },
        "untouched",
      ),
    ).toEqual([
      "studio: ~/.bashrc: changed beyond cota's part",
      "studio: ~/.codex/config.toml: changed beyond cota's part",
      "studio: ~/.gitconfig: added",
    ]);
  });
});
