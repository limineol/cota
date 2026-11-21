import { Database } from "bun:sqlite";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import * as Harness from "@cota/hub/harness";
import { expect, layer } from "@effect/vitest";
import { Effect } from "effect";
import * as CurlTitleReports from "#04-infrastructure/curl-title-reports.ts";
import {
  cota,
  joined,
  type Machine,
  onAMachine,
  readerKey,
  secrets,
  subscriptionKey,
} from "#05-tests/machine.ts";

const fleet = { "x-cota-key": Harness.secrets.fleetHubKey };

/** A session on the hub: one request of OpenCode's through the pool `work`, with the session's id. */
const sessionOnTheHub = (session: string) =>
  Effect.gen(function* () {
    const fake = yield* Harness.FakeProvider.FakeProvider;
    fake.answer({
      headers: [["content-type", "application/json"]],
      chunks: [
        JSON.stringify({
          id: "chatcmpl-1",
          model: "glm-5.2",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "On it." },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
        }),
      ],
    });
    yield* Harness.send("/pools/work/chat/completions", {
      method: "POST",
      headers: {
        ...fleet,
        "content-type": "application/json",
        "x-session-affinity": session,
        "user-agent": "opencode/1.2.3",
      },
      body: JSON.stringify({
        model: "glm-5.2",
        messages: [{ role: "user", content: "Name this session." }],
      }),
    }).pipe(Effect.andThen(Harness.textOf));
    yield* Harness.recorded(1);
  });

/** The title the hub shows for a session, as `GET /api/sessions/{session}` answers a reader. */
const shownTitle = (session: string) =>
  Effect.gen(function* () {
    const answer = yield* Harness.send(
      `/api/sessions/${encodeURIComponent(session)}`,
      { headers: { "x-cota-key": readerKey } },
    );
    expect(answer.status).toBe(200);
    const detail: {
      readonly session: {
        readonly title: {
          readonly text: string;
          readonly source: string;
          readonly machine?: string;
        } | null;
      };
    } = JSON.parse(yield* Harness.textOf(answer));
    return detail.session.title;
  });

/** A machine of its own, on a hub that has kept no title yet and keeps them. */
const onANewMachine = <A, E, R>(
  test: (on: Machine) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const memory = yield* Harness.InMemorySessionTitles;
    memory.reports.length = 0;
    memory.fails = false;
    return yield* onAMachine(test);
  });

/** Every report the hub kept, in order: session, title and machine. */
const reports = Effect.map(Harness.InMemorySessionTitles, (memory) =>
  memory.reports.map(({ session, title, machine }) => [
    session,
    title,
    machine,
  ]),
);

const transcriptOf = (on: Machine, session: string) =>
  join(on.home, ".claude", "projects", "-work-acme-api", `${session}.jsonl`);

const lineOf = (entry: object) => `${JSON.stringify(entry)}\n`;

