import { describe, expect, it } from "@effect/vitest";
import { Array as Arr, DateTime, Effect, Option, Stream } from "effect";
import type * as Protocol from "#modules/relay/02-application/interfaces/protocol.ts";
import type * as ClientRequest from "#modules/relay/03-domain/client-request.ts";
import * as Conversation from "#shared/03-domain/conversation.ts";
import * as AnthropicMessages from "./anthropic-messages.ts";

const { protocol } = AnthropicMessages;

const request = (
  method: string,
  path: string,
  headers: ClientRequest.Headers = {},
  body?: unknown,
): ClientRequest.ClientRequest => ({
  method,
  path,
  headers,
  body: body === undefined ? Option.none() : Option.some(body),
});

const read = Option.getOrThrow(
  protocol.reader(protocol.describe(request("POST", "/v1/messages"))),
);

const readAll = (parts: ReadonlyArray<Protocol.Part>) =>
  Effect.gen(function* () {
    const readings = yield* Stream.runCollect(read(Stream.fromIterable(parts)));
    return Option.getOrThrow(Arr.last(readings));
  });

const events = (
  ...pairs: ReadonlyArray<readonly [string, string]>
): Array<Protocol.Part> =>
  pairs.map(([event, data]) => ({ _tag: "Event", event, data }));

const messageStart = [
  "message_start",
  '{"type":"message_start","message":{"id":"msg_01XFDUDYJgAACzvnptvVoYEL","type":"message","role":"assistant","model":"claude-opus-5-5","content":[],"stop_reason":null,"usage":{"input_tokens":25,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":0},"output_tokens":1,"service_tier":"standard"}}}',
] as const;

const turn = events(
  messageStart,
  ["ping", '{"type": "ping"}'],
  [
    "content_block_start",
    '{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}',
  ],
  [
    "content_block_delta",
    '{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Let me solve this step by step:\\n\\n1. First break down 27 * 453"}}',
  ],
  [
    "content_block_delta",
    '{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"\\n2. 453 = 400 + 50 + 3"}}',
  ],
  [
    "content_block_delta",
    '{"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"EqQBCgIYAhIM1gbcDa9GJwZA2b3hGgxBdjrkzLoky3dl1pkiMOYds..."}}',
  ],
  ["content_block_stop", '{"type":"content_block_stop","index":0}'],
  [
    "content_block_start",
    '{"type":"content_block_start","index":1,"content_block":{"type":"redacted_thinking","data":"EmwKAhgBEgy3va3pzix/LafPsn4aDFIT2Xlxh0L5L8rLVyIwxtE3rAFBa8cr3qpP..."}}',
  ],
  ["content_block_stop", '{"type":"content_block_stop","index":1}'],
  [
    "content_block_start",
    '{"type":"content_block_start","index":2,"content_block":{"type":"text","text":""}}',
  ],
  [
    "content_block_delta",
    '{"type":"content_block_delta","index":2,"delta":{"type":"text_delta","text":"Okay, let\'s check"}}',
  ],
  [
    "content_block_delta",
    '{"type":"content_block_delta","index":2,"delta":{"type":"text_delta","text":" the weather."}}',
  ],
  [
    "content_block_delta",
    '{"type":"content_block_delta","index":2,"delta":{"type":"future_delta","text":"skipped"}}',
  ],
  ["content_block_stop", '{"type":"content_block_stop","index":2}'],
  [
    "content_block_start",
    '{"type":"content_block_start","index":3,"content_block":{"type":"server_tool_use","id":"srvtoolu_014hJH82Qum7Td6UV8gDXThB","name":"web_search","input":{}}}',
  ],
  [
    "content_block_delta",
    '{"type":"content_block_delta","index":3,"delta":{"type":"input_json_delta","partial_json":"{\\"query\\":\\"weather NYC today\\"}"}}',
  ],
  ["content_block_stop", '{"type":"content_block_stop","index":3}'],
  [
    "content_block_start",
    '{"type":"content_block_start","index":4,"content_block":{"type":"web_search_tool_result","tool_use_id":"srvtoolu_014hJH82Qum7Td6UV8gDXThB","content":[{"type":"web_search_result","title":"Weather in New York City in May 2025","url":"https://www.timeanddate.com/weather/usa/new-york/historic","encrypted_content":"Ev0DCioIAxgCIiQ3NmU4ZmI4OC1k...","page_age":null}]}}',
  ],
  ["content_block_stop", '{"type":"content_block_stop","index":4}'],
  [
    "content_block_start",
    '{"type":"content_block_start","index":5,"content_block":{"type":"tool_use","id":"toolu_01T1x1fJ34qAmk2tNTrN7Up6","name":"get_weather","input":{}}}',
  ],
  [
    "content_block_delta",
    '{"type":"content_block_delta","index":5,"delta":{"type":"input_json_delta","partial_json":""}}',
  ],
  [
    "content_block_delta",
    '{"type":"content_block_delta","index":5,"delta":{"type":"input_json_delta","partial_json":"{\\"location\\": \\"San Fra"}}',
  ],
  [
    "content_block_delta",
    '{"type":"content_block_delta","index":5,"delta":{"type":"input_json_delta","partial_json":"ncisco, CA\\", \\"unit\\": \\"fahrenheit\\"}"}}',
  ],
  ["content_block_stop", '{"type":"content_block_stop","index":5}'],
  [
    "content_block_start",
    '{"type":"content_block_start","index":6,"content_block":{"type":"tool_use","id":"toolu_01NoInput","name":"list_files","input":{}}}',
  ],
  ["content_block_stop", '{"type":"content_block_stop","index":6}'],
  ["future_event", '{"type":"future_event","index":0,"anything":true}'],
  [
    "message_delta",
    '{"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":89}}',
  ],
  ["message_stop", '{"type":"message_stop"}'],
);

