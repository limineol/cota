import { expect, layer } from "@effect/vitest";
import { DateTime, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { InMemoryRequests } from "#modules/request-log/05-tests/fakes/in-memory-requests.repository.ts";
import { InMemorySessionTitles } from "#modules/request-log/05-tests/fakes/in-memory-session-titles.ts";
import * as Generated from "#modules/request-log/05-tests/traffic.ts";
import * as FakeProvider from "#shared/05-tests/fake-provider.ts";
import * as Harness from "#shared/05-tests/harness.ts";

const fleet = { "x-cota-key": Harness.secrets.fleetHubKey };
const reader = { "x-cota-key": Harness.secrets.readerHubKey };

const chat = (session: string, prompt: string) =>
  Effect.gen(function* () {
    const fake = yield* FakeProvider.FakeProvider;
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
        "x-cota-machine": "workstation",
        "user-agent": "opencode/1.2.3",
      },
      body: JSON.stringify({
        model: "glm-5.2",
        tools: [{ type: "function", function: { name: "read" } }],
        messages: [
          { role: "system", content: "You are OpenCode." },
          { role: "user", content: prompt },
        ],
      }),
    }).pipe(Effect.andThen(Harness.textOf));
  });

const report = (
  headers: Record<string, string>,
  titles: Record<string, string>,
) =>
  Harness.send("/api/session-titles", {
    method: "PUT",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ titles }),
  });

const listed = Effect.gen(function* () {
  const client = yield* Harness.api(reader);
  const { sessions, total } = yield* client.sessions.sessions({ query: {} });
  return {
    total,
    sessions: Generated.plain(
      sessions.map(({ id, requests, title, firstPrompt }) => ({
        id,
        requests,
        title,
        firstPrompt,
      })),
    ),
  };
});

layer(Harness.layer())("the sessions group", (it) => {
  it.effect(
    "lists the sessions the pool routes sent, each with its first prompt and the title a hub key reported, latest first",
    () =>
      Effect.gen(function* () {
        yield* chat("session-1", "Fix the relay's hang-up.");
        yield* chat("session-1", "And its test.");
        yield* Harness.recorded(2);
        yield* TestClock.adjust("1 minute");
        yield* chat("session-2", "Name the sessions.");
        yield* Harness.recorded(1);
        yield* TestClock.adjust("1 minute");
        // `recorded` moves the clock on while it waits, so the report's time is read, not assumed.
        const reportedAt = DateTime.formatIso(yield* DateTime.now);
        const reported = yield* report(
          { ...fleet, "x-cota-machine": "  laptop  " },
          { "session-1": `  Fixing the relay${" and more".repeat(30)}  ` },
        );
        const memory = yield* InMemorySessionTitles;

        expect(reported.status).toBe(204);
        expect(
          memory.reports.map(({ title, machine, reportedBy }) => [
            title.length,
            machine,
            reportedBy,
          ]),
        ).toEqual([[200, "laptop", "fleet"]]);
        expect(yield* listed).toEqual({
          total: 2,
          sessions: [
            {
              id: "session-2",
              requests: 1,
              title: null,
              firstPrompt: "Name the sessions.",
            },
            {
              id: "session-1",
              requests: 2,
              title: {
                text: `Fixing the relay${" and more".repeat(30)}`.slice(0, 200),
                source: "reported",
                at: reportedAt,
                machine: "laptop",
              },
              firstPrompt: "Fix the relay's hang-up.",
            },
          ],
        });
      }),
  );

  it.effect(
    "takes the owner's report as the latest, and an empty title as clearing the reported one",
    () =>
      Effect.gen(function* () {
        const owner = yield* Harness.signIn();
        yield* TestClock.adjust("1 minute");
        const first = yield* report(owner, {
          "session-1": "",
          "session-2": "Names",
        });
        const memory = yield* InMemorySessionTitles;
        const client = yield* Harness.api(reader);
        const { sessions } = yield* client.sessions.sessions({ query: {} });

        expect(first.status).toBe(204);
        expect(memory.reports.at(-1)?.reportedBy).toBe("owner");
        expect(
          Generated.plain(sessions.map(({ title }) => title?.text ?? null)),
        ).toEqual(["Names", null]);
      }),
  );

  it.effect(
    "answers 400, storing nothing, to titles none or too many, a session id empty or past 255 characters, and a sort, limit or offset out of range",
    () =>
      Effect.gen(function* () {
        const memory = yield* InMemorySessionTitles;
        const before = memory.reports.length;
        const answers = [];
        for (const titles of [
          {},
          Object.fromEntries(
            Array.from({ length: 1001 }, (_, index) => [`s${index}`, "t"]),
          ),
          { "": "t", "session-1": "t" },
          { "session-1": "t", ["s".repeat(256)]: "t" },
          { "session-1": "t", ["\u{1F980}".repeat(256)]: "t" },
        ]) {
          answers.push((yield* report(fleet, titles)).status);
        }
        for (const query of [
          "sort=oldest",
          "limit=0",
          "limit=201",
          "offset=10001",
          "offset=-1",
        ]) {
          answers.push(
            (yield* Harness.send(`/api/sessions?${query}`, { headers: reader }))
              .status,
          );
        }

        expect(answers).toEqual(Array.from({ length: 10 }, () => 400));
        expect(memory.reports.length).toBe(before);
        expect(
          (yield* report(fleet, { ["\u{1F980}".repeat(255)]: "Crabs" })).status,
        ).toBe(204);
      }),
  );

  it.effect(
    "pages by limit and offset, saying the total and the page asked for",
    () =>
      Effect.gen(function* () {
        const client = yield* Harness.api(reader);
        const pages = [];
        for (const offset of [0, 1, 2]) {
          const page = yield* client.sessions.sessions({
            query: { sort: "requests", limit: 1, offset },
          });
          pages.push([
            page.sessions.map(({ id }) => id),
            page.total,
            page.limit,
            page.offset,
          ]);
        }

        expect(pages).toEqual([
          [["session-1"], 2, 1, 0],
          [["session-2"], 2, 1, 1],
          [[], 2, 1, 2],
        ]);
      }),
  );

  it.effect(
    "answers 503 when the request log cannot be read or the titles kept, saying so without what ClickHouse said",
    () =>
      Effect.gen(function* () {
        const requests = yield* InMemoryRequests;
        const titles = yield* InMemorySessionTitles;
        requests.readingFails = true;
        const listing = yield* Harness.problemOf(
          yield* Harness.send("/api/sessions", { headers: reader }),
        );
        requests.readingFails = false;
        titles.fails = true;
        const reporting = yield* Harness.problemOf(
          yield* report(fleet, { "session-1": "Fix" }),
        );
        const listingTitles = yield* Harness.problemOf(
          yield* Harness.send("/api/sessions", { headers: reader }),
        );
        titles.fails = false;

        expect(
          [listing, reporting, listingTitles].map(({ status, body }) => [
            status,
            Object(body).type,
            Object(body).detail,
          ]),
        ).toEqual(
          Array.from({ length: 3 }, () => [
            503,
            "urn:cota:request-log-unavailable",
            "ClickHouse could not be reached, or did not answer within 30 seconds.",
          ]),
        );
      }),
  );
});

