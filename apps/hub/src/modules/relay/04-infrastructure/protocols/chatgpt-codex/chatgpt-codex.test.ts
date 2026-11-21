import { describe, expect, it } from "@effect/vitest";
import { Array as Arr, DateTime, Effect, Option, Stream } from "effect";
import type * as Protocol from "#modules/relay/02-application/interfaces/protocol.ts";
import type * as ClientRequest from "#modules/relay/03-domain/client-request.ts";
import * as Conversation from "#shared/03-domain/conversation.ts";
import * as ChatgptCodex from "./chatgpt-codex.ts";

const { protocol } = ChatgptCodex;

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
  protocol.reader(protocol.describe(request("POST", "/responses"))),
);

const readAll = (data: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const parts = data.map(
      (each): Protocol.Part => ({
        _tag: "Event",
        event: /"type":"([^"]+)"/.exec(each)?.[1] ?? "message",
        data: each,
      }),
    );
    const readings = yield* Stream.runCollect(read(Stream.fromIterable(parts)));
    return Option.getOrThrow(Arr.last(readings));
  });

const sha256 = (text: string) =>
  new Bun.CryptoHasher("sha256").update(text).digest("hex");

const jwtHeader = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9";
const annToken = `${jwtHeader}.eyJodHRwczovL2FwaS5vcGVuYWkuY29tL2F1dGgiOnsiY2hhdGdwdF9hY2NvdW50X2lkIjoiYWNjdC1mYWtlLTAwMDEiLCJjaGF0Z3B0X2FjY291bnRfdXNlcl9pZCI6InVzZXItZmFrZS1hbm5fX2FjY3QtZmFrZS0wMDAxIn0sImV4cCI6MTc5NDQ0MTYwMH0.c2lnbmF0dXJl`;
const annRefreshed = `${jwtHeader}.eyJodHRwczovL2FwaS5vcGVuYWkuY29tL2F1dGgiOnsiY2hhdGdwdF9hY2NvdW50X2lkIjoiYWNjdC1mYWtlLTAwMDEiLCJjaGF0Z3B0X2FjY291bnRfdXNlcl9pZCI6InVzZXItZmFrZS1hbm5fX2FjY3QtZmFrZS0wMDAxIn0sImV4cCI6MTc5NDQ0NTIwMH0.b3RoZXI`;
const bobToken = `${jwtHeader}.eyJodHRwczovL2FwaS5vcGVuYWkuY29tL2F1dGgiOnsiY2hhdGdwdF9hY2NvdW50X2lkIjoiYWNjdC1mYWtlLTAwMDEiLCJjaGF0Z3B0X2FjY291bnRfdXNlcl9pZCI6InVzZXItZmFrZS1ib2JfX2FjY3QtZmFrZS0wMDAxIn0sImV4cCI6MTc5NDQ0MTYwMH0.c2lnbmF0dXJl`;
const unclaimedToken = `${jwtHeader}.eyJodHRwczovL2FwaS5vcGVuYWkuY29tL2F1dGgiOnsiY2hhdGdwdF9hY2NvdW50X2lkIjoiYWNjdC1mYWtlLTAwMDEifSwiZXhwIjoxNzk0NDQxNjAwfQ.c2lnbmF0dXJl`;

const reasoningDone =
  '{"type":"response.output_item.done","sequence_number":7,"output_index":0,"item":{"id":"rs_0fake","type":"reasoning","summary":[{"type":"summary_text","text":"**Listing files**\\n\\nI will look at the directory first."}],"encrypted_content":"gAAAAABfakeEncryptedReasoning=="}}';
const messageDone =
  '{"type":"response.output_item.done","sequence_number":14,"output_index":1,"item":{"id":"msg_0fake","type":"message","status":"completed","role":"assistant","content":[{"type":"output_text","annotations":[],"logprobs":[],"text":"I will list the files."}],"phase":"commentary"}}';
const functionCallDone =
  '{"type":"response.output_item.done","sequence_number":18,"output_index":2,"item":{"id":"fc_0fake","type":"function_call","status":"completed","arguments":"{\\"command\\":[\\"ls\\"],\\"workdir\\":\\"/work/demo\\"}","call_id":"call_0fake","name":"shell"}}';
