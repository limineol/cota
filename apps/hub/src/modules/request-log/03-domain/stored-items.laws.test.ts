import { expect, layer } from "@effect/vitest";
import { Arbitrary, DateTime, Effect, Option, Schema } from "effect";
import type * as Protocol from "#modules/relay/02-application/interfaces/protocol.ts";
import * as AnthropicMessages from "#modules/relay/04-infrastructure/protocols/anthropic-messages/anthropic-messages.ts";
import * as ChatgptCodex from "#modules/relay/04-infrastructure/protocols/chatgpt-codex/chatgpt-codex.ts";
import * as OpenAiChat from "#modules/relay/04-infrastructure/protocols/openai-chat/openai-chat.ts";
import { RecordRequest } from "#modules/request-log/02-application/commands/record-request.command.ts";
import { RebuildConversation } from "#modules/request-log/02-application/queries/rebuild-conversation.query.ts";
import * as ItemMapper from "#modules/request-log/04-infrastructure/persistence/clickhouse/mappers/item.mapper.ts";
import * as RequestMapper from "#modules/request-log/04-infrastructure/persistence/clickhouse/mappers/request.mapper.ts";
import * as RequestItemsMapper from "#modules/request-log/04-infrastructure/persistence/clickhouse/mappers/request-items.mapper.ts";
import { InMemoryRequests } from "#modules/request-log/05-tests/fakes/in-memory-requests.repository.ts";
import * as RequestLog from "#modules/request-log/05-tests/fakes/record-request.fake.ts";
import * as Conversation from "#shared/03-domain/conversation.ts";
import { HubKeyName, PoolId } from "#shared/03-domain/ids.ts";
import type { ProtocolName } from "#shared/03-domain/protocol-name.ts";
import * as Request from "#shared/03-domain/request.entity.ts";
import * as FakeProvider from "#shared/05-tests/fake-provider.ts";
import * as Harness from "#shared/05-tests/harness.ts";
import * as StoredItems from "./stored-items.ts";

const int = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));
const pick = <const A extends readonly [unknown, ...Array<unknown>]>(
  values: A,
): Arbitrary.Arbitrary<A[number]> =>
  int(0, values.length - 1).pipe(
    Arbitrary.map((index): A[number] => values[index] ?? values[0]),
  );
const anyText = Arbitrary.schema(Schema.String);

/** Text with half of a surrogate pair in it, high or low, and the other half sometimes beside it. */
const halfText = Arbitrary.all([
  anyText,
  pick(["\ud800", "\udbff", "\udc00", "\udfff", "\ud83d", "\ude00"]),
  anyText,
]).pipe(Arbitrary.map((pieces) => pieces.join("")));

const loneSurrogate =
  /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

/** A value with each lone surrogate in its texts, keys included, made U+FFFD. */
const textsMended = (value: unknown): unknown => {
  if (typeof value === "string") return value.replace(loneSurrogate, "\ufffd");
  if (Array.isArray(value)) return value.map(textsMended);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, each]) => [
      textsMended(key),
      textsMended(each),
    ]),
  );
};

/** Every text of a value, keys included. */
const texts = (value: unknown): ReadonlyArray<string> => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(texts);
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, each]) => [key, ...texts(each)]);
};
const leaf = Arbitrary.schema(Schema.Json);

const keys = [
  "type",
  "role",
  "content",
  "text",
  "input",
  "__proto__",
  "constructor",
  "0",
  "10",
  "é😀",
  "summary",
  "encrypted_content",
  "arguments",
  "output",
  "",
] as const;

const objectOf = (
  key: Arbitrary.Arbitrary<string>,
  value: Arbitrary.Arbitrary<Schema.Json>,
  minLength = 0,
) =>
  Arbitrary.array(Arbitrary.all([key, value]), {
    minLength,
    maxLength: 4,
  }).pipe(Arbitrary.map((pairs): Schema.Json => Object.fromEntries(pairs)));

