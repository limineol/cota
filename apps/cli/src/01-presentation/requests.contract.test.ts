import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import * as Harness from "@cota/hub/harness";
import { expect, layer } from "@effect/vitest";
import { Effect } from "effect";
import * as CurlRequestReports from "#04-infrastructure/curl-request-reports.ts";
import { written } from "#05-tests/antigravity-databases.ts";
import {
  conversationOf,
  encode,
  type Plan,
  plan,
  stepTypes,
} from "#05-tests/antigravity-records.ts";
import {
  cota,
  joined,
  type Machine,
  onAMachine,
  readerKey,
  secrets,
  subscriptionKey,
  unusedPort,
} from "#05-tests/machine.ts";

/** A conversation of two model calls, a tool's step between them. */
const opening: ReadonlyArray<Plan> = [
  plan("user"),
  plan("model", { reasoning: 30, answer: 70 }),
  plan("tool"),
  plan("model", { model: 1, reasoning: 0, answer: 25 }),
];

/** `agy`'s data folder in the machine's home, as the client makes it, with files of its own the reporter must not open. */
const dataFolderOf = (on: Machine) => {
  const folder = join(on.home, ".gemini", "antigravity-cli");
  mkdirSync(join(folder, "conversations"), { recursive: true });
  mkdirSync(join(folder, "logs"), { recursive: true });
  writeFileSync(
    join(folder, "oauth_creds.json"),
    '{"refresh_token":"1//not-a-real-token"}',
  );
  writeFileSync(join(folder, "settings.json"), "{}");
  writeFileSync(join(folder, "logs", "agy.log"), "started\n");
  return folder;
};

/** Writes a conversation's database in a data folder, closed unless the client is said to hold it open. */
const conversationIn = (
  folder: string,
  conversation: string,
  plans: ReadonlyArray<Plan>,
  options: { readonly open?: boolean; readonly subAgent?: boolean } = {},
) => {
  const db = written(join(folder, "conversations", `${conversation}.db`), {
    ...conversationOf(conversation, plans),
    subAgent: options.subAgent ?? false,
  });
  if (options.open !== true) db.close();
  return db;
};

/** What the hub shows of a session's requests, as `GET /api/sessions/{session}` answers a reader. */
const shownRequests = (session: string) =>
  Effect.gen(function* () {
    const answer = yield* Harness.send(
      `/api/sessions/${encodeURIComponent(session)}`,
      { headers: { "x-cota-key": readerKey } },
    );
    if (answer.status === 404) return [];
    expect(answer.status).toBe(200);
    const detail: {
      readonly requests: ReadonlyArray<{
        readonly model: string;
        readonly outcome: string;
        readonly outputTokens: number | null;
        readonly startedAt: string;
      }>;
    } = JSON.parse(yield* Harness.textOf(answer));
    return [...detail.requests]
      .sort((one, other) => (one.startedAt < other.startedAt ? -1 : 1))
      .map(({ model, outcome, outputTokens }) => ({
        model,
        outcome,
        outputTokens,
      }));
  });

/** How many of a session's requests the request log holds, each stored once. */
const storedOf = (session: string) =>
  Effect.map(
    Harness.InMemoryRequests,
    (memory) =>
      memory.requests.filter(({ request }) => request.session === session)
        .length,
  );

/** A machine of its own, on a hub whose request log answers every batch. */
const onANewMachine = <A, E, R>(
  test: (on: Machine) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const memory = yield* Harness.InMemoryRequests;
    memory.faults.length = 0;
    return yield* onAMachine(test);
  });

const report = (on: Machine, options: Parameters<typeof cota>[2] = {}) =>
  cota(on, ["requests", "report"], options);

const requestsCheck = (on: Machine) =>
  Effect.gen(function* () {
    const doctor = yield* cota(on, ["doctor", "--json"]);
    return {
      status: doctor.status,
      check: JSON.parse(doctor.out).checks.find(
        ({ id }: { readonly id: string }) => id === "requests",
      ),
    };
  });

const launchAgentOf = (on: Machine) =>
  join(on.home, "Library", "LaunchAgents", "cota.requests.plist");

/** Every file under a directory, with a digest of its bytes and its modification time. */
const filesOf = (directory: string) =>
  new Map(
    readdirSync(directory, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const path = join(entry.parentPath, entry.name);
        return [
          relative(directory, path),
          `${createHash("sha256").update(readFileSync(path)).digest("hex")} ${statSync(path).mtimeMs}`,
        ] as const;
      }),
  );