const completed =
  '{"type":"response.completed","sequence_number":19,"response":{"id":"resp_0fake","object":"response","status":"completed","model":"gpt-5.5-codex","end_turn":false,"usage":{"input_tokens":5200,"input_tokens_details":{"cached_tokens":4096,"cache_write_tokens":1000},"output_tokens":180,"output_tokens_details":{"reasoning_tokens":96},"total_tokens":5380}}}';

const turn = [
  '{"type":"response.created","sequence_number":0,"response":{"id":"resp_0fake","object":"response","status":"in_progress","model":"gpt-5.5-codex","output":[],"usage":null}}',
  '{"type":"response.in_progress","sequence_number":1,"response":{"id":"resp_0fake","object":"response","status":"in_progress"}}',
  '{"type":"response.output_item.added","sequence_number":2,"output_index":0,"item":{"id":"rs_0fake","type":"reasoning","summary":[]}}',
  '{"type":"response.reasoning_summary_part.added","sequence_number":3,"item_id":"rs_0fake","output_index":0,"summary_index":0,"part":{"type":"summary_text","text":""}}',
  '{"type":"response.reasoning_summary_text.delta","sequence_number":4,"item_id":"rs_0fake","output_index":0,"summary_index":0,"delta":"**Listing files**"}',
  '{"type":"response.reasoning_summary_text.done","sequence_number":5,"item_id":"rs_0fake","output_index":0,"summary_index":0,"text":"**Listing files**\\n\\nI will look at the directory first."}',
  '{"type":"response.reasoning_summary_part.done","sequence_number":6,"item_id":"rs_0fake","output_index":0,"summary_index":0,"part":{"type":"summary_text","text":"**Listing files**\\n\\nI will look at the directory first."}}',
  reasoningDone,
  '{"type":"response.output_item.added","sequence_number":8,"output_index":1,"item":{"id":"msg_0fake","type":"message","status":"in_progress","role":"assistant","content":[]}}',
  '{"type":"response.content_part.added","sequence_number":9,"item_id":"msg_0fake","output_index":1,"content_index":0,"part":{"type":"output_text","annotations":[],"text":""}}',
  '{"type":"response.output_text.delta","sequence_number":10,"item_id":"msg_0fake","output_index":1,"content_index":0,"delta":"I will list"}',
  '{"type":"response.output_text.delta","sequence_number":11,"item_id":"msg_0fake","output_index":1,"content_index":0,"delta":" the files."}',
  '{"type":"response.output_text.done","sequence_number":12,"item_id":"msg_0fake","output_index":1,"content_index":0,"text":"I will list the files."}',
  '{"type":"response.content_part.done","sequence_number":13,"item_id":"msg_0fake","output_index":1,"content_index":0,"part":{"type":"output_text","annotations":[],"text":"I will list the files."}}',
  messageDone,
  '{"type":"response.output_item.added","sequence_number":15,"output_index":2,"item":{"id":"fc_0fake","type":"function_call","status":"in_progress","arguments":"","call_id":"call_0fake","name":"shell"}}',
  '{"type":"response.function_call_arguments.delta","sequence_number":16,"item_id":"fc_0fake","output_index":2,"delta":"{\\"command\\":[\\"ls\\"],\\"workdir\\":\\"/work/demo\\"}"}',
  '{"type":"response.function_call_arguments.done","sequence_number":17,"item_id":"fc_0fake","output_index":2,"arguments":"{\\"command\\":[\\"ls\\"],\\"workdir\\":\\"/work/demo\\"}"}',
  functionCallDone,
  completed,
];

const reasoningItem = {
  id: "rs_0fake",
  type: "reasoning",
  summary: [
    {
      type: "summary_text",
      text: "**Listing files**\n\nI will look at the directory first.",
    },
  ],
  encrypted_content: "gAAAAABfakeEncryptedReasoning==",
};
const messageItem = {
  id: "msg_0fake",
  type: "message",
  status: "completed",
  role: "assistant",
  content: [
    {
      type: "output_text",
      annotations: [],
      logprobs: [],
      text: "I will list the files.",
    },
  ],
  phase: "commentary",
};
const functionCallItem = {
  id: "fc_0fake",
  type: "function_call",
  status: "completed",
  arguments: '{"command":["ls"],"workdir":"/work/demo"}',
  call_id: "call_0fake",
  name: "shell",
};

