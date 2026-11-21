import { describe, expect, it } from "@effect/vitest";
import { Array as Arr, DateTime, Effect, Option, Stream } from "effect";
import { TestClock } from "effect/testing";
import type * as Protocol from "#modules/relay/02-application/interfaces/protocol.ts";
import type * as ClientRequest from "#modules/relay/03-domain/client-request.ts";
import type * as Refusal from "#modules/relay/03-domain/refusal.ts";
import * as Conversation from "#shared/03-domain/conversation.ts";
import * as OpenAiChat from "./openai-chat.ts";

const { protocol } = OpenAiChat;

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

const events = (...data: ReadonlyArray<string>): Array<Protocol.Part> =>
  data.map((data) => ({ _tag: "Event", event: "message", data }));

const read = Option.getOrThrow(
  protocol.reader(protocol.describe(request("POST", "/chat/completions"))),
);

const refusalOf = (answer: Refusal.Answer) => protocol.refusal.of(answer);

const readAll = (parts: ReadonlyArray<Protocol.Part>) =>
  Effect.gen(function* () {
    const readings = yield* Stream.runCollect(read(Stream.fromIterable(parts)));
    return Option.getOrThrow(Arr.last(readings));
  });

const streamed = [
  '{"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"glm-5.2","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}],"usage":null}',
  '{"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"glm-5.2","choices":[{"index":0,"delta":{"reasoning_content":"Let me"},"finish_reason":null}]}',
  '{"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"glm-5.2","choices":[{"index":0,"delta":{"reasoning_content":" look."},"finish_reason":null}]}',
  '{"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"glm-5.2","choices":[{"index":0,"delta":{"content":"Hi"},"finish_reason":null}]}',
  '{"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"glm-5.2","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"read","arguments":""}}]},"finish_reason":null}]}',
  '{"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"glm-5.2","choices":[{"index":0,"delta":{"tool_calls":[{"index":1,"id":"call_2","type":"function","function":{"name":"grep","arguments":"{\\"q\\":"}}]},"finish_reason":null}]}',
  '{"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"glm-5.2","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"path\\":"}}]},"finish_reason":null}]}',
  '{"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"glm-5.2","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"a\\"}"}},{"index":1,"function":{"arguments":"\\"x\\"}"}}]},"finish_reason":null}]}',
  '{"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"glm-5.2","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}',
  '{"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"glm-5.2","choices":[],"usage":{"prompt_tokens":100,"completion_tokens":20,"total_tokens":120,"prompt_tokens_details":{"cached_tokens":80},"completion_tokens_details":{"reasoning_tokens":5}}}',
  "[DONE]",
];