const assistantTurn = {
  role: "assistant",
  content: [
    {
      type: "thinking",
      thinking:
        "Let me solve this step by step:\n\n1. First break down 27 * 453\n2. 453 = 400 + 50 + 3",
      signature: "EqQBCgIYAhIM1gbcDa9GJwZA2b3hGgxBdjrkzLoky3dl1pkiMOYds...",
    },
    {
      type: "redacted_thinking",
      data: "EmwKAhgBEgy3va3pzix/LafPsn4aDFIT2Xlxh0L5L8rLVyIwxtE3rAFBa8cr3qpP...",
    },
    { type: "text", text: "Okay, let's check the weather." },
    {
      type: "server_tool_use",
      id: "srvtoolu_014hJH82Qum7Td6UV8gDXThB",
      name: "web_search",
      input: { query: "weather NYC today" },
    },
    {
      type: "web_search_tool_result",
      tool_use_id: "srvtoolu_014hJH82Qum7Td6UV8gDXThB",
      content: [
        {
          type: "web_search_result",
          title: "Weather in New York City in May 2025",
          url: "https://www.timeanddate.com/weather/usa/new-york/historic",
          encrypted_content: "Ev0DCioIAxgCIiQ3NmU4ZmI4OC1k...",
          page_age: null,
        },
      ],
    },
    {
      type: "tool_use",
      id: "toolu_01T1x1fJ34qAmk2tNTrN7Up6",
      name: "get_weather",
      input: { location: "San Francisco, CA", unit: "fahrenheit" },
    },
    { type: "tool_use", id: "toolu_01NoInput", name: "list_files", input: {} },
  ],
};