const nodeOf = (
  key: Arbitrary.Arbitrary<string>,
  depth: number,
): Arbitrary.Arbitrary<Schema.Json> =>
  depth === 0
    ? leaf
    : int(0, 3).pipe(
        Arbitrary.flatMap((kind) => {
          if (kind === 0) return leaf;
          const child = nodeOf(key, depth - 1);
          return kind === 1
            ? Arbitrary.array(child, { maxLength: 3 })
            : objectOf(key, child);
        }),
      );

const withMarkers = pick([...keys, "cache_control", "cache_control"]);
const withoutMarkers = Arbitrary.all([pick(keys), anyText]).pipe(
  Arbitrary.map(([key, other]) => (key === "" ? other : key)),
);

type Shape = "absent" | "single" | "list" | "empty";

const partOf = (field: string) =>
  Arbitrary.all({
    field: Arbitrary.Constant(field),
    shape: pick(["absent", "single", "list", "list", "empty"]),
    items: Arbitrary.array(nodeOf(withMarkers, 4), {
      minLength: 1,
      maxLength: 4,
    }),
  });

const bodyOf = (fields: ReadonlyArray<string>) =>
  Arbitrary.all({
    params: Arbitrary.array(
      Arbitrary.all([
        pick(["model", "stream", "max_tokens", "cache_control", "__proto__"]),
        leaf,
      ]),
      { maxLength: 4 },
    ),
    parts: Arbitrary.all(fields.map(partOf)),
  }).pipe(
    Arbitrary.map(({ params, parts }): Schema.JsonObject => {
      const placed = parts.flatMap(
        ({ field, shape, items }): Array<readonly [string, Schema.Json]> => {
          const kinds: Record<Shape, () => Array<[string, Schema.Json]>> = {
            absent: () => [],
            single: () => [[field, items[0] ?? null]],
            list: () => [[field, items]],
            empty: () => [[field, []]],
          };
          return kinds[shape]();
        },
      );
      return Object.fromEntries([
        ...params.filter(([key]) => !fields.includes(key)),
        ...placed,
      ]);
    }),
  );

const isObject = (value: Schema.Json): value is Schema.JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const expectSameJson = (actual: Schema.Json, expected: Schema.Json) => {
  if (!Harness.sameJson(actual, expected)) expect(actual).toEqual(expected);
  expect(Harness.sameJson(actual, expected)).toBe(true);
};

const parsedJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json));
const asObject = Schema.decodeUnknownSync(Schema.JsonObject);
const throughText = (body: Schema.Json): Schema.Json =>
  parsedJson(JSON.stringify(body));

const rulesOf = (protocol: Protocol.Protocol, path: string) =>
  Option.getOrThrow(
    protocol.conversation(
      protocol.describe({
        method: "POST",
        path,
        headers: {},
        body: Option.none(),
      }),
    ),
  );

const anthropic = rulesOf(AnthropicMessages.protocol, "/v1/messages");
const openAi = rulesOf(OpenAiChat.protocol, "/chat/completions");
const codex = rulesOf(ChatgptCodex.protocol, "/responses");

const rulesFor: Readonly<Record<ProtocolName, Conversation.Rules>> = {
  "anthropic-messages": anthropic,
  "chatgpt-codex": codex,
  "openai-chat": openAi,
};

let run = 0;
const fresh = (name: string) => {
  run++;
  return `${name}-${run}`;
};

const requestOf = (
  session: string,
  protocol: ProtocolName,
  conversation: Option.Option<Conversation.Conversation>,
  at: number,
): Request.Request => ({
  id: Request.RequestId.make(Bun.randomUUIDv7("hex", at)),
  startedAt: DateTime.makeUnsafe(at),
  firstByteMs: Option.none(),
  durationMs: 0,
  session,
  sessionSource: "",
  machine: "",
  project: "",
  client: "",
  clientVersion: "",
  userAgent: "",
  hubKey: HubKeyName.make("clients"),
  pool: PoolId.make("solo"),
  divertedFrom: Option.none(),
  follows: Option.none(),
  loginFingerprint: Option.none(),
  refusalReset: Option.none(),
  provider: "",
  protocol,
  operation: "messages",
  purpose: "",
  model: "",
  servedModel: "",
  stream: false,
  outcome: "ok",
  upstreamStatus: 200,
  errorType: "",
  errorMessage: "",
  stopReason: "",
  usage: Option.none(),
  serviceTier: "",
  providerRequestId: "",
  rateLimits: {},
  clientHeaders: {},
  conversation,
  errorBody: "",
  requestBytes: 0,
  responseBytes: 0,
  readingComplete: true,
});