layer(Harness.layer())("the request reporter against a whole hub", (it) => {
  it.effect(
    "add schedules the reporter and reports every conversation the folder holds, a record growing is reported on, show says how far, and remove forgets the folder and its schedule; the hub shows each call",
    () =>
      onANewMachine((on) =>
        Effect.gen(function* () {
          const session = "c0ffee00-0000-4000-8000-00000000c001";
          const folder = dataFolderOf(on);
          conversationIn(folder, session, opening);
          yield* joined(on, [subscriptionKey]);
          expect(
            yield* cota(on, [
              "requests",
              "add",
              "antigravity",
              folder,
              "gemini",
            ]),
          ).toEqual({
            status: 0,
            out: [
              `cota: ${folder} is reported now, its model calls billing gemini.\n`,
              `cota: scheduled the request reporter every 30 seconds, by ${launchAgentOf(on)}.\n`,
              "cota: the hub stored 2 calls.\n",
            ].join(""),
            err: "",
          });
          expect(readFileSync(on.configurationFile, "utf8")).toContain(
            `[[clients.antigravity.reported]]\nfolder = "${folder}"\npool = "gemini"\n`,
          );
          expect(readFileSync(launchAgentOf(on), "utf8")).toContain(
            `<string>${on.program}</string>\n\t\t<string>requests</string>\n\t\t<string>report</string>`,
          );
          expect(yield* shownRequests(session)).toEqual([
            { model: "gemini-4-neon", outcome: "ok", outputTokens: 100 },
            { model: "gemini-4-flash", outcome: "ok", outputTokens: 25 },
          ]);

          conversationIn(folder, session, [
            ...opening,
            plan("user", { text: "Café — naïve 🚀" }),
            plan("model", { reasoning: 5, answer: 6 }),
          ]);
          expect(yield* report(on)).toEqual({
            status: 0,
            out: "cota: the hub stored 1 call.\n",
            err: "",
          });
          expect(yield* report(on)).toEqual({
            status: 0,
            out: "cota: there was nothing new to report.\n",
            err: "",
          });
          expect((yield* shownRequests(session)).at(-1)).toEqual({
            model: "gemini-4-neon",
            outcome: "ok",
            outputTokens: 11,
          });
          expect(yield* storedOf(session)).toBe(3);

          const shown = JSON.parse(
            (yield* cota(on, ["requests", "show", "--json"])).out,
          );
          expect(shown.folders).toEqual([
            {
              folder,
              pool: "gemini",
              through: expect.stringMatching(/^2026-11-12T/),
              ranAt: expect.stringMatching(/^2026-11-12T/),
              notReported: [],
            },
          ]);
          expect(shown.notKept).toEqual([]);
          const doctor = yield* requestsCheck(on);
          expect([doctor.status, doctor.check]).toEqual([
            0,
            { id: "requests", outcome: "passed", problem: null, fix: null },
          ]);

          expect(
            yield* cota(on, ["requests", "remove", "antigravity", folder]),
          ).toEqual({
            status: 0,
            out: [
              `cota: ${folder} is no longer reported; what it reported stays on the hub.\n`,
              `cota: removed the request reporter's schedule, ${launchAgentOf(on)}.\n`,
            ].join(""),
            err: "",
          });
          expect(existsSync(launchAgentOf(on))).toBe(false);
          expect(readFileSync(on.configurationFile, "utf8")).not.toContain(
            "antigravity",
          );
          expect(JSON.parse(readFileSync(on.requests, "utf8"))).toEqual({
            folders: {},
          });
          expect(
            JSON.parse((yield* cota(on, ["requests", "show", "--json"])).out)
              .notKept,
          ).toEqual([folder]);
          const given = on.launchctl.commands.flat().join("\n");
          for (const secret of secrets) expect(given).not.toContain(secret);
        }),
      ),
  );

  it.effect(
    "sends again a report whose answer was lost, and the hub stores its calls once",
    () =>
      onANewMachine((on) =>
        Effect.gen(function* () {
          const session = "c0ffee00-0000-4000-8000-00000000c002";
          const folder = dataFolderOf(on);
          conversationIn(folder, session, opening);
          const hub = yield* joined(on, [subscriptionKey]);
          (yield* Harness.InMemoryRequests).faults.push("lost");
          const lost = yield* cota(on, [
            "requests",
            "add",
            "antigravity",
            folder,
            "gemini",
          ]);
          expect(lost.status).toBe(1);
          expect(lost.err).toContain(
            `cota: ${hub} answered 503 to a report of ${folder}`,
          );
          expect(yield* report(on)).toEqual({
            status: 0,
            out: "cota: the hub stored 0 calls, and held 2 already.\n",
            err: "",
          });
          expect(yield* storedOf(session)).toBe(2);
          expect(yield* shownRequests(session)).toHaveLength(2);
        }),
      ),
  );

  it.effect(
    "refuses at add a pool that is not an observed pool, keeping nothing, and a run whose pool the hub refuses says how to name one",
    () =>
      onANewMachine((on) =>
        Effect.gen(function* () {
          const folder = dataFolderOf(on);
          conversationIn(
            folder,
            "c0ffee00-0000-4000-8000-00000000c003",
            opening,
          );
          const hub = yield* joined(on, [subscriptionKey]);
          const before = readFileSync(on.configurationFile, "utf8");
          expect(
            yield* cota(on, ["requests", "add", "antigravity", folder, "work"]),
          ).toEqual({
            status: 1,
            out: "",
            err: `cota: ${hub} has no observed pool work; its observed pools are gemini\n`,
          });
          expect(readFileSync(on.configurationFile, "utf8")).toBe(before);
          expect(existsSync(launchAgentOf(on))).toBe(false);

          writeFileSync(
            on.configurationFile,
            `${before}\n[[clients.antigravity.reported]]\nfolder = "${folder}"\npool = "work"\n`,
          );
          const refused = yield* report(on);
          expect(refused.status).toBe(1);
          expect(refused.err).toContain(
            `cota: ${hub} refused the pool work of ${folder}: `,
          );
          expect(refused.err).toContain(
            `cota requests add antigravity '${folder}' <pool> names an observed pool`,
          );
        }),
      ),
  );

  it.effect(
    "with the hub away writes requests.error, on which doctor fails, and with it back reports what waited, removes requests.error, and doctor passes",
    () =>
      onANewMachine((on) =>
        Effect.gen(function* () {
          const session = "c0ffee00-0000-4000-8000-00000000c004";
          const folder = dataFolderOf(on);
          const hub = yield* joined(on, [subscriptionKey]);
          expect(
            (yield* cota(on, [
              "requests",
              "add",
              "antigravity",
              folder,
              "gemini",
            ])).out,
          ).toContain("cota: there was nothing new to report.\n");
          conversationIn(folder, session, opening);
          const joinedConfiguration = readFileSync(
            on.configurationFile,
            "utf8",
          );
          const away = `http://127.0.0.1:${unusedPort()}`;
          writeFileSync(
            on.configurationFile,
            joinedConfiguration.replace(hub, away),
          );
          expect(yield* report(on)).toEqual({
            status: 1,
            out: "",
            err: `cota: ${away} could not be reached within 120 seconds; the calls not stored are sent by the next run\n`,
          });
          writeFileSync(on.configurationFile, joinedConfiguration);
          const error = readFileSync(on.requestsError, "utf8");
          expect(error).toMatch(
            new RegExp(
              `^2026-11-12T[0-9:.]+Z ${away.replaceAll(".", "\\.")} could not be reached`,
            ),
          );
          expect(yield* requestsCheck(on)).toEqual({
            status: 1,
            check: {
              id: "requests",
              outcome: "failed",
              problem: `the request reporter's last run failed: ${error.trim()}`,
              fix: "fix what that says, then cota requests report",
            },
          });
          expect(yield* report(on)).toEqual({
            status: 0,
            out: "cota: the hub stored 2 calls.\n",
            err: "",
          });
          expect(existsSync(on.requestsError)).toBe(false);
          expect(yield* requestsCheck(on)).toEqual({
            status: 0,
            check: {
              id: "requests",
              outcome: "passed",
              problem: null,
              fix: null,
            },
          });
        }),
      ),
  );

  it.effect(
    "lists a conversation it does not report in show, with the reason, and doctor warns of it, reporting the folder's others",
    () =>
      onANewMachine((on) =>
        Effect.gen(function* () {
          const good = "c0ffee00-0000-4000-8000-00000000c005";
          const subAgent = "c0ffee00-0000-4000-8000-00000000c006";
          const folder = dataFolderOf(on);
          conversationIn(folder, good, opening);
          conversationIn(folder, subAgent, opening, { subAgent: true });
          yield* joined(on, [subscriptionKey]);
          expect(
            (yield* cota(on, [
              "requests",
              "add",
              "antigravity",
              folder,
              "gemini",
            ])).out,
          ).toContain("cota: the hub stored 2 calls.\n");
          expect(yield* storedOf(subAgent)).toBe(0);
          expect((yield* cota(on, ["requests", "show"])).out).toContain(
            `\n  ${subAgent}: not reported (sub-agent)\n`,
          );
          expect(yield* requestsCheck(on)).toEqual({
            status: 0,
            check: {
              id: "requests",
              outcome: "warned",
              problem: `${folder}'s conversation ${subAgent} is not reported (sub-agent)`,
              fix: "cota requests show; where the reason is schema or unreadable-step, Antigravity's record changed: open an issue",
            },
          });
        }),
      ),
  );

  it.effect(
    "J23: A run opens no file of a data folder but `conversations/*.db` and their `-wal`, opens none of them to write, and leaves every file of the folder as it was.",
    () =>
      onANewMachine((on) =>
        Effect.gen(function* () {
          const session = "c0ffee00-0000-4000-8000-00000000c007";
          const folder = dataFolderOf(on);
          const client = conversationIn(folder, session, opening, {
            open: true,
          });
          try {
            const before = filesOf(folder);
            expect([...before.keys()]).toContain(
              join("conversations", `${session}.db-shm`),
            );
            yield* joined(on, [subscriptionKey]);
            expect(
              (yield* cota(on, [
                "requests",
                "add",
                "antigravity",
                folder,
                "gemini",
              ])).out,
            ).toContain("cota: the hub stored 2 calls.\n");
            expect(yield* report(on)).toEqual({
              status: 0,
              out: "cota: there was nothing new to report.\n",
              err: "",
            });
            expect(filesOf(folder)).toEqual(before);
            expect(readdirSync(join(on.state, "requests"))).toEqual([]);
          } finally {
            client.close();
          }
        }),
      ),
  );

  it.effect(
    "says a machine that has not joined has nothing to report, and writes nothing",
    () =>
      onANewMachine((on) =>
        Effect.gen(function* () {
          const folder = dataFolderOf(on);
          for (const argv of [
            ["requests", "report"],
            ["requests", "add", "antigravity", folder, "gemini"],
            ["requests", "show"],
          ]) {
            expect(yield* cota(on, argv)).toEqual({
              status: 1,
              out: "",
              err: "cota: this machine has not joined a hub. Join one: cota join <hub>\n",
            });
          }
          expect(existsSync(join(on.home, ".local"))).toBe(false);
          expect(existsSync(on.configuration)).toBe(false);
        }),
      ),
  );

  it.effect.skipIf(!existsSync("/usr/bin/curl"))(
    "sends through /usr/bin/curl, as a run on macOS does, a report of several MB, and reads a refusal through it",
    () =>
      onANewMachine((on) =>
        Effect.gen(function* () {
          const session = "c0ffee00-0000-4000-8000-00000000c008";
          const folder = dataFolderOf(on);
          const held = conversationOf(session, opening);
          // The user's message, several MB of text a person pasted.
          const pasted = `${"Café — naïve 🚀 ".repeat(200_000)}"\\`;
          const [first, ...rest] = held.steps;
          if (first === undefined) throw new Error("no first step");
          const big = {
            ...held,
            steps: [
              {
                ...first,
                payload: encode([
                  { number: 1, varint: BigInt(stepTypes.user) },
                  { number: 4, varint: 3n },
                  {
                    number: 19,
                    message: [
                      { number: 2, text: pasted },
                      {
                        number: 12,
                        message: [
                          { number: 12, text: "file:///work/acme-api" },
                        ],
                      },
                    ],
                  },
                ]),
              },
              ...rest,
            ],
          };
          written(join(folder, "conversations", `${session}.db`), big).close();
          const hub = yield* joined(on, [subscriptionKey]);
          const curl = {
            requestReports: CurlRequestReports.layer("/usr/bin/curl"),
          };
          writeFileSync(
            on.configurationFile,
            `${readFileSync(on.configurationFile, "utf8")}\n[[clients.antigravity.reported]]\nfolder = "${folder}"\npool = "work"\n`,
          );
          const refused = yield* report(on, curl);
          expect(refused.status).toBe(1);
          expect(refused.err).toContain(
            `cota: ${hub} refused the pool work of ${folder}: `,
          );
          writeFileSync(
            on.configurationFile,
            readFileSync(on.configurationFile, "utf8").replace(
              'pool = "work"',
              'pool = "gemini"',
            ),
          );
          expect(yield* report(on, curl)).toEqual({
            status: 0,
            out: "cota: the hub stored 2 calls.\n",
            err: "",
          });
          const memory = yield* Harness.InMemoryRequests;
          expect(
            memory.items.some(
              (item) =>
                item.session === session && item.content.length > pasted.length,
            ),
          ).toBe(true);
          expect(readdirSync(join(on.state, "requests"))).toEqual([]);
        }),
      ),
  );
});