describe("describe", () => {
  it("names messages, count_tokens and models, and every other request other", () => {
    expect(
      [
        request("POST", "/v1/messages"),
        request("POST", "/v1/messages/count_tokens"),
        request("GET", "/v1/models"),
        request("GET", "/v1/messages"),
        request("POST", "/v1/messages/cache_touch"),
        request("HEAD", "/api/hello"),
      ].map((each) => protocol.describe(each).operation),
    ).toEqual([
      "messages",
      "count_tokens",
      "models",
      "other",
      "other",
      "other",
    ]);
  });

  it("reads the model and whether it streams from the body", () => {
    const described = [
      { model: "claude-opus-5-5", stream: true, max_tokens: 64000 },
      { model: "claude-haiku-4-5", max_tokens: 512 },
      { model: "", stream: "yes" },
    ].map((body) =>
      protocol.describe(request("POST", "/v1/messages", {}, body)),
    );
    expect(described.map(({ model, stream }) => [model, stream])).toEqual([
      [Option.some("claude-opus-5-5"), true],
      [Option.some("claude-haiku-4-5"), false],
      [Option.none(), false],
    ]);
  });

  it("takes the session from x-claude-code-session-id, else from metadata.user_id, which is a JSON string", () => {
    const userId = JSON.stringify({
      device_id: "5c5c0f0a",
      account_uuid: "8b8f1f6e-3f5a-4a4f-9d3a-0c0f5b1d2e3f",
      session_id: " 4d7a5e1c-0b5f-4a7e-9f4a-8f2b1c3d4e5f ",
    });
    const body = { model: "claude-opus-5-5", metadata: { user_id: userId } };
    expect(
      [
        request(
          "POST",
          "/v1/messages",
          { "x-claude-code-session-id": "a1b2c3d4-header" },
          body,
        ),
        request("POST", "/v1/messages", {}, body),
        request(
          "POST",
          "/v1/messages",
          {},
          { metadata: { user_id: "not json" } },
        ),
        request(
          "POST",
          "/v1/messages",
          { "x-claude-code-session-id": "   " },
          {
            metadata: {
              user_id: JSON.stringify({ session_id: "s".repeat(256) }),
            },
          },
        ),
      ].map((each) => protocol.describe(each).session),
    ).toEqual([
      Option.some({
        id: "a1b2c3d4-header",
        source: "x-claude-code-session-id",
      }),
      Option.some({
        id: "4d7a5e1c-0b5f-4a7e-9f4a-8f2b1c3d4e5f",
        source: "body",
      }),
      Option.none(),
      Option.none(),
    ]);
  });

  it("takes the purpose from x-claude-code-request-class, else names Claude Code's quota probe, and never guesses", () => {
    const probe = {
      model: "claude-haiku-4-5",
      max_tokens: 1,
      messages: [{ role: "user", content: "quota" }],
    };
    expect(
      [
        request(
          "POST",
          "/v1/messages",
          { "x-claude-code-request-class": "compaction" },
          probe,
        ),
        request("POST", "/v1/messages", {}, probe),
        request("POST", "/v1/messages", {}, { ...probe, max_tokens: 2 }),
        request(
          "POST",
          "/v1/messages",
          {},
          {
            ...probe,
            messages: [
              { role: "user", content: [{ type: "text", text: "quota" }] },
            ],
          },
        ),
        request(
          "POST",
          "/v1/messages",
          {},
          {
            ...probe,
            messages: [...probe.messages, { role: "user", content: "quota" }],
          },
        ),
      ].map((each) => protocol.describe(each).purpose),
    ).toEqual(["compaction", "quota_probe", "", "", ""]);
  });

  it("keeps the headers on its list and no other", () => {
    const described = protocol.describe(
      request("POST", "/v1/messages", {
        "anthropic-beta": "claude-code-20250219,oauth-2025-04-20",
        "anthropic-version": "2023-06-01",
        "x-app": "cli",
        "x-claude-code-agent-id": "agent-7",
        "x-stainless-retry-count": "0",
        authorization: "Bearer sk-ant-oat01-secret",
        "x-api-key": "sk-ant-api03-secret",
        "user-agent": "claude-cli/2.1.322 (external, cli)",
      }),
    );
    expect(described.headers).toEqual({
      "anthropic-beta": "claude-code-20250219,oauth-2025-04-20",
      "anthropic-version": "2023-06-01",
      "x-app": "cli",
      "x-claude-code-agent-id": "agent-7",
      "x-stainless-retry-count": "0",
    });
  });
});