const shuffled = (value: Schema.Json, seed: number): Schema.Json => {
  if (Array.isArray(value)) {
    return value.map((each: Schema.Json, index) =>
      shuffled(each, seed + index + 1),
    );
  }
  if (!isObject(value)) return value;
  const entries = Object.entries(value).map(
    ([key, each], index): [string, Schema.Json] => [
      key,
      shuffled(each, seed + index + 1),
    ],
  );
  const turn = entries.length === 0 ? 0 : seed % entries.length;
  const rotated = [...entries.slice(turn), ...entries.slice(0, turn)];
  return Object.fromEntries(seed % 2 === 0 ? rotated : rotated.reverse());
};

const objectPaths = (
  value: Schema.Json,
  path: ReadonlyArray<string | number> = [],
): Array<ReadonlyArray<string | number>> => {
  if (Array.isArray(value)) {
    return value.flatMap((each: Schema.Json, index) =>
      objectPaths(each, [...path, index]),
    );
  }
  if (!isObject(value)) return [];
  return [
    path,
    ...Object.entries(value).flatMap(([key, each]) =>
      objectPaths(each, [...path, key]),
    ),
  ];
};

const marked = (
  value: Schema.Json,
  path: ReadonlyArray<string | number>,
): Schema.Json => {
  const [step, ...rest] = path;
  if (Array.isArray(value)) {
    return value.map((each: Schema.Json, index) =>
      index === step ? marked(each, rest) : each,
    );
  }
  if (!isObject(value)) return value;
  if (step === undefined) {
    return Object.fromEntries([
      ...Object.entries(value),
      ["cache_control", { type: "ephemeral" }],
    ]);
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, each]) => [
      key,
      key === step ? marked(each, rest) : each,
    ]),
  );
};