describe("describe", () => {
  it("names responses, models, search and image, and every other request other", () => {
    expect(
      [
        request("POST", "/responses"),
        request("GET", "/models"),
        request("POST", "/alpha/search"),
        request("POST", "/images/generations"),
        request("POST", "/images/edits"),
        request("GET", "/responses"),
        request("POST", "/responses/compact"),
        request("POST", "/memories/trace_summarize"),
        request("POST", ""),
      ].map((each) => protocol.describe(each).operation),
    ).toEqual([
      "responses",
      "models",
      "search",
      "image",
      "image",
      "other",
      "other",
      "other",
      "other",
    ]);
  });

  it("reads the model, whether it streams and the service tier from the body", () => {
    const described = [
      { model: "gpt-5.5-codex", stream: true, service_tier: "priority" },
      { model: "gpt-5.5-codex", stream: true },
      { model: "", stream: "yes", service_tier: 2 },
    ].map((body) => protocol.describe(request("POST", "/responses", {}, body)));
    expect(
      described.map(({ model, stream, serviceTier }) => [
        model,
        stream,
        serviceTier,
      ]),
    ).toEqual([
      [Option.some("gpt-5.5-codex"), true, "priority"],
      [Option.some("gpt-5.5-codex"), true, ""],
      [Option.none(), false, ""],
    ]);
  });

  it("takes the session from session-id, else session_id, else client_metadata.session_id in the body, and says where", () => {
    const body = {
      model: "gpt-5.5-codex",
      client_metadata: { session_id: " 019a7c1e-body " },
    };
    expect(
      [
        request(
          "POST",
          "/responses",
          { "session-id": "019a7c1e-header", session_id: "019a7c1e-old" },
          body,
        ),
        request("POST", "/responses", { session_id: "019a7c1e-old" }, body),
        request("POST", "/responses", { "session-id": "  " }, body),
        request(
          "POST",
          "/responses",
          {},
          { client_metadata: { session_id: "s".repeat(256) } },
        ),
        request("POST", "/responses", {}, { client_metadata: "019a" }),
      ].map((each) => protocol.describe(each).session),
    ).toEqual([
      Option.some({ id: "019a7c1e-header", source: "session-id" }),
      Option.some({ id: "019a7c1e-old", source: "session_id" }),
      Option.some({ id: "019a7c1e-body", source: "body" }),
      Option.none(),
      Option.none(),
    ]);
  });

  it("takes the purpose from x-openai-subagent, else request_kind in x-codex-turn-metadata, and skips metadata that is not JSON", () => {
    const metadata =
      '{"session_id":"019a7c1e","turn_id":"019a7c1f","request_kind":"compaction","sandbox":"seatbelt"}';
    expect(
      [
        { "x-openai-subagent": "review", "x-codex-turn-metadata": metadata },
        { "x-openai-subagent": " ", "x-codex-turn-metadata": metadata },
        { "x-codex-turn-metadata": '{"turn_id":"019a7c1f"}' },
        { "x-codex-turn-metadata": "request_kind=turn" },
        { "x-codex-turn-metadata": '{"request_kind":7}' },
        {},
      ].map(
        (headers) =>
          protocol.describe(request("POST", "/responses", headers)).purpose,
      ),
    ).toEqual(["review", "compaction", "", "", "", ""]);
  });

  it("keeps the headers on its list and no other", () => {
    const described = protocol.describe(
      request("POST", "/responses", {
        originator: "codex_cli_rs",
        "thread-id": "019a7c1e",
        "x-codex-window-id": "019a7c1e:0",
        "x-codex-turn-metadata": '{"request_kind":"turn"}',
        "x-openai-subagent": "review",
        "x-codex-parent-thread-id": "019a7c00",
        "x-codex-beta-features": "remote_compaction_v2",
        authorization: `Bearer ${annToken}`,
        "chatgpt-account-id": "acct-fake-0001",
        "session-id": "019a7c1e",
        "x-codex-turn-state": "opaque",
        "content-encoding": "zstd",
      }),
    );
    expect(described.headers).toEqual({
      originator: "codex_cli_rs",
      "thread-id": "019a7c1e",
      "x-codex-window-id": "019a7c1e:0",
      "x-codex-turn-metadata": '{"request_kind":"turn"}',
      "x-openai-subagent": "review",
      "x-codex-parent-thread-id": "019a7c00",
      "x-codex-beta-features": "remote_compaction_v2",
    });
  });
});