describe("fingerprint", () => {
  const sha256 = (text: string) =>
    new Bun.CryptoHasher("sha256").update(text).digest("hex");

  it("is the SHA-256 of the login, whether it comes as a bearer token or as x-api-key", () => {
    expect(
      [
        { authorization: "Bearer sk-ant-oat01-login" },
        { "x-api-key": "sk-ant-oat01-login" },
        { authorization: "Bearer sk-ant-oat01-login", "x-api-key": "other" },
        { authorization: "sk-ant-oat01-login" },
        {},
        { authorization: "  ", "x-api-key": "" },
      ].map((headers) =>
        protocol.fingerprint(request("POST", "/v1/messages", headers)),
      ),
    ).toEqual([
      Option.some(sha256("sk-ant-oat01-login")),
      Option.some(sha256("sk-ant-oat01-login")),
      Option.some(sha256("sk-ant-oat01-login")),
      Option.some(sha256("sk-ant-oat01-login")),
      Option.none(),
      Option.none(),
    ]);
  });
});

describe("refusal", () => {
  const refusalOf = (status: number, headers: ClientRequest.Headers) =>
    protocol.refusal.of({ status, headers, body: "" });

  it.effect(
    "is a 429 whose unified status is rejected, with its reset in Unix seconds",
    () =>
      Effect.gen(function* () {
        const refusal = yield* refusalOf(429, {
          "anthropic-ratelimit-unified-status": "rejected",
          "anthropic-ratelimit-unified-reset": "1794477600",
          "anthropic-ratelimit-unified-representative-claim": "five_hour",
          "retry-after": "3600",
        });
        expect(
          Option.map(refusal, ({ reset }) =>
            Option.map(reset, DateTime.formatIso),
          ),
        ).toEqual(Option.some(Option.some("2026-11-12T10:00:00.000Z")));
      }),
  );

  it.effect(
    "is a refusal without a reset when the reset is missing or not a number",
    () =>
      Effect.gen(function* () {
        const refusals = yield* Effect.forEach(
          [undefined, "", "Thu, 12 Nov 2026 10:00:00 GMT"],
          (reset) =>
            refusalOf(429, {
              "anthropic-ratelimit-unified-status": "rejected",
              ...(reset === undefined
                ? {}
                : { "anthropic-ratelimit-unified-reset": reset }),
            }),
        );
        expect(refusals).toEqual([
          Option.some({ reset: Option.none() }),
          Option.some({ reset: Option.none() }),
          Option.some({ reset: Option.none() }),
        ]);
      }),
  );

  it.effect(
    "is not a refusal for a plain rate limit, an allowed status, or a rejected status served as overage",
    () =>
      Effect.gen(function* () {
        const refusals = yield* Effect.forEach(
          [
            [429, { "retry-after": "20" }],
            [429, { "anthropic-ratelimit-unified-status": "allowed_warning" }],
            [
              200,
              {
                "anthropic-ratelimit-unified-status": "rejected",
                "anthropic-ratelimit-unified-overage-status": "allowed",
              },
            ],
            [529, { "anthropic-ratelimit-unified-status": "rejected" }],
          ] as const,
          ([status, headers]) => refusalOf(status, headers),
        );
        expect(refusals).toEqual([
          Option.none(),
          Option.none(),
          Option.none(),
          Option.none(),
        ]);
      }),
  );

  it("is told from the answer's head, before its body", () => {
    expect(protocol.refusal._tag).toBe("FromHead");
  });
});