const write = (path: string, text: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

const customTitle = (title: string) =>
  lineOf({ type: "custom-title", customTitle: title, sessionId: "s" });
const aiTitle = (title: string) =>
  lineOf({ type: "ai-title", aiTitle: title, sessionId: "s" });
const userLine = lineOf({
  type: "user",
  message: { role: "user", content: "Fix the relay" },
});

/** T3 Code's database, with its threads and the client thread behind each, as the prototype read them. */
const t3Database = (
  on: Machine,
  threads: ReadonlyArray<{
    readonly session: string;
    readonly title: string;
    readonly deleted?: boolean;
  }>,
) => {
  const path = join(on.home, ".t3", "userdata", "statev2.sqlite");
  mkdirSync(dirname(path), { recursive: true });
  rmSync(path, { force: true });
  const db = new Database(path, { create: true });
  db.run(
    "CREATE TABLE orchestration_v2_projection_threads (thread_id TEXT PRIMARY KEY, title TEXT, deleted_at TEXT)",
  );
  db.run(
    "CREATE TABLE orchestration_v2_projection_provider_threads (thread_id TEXT, payload_json TEXT)",
  );
  threads.forEach(({ session, title, deleted }, index) => {
    db.run("INSERT INTO orchestration_v2_projection_threads VALUES (?, ?, ?)", [
      `thread-${index}`,
      title,
      deleted === true ? "2026-11-10T00:00:00Z" : null,
    ]);
    db.run(
      "INSERT INTO orchestration_v2_projection_provider_threads VALUES (?, ?)",
      [
        `thread-${index}`,
        JSON.stringify({ nativeThreadRef: { nativeId: session } }),
      ],
    );
  });
  db.close();
};

const codexIndexOf = (on: Machine) =>
  join(on.home, ".codex", "session_index.jsonl");

const report = (on: Machine, options: Parameters<typeof cota>[2] = {}) =>
  cota(on, ["titles", "report"], options);

layer(Harness.layer())("the title reporter against a whole hub", (it) => {
  it.effect(
    "reports what Claude Code, Codex and T3 Code say of each session, T3 Code's title first, then the owner's name, the generated one and Codex's, and the hub shows each",
    () =>
      onANewMachine((on) =>
        Effect.gen(function* () {
          const sessions = ["claude-1", "t3-2", "codex-3", "deleted-4"];
          for (const session of sessions) yield* sessionOnTheHub(session);
          write(
            transcriptOf(on, "claude-1"),
            `${userLine}${aiTitle("Generated one")}${customTitle("  Named by the owner  ")}`,
          );
          write(transcriptOf(on, "t3-2"), aiTitle("Generated two"));
          write(
            codexIndexOf(on),
            [
              lineOf({ id: "codex-3", thread_name: "First name" }),
              lineOf({ id: "codex-3", thread_name: "Codex's thread" }),
              lineOf({ id: "deleted-4", thread_name: "Codex names it" }),
              lineOf({ id: "t3-2", thread_name: "Codex loses to T3" }),
            ].join(""),
          );
          t3Database(on, [
            { session: "t3-2", title: "Shown in T3 Code" },
            { session: "deleted-4", title: "A deleted thread", deleted: true },
          ]);
          yield* joined(on, [subscriptionKey]);
          expect((yield* reports).sort()).toEqual(
            [
              ["codex-3", "Codex's thread", "studio"],
              ["deleted-4", "Codex names it", "studio"],
              ["t3-2", "Shown in T3 Code", "studio"],
              ["claude-1", "Named by the owner", "studio"],
            ].sort(),
          );
          expect(yield* shownTitle("claude-1")).toEqual(
            expect.objectContaining({
              text: "Named by the owner",
              source: "reported",
              machine: "studio",
            }),
          );
          expect((yield* shownTitle("t3-2"))?.text).toBe("Shown in T3 Code");
          expect((yield* shownTitle("codex-3"))?.text).toBe("Codex's thread");
          expect((yield* shownTitle("deleted-4"))?.text).toBe("Codex names it");
          expect(yield* report(on)).toEqual({
            status: 0,
            out: "cota: there was no new title to send.\n",
            err: "",
          });
          expect((yield* reports).length).toBe(4);
        }),
      ),
  );

  it.effect(
    "reads a transcript on as it grows, leaving a line written in half for the next run, and sends a title only when it changed",
    () =>
      onANewMachine((on) =>
        Effect.gen(function* () {
          yield* joined(on, [subscriptionKey]);
          const transcript = transcriptOf(on, "growing");
          write(transcript, userLine);
          const whole = aiTitle("Café — the relay’s hang-up 🚀");
          const bytes = Buffer.from(whole);
          const cut = bytes.subarray(0, bytes.indexOf("é") + 1);
          appendFileSync(transcript, cut);
          expect((yield* report(on)).out).toBe(
            "cota: there was no new title to send.\n",
          );
          appendFileSync(transcript, bytes.subarray(cut.length));
          expect((yield* report(on)).out).toBe("cota: the hub kept 1 title.\n");
          appendFileSync(transcript, userLine);
          expect((yield* report(on)).out).toBe(
            "cota: there was no new title to send.\n",
          );
          appendFileSync(transcript, customTitle("Renamed"));
          expect((yield* report(on)).out).toBe("cota: the hub kept 1 title.\n");
          expect(yield* reports).toEqual([
            ["growing", "Café — the relay’s hang-up 🚀", "studio"],
            ["growing", "Renamed", "studio"],
          ]);
          const state = JSON.parse(readFileSync(on.titles, "utf8"));
          expect(state.transcripts[transcript].offset).toBe(
            readFileSync(transcript).length,
          );
        }),
      ),
  );

  it.effect(
    "skips on its first run a transcript untouched for 14 days, and reads one that is not",
    () =>
      onANewMachine((on) =>
        Effect.gen(function* () {
          write(transcriptOf(on, "old"), customTitle("From last month"));
          write(transcriptOf(on, "recent"), customTitle("From this week"));
          const monthAgo = new Date("2026-10-12T00:00:00Z");
          utimesSync(transcriptOf(on, "old"), monthAgo, monthAgo);
          yield* joined(on, [subscriptionKey]);
          expect(yield* reports).toEqual([
            ["recent", "From this week", "studio"],
          ]);
        }),
      ),
  );

  it.effect(
    "keeps a batch the hub refused for the next run, writing titles.error, which doctor fails on, and removes it once the hub keeps the batch",
    () =>
      onANewMachine((on) =>
        Effect.gen(function* () {
          const hub = yield* joined(on, [subscriptionKey]);
          const memory = yield* Harness.InMemorySessionTitles;
          memory.fails = true;
          write(transcriptOf(on, "refused"), customTitle("Sent twice"));
          expect(yield* report(on)).toEqual({
            status: 1,
            out: "",
            err: `cota: ${hub} answered 503 to the titles; the titles not sent are sent by the next run\n`,
          });
          expect(readFileSync(on.titlesError, "utf8")).toMatch(
            new RegExp(
              `^2026-11-12T[0-9:.]+Z ${hub.replaceAll(".", "\\.")} answered 503 to the titles; the titles not sent are sent by the next run\\n$`,
            ),
          );
          const doctor = yield* cota(on, ["doctor", "--json"]);
          expect(doctor.status).toBe(1);
          const titles = JSON.parse(doctor.out).checks.at(-1);
          expect(titles).toEqual({
            id: "titles",
            outcome: "failed",
            problem: `the title reporter's last run failed: ${readFileSync(on.titlesError, "utf8").trim()}`,
            fix: "fix what that says, then cota titles report",
          });
          memory.fails = false;
          expect(yield* report(on)).toEqual({
            status: 0,
            out: "cota: the hub kept 1 title.\n",
            err: "",
          });
          expect(existsSync(on.titlesError)).toBe(false);
          expect(memory.reports.map(({ title }) => title)).toEqual([
            "Sent twice",
          ]);
          expect((yield* cota(on, ["doctor"])).status).toBe(0);
        }),
      ),
  );

  it.effect(
    "schedules itself with launchd once, replacing nothing that is in place, is removed by cota titles schedule --remove, and doctor fails until it is scheduled again; no secret reaches launchctl",
    () =>
      onANewMachine((on) =>
        Effect.gen(function* () {
          yield* joined(on, [subscriptionKey]);
          expect(readFileSync(on.launchAgent, "utf8")).toContain(
            `<string>${on.program}</string>\n\t\t<string>titles</string>\n\t\t<string>report</string>`,
          );
          expect(yield* cota(on, ["titles", "schedule"])).toEqual({
            status: 0,
            out: `cota: the title reporter is scheduled every 30 seconds already, by ${on.launchAgent}; nothing changed.\n`,
            err: "",
          });
          expect(yield* cota(on, ["titles", "schedule", "--remove"])).toEqual({
            status: 0,
            out: `cota: removed the title reporter's schedule, ${on.launchAgent}.\n`,
            err: "",
          });
          expect(existsSync(on.launchAgent)).toBe(false);
          expect(
            (yield* cota(on, ["titles", "schedule", "--remove"])).out,
          ).toBe(
            "cota: the title reporter was not scheduled; there was nothing to remove.\n",
          );
          const doctor = yield* cota(on, ["doctor"]);
          expect(doctor.status).toBe(1);
          expect(doctor.out).toContain(
            "failed   titles    the title reporter is not scheduled\n                   fix: cota titles schedule\n",
          );
          expect((yield* cota(on, ["titles", "schedule"])).out).toBe(
            `cota: scheduled the title reporter every 30 seconds, by ${on.launchAgent}.\n`,
          );
          expect((yield* cota(on, ["doctor"])).status).toBe(0);
          const given = on.launchctl.commands.flat().join("\n");
          for (const secret of secrets) expect(given).not.toContain(secret);
          expect(on.launchctl.commands).toContainEqual([
            "launchctl",
            "bootstrap",
            "gui/501",
            on.launchAgent,
          ]);
        }),
      ),
  );

  it.effect(
    "says a machine that has not joined has nothing to report, and writes nothing",
    () =>
      onANewMachine((on) =>
        Effect.gen(function* () {
          expect(yield* report(on)).toEqual({
            status: 1,
            out: "",
            err: "cota: this machine has not joined a hub. Join one: cota join <hub>\n",
          });
          expect(existsSync(join(on.home, ".local"))).toBe(false);
        }),
      ),
  );

  it.effect.skipIf(!existsSync("/usr/bin/curl"))(
    "sends through /usr/bin/curl, as a run on macOS does, the title's quotes, backslashes and characters intact",
    () =>
      onANewMachine((on) =>
        Effect.gen(function* () {
          yield* joined(on, [subscriptionKey]);
          yield* sessionOnTheHub("through-curl");
          const title = 'He said "ship it" \\ to the café 🚀';
          write(transcriptOf(on, "through-curl"), customTitle(title));
          expect(
            yield* report(on, {
              titleReports: CurlTitleReports.layer("/usr/bin/curl"),
            }),
          ).toEqual({
            status: 0,
            out: "cota: the hub kept 1 title.\n",
            err: "",
          });
          expect(yield* shownTitle("through-curl")).toEqual(
            expect.objectContaining({ text: title, machine: "studio" }),
          );
          (yield* Harness.InMemorySessionTitles).fails = true;
          write(transcriptOf(on, "through-curl"), customTitle("Refused"));
          const refused = yield* report(on, {
            titleReports: CurlTitleReports.layer("/usr/bin/curl"),
          });
          (yield* Harness.InMemorySessionTitles).fails = false;
          expect(refused.status).toBe(1);
          expect(refused.err).toContain("answered 503 to the titles");
        }),
      ),
  );
});