describe("fingerprint", () => {
  const fingerprintOf = (headers: ClientRequest.Headers) =>
    protocol.fingerprint(request("POST", "/responses", headers));

  it("joins the account id with the access token's account-user claim, so a refreshed token keeps its fingerprint", () => {
    const account = { "chatgpt-account-id": "acct-fake-0001" };
    expect([
      fingerprintOf({ ...account, authorization: `Bearer ${annToken}` }),
      fingerprintOf({ ...account, authorization: `Bearer ${annRefreshed}` }),
      fingerprintOf({ ...account, authorization: `Bearer ${bobToken}` }),
    ]).toEqual([
      Option.some(sha256("acct-fake-0001\nuser-fake-ann__acct-fake-0001")),
      Option.some(sha256("acct-fake-0001\nuser-fake-ann__acct-fake-0001")),
      Option.some(sha256("acct-fake-0001\nuser-fake-bob__acct-fake-0001")),
    ]);
  });

  it("is the account id alone when the token has no claim or is not a JWT, the login without an account id, and nothing without a login", () => {
    expect(
      [
        {
          "chatgpt-account-id": "acct-fake-0001",
          authorization: `Bearer ${unclaimedToken}`,
        },
        {
          "chatgpt-account-id": "acct-fake-0001",
          authorization: "Bearer not-a-jwt",
        },
        {
          "chatgpt-account-id": "acct-fake-0001",
          authorization: "Bearer a.%%%.c",
        },
        { authorization: `Bearer ${annToken}` },
        { "chatgpt-account-id": " ", authorization: "Bearer not-a-jwt" },
        { "chatgpt-account-id": "acct-fake-0001" },
      ].map(fingerprintOf),
    ).toEqual([
      Option.some(sha256("acct-fake-0001")),
      Option.some(sha256("acct-fake-0001")),
      Option.some(sha256("acct-fake-0001")),
      Option.some(sha256(annToken)),
      Option.some(sha256("not-a-jwt")),
      Option.none(),
    ]);
  });
});

describe("refusal", () => {
  const refusalOf = (status: number, body: string) =>
    protocol.refusal.of({ status, headers: {}, body });

  it.effect(
    "is a 429 whose error.type is usage_limit_reached, with its reset from error.resets_at in Unix seconds",
    () =>
      Effect.gen(function* () {
        const refusals = yield* Effect.forEach(
          [
            '{"error":{"type":"usage_limit_reached","message":"The usage limit has been reached","plan_type":"pro","resets_at":1794477600,"limit_window_minutes":300}}',
            '{"error":{"type":"usage_limit_reached","resets_at":"soon"}}',
            '{"error":{"type":"usage_limit_reached"}}',
          ],
          (body) => refusalOf(429, body),
        );
        expect(
          refusals.map((refusal) =>
            Option.map(refusal, ({ reset }) =>
              Option.map(reset, DateTime.formatIso),
            ),
          ),
        ).toEqual([
          Option.some(Option.some("2026-11-12T10:00:00.000Z")),
          Option.some(Option.none()),
          Option.some(Option.none()),
        ]);
      }),
  );

  it.effect(
    "is not a refusal for another 429, a usage limit that is not a 429, or a body that is not JSON",
    () =>
      Effect.gen(function* () {
        const refusals = yield* Effect.forEach(
          [
            [429, '{"error":{"type":"usage_not_included"}}'],
            [
              429,
              '{"error":{"code":"rate_limit_exceeded","message":"Rate limit reached"}}',
            ],
            [429, '{"error":{"code":"usage_limit_reached"}}'],
            [429, "Too Many Requests"],
            [429, ""],
            [403, '{"error":{"type":"usage_limit_reached"}}'],
          ] as const,
          ([status, body]) => refusalOf(status, body),
        );
        expect(refusals).toEqual(Arr.makeBy(6, () => Option.none()));
      }),
  );

  it("is told from the answer's body", () => {
    expect(protocol.refusal._tag).toBe("FromBody");
  });
});