describe("describe", () => {
  it("names chat, models, and every other path other", () => {
    expect(
      [
        request("POST", "/chat/completions"),
        request("GET", "/models"),
        request("GET", "/chat/completions"),
        request("POST", "/responses"),
        request("POST", "/chat/completions/"),
      ].map((each) => protocol.describe(each).operation),
    ).toEqual(["chat", "models", "other", "other", "other"]);
  });

  it("reads the model and whether it streams from the body, untouched", () => {
    const described = protocol.describe(
      request(
        "POST",
        "/chat/completions",
        {},
        {
          model: "lmstudio/google/gemma-4-26b-a4b-qat",
          stream: true,
          stream_options: { include_usage: true },
        },
      ),
    );
    expect([described.model, described.stream]).toEqual([
      Option.some("lmstudio/google/gemma-4-26b-a4b-qat"),
      true,
    ]);
  });

  it("describes a body it cannot read as having no model and not streaming", () => {
    const described = protocol.describe(
      request("POST", "/chat/completions", {}, { model: 7, stream: "yes" }),
    );
    expect([described.model, described.stream]).toEqual([Option.none(), false]);
  });

  it("takes the session from the first session header in the spec's order, trimmed", () => {
    const opencode = {
      "x-session-affinity": " ses_abc ",
      "x-opencode-session-id": "ses_other",
      "x-session-id": "ses_third",
    };
    const pi = { session_id: "019a2c3d", "x-client-request-id": "019a2c3d" };
    expect([
      protocol.describe(request("POST", "/chat/completions", opencode)).session,
      protocol.describe(request("POST", "/chat/completions", pi)).session,
      protocol.describe(request("POST", "/chat/completions", {})).session,
    ]).toEqual([
      Option.some({ id: "ses_abc", source: "x-session-affinity" }),
      Option.some({ id: "019a2c3d", source: "session_id" }),
      Option.none(),
    ]);
  });

  it("skips a session header that is blank or longer than 255 characters", () => {
    const described = protocol.describe(
      request("POST", "/chat/completions", {
        "x-session-affinity": "   ",
        "x-opencode-session-id": "s".repeat(256),
        "x-opencode-session": "s".repeat(255),
      }),
    );
    expect(described.session).toEqual(
      Option.some({ id: "s".repeat(255), source: "x-opencode-session" }),
    );
  });

  it("counts a session id's characters, not its UTF-16 units", () => {
    const crabs = (count: number) => "\u{1F980}".repeat(count);
    const described = protocol.describe(
      request("POST", "/chat/completions", {
        "x-session-affinity": crabs(256),
        "x-opencode-session-id": crabs(255),
      }),
    );
    expect(described.session).toEqual(
      Option.some({ id: crabs(255), source: "x-opencode-session-id" }),
    );
  });

  it("keeps only the headers on its allow-list, and states no purpose", () => {
    const described = protocol.describe(
      request("POST", "/chat/completions", {
        "x-opencode-parent-session-id": "ses_parent",
        "x-stainless-retry-count": "0",
        authorization: "Bearer secret",
        "user-agent": "pi/1.5.2",
      }),
    );
    expect([described.headers, described.purpose]).toEqual([
      {
        "x-opencode-parent-session-id": "ses_parent",
        "x-stainless-retry-count": "0",
      },
      "",
    ]);
  });
});