layer(RequestLog.layer)("request log laws", (it) => {
  it.effect.prop(
    "L1: For every JSON object a protocol can split, joining what it was split into gives the same JSON value.",
    {
      protocol: pick(["anthropic-messages", "openai-chat", "chatgpt-codex"]),
      anthropicBody: bodyOf(["system", "tools", "messages"]),
      openAiBody: bodyOf(["tools", "messages"]),
      codexBody: bodyOf(["instructions", "tools", "input"]),
    },
    (generated) =>
      Effect.gen(function* () {
        const recorded = yield* RequestLog.Recorded;
        const recordRequest = yield* RecordRequest;
        const rebuildConversation = yield* RebuildConversation;
        const rules = rulesFor[generated.protocol];
        const body = throughText(
          {
            "anthropic-messages": generated.anthropicBody,
            "chatgpt-codex": generated.codexBody,
            "openai-chat": generated.openAiBody,
          }[generated.protocol],
        );
        const conversation = Conversation.read(rules, body, []);
        const request = requestOf(
          fresh("l1"),
          generated.protocol,
          conversation,
          1_794_441_600_000,
        );
        yield* recordRequest.execute(request);
        yield* recorded.drain;

        expect(Option.isSome(conversation)).toBe(true);
        expectSameJson(
          Option.getOrThrow(
            Conversation.join(Conversation.split(rules, asObject(body))),
          ),
          body,
        );
        expectSameJson(
          Option.getOrThrow(
            yield* rebuildConversation.execute(request.id).pipe(Effect.orDie),
          ),
          body,
        );
      }),
    { timeout: 30_000, arbitrary: { runs: 300 } },
  );

  it.effect.prop(
    "L2: Two items of one session that are the same JSON value once the overlay is out have the same digest, and are stored once.",
    {
      protocol: pick(["anthropic-messages", "openai-chat", "chatgpt-codex"]),
      items: Arbitrary.array(
        objectOf(withoutMarkers, nodeOf(withoutMarkers, 3), 1),
        { minLength: 1, maxLength: 4 },
      ),
      requests: Arbitrary.array(
        Arbitrary.all({
          session: pick(["one", "one", "other"]),
          carried: Arbitrary.array(
            Arbitrary.all({
              item: int(0, 3),
              seed: int(0, 50),
              marker: int(-2, 8),
            }),
            { minLength: 1, maxLength: 5 },
          ),
        }),
        { minLength: 2, maxLength: 5 },
      ),
    },
    (generated) =>
      Effect.gen(function* () {
        const recorded = yield* RequestLog.Recorded;
        const recordRequest = yield* RecordRequest;
        const memory = yield* InMemoryRequests;
        const anthropicSpeaks = generated.protocol === "anthropic-messages";
        const rules = rulesFor[generated.protocol];
        const inputField = fieldOf[generated.protocol].input ?? "";
        const sessions = { one: fresh("l2"), other: fresh("l2") };
        const pool = generated.items;
        const firstCarried: Array<{
          session: string;
          item: Schema.Json;
          requestId: Request.RequestId;
          digest: Conversation.Digest;
        }> = [];

        for (const [index, request] of generated.requests.entries()) {
          const session = sessions[request.session];
          const carried = request.carried.map(
            ({ item }) => pool[item % pool.length] ?? null,
          );
          const sent = request.carried.map(({ seed, marker }, at) => {
            const item = shuffled(carried[at] ?? null, seed);
            const places = objectPaths(item);
            const place = places[marker];
            return anthropicSpeaks && place !== undefined
              ? marked(item, place)
              : item;
          });
          const conversation = Conversation.read(
            rules,
            throughText({ model: "m", [inputField]: sent }),
            [],
          );
          const finished = requestOf(
            session,
            generated.protocol,
            conversation,
            1_794_441_600_000 + index,
          );
          yield* recordRequest.execute(finished);
          const input = Option.getOrThrow(conversation).input;
          carried.forEach((item, at) => {
            const digest = input[at]?.digest;
            const known = firstCarried.find(
              (each) =>
                each.session === session && Harness.sameJson(each.item, item),
            );
            if (known === undefined && digest !== undefined) {
              firstCarried.push({
                session,
                item,
                requestId: finished.id,
                digest,
              });
            }
            const same = firstCarried.find((each) =>
              Harness.sameJson(each.item, item),
            );
            expect(digest).toBe(same?.digest);
          });
        }
        yield* recorded.drain;

        for (const session of Object.values(sessions)) {
          const stored = memory.items.filter(
            (item) => item.session === session,
          );
          const expected = firstCarried.filter(
            (each) => each.session === session,
          );
          expect(
            stored.map(({ digest, requestId }) => ({ digest, requestId })),
          ).toEqual(
            expected.map(({ digest, requestId }) => ({ digest, requestId })),
          );
          stored.forEach((item, at) => {
            expectSameJson(
              parsedJson(item.content),
              expected[at]?.item ?? null,
            );
          });
        }
      }),
    { timeout: 30_000, arbitrary: { runs: 300 } },
  );

  it.effect.prop(
    "L4: The rows written for a request are its rows as sent with each lone surrogate in a text made U+FFFD, so that every text is well-formed; an item's content and a request's layout, overlay and params, which write one as its escape, are as sent.",
    {
      texts: Arbitrary.array(halfText, { minLength: 30, maxLength: 30 }),
      usage: Arbitrary.schema(Schema.Boolean),
    },
    (generated) =>
      Effect.gen(function* () {
        const recorded = yield* RequestLog.Recorded;
        const recordRequest = yield* RecordRequest;
        const rebuildConversation = yield* RebuildConversation;
        const memory = yield* InMemoryRequests;
        const text = (at: number) => generated.texts[at] ?? "";
        const body = throughText({
          model: text(0),
          [text(1)]: text(2),
          system: [{ type: "text", text: text(3) }],
          messages: [
            { role: "user", content: text(4) },
            { role: text(5), content: [{ type: text(6), text: text(7) }] },
          ],
        });
        const sent: Request.Request = {
          ...requestOf(
            `${fresh("l4")}${text(8)}`,
            "anthropic-messages",
            Conversation.read(anthropic, body, [
              { role: "assistant", content: [{ type: "text", text: text(9) }] },
            ]),
            1_794_441_600_000,
          ),
          sessionSource: text(10),
          machine: text(11),
          project: text(20),
          client: text(21),
          clientVersion: text(22),
          userAgent: text(23),
          provider: text(24),
          operation: text(25),
          purpose: text(12),
          model: text(0),
          servedModel: text(13),
          errorType: text(14),
          errorMessage: text(15),
          stopReason: text(16),
          usage: generated.usage
            ? Option.some({
                tokens: {
                  input: 1,
                  cacheRead: 0,
                  cacheWriteShort: 0,
                  cacheWriteLong: 0,
                  output: 1,
                },
                reasoning: 0,
                reported: text(17),
              })
            : Option.none(),
          serviceTier: text(26),
          providerRequestId: text(27),
          rateLimits: { [text(18)]: text(19) },
          clientHeaders: { [text(28)]: text(29) },
          errorBody: text(17),
        };
        yield* recordRequest.execute(sent);
        yield* recorded.drain;

        const rowsOf = (request: Request.Request) => ({
          request: RequestMapper.requestRowOf({ request, cost: Option.none() }),
          items: StoredItems.newItems(new Set(), request).map(
            ItemMapper.itemRowOf,
          ),
          requestItems: Option.toArray(StoredItems.requestItemsOf(request)).map(
            RequestItemsMapper.requestItemsRowOf,
          ),
        });
        const stored = memory.requests.find(
          ({ request }) => request.id === sent.id,
        );
        if (stored === undefined) return expect(stored).toBeDefined();
        const written = {
          request: RequestMapper.requestRowOf(stored),
          items: memory.items
            .filter(({ requestId }) => requestId === sent.id)
            .map(ItemMapper.itemRowOf),
          requestItems: memory.requestItems
            .filter(({ requestId }) => requestId === sent.id)
            .map(RequestItemsMapper.requestItemsRowOf),
        };
        const asSent = rowsOf(sent);

        expect(written).toEqual(textsMended(asSent));
        expect(texts(written).every((each) => each.isWellFormed())).toBe(true);
        expect(written.items.map(({ content }) => content)).toEqual(
          asSent.items.map(({ content }) => content),
        );
        expect(
          written.requestItems.map(({ layout, overlay, params }) => [
            layout,
            overlay,
            params,
          ]),
        ).toEqual(
          asSent.requestItems.map(({ layout, overlay, params }) => [
            layout,
            overlay,
            params,
          ]),
        );
        expectSameJson(
          Option.getOrThrow(
            yield* rebuildConversation.execute(sent.id).pipe(Effect.orDie),
          ),
          body,
        );
      }),
    { timeout: 30_000, arbitrary: { runs: 200 } },
  );
});