describe("answerHeaders", () => {
  it("reads x-request-id, else x-oai-request-id, the served model from openai-model, and keeps the quota headers but x-codex-turn-state", () => {
    expect([
      protocol.answerHeaders({
        "x-request-id": "req_0fake",
        "x-oai-request-id": "oai_0fake",
        "openai-model": "gpt-5.5-codex-2026-10-01",
        "x-codex-primary-used-percent": "42",
        "x-codex-primary-window-minutes": "300",
        "x-codex-primary-reset-at": "1794477600",
        "x-codex-secondary-used-percent": "7",
        "x-codex-other-primary-used-percent": "3",
        "x-codex-other-limit-name": "Other models",
        "x-codex-credits-has-credits": "false",
        "x-codex-active-limit": "codex",
        "x-gpt-5-limit-name": "GPT-5",
        "x-codex-turn-state": "opaque-routing-token",
        "x-models-etag": "W/1",
        "content-type": "text/event-stream",
      }),
      protocol.answerHeaders({ "x-oai-request-id": "oai_0fake" }),
    ]).toEqual([
      {
        providerRequestId: "req_0fake",
        servedModel: "gpt-5.5-codex-2026-10-01",
        rateLimits: {
          "x-codex-primary-used-percent": "42",
          "x-codex-primary-window-minutes": "300",
          "x-codex-primary-reset-at": "1794477600",
          "x-codex-secondary-used-percent": "7",
          "x-codex-other-primary-used-percent": "3",
          "x-codex-other-limit-name": "Other models",
          "x-codex-credits-has-credits": "false",
          "x-codex-active-limit": "codex",
          "x-gpt-5-limit-name": "GPT-5",
        },
      },
      { providerRequestId: "oai_0fake", servedModel: "", rateLimits: {} },
    ]);
  });
});

describe("reader", () => {
  it("reads the answers of responses and of no other operation", () => {
    expect(
      [
        request("POST", "/responses"),
        request("GET", "/models"),
        request("POST", "/alpha/search"),
        request("POST", "/images/generations"),
        request("POST", "/memories/trace_summarize"),
      ].map((each) => Option.isSome(protocol.reader(protocol.describe(each)))),
    ).toEqual([true, false, false, false, false]);
  });
});