describe("read, a stream", () => {
  it.effect(
    "assembles the first choice's message: content, reasoning under its own field, tool calls by index",
    () =>
      Effect.gen(function* () {
        const reading = yield* readAll(events(...streamed));
        expect(reading.output).toEqual([
          {
            role: "assistant",
            content: "Hi",
            reasoning_content: "Let me look.",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "read", arguments: '{"path":"a"}' },
              },
              {
                id: "call_2",
                type: "function",
                function: { name: "grep", arguments: '{"q":"x"}' },
              },
            ],
          },
        ]);
        expect([
          reading.stopReason,
          reading.servedModel,
          reading.finished,
        ]).toEqual(["tool_calls", "glm-5.2", true]);
      }),
  );

  it.effect(
    "maps usage to the request log's classes: cached tokens out of input, reasoning inside output",
    () =>
      Effect.gen(function* () {
        const reading = yield* readAll(events(...streamed));
        expect(reading.usage).toEqual(
          Option.some({
            tokens: {
              input: 20,
              cacheRead: 80,
              cacheWriteShort: 0,
              cacheWriteLong: 0,
              output: 20,
            },
            reasoning: 5,
            reported:
              '{"prompt_tokens":100,"completion_tokens":20,"total_tokens":120,"prompt_tokens_details":{"cached_tokens":80},"completion_tokens_details":{"reasoning_tokens":5}}',
          }),
        );
      }),
  );

  it.effect(
    "takes usage from the finish_reason chunk, as Z.ai sends it, and the latest usage wins",
    () =>
      Effect.gen(function* () {
        const reading = yield* readAll(
          events(
            '{"id":"1","model":"glm-5.2","choices":[{"index":0,"delta":{"content":"Hi"},"finish_reason":null}],"usage":{"prompt_tokens":10,"completion_tokens":1,"total_tokens":11}}',
            '{"id":"1","model":"glm-5.2","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":3,"total_tokens":13,"prompt_tokens_details":{"cached_tokens":4}}}',
            "[DONE]",
          ),
        );
        expect(Option.map(reading.usage, ({ tokens }) => tokens)).toEqual(
          Option.some({
            input: 6,
            cacheRead: 4,
            cacheWriteShort: 0,
            cacheWriteLong: 0,
            output: 3,
          }),
        );
        expect(reading.stopReason).toBe("stop");
      }),
  );

  it.effect(
    "is finished at [DONE] and reads on without failing past OpenCode Go's cost chunk",
    () =>
      Effect.gen(function* () {
        const readings = yield* Stream.runCollect(
          read(
            Stream.fromIterable(
              events(
                '{"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1,"total_tokens":4}}',
                "[DONE]",
                '{"choices":[],"cost":"0.00042"}',
              ),
            ),
          ),
        );
        expect(readings.map(({ finished }) => finished)).toEqual([
          false,
          false,
          true,
          true,
        ]);
        expect(
          Option.map(Arr.last(readings), ({ usage }) => Option.isSome(usage)),
        ).toEqual(Option.some(true));
      }),
  );

  it.effect("leaves usage not reported when a stream gives none", () =>
    Effect.gen(function* () {
      const reading = yield* readAll(
        events(
          '{"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}],"usage":null}',
          "[DONE]",
        ),
      );
      expect([reading.usage, reading.finished]).toEqual([Option.none(), true]);
    }),
  );

  it.effect(
    "reads reasoning under the field it arrived in, reasoning or reasoning_text",
    () =>
      Effect.gen(function* () {
        const reading = yield* readAll(
          events(
            '{"choices":[{"index":0,"delta":{"reasoning":"gpt-oss thinks"}}]}',
            '{"choices":[{"index":1,"delta":{"content":"second choice"}}]}',
            '{"choices":[{"index":0,"delta":{"reasoning_text":"pi style"}}]}',
            '{"choices":[{"index":0,"delta":{"content":"done"},"finish_reason":"stop"}]}',
            "[DONE]",
          ),
        );
        expect(reading.output).toEqual([
          {
            role: "assistant",
            content: "done",
            reasoning: "gpt-oss thinks",
            reasoning_text: "pi style",
          },
        ]);
      }),
  );

  it.effect(
    "skips a chunk that is not JSON, and one with fields of the wrong type",
    () =>
      Effect.gen(function* () {
        const reading = yield* readAll(
          events(
            "not json",
            '{"model":7,"choices":"no","usage":{"prompt_tokens":"many"}}',
            '{"choices":[{"index":0,"delta":{"content":"fine"}}]}',
            "[DONE]",
          ),
        );
        expect([reading.output, reading.servedModel, reading.usage]).toEqual([
          [{ role: "assistant", content: "fine" }],
          "",
          Option.none(),
        ]);
      }),
  );

  it.effect(
    "reads an error chunk inside a stream as the provider's error",
    () =>
      Effect.gen(function* () {
        const reading = yield* readAll(
          events(
            '{"error":{"message":"upstream overloaded","type":"server_error","code":null}}',
            "[DONE]",
          ),
        );
        expect(reading.error).toEqual(
          Option.some({ type: "server_error", message: "upstream overloaded" }),
        );
      }),
  );
});

