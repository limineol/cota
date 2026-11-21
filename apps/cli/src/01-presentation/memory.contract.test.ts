import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import * as Harness from "@cota/hub/harness";
import { expect, layer } from "@effect/vitest";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import {
  cota,
  joined,
  type Machine,
  onAMachine,
  readerKey,
  subscriptionKey,
} from "#05-tests/machine.ts";

const readerKeyFile = (on: Machine) =>
  join(on.configuration, "hub-keys", "reader");

const longAnswer = `${"The retries back off. ".repeat(40)}Done.`;

/** A session of Claude Code's on the hub: one main request through the pool `claude`, its answer long enough to be cut. */
const sessionOnTheHub = (session: string) =>
  Effect.gen(function* () {
    const fake = yield* Harness.FakeProvider.FakeProvider;
    fake.answer({
      headers: [["content-type", "application/json"]],
      chunks: [
        JSON.stringify({
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "claude-opus-5-5",
          content: [{ type: "text", text: longAnswer }],
          stop_reason: "end_turn",
          usage: { input_tokens: 12, output_tokens: 7 },
        }),
      ],
    });
    yield* Harness.send("/pools/claude/v1/messages", {
      method: "POST",
      headers: {
        "x-cota-key": subscriptionKey,
        authorization: "Bearer sk-ant-oat01-a-login-for-the-memory",
        "content-type": "application/json",
        "x-claude-code-session-id": session,
        "x-claude-code-request-class": "main",
        "user-agent": "claude-cli/2.1.322 (external, cli)",
      },
      body: JSON.stringify({
        model: "claude-opus-5-5",
        max_tokens: 1000,
        system: "You are a coding agent.",
        messages: [{ role: "user", content: "Why do the webhooks retry?" }],
      }),
    }).pipe(Effect.andThen(Harness.textOf));
    yield* Harness.recorded(1);
    yield* TestClock.adjust("1 minute");
  });

/** A machine joined to the hub with its subscription key, keeping the reader key given on standard input. */
const remembering = (on: Machine) =>
  Effect.gen(function* () {
    yield* joined(on, [subscriptionKey]);
    const kept = yield* cota(on, ["memory", "key"], { input: [readerKey] });
    expect(kept).toMatchObject({
      status: 0,
      out: "cota: kept the reader key; cota memory reads the request log with it.\n",
    });
  });