describe("answerHeaders", () => {
  it("reads request-id, and keeps every anthropic-ratelimit-* header and retry-after", () => {
    expect(
      protocol.answerHeaders({
        "request-id": "req_011CUmBw1YpVz8fAkxZT9Jtu",
        "anthropic-ratelimit-unified-status": "allowed",
        "anthropic-ratelimit-unified-5h-utilization": "0.42",
        "anthropic-ratelimit-unified-reset": "1794477600",
        "retry-after": "12",
        "anthropic-organization-id": "org-7",
        "content-type": "text/event-stream",
      }),
    ).toEqual({
      providerRequestId: "req_011CUmBw1YpVz8fAkxZT9Jtu",
      servedModel: "",
      rateLimits: {
        "anthropic-ratelimit-unified-status": "allowed",
        "anthropic-ratelimit-unified-5h-utilization": "0.42",
        "anthropic-ratelimit-unified-reset": "1794477600",
        "retry-after": "12",
      },
    });
  });
});

describe("reader", () => {
  it("reads the answers of messages and of no other operation", () => {
    expect(
      [
        request("POST", "/v1/messages"),
        request("POST", "/v1/messages/count_tokens"),
        request("GET", "/v1/models"),
        request("POST", "/v1/messages/batches"),
      ].map((each) => Option.isSome(protocol.reader(protocol.describe(each)))),
    ).toEqual([true, false, false, false]);
  });
});

describe("read, a stream", () => {
  it.effect(
    "assembles the assistant's message as the client sends it back: thinking with its signature, redacted thinking, text, server tool blocks as they came, and tool use with its input",
    () =>
      Effect.gen(function* () {
        const reading = yield* readAll(turn);
        expect(reading.output).toEqual([assistantTurn]);
      }),
  );

  it.effect(
    "starts usage at message_start, lets each message_delta overwrite the fields it carries, and is finished at message_stop",
    () =>
      Effect.gen(function* () {
        const readings = yield* Stream.runCollect(
          read(Stream.fromIterable(turn)),
        );
        const last = Option.getOrThrow(Arr.last(readings));
        expect(readings.map(({ finished }) => finished)).toEqual([
          ...turn.map(() => false),
          true,
        ]);
        expect([
          last.stopReason,
          last.servedModel,
          last.serviceTier,
          Option.map(last.usage, ({ tokens, reasoning }) => ({
            ...tokens,
            reasoning,
          })),
          Option.map(last.usage, ({ reported }) => JSON.parse(reported)),
        ]).toEqual([
          "tool_use",
          "claude-opus-5-5",
          "standard",
          Option.some({
            input: 25,
            cacheRead: 0,
            cacheWriteShort: 0,
            cacheWriteLong: 0,
            output: 89,
            reasoning: 0,
          }),
          Option.some({
            input_tokens: 25,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            cache_creation: {
              ephemeral_5m_input_tokens: 0,
              ephemeral_1h_input_tokens: 0,
            },
            output_tokens: 89,
            service_tier: "standard",
          }),
        ]);
      }),
  );

  it.effect(
    "maps usage to the request log's classes: cache writes by lifetime, all short without a breakdown, thinking as reasoning, and a fast speed as the tier",
    () =>
      Effect.gen(function* () {
        const usageOf = (usage: string, delta: string) =>
          readAll(
            events(
              [
                "message_start",
                `{"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-opus-5-5","content":[],"stop_reason":null,"usage":${usage}}}`,
              ],
              [
                "message_delta",
                `{"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":${delta}}`,
              ],
              ["message_stop", '{"type":"message_stop"}'],
            ),
          ).pipe(
            Effect.map((reading) => [
              Option.map(reading.usage, ({ tokens, reasoning }) => ({
                ...tokens,
                reasoning,
              })),
              reading.serviceTier,
            ]),
          );
        expect(
          yield* usageOf(
            '{"input_tokens":3,"cache_creation_input_tokens":1500,"cache_read_input_tokens":40000,"cache_creation":{"ephemeral_5m_input_tokens":500,"ephemeral_1h_input_tokens":1000},"output_tokens":1,"service_tier":"standard","speed":"fast"}',
            '{"input_tokens":3,"cache_creation_input_tokens":1500,"cache_read_input_tokens":40000,"output_tokens":740,"output_tokens_details":{"thinking_tokens":512},"server_tool_use":{"web_search_requests":1}}',
          ),
        ).toEqual([
          Option.some({
            input: 3,
            cacheRead: 40000,
            cacheWriteShort: 500,
            cacheWriteLong: 1000,
            output: 740,
            reasoning: 512,
          }),
          "fast",
        ]);
        expect(
          yield* usageOf(
            '{"input_tokens":12,"cache_creation_input_tokens":2048,"cache_read_input_tokens":null,"output_tokens":1}',
            '{"output_tokens":30,"cache_read_input_tokens":null}',
          ),
        ).toEqual([
          Option.some({
            input: 12,
            cacheRead: 0,
            cacheWriteShort: 2048,
            cacheWriteLong: 0,
            output: 30,
            reasoning: 0,
          }),
          "",
        ]);
      }),
  );

  it.effect(
    "ends at an error event, as a failure with its type and message",
    () =>
      Effect.gen(function* () {
        const reading = yield* readAll(
          events(messageStart, [
            "error",
            '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
          ]),
        );
        expect([reading.finished, reading.error]).toEqual([
          true,
          Option.some({ type: "overloaded_error", message: "Overloaded" }),
        ]);
      }),
  );

  it.effect(
    "reports no usage and no output for a stream that sent neither",
    () =>
      Effect.gen(function* () {
        const reading = yield* readAll(
          events(["ping", '{"type":"ping"}'], ["message_stop", "not json"]),
        );
        expect([reading.usage, reading.output, reading.finished]).toEqual([
          Option.none(),
          [],
          false,
        ]);
      }),
  );
});