describe("read, an answer that is not a stream", () => {
  it.effect(
    "reads choices[0].message as the output, with usage, stop reason and model",
    () =>
      Effect.gen(function* () {
        const reading = yield* readAll([
          {
            _tag: "Body",
            text: '{"id":"chatcmpl-1","object":"chat.completion","created":1,"model":"m","choices":[{"index":0,"message":{"role":"assistant","content":"Hi","reasoning_content":"...","tool_calls":[{"id":"call_1","type":"function","function":{"name":"read","arguments":"{\\"path\\":\\"a\\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":100,"completion_tokens":20,"total_tokens":120,"prompt_tokens_details":{"cached_tokens":80},"completion_tokens_details":{"reasoning_tokens":5}}}',
          },
        ]);
        expect(reading.output).toEqual([
          {
            role: "assistant",
            content: "Hi",
            reasoning_content: "...",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "read", arguments: '{"path":"a"}' },
              },
            ],
          },
        ]);
        expect([
          reading.stopReason,
          reading.servedModel,
          Option.map(reading.usage, ({ tokens, reasoning }) => [
            tokens.input,
            tokens.cacheRead,
            tokens.output,
            reasoning,
          ]),
        ]).toEqual(["tool_calls", "m", Option.some([20, 80, 20, 5])]);
      }),
  );

  it.effect(
    "reads the error type and message of Z.ai's and OpenCode Go's error bodies",
    () =>
      Effect.gen(function* () {
        const zai = yield* readAll([
          {
            _tag: "Body",
            text: '{"error":{"code":"1308","message":"Usage limit reached for 5 hour. Your limit will reset at 2026-09-22 16:25:56"}}',
          },
        ]);
        const go = yield* readAll([
          {
            _tag: "Body",
            text: '{"type":"error","error":{"type":"GoUsageLimitError","message":"5-hour usage limit reached. Resets in 3h 2m."},"metadata":{"workspace":"wrk_1","limitName":"5 hour"}}',
          },
        ]);
        expect([zai.error, go.error]).toEqual([
          Option.some({
            type: "1308",
            message:
              "Usage limit reached for 5 hour. Your limit will reset at 2026-09-22 16:25:56",
          }),
          Option.some({
            type: "GoUsageLimitError",
            message: "5-hour usage limit reached. Resets in 3h 2m.",
          }),
        ]);
      }),
  );
});

describe("reader", () => {
  it("reads the answers of chat and of no other operation", () => {
    expect(
      [
        request("POST", "/chat/completions"),
        request("GET", "/models"),
        request("POST", "/embeddings"),
      ].map((each) => Option.isSome(protocol.reader(protocol.describe(each)))),
    ).toEqual([true, false, false]);
  });
});

describe("error", () => {
  it("reads an error body's type, else its code, and its message", () => {
    expect([
      protocol.error(
        '{"error":{"type":"invalid_request_error","message":"model not found"}}',
      ),
      protocol.error(
        '{"error":{"code":1113,"message":"Insufficient balance"}}',
      ),
      protocol.error("Bad Gateway"),
    ]).toEqual([
      Option.some({
        type: "invalid_request_error",
        message: "model not found",
      }),
      Option.some({ type: "1113", message: "Insufficient balance" }),
      Option.none(),
    ]);
  });
});

describe("refusal", () => {
  const goBody =
    '{"type":"error","error":{"type":"GoUsageLimitError","message":"5-hour usage limit reached. Resets in 3h 2m."},"metadata":{"limitName":"5 hour"}}';
  const zaiBody = (code: string) =>
    `{"error":{"code":"${code}","message":"Usage limit reached"}}`;

  it.effect(
    "recognises OpenCode Go's GoUsageLimitError with its retry-after seconds as the reset",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(
          DateTime.toEpochMillis(DateTime.makeUnsafe("2026-11-12T10:00:00Z")),
        );
        const refusal = yield* refusalOf({
          status: 429,
          headers: { "retry-after": "10920" },
          body: goBody,
        });
        expect(
          Option.map(refusal, ({ reset }) =>
            Option.map(reset, DateTime.formatIso),
          ),
        ).toEqual(Option.some(Option.some("2026-11-12T13:02:00.000Z")));
      }),
  );

  it.effect(
    "recognises Z.ai's codes 1308, 1310 and 1316 to 1321, without parsing the reset in the message",
    () =>
      Effect.gen(function* () {
        const codes = [
          "1308",
          "1310",
          "1316",
          "1317",
          "1318",
          "1319",
          "1320",
          "1321",
        ];
        const refusals = yield* Effect.forEach(codes, (code) =>
          refusalOf({ status: 429, headers: {}, body: zaiBody(code) }),
        );
        expect(refusals).toEqual(
          codes.map(() => Option.some({ reset: Option.none() })),
        );
      }),
  );

  it.effect(
    "is not a refusal for Z.ai's transient 429s, a plain rate limit, another status, or a reset given as a date",
    () =>
      Effect.gen(function* () {
        const answers: ReadonlyArray<Refusal.Answer> = [
          { status: 429, headers: {}, body: zaiBody("1302") },
          { status: 429, headers: {}, body: zaiBody("1305") },
          { status: 429, headers: {}, body: zaiBody("1113") },
          {
            status: 429,
            headers: { "retry-after": "5" },
            body: '{"type":"error","error":{"type":"RateLimitError","message":"slow down"}}',
          },
          { status: 400, headers: {}, body: zaiBody("1308") },
          { status: 429, headers: {}, body: "Usage limit reached" },
        ];
        const refusals = yield* Effect.forEach(answers, refusalOf);
        expect(refusals).toEqual(answers.map(() => Option.none()));
        const dated = yield* refusalOf({
          status: 429,
          headers: { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" },
          body: goBody,
        });
        expect(dated).toEqual(Option.some({ reset: Option.none() }));
      }),
  );
});