const clients = { "x-cota-key": Harness.secrets.clientsHubKey };

const system = [{ type: "text", text: "You are Claude Code." }];

const tools = [
  {
    name: "Read",
    description: "Reads a file.",
    input_schema: { type: "object" },
  },
];

const turn = {
  role: "assistant",
  content: [
    { type: "text", text: "Reading it." },
    {
      type: "tool_use",
      id: "toolu_1",
      name: "Read",
      input: { path: "relay.ts" },
    },
  ],
};

/** Claude Code's request in a session, answered with the given content and usage, a minute after the one before. */
const claudeCode = (
  session: string,
  requestClass: string,
  body: Record<string, unknown>,
  content: ReadonlyArray<unknown>,
  inputTokens: number,
) =>
  Effect.gen(function* () {
    const fake = yield* FakeProvider.FakeProvider;
    fake.answer({
      headers: [["content-type", "application/json"]],
      chunks: [
        JSON.stringify({
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "claude-opus-5-5",
          content,
          stop_reason: "end_turn",
          usage: { input_tokens: inputTokens, output_tokens: 7 },
        }),
      ],
    });
    yield* TestClock.adjust("1 minute");
    yield* Harness.send("/pools/claude/v1/messages", {
      method: "POST",
      headers: {
        ...clients,
        authorization: "Bearer sk-ant-oat01-a-login-for-the-detail",
        "content-type": "application/json",
        "x-claude-code-session-id": session,
        "x-claude-code-request-class": requestClass,
        "user-agent": "claude-cli/2.1.322 (external, cli)",
      },
      body: JSON.stringify({
        model: "claude-opus-5-5",
        max_tokens: 1000,
        system,
        ...body,
      }),
    }).pipe(Effect.andThen(Harness.textOf));
  });

const detailOf = (session: string) =>
  Effect.gen(function* () {
    const client = yield* Harness.api(reader);
    return yield* client.sessions.session({ params: { session } });
  });