describe("read, a stream", () => {
  it.effect(
    "keeps each response.output_item.done as one finished output item, in the order they came, and nothing from the deltas",
    () =>
      Effect.gen(function* () {
        const reading = yield* readAll(turn);
        expect(reading.output).toEqual([
          reasoningItem,
          messageItem,
          functionCallItem,
        ]);
      }),
  );

  it.effect(
    "is finished at response.completed, with its usage in the request log's classes: cached and cache-write tokens taken out of input",
    () =>
      Effect.gen(function* () {
        const before = yield* readAll(turn.slice(0, -1));
        const reading = yield* readAll(turn);
        expect([before.finished, before.usage]).toEqual([false, Option.none()]);
        expect([
          reading.finished,
          reading.stopReason,
          reading.error,
          reading.usage,
        ]).toEqual([
          true,
          "completed",
          Option.none(),
          Option.some({
            tokens: {
              input: 104,
              cacheRead: 4096,
              cacheWriteShort: 1000,
              cacheWriteLong: 0,
              output: 180,
            },
            reasoning: 96,
            reported:
              '{"input_tokens":5200,"input_tokens_details":{"cached_tokens":4096,"cache_write_tokens":1000},"output_tokens":180,"output_tokens_details":{"reasoning_tokens":96},"total_tokens":5380}',
          }),
        ]);
      }),
  );

  it.effect(
    "reads usage whose details are null or missing as all input and no reasoning",
    () =>
      Effect.gen(function* () {
        const reading = yield* readAll([
          '{"type":"response.completed","response":{"id":"resp_1","usage":{"input_tokens":12,"input_tokens_details":null,"output_tokens":3,"output_tokens_details":null,"total_tokens":15}}}',
        ]);
        expect(
          Option.map(reading.usage, ({ tokens, reasoning }) => [
            tokens,
            reasoning,
          ]),
        ).toEqual(
          Option.some([
            {
              input: 12,
              cacheRead: 0,
              cacheWriteShort: 0,
              cacheWriteLong: 0,
              output: 3,
            },
            0,
          ]),
        );
      }),
  );

  it.effect(
    "is finished at response.incomplete, with its usage and its reason as the stop reason",
    () =>
      Effect.gen(function* () {
        const reading = yield* readAll([
          messageDone,
          '{"type":"response.incomplete","sequence_number":15,"response":{"id":"resp_0fake","object":"response","status":"incomplete","incomplete_details":{"reason":"max_output_tokens"},"usage":{"input_tokens":900,"input_tokens_details":{"cached_tokens":0},"output_tokens":4096,"output_tokens_details":{"reasoning_tokens":4000},"total_tokens":4996}}}',
        ]);
        expect([
          reading.finished,
          reading.stopReason,
          reading.error,
          reading.output,
          Option.map(reading.usage, ({ tokens }) => tokens.output),
        ]).toEqual([
          true,
          "max_output_tokens",
          Option.none(),
          [messageItem],
          Option.some(4096),
        ]);
      }),
  );

  it.effect(
    "ends in a failure at response.failed, with the error's code where it has no type, and its message",
    () =>
      Effect.gen(function* () {
        const failed = yield* readAll([
          '{"type":"response.created","sequence_number":0,"response":{"id":"resp_5c66","status":"in_progress"}}',
          '{"type":"response.failed","sequence_number":3,"response":{"id":"resp_5c66","object":"response","created_at":1759510079,"status":"failed","background":false,"error":{"code":"context_length_exceeded","message":"Your input exceeds the context window of this model. Please adjust your input and try again."},"usage":null,"user":null,"metadata":{}}}',
        ]);
        const typed = yield* readAll([
          '{"type":"response.failed","response":{"status":"failed","error":{"type":"server_error","code":"server_is_overloaded","message":"Overloaded"}}}',
        ]);
        const bare = yield* readAll(['{"type":"response.failed"}']);
        expect(
          [failed, typed, bare].map((reading) => [
            reading.finished,
            reading.stopReason,
            reading.error,
            reading.usage,
          ]),
        ).toEqual([
          [
            true,
            "failed",
            Option.some({
              type: "context_length_exceeded",
              message:
                "Your input exceeds the context window of this model. Please adjust your input and try again.",
            }),
            Option.none(),
          ],
          [
            true,
            "failed",
            Option.some({ type: "server_error", message: "Overloaded" }),
            Option.none(),
          ],
          [true, "", Option.some({ type: "", message: "" }), Option.none()],
        ]);
      }),
  );

  it.effect(
    "ends in a failure at an error event, whether its error is nested or not",
    () =>
      Effect.gen(function* () {
        const nested = yield* readAll([
          '{"type":"error","error":{"code":"flex_unavailable","message":"Flex capacity unavailable."}}',
        ]);
        const flat = yield* readAll([
          '{"type":"error","code":"model_not_found","message":"The model does not exist.","param":null,"sequence_number":1}',
        ]);
        expect(
          [nested, flat].map((reading) => [reading.finished, reading.error]),
        ).toEqual([
          [
            true,
            Option.some({
              type: "flex_unavailable",
              message: "Flex capacity unavailable.",
            }),
          ],
          [
            true,
            Option.some({
              type: "model_not_found",
              message: "The model does not exist.",
            }),
          ],
        ]);
      }),
  );

  it.effect(
    "skips an unknown event, data that is not JSON and an item that is not an object, and keeps an item of an unknown type as it came",
    () =>
      Effect.gen(function* () {
        const reading = yield* readAll([
          '{"type":"response.future_event","anything":true}',
          "not json",
          '{"type":"response.output_item.done","item":"text"}',
          '{"type":"response.output_item.done","item":{"id":"zz_1","type":"future_item","payload":{"a":1}}}',
          '{"no_type":true}',
        ]);
        expect([reading.finished, reading.error, reading.output]).toEqual([
          false,
          Option.none(),
          [{ id: "zz_1", type: "future_item", payload: { a: 1 } }],
        ]);
      }),
  );

  it.effect(
    "takes the served model from an event's response.headers, as Codex does",
    () =>
      Effect.gen(function* () {
        const reading = yield* readAll([
          '{"type":"response.created","response":{"id":"resp_1","headers":{"OpenAI-Model":"gpt-5.5-codex-2026-10-01","x-codex-turn-state":"opaque"}}}',
          '{"type":"response.completed","response":{"id":"resp_1"}}',
        ]);
        expect(reading.servedModel).toBe("gpt-5.5-codex-2026-10-01");
      }),
  );
});