describe("answerHeaders", () => {
  it("reads x-request-id as the provider's request id, and retry-after as a quota header", () => {
    expect([
      protocol.answerHeaders({
        "x-request-id": "req_abc",
        "retry-after": "30",
        "content-type": "application/json",
      }),
      protocol.answerHeaders({ "content-type": "text/event-stream" }),
    ]).toEqual([
      {
        providerRequestId: "req_abc",
        servedModel: "",
        rateLimits: { "retry-after": "30" },
      },
      { providerRequestId: "", servedModel: "", rateLimits: {} },
    ]);
  });
});

describe("conversation", () => {
  const chat = request("POST", "/chat/completions");
  const rules = Option.getOrThrow(
    protocol.conversation(protocol.describe(chat)),
  );

  it("reads the conversation of chat and of no other operation", () => {
    expect(
      [chat, request("GET", "/models")].map((each) =>
        Option.isSome(protocol.conversation(protocol.describe(each))),
      ),
    ).toEqual([true, false]);
  });

  it("splits tools and messages, takes nothing out, and reads content, reasoning and tool-call arguments as text", () => {
    const tool = {
      type: "function",
      function: { name: "read", parameters: { type: "object" } },
    };
    const conversation = Option.getOrThrow(
      Conversation.read(
        rules,
        {
          model: "glm-5.2",
          stream: true,
          tools: [tool],
          messages: [
            { role: "system", content: "You are terse." },
            {
              role: "user",
              content: [
                { type: "text", text: "Read a.txt" },
                {
                  type: "image_url",
                  image_url: { url: "data:image/png;base64,iVBORw0K" },
                },
              ],
            },
            {
              role: "assistant",
              content: null,
              reasoning_content: "Let me",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "read", arguments: '{"path":"a.txt"}' },
                },
              ],
            },
            { role: "tool", tool_call_id: "call_1", content: "hello" },
          ],
        },
        [],
      ),
    );

    expect([
      conversation.params,
      conversation.layout.map(({ part, field, layout }) => [
        part,
        field,
        layout,
      ]),
      conversation.overlay,
      conversation.tools.map(({ content, type }) => [content, type]),
      conversation.input.map(({ role, text }) => [role, text]),
    ]).toEqual([
      { model: "glm-5.2", stream: true },
      [
        ["tools", "tools", "list"],
        ["input", "messages", "list"],
      ],
      [],
      [[Conversation.canonical(tool), "function"]],
      [
        ["system", "You are terse."],
        ["user", "Read a.txt"],
        ["assistant", 'Let me\n\n{"path":"a.txt"}'],
        ["tool", "hello"],
      ],
    ]);
  });
});