layer(Harness.layer())("a session's detail", (it) => {
  it.effect(
    "lists a session's requests with their roles, its segments, and the transcript of its last segment's tip, model listings left out",
    () =>
      Effect.gen(function* () {
        yield* claudeCode(
          "detail-1",
          "main",
          { tools, messages: [{ role: "user", content: "Fix the relay." }] },
          turn.content,
          1000,
        );
        yield* claudeCode(
          "detail-1",
          "main",
          {
            tools,
            messages: [
              { role: "user", content: "Fix the relay." },
              turn,
              {
                role: "user",
                content: [
                  {
                    type: "tool_result",
                    tool_use_id: "toolu_1",
                    content: "export const relay = 1;",
                  },
                ],
              },
            ],
          },
          [{ type: "text", text: "Fixed." }],
          1200,
        );
        yield* claudeCode(
          "detail-1",
          "auxiliary",
          {
            tools: [],
            messages: [{ role: "user", content: "Name this session." }],
            output_config: {
              format: {
                type: "json_schema",
                schema: {
                  type: "object",
                  properties: { title: { type: "string" } },
                  required: ["title"],
                },
              },
            },
          },
          [{ type: "text", text: '{"title":"Fixing the relay"}' }],
          30,
        );
        const fake = yield* FakeProvider.FakeProvider;
        fake.answer({
          headers: [["content-type", "application/json"]],
          chunks: ['{"data":[]}'],
        });
        yield* Harness.send("/pools/claude/v1/models", {
          headers: {
            ...clients,
            authorization: "Bearer sk-ant-oat01-a-login-for-the-detail",
            "x-claude-code-session-id": "detail-1",
          },
        }).pipe(Effect.andThen(Harness.textOf));
        const [first, second, title] = yield* Harness.recorded(4);
        const detail = Generated.plain(yield* detailOf("detail-1"));
        const at = (request: typeof first) =>
          request === undefined ? null : DateTime.formatIso(request.startedAt);
        const listed = (
          request: typeof first,
          requestRole: string,
          segment: number | null,
          promptSize: number,
          toolCount: number,
        ) => ({
          id: request?.id,
          startedAt: at(request),
          requestRole,
          segment,
          operation: "messages",
          purpose: requestRole === "title" ? "auxiliary" : "main",
          model: "claude-opus-5-5",
          servedModel: "",
          stopReason: "end_turn",
          outcome: "ok",
          upstreamStatus: 200,
          errorType: "",
          promptSize,
          outputTokens: 7,
          costUsd: null,
          durationMs: request?.durationMs,
          firstByteMs: Option.getOrNull(request?.firstByteMs ?? Option.none()),
          tools: toolCount,
          divertedFrom: null,
          follows: null,
        });

        expect(Object(detail).session).toMatchObject({
          id: "detail-1",
          requests: 3,
          title: {
            text: "Fixing the relay",
            source: "generated",
            at: at(title),
            machine: null,
          },
          firstPrompt: "Fix the relay.",
        });
        expect(Object(detail).requests).toEqual([
          listed(first, "main", 0, 1000, 1),
          listed(second, "main", 0, 1200, 1),
          listed(title, "title", null, 30, 0),
        ]);
        expect(Object(detail).requestsCut).toBe(0);
        expect(Object(detail).segments).toEqual([
          {
            index: 0,
            startedBy: "start",
            firstRequest: first?.id,
            lastRequest: second?.id,
            tip: second?.id,
            startedAt: at(first),
            endedAt: at(second),
            requests: 2,
            promptSize: 1200,
          },
        ]);
        const transcript = Object(detail).transcript;
        expect({
          ...transcript,
          entries: transcript.entries.map(
            ({ item, ...entry }: { item: string }) => ({
              ...entry,
              item: /^[0-9a-f]{32}$/.test(item),
            }),
          ),
        }).toEqual({
          request: second?.id,
          protocol: "anthropic-messages",
          entries: [
            {
              kind: "message",
              item: true,
              part: "system",
              role: "system",
              parts: [{ type: "text", text: "You are Claude Code.", cut: 0 }],
            },
            {
              kind: "message",
              item: true,
              part: "input",
              role: "user",
              parts: [{ type: "text", text: "Fix the relay.", cut: 0 }],
            },
            {
              kind: "message",
              item: true,
              part: "input",
              role: "assistant",
              parts: [{ type: "text", text: "Reading it.", cut: 0 }],
            },
            {
              kind: "tool-call",
              item: true,
              part: "input",
              callId: "toolu_1",
              name: "Read",
              input: '{"path":"relay.ts"}',
              cut: 0,
            },
            {
              kind: "tool-result",
              item: true,
              part: "input",
              callId: "toolu_1",
              name: "Read",
              output: "export const relay = 1;",
              error: false,
              cut: 0,
            },
            {
              kind: "message",
              item: true,
              part: "output",
              role: "assistant",
              parts: [{ type: "text", text: "Fixed." }].map((part) => ({
                ...part,
                cut: 0,
              })),
            },
          ],
          cutCharacters: 0,
        });
      }),
  );

  it.effect(
    "reads a session whose id is percent-encoded in the path, and answers 404 for one no traffic request has",
    () =>
      Effect.gen(function* () {
        yield* chat("team/one two", "Ship it.");
        yield* Harness.recorded(1);
        const named = yield* Harness.send(
          `/api/sessions/${encodeURIComponent("team/one two")}`,
          { headers: reader },
        );
        const { id } = JSON.parse(yield* Harness.textOf(named)).session;
        const missing = yield* Harness.problemOf(
          yield* Harness.send("/api/sessions/nobody", { headers: reader }),
        );

        expect([named.status, id]).toEqual([200, "team/one two"]);
        expect([missing.status, missing.body]).toEqual([
          404,
          {
            type: "urn:cota:no-such-session",
            status: 404,
            title: "There is no such session.",
            detail: 'The request log has no session "nobody".',
          },
        ]);
      }),
  );
});