describe("error", () => {
  it("reads an error body's type, else its code, and its message", () => {
    expect(
      [
        '{"error":{"type":"usage_limit_reached","message":"The usage limit has been reached","resets_at":1794477600}}',
        '{"error":{"code":"model_not_found","message":"The model does not exist."}}',
        '{"detail":"Unauthorized"}',
        "<html>",
      ].map(protocol.error),
    ).toEqual([
      Option.some({
        type: "usage_limit_reached",
        message: "The usage limit has been reached",
      }),
      Option.some({
        type: "model_not_found",
        message: "The model does not exist.",
      }),
      Option.none(),
      Option.none(),
    ]);
  });
});

describe("conversation", () => {
  const responses = request("POST", "/responses");
  const rules = Option.getOrThrow(
    protocol.conversation(protocol.describe(responses)),
  );
  const conversationOf = (body: unknown) =>
    Option.getOrThrow(Conversation.read(rules, body, []));

  it("reads the conversation of responses and of no other operation", () => {
    expect(
      [
        responses,
        request("GET", "/models"),
        request("POST", "/alpha/search"),
        request("POST", "/images/edits"),
      ].map((each) =>
        Option.isSome(protocol.conversation(protocol.describe(each))),
      ),
    ).toEqual([true, false, false, false]);
  });

  it("splits instructions as one system item, tools and input, and takes nothing out", () => {
    const conversation = conversationOf({
      model: "gpt-5.5-codex",
      instructions: "You are Codex.",
      tools: [{ type: "function", name: "shell", parameters: {} }],
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "List the files." }],
        },
      ],
      stream: true,
    });
    const without = conversationOf({ model: "gpt-5.5-codex", input: [] });

    expect([
      conversation.params,
      conversation.layout.map(({ field, layout }) => [field, layout]),
      conversation.overlay,
      [conversation.system, conversation.tools, conversation.input].map(
        (items) => items.map(({ content }) => content),
      ),
      without.layout.map(({ field, layout }) => [field, layout]),
    ]).toEqual([
      { model: "gpt-5.5-codex", stream: true },
      [
        ["instructions", "single"],
        ["tools", "list"],
        ["input", "list"],
      ],
      [],
      [
        ['"You are Codex."'],
        ['{"name":"shell","parameters":{},"type":"function"}'],
        [
          '{"content":[{"text":"List the files.","type":"input_text"}],"role":"user","type":"message"}',
        ],
      ],
      [
        ["instructions", "absent"],
        ["tools", "absent"],
        ["input", "list"],
      ],
    ]);
  });

  it("reads an item's text from message text, reasoning summary, tool arguments and tool output, never encrypted content or image data", () => {
    const conversation = conversationOf({
      instructions: "You are Codex.",
      input: [
        {
          type: "message",
          role: "developer",
          content: [{ type: "input_text", text: "Sandbox: workspace-write." }],
        },
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "What is in this picture?" },
            {
              type: "input_image",
              image_url: "data:image/png;base64,iVBORw0KGgo=",
            },
          ],
        },
        { role: "user", content: "A plain message." },
        reasoningItem,
        messageItem,
        functionCallItem,
        {
          type: "function_call_output",
          call_id: "call_0fake",
          output: "README.md\nsrc",
        },
        {
          type: "custom_tool_call",
          call_id: "call_1fake",
          name: "apply_patch",
          input: "*** Begin Patch\n*** End Patch",
        },
        {
          type: "custom_tool_call_output",
          call_id: "call_1fake",
          output: [
            { type: "input_text", text: "Done." },
            { type: "input_image", image_url: "data:image/png;base64,AAAA" },
          ],
        },
        {
          type: "local_shell_call",
          call_id: "call_2fake",
          status: "completed",
          action: { type: "exec", command: ["ls", "-a"] },
        },
        {
          type: "web_search_call",
          id: "ws_0fake",
          status: "completed",
          action: { type: "search", query: "effect 4 streams" },
        },
        {
          type: "image_generation_call",
          id: "ig_0fake",
          status: "completed",
          result: "iVBORw0KGgo=",
        },
        { type: "compaction", encrypted_content: "gAAAAABfakeCompaction==" },
      ],
    });

    expect(
      [...conversation.system, ...conversation.input].map(
        ({ type, role, text }) => ({ type, role, text }),
      ),
    ).toEqual([
      { type: "", role: "", text: "You are Codex." },
      { type: "message", role: "developer", text: "Sandbox: workspace-write." },
      { type: "message", role: "user", text: "What is in this picture?" },
      { type: "", role: "user", text: "A plain message." },
      {
        type: "reasoning",
        role: "",
        text: "**Listing files**\n\nI will look at the directory first.",
      },
      { type: "message", role: "assistant", text: "I will list the files." },
      {
        type: "function_call",
        role: "",
        text: '{"command":["ls"],"workdir":"/work/demo"}',
      },
      { type: "function_call_output", role: "", text: "README.md\nsrc" },
      {
        type: "custom_tool_call",
        role: "",
        text: "*** Begin Patch\n*** End Patch",
      },
      { type: "custom_tool_call_output", role: "", text: "Done." },
      {
        type: "local_shell_call",
        role: "",
        text: '{"command":["ls","-a"],"type":"exec"}',
      },
      {
        type: "web_search_call",
        role: "",
        text: '{"query":"effect 4 streams","type":"search"}',
      },
      { type: "image_generation_call", role: "", text: "" },
      { type: "compaction", role: "", text: "" },
    ]);
  });

  it.effect(
    "stores each finished output item as the same item Codex sends back, in its own key order, as input on its next request",
    () =>
      Effect.gen(function* () {
        const question = {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "List the files." }],
        };
        const answer = yield* readAll(turn);
        const answered = Option.getOrThrow(
          Conversation.read(
            rules,
            { model: "gpt-5.5-codex", input: [question] },
            answer.output,
          ),
        );
        const next = conversationOf({
          model: "gpt-5.5-codex",
          input: [
            question,
            JSON.parse(
              '{"type":"reasoning","id":"rs_0fake","summary":[{"type":"summary_text","text":"**Listing files**\\n\\nI will look at the directory first."}],"encrypted_content":"gAAAAABfakeEncryptedReasoning=="}',
            ),
            JSON.parse(
              '{"type":"message","status":"completed","id":"msg_0fake","role":"assistant","content":[{"type":"output_text","text":"I will list the files.","annotations":[],"logprobs":[]}],"phase":"commentary"}',
            ),
            JSON.parse(
              '{"type":"function_call","status":"completed","id":"fc_0fake","name":"shell","arguments":"{\\"command\\":[\\"ls\\"],\\"workdir\\":\\"/work/demo\\"}","call_id":"call_0fake"}',
            ),
            {
              type: "function_call_output",
              call_id: "call_0fake",
              output: "README.md\nsrc",
            },
          ],
        });

        expect(answered.output.map(({ digest }) => digest)).toEqual(
          next.input.slice(1, 4).map(({ digest }) => digest),
        );
      }),
  );
});