layer(Harness.layer())("cota memory against a whole hub", (it) => {
  it.effect(
    "O3: the reader key, given on standard input, is kept 0600 and reaches the hub only in x-cota-key, never in what any subcommand prints",
    () =>
      onAMachine((on) =>
        Effect.gen(function* () {
          yield* Harness.forgetEverything;
          yield* sessionOnTheHub("memory-1");
          yield* remembering(on);
          expect(readFileSync(readerKeyFile(on), "utf8")).toBe(
            `${readerKey}\n`,
          );
          expect(statSync(readerKeyFile(on)).mode & 0o777).toBe(0o600);

          const listed = yield* cota(on, [
            "memory",
            "get",
            "/api/sessions",

            "q=webhooks retry",
          ]);
          expect(listed.status).toBe(0);
          const sessions: {
            readonly sessions: ReadonlyArray<{ readonly id: string }>;
          } = JSON.parse(listed.out);
          expect(sessions.sessions.map(({ id }) => id)).toEqual(["memory-1"]);

          const page = yield* cota(on, [
            "memory",
            "transcript",
            "memory-1",
            "--entries",
            "2",
            "--cut",
            "40",
          ]);
          expect(page.status).toBe(0);
          const lines = page.out.split("\n");
          expect(lines[0]).toMatch(
            /^session memory-1: segment 1 of 1, read from its tip \S+ \(anthropic-messages\), 3 entries$/,
          );
          expect(lines[1]).toMatch(/^segment 1: 1 request from \S+, tip \S+$/);
          expect(lines.slice(2)).toEqual([
            "#1 system, system message",
            "You are a coding agent.",
            "#2 input, user message",
            "Why do the webhooks retry?",
            "entries 1 to 2 of 3; the next page: --from 3",
            "",
          ]);
          const tip = lines[0]?.match(/tip (\S+)/)?.[1] ?? "";

          const last = yield* cota(on, [
            "memory",
            "transcript",
            "--request",
            tip,
            "--from=3",
            "--cut=40",
          ]);
          expect(last.status).toBe(0);
          expect(last.out).toBe(
            [
              `request ${tip} (anthropic-messages), 3 entries`,
              "#3 output, assistant message",
              Array.from(longAnswer).slice(0, 40).join(""),
              `… [${longAnswer.length - 40} characters left out]`,
              "entries 3 to 3 of 3; that is the last.",
              "",
            ].join("\n"),
          );

          const schema = yield* cota(on, ["memory", "get", "/api/schema"]);
          expect(schema).toMatchObject({ status: 0, err: "" });
          expect(JSON.parse(schema.out)).toEqual({
            database: "cota",
            tables: [],
          });

          const refused = yield* cota(on, ["memory", "sql"], {
            input: ["SELECT count() FROM requests"],
          });
          expect(refused.status).toBe(1);
          expect(refused.err).toMatch(
            /^cota: the hub answered 400: \{.*"type":"urn:cota:query-failed".*\}\n$/,
          );

          const missing = yield* cota(on, [
            "memory",
            "transcript",
            "no-such-session",
          ]);
          expect(missing).toMatchObject({
            status: 1,
            err: 'cota: the hub answered 404: The request log has no session "no-such-session".\n',
          });
        }),
      ),
  );

  it.effect(
    "O3: a reader key typed at the prompt is kept; a key of another scope, or one the hub does not know, is refused without being printed or written",
    () =>
      onAMachine((on) =>
        Effect.gen(function* () {
          yield* joined(on, [subscriptionKey]);
          const other = yield* cota(on, ["memory", "key"], {
            input: [subscriptionKey],
          });
          expect(other).toMatchObject({
            status: 1,
            err: "cota: that is a subscription hub key; cota memory needs a reader key, which opens no pool\n",
          });
          const unknown = yield* cota(on, ["memory", "key"], {
            input: ["not-a-key-of-the-hub"],
          });
          expect(unknown.status).toBe(1);
          expect(unknown.err).toMatch(
            /does not know that key, so it was not kept\n$/,
          );
          expect(existsSync(readerKeyFile(on))).toBe(false);

          const typed = yield* cota(on, ["memory", "key"], {
            typed: [readerKey],
          });
          expect(typed.status).toBe(0);
          expect(readFileSync(readerKeyFile(on), "utf8")).toBe(
            `${readerKey}\n`,
          );
        }),
      ),
  );

  it.effect(
    "O3: without a reader key, or with one the hub no longer knows, each subcommand says so and prints nothing of the hub's",
    () =>
      onAMachine((on) =>
        Effect.gen(function* () {
          const hub = yield* joined(on, [subscriptionKey]);
          const none = yield* cota(on, ["memory", "get", "/api/schema"]);
          expect(none).toMatchObject({
            status: 1,
            out: "",
            err: "cota: this machine keeps no reader key; the owner gives it one with cota memory key.\n",
          });
          mkdirSync(dirname(readerKeyFile(on)), { recursive: true });
          writeFileSync(readerKeyFile(on), "a-reader-key-the-hub-forgot\n", {
            mode: 0o600,
          });
          const forgotten = `cota: ${hub} does not know this machine's reader key; the owner gives it again with cota memory key.\n`;
          for (const argv of [
            ["memory", "get", "/api/schema"],
            ["memory", "transcript", "memory-1"],
          ]) {
            expect(yield* cota(on, argv)).toMatchObject({
              status: 1,
              out: "",
              err: forgotten,
            });
          }
          expect(
            yield* cota(on, ["memory", "sql"], { input: ["SELECT 1"] }),
          ).toMatchObject({ status: 1, out: "", err: forgotten });
        }),
      ),
  );
});