const outputText = Arbitrary.schema(Schema.String);

const answerOf = (
  protocol: ProtocolName,
  kind: "stream" | "json" | "error",
  text: string,
): FakeProvider.Script => {
  if (kind === "error") {
    return {
      status: 500,
      headers: [["content-type", "application/json"]],
      chunks: [
        '{"type":"error","error":{"type":"api_error","message":"Internal server error"}}',
      ],
    };
  }
  const json = (value: unknown) => JSON.stringify(value);
  if (protocol === "chatgpt-codex") {
    return kind === "json"
      ? {
          headers: [["content-type", "application/json"]],
          chunks: [json({ id: "resp_1", status: "completed", output: [] })],
        }
      : Harness.codexAnswer([codexOutput(text)]);
  }
  if (protocol === "anthropic-messages") {
    if (kind === "json") {
      return {
        headers: [["content-type", "application/json"]],
        chunks: [
          json({
            id: "msg_1",
            type: "message",
            role: "assistant",
            model: "claude-opus-5-5",
            content: [{ type: "text", text }],
            stop_reason: "end_turn",
            usage: { input_tokens: 3, output_tokens: 1 },
          }),
        ],
      };
    }
    return {
      headers: [["content-type", "text/event-stream"]],
      chunks: [
        `event: message_start\ndata: ${json({ type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], usage: { input_tokens: 3, output_tokens: 1 } } })}\n\n`,
        `event: content_block_start\ndata: ${json({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}\n\n`,
        `event: content_block_delta\ndata: ${json({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } })}\n\n`,
        `event: content_block_stop\ndata: ${json({ type: "content_block_stop", index: 0 })}\n\n`,
        `event: message_stop\ndata: ${json({ type: "message_stop" })}\n\n`,
      ],
    };
  }
  if (kind === "json") {
    return {
      headers: [["content-type", "application/json"]],
      chunks: [
        json({
          id: "chatcmpl-1",
          object: "chat.completion",
          model: "glm-5.2",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: text },
              finish_reason: "stop",
            },
          ],
        }),
      ],
    };
  }
  return {
    headers: [["content-type", "text/event-stream"]],
    chunks: [
      `data: ${json({ id: "chatcmpl-1", object: "chat.completion.chunk", model: "glm-5.2", choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] })}\n\n`,
      `data: ${json({ id: "chatcmpl-1", object: "chat.completion.chunk", model: "glm-5.2", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
      "data: [DONE]\n\n",
    ],
  };
};

const codexOutput = (text: string): Schema.Json => ({
  id: "msg_1",
  type: "message",
  status: "completed",
  role: "assistant",
  content: [{ type: "output_text", annotations: [], text }],
});

const expectedOutput = (protocol: ProtocolName, text: string): Schema.Json =>
  protocol === "anthropic-messages"
    ? { role: "assistant", content: [{ type: "text", text }] }
    : protocol === "chatgpt-codex"
      ? codexOutput(text)
      : { role: "assistant", content: text };

const fieldOf: Readonly<
  Record<ProtocolName, Partial<Record<Conversation.RequestPart, string>>>
> = {
  "anthropic-messages": { system: "system", tools: "tools", input: "messages" },
  "openai-chat": { tools: "tools", input: "messages" },
  "chatgpt-codex": {
    system: "instructions",
    tools: "tools",
    input: "input",
  },
};

layer(Harness.layer({ relay: "max_decoded_body_mib = 1" }))(
  "request log laws through the hub",
  (it) => {
    it.effect.prop(
      "L3: Every item stored is an element of a body the hub forwarded or was built from a response it relayed; a request whose body could not be read has no items, and says so by having no `request_items` row.",
      {
        protocol: pick(["anthropic-messages", "openai-chat", "chatgpt-codex"]),
        operation: pick(["conversation", "other"]),
        body: pick([
          "object",
          "object",
          "object",
          "object",
          "not json",
          "array",
          "a number past a double",
          "over the decoded limit",
          "over the decoded limit",
        ]),
        anthropicBody: bodyOf(["system", "tools", "messages"]),
        openAiBody: bodyOf(["tools", "messages"]),
        codexBody: bodyOf(["instructions", "tools", "input"]),
        compressed: Arbitrary.schema(Schema.Boolean),
        session: pick(["none", "shared"]),
        answer: pick(["stream", "json", "error"]),
        text: outputText,
      },
      (generated) =>
        Effect.gen(function* () {
          yield* Harness.forgetEverything;
          const fake = yield* FakeProvider.FakeProvider;
          const memory = yield* InMemoryRequests;
          const anthropicSpeaks = generated.protocol === "anthropic-messages";
          const codexSpeaks = generated.protocol === "chatgpt-codex";
          fake.answer(
            answerOf(generated.protocol, generated.answer, generated.text),
          );
          const object = {
            "anthropic-messages": generated.anthropicBody,
            "chatgpt-codex": generated.codexBody,
            "openai-chat": generated.openAiBody,
          }[generated.protocol];
          const text = JSON.stringify(object);
          const withField = (field: string) =>
            text === "{}" ? `{${field}}` : `{${field},${text.slice(1)}`;
          const plain = {
            object: text,
            "not json": text.slice(0, -1),
            array: `[${text}]`,
            "a number past a double": withField('"seed":1e400'),
            "over the decoded limit": withField(
              `"padding":"${"a".repeat(1024 * 1024)}"`,
            ),
          }[generated.body];
          const bytes = new TextEncoder().encode(plain);
          const conversational = generated.operation === "conversation";
          const path = {
            "anthropic-messages": conversational
              ? "/solo/v1/messages"
              : "/solo/v1/messages/count_tokens",
            "chatgpt-codex": conversational
              ? "/codex/backend-api/codex/responses"
              : "/codex/backend-api/codex/memories/trace_summarize",
            "openai-chat": conversational
              ? "/work/chat/completions"
              : "/work/completions",
          }[generated.protocol];
          const sessionHeader = {
            "anthropic-messages": "x-claude-code-session-id",
            "chatgpt-codex": "session-id",
            "openai-chat": "x-session-affinity",
          }[generated.protocol];
          const coding = codexSpeaks ? "zstd" : "gzip";
          const response = yield* Harness.send(`/pools${path}`, {
            method: "POST",
            headers: {
              "x-cota-key":
                generated.protocol === "openai-chat"
                  ? Harness.secrets.fleetHubKey
                  : Harness.secrets.clientsHubKey,
              "content-type": "application/json",
              ...(generated.session === "shared"
                ? { [sessionHeader]: "l3-session" }
                : {}),
              ...(generated.compressed ? { "content-encoding": coding } : {}),
            },
            body: generated.compressed
              ? new Uint8Array(
                  codexSpeaks
                    ? Bun.zstdCompressSync(bytes)
                    : Bun.gzipSync(bytes),
                )
              : bytes,
          });
          yield* Harness.bytesOf(response);
          const [request, ...others] = yield* Harness.recorded(1);
          expect(others).toEqual([]);
          if (request === undefined) return expect(request).toBeDefined();

          const readable = conversational && generated.body === "object";
          expect(Option.isSome(request.conversation)).toBe(readable);
          expect(
            memory.requestItems.some(
              ({ requestId }) => requestId === request.id,
            ),
          ).toBe(readable);
          const stored = memory.items.filter(
            ({ session, requestId }) =>
              session === request.session && requestId === request.id,
          );
          if (!readable) return expect(stored).toEqual([]);

          const sent = new Uint8Array(fake.last().body);
          const forwarded = parsedJson(
            new TextDecoder().decode(
              !generated.compressed
                ? sent
                : codexSpeaks
                  ? Bun.zstdDecompressSync(sent)
                  : Bun.gunzipSync(sent),
            ),
          );
          const fields = fieldOf[generated.protocol];
          for (const item of stored) {
            const content = parsedJson(item.content);
            if (item.part === "output") {
              expect(generated.answer).not.toBe("error");
              expectSameJson(
                content,
                expectedOutput(generated.protocol, generated.text),
              );
              continue;
            }
            const field = fields[item.part];
            const value =
              isObject(forwarded) && field !== undefined
                ? forwarded[field]
                : undefined;
            const elements = (
              Array.isArray(value) ? value : [value ?? null]
            ).map((element) =>
              anthropicSpeaks
                ? Harness.without(element, ["cache_control"])
                : element,
            );
            expect(
              elements.some((element) => Harness.sameJson(element, content)),
            ).toBe(true);
          }
        }),
      { timeout: 30_000, arbitrary: { runs: 100 } },
    );
  },
);