describe("read, an answer that is not a stream", () => {
  it.effect(
    "reads the message itself: its content, usage, stop reason and model",
    () =>
      Effect.gen(function* () {
        const reading = yield* readAll([
          {
            _tag: "Body",
            text: '{"id":"msg_01","type":"message","role":"assistant","model":"claude-haiku-4-5-20251001","content":[{"type":"text","text":"Hi"},{"type":"tool_use","id":"toolu_1","name":"Bash","input":{"command":"ls"}}],"stop_reason":"tool_use","stop_sequence":null,"usage":{"input_tokens":9,"cache_creation_input_tokens":0,"cache_read_input_tokens":12,"output_tokens":21,"service_tier":"standard"}}',
          },
        ]);
        expect([
          reading.output,
          reading.stopReason,
          reading.servedModel,
          Option.map(reading.usage, ({ tokens }) => tokens),
        ]).toEqual([
          [
            {
              role: "assistant",
              content: [
                { type: "text", text: "Hi" },
                {
                  type: "tool_use",
                  id: "toolu_1",
                  name: "Bash",
                  input: { command: "ls" },
                },
              ],
            },
          ],
          "tool_use",
          "claude-haiku-4-5-20251001",
          Option.some({
            input: 9,
            cacheRead: 12,
            cacheWriteShort: 0,
            cacheWriteLong: 0,
            output: 21,
          }),
        ]);
      }),
  );
});

describe("error", () => {
  it("reads an error body's type and message", () => {
    expect([
      protocol.error(
        '{"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your account\'s rate limit."},"request_id":"req_011CSHoEeqs5C35K2UUqR7Fy"}',
      ),
      protocol.error("upstream connect error"),
    ]).toEqual([
      Option.some({
        type: "rate_limit_error",
        message: "This request would exceed your account's rate limit.",
      }),
      Option.none(),
    ]);
  });
});

describe("conversation", () => {
  const messages = request("POST", "/v1/messages");
  const rules = Option.getOrThrow(
    protocol.conversation(protocol.describe(messages)),
  );
  const conversationOf = (body: unknown, output: ReadonlyArray<never> = []) =>
    Option.getOrThrow(Conversation.read(rules, body, output));

  it("reads the conversation of messages and of no other operation", () => {
    expect(
      [
        messages,
        request("POST", "/v1/messages/count_tokens"),
        request("GET", "/v1/models"),
      ].map((each) =>
        Option.isSome(protocol.conversation(protocol.describe(each))),
      ),
    ).toEqual([true, false, false]);
  });

  it("splits system, tools and messages, taking cache_control out at any depth", () => {
    const conversation = conversationOf({
      model: "claude-opus-5-5",
      system: "You are terse.",
      tools: [
        {
          name: "read",
          input_schema: { type: "object" },
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_01",
              content: [
                {
                  type: "text",
                  text: "a.txt",
                  cache_control: { type: "ephemeral", ttl: "1h" },
                },
              ],
            },
          ],
        },
      ],
    });

    expect([
      conversation.params,
      conversation.layout.map(({ field, layout }) => [field, layout]),
      conversation.overlay,
      [conversation.system, conversation.tools, conversation.input].map(
        (items) => items.map(({ content }) => content),
      ),
    ]).toEqual([
      { model: "claude-opus-5-5" },
      [
        ["system", "single"],
        ["tools", "list"],
        ["messages", "list"],
      ],
      [
        {
          part: "tools",
          position: 0,
          path: ["cache_control"],
          value: { type: "ephemeral" },
        },
        {
          part: "input",
          position: 0,
          path: ["content", 0, "content", 0, "cache_control"],
          value: { type: "ephemeral", ttl: "1h" },
        },
      ],
      [
        ['"You are terse."'],
        ['{"input_schema":{"type":"object"},"name":"read"}'],
        [
          '{"content":[{"content":[{"text":"a.txt","type":"text"}],"tool_use_id":"toolu_01","type":"tool_result"}],"role":"user"}',
        ],
      ],
    ]);
  });

  it("reads an item's text from its text, thinking and tool-result blocks and the input of its tool-use blocks", () => {
    const conversation = conversationOf({
      system: [{ type: "text", text: "You are Claude Code." }],
      messages: [
        { role: "user", content: "What is 27 * 453?" },
        assistantTurn,
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_01T1x1fJ34qAmk2tNTrN7Up6",
              content: "Sunny, 68°F",
            },
            { type: "image", source: { type: "base64", data: "iVBORw0K" } },
          ],
        },
      ],
    });

    expect(
      [...conversation.system, ...conversation.input].map(
        ({ type, role, text }) => ({ type, role, text }),
      ),
    ).toEqual([
      { type: "text", role: "", text: "You are Claude Code." },
      { type: "", role: "user", text: "What is 27 * 453?" },
      {
        type: "",
        role: "assistant",
        text: [
          "Let me solve this step by step:\n\n1. First break down 27 * 453\n2. 453 = 400 + 50 + 3",
          "Okay, let's check the weather.",
          '{"query":"weather NYC today"}',
          '{"location":"San Francisco, CA","unit":"fahrenheit"}',
          "{}",
        ].join("\n\n"),
      },
      { type: "", role: "user", text: "Sunny, 68°F" },
    ]);
  });

  it.effect(
    "stores the answer as the same item as the assistant turn the client sends back in its next request",
    () =>
      Effect.gen(function* () {
        const question = { role: "user", content: "What is 27 * 453?" };
        const first = conversationOf(
          { model: "claude-opus-5-5", messages: [question] },
          [],
        );
        const answer = yield* readAll(turn);
        const answered = Option.getOrThrow(
          Conversation.read(
            rules,
            { model: "claude-opus-5-5", messages: [question] },
            answer.output,
          ),
        );
        const [last, ...earlier] = [...assistantTurn.content].reverse();
        const sentBack = {
          role: "assistant",
          content: [
            ...earlier.reverse(),
            { ...last, cache_control: { type: "ephemeral" } },
          ],
        };
        const next = conversationOf({
          model: "claude-opus-5-5",
          messages: [
            question,
            sentBack,
            {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "toolu_01NoInput",
                  content: "a.txt",
                  cache_control: { type: "ephemeral" },
                },
              ],
            },
          ],
        });

        expect(first.output).toEqual([]);
        expect(answered.output.map(({ digest }) => digest)).toEqual([
          next.input[1]?.digest,
        ]);
        expect(next.input[0]?.digest).toBe(first.input[0]?.digest);
      }),
  );
});
