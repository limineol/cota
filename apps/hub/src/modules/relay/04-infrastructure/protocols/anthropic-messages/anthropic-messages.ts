import { DateTime, Effect, Option, Schema, Stream } from "effect";
import type * as Protocol from "#modules/relay/02-application/interfaces/protocol.ts";
import * as ClientRequest from "#modules/relay/03-domain/client-request.ts";
import * as Description from "#modules/relay/03-domain/description.ts";
import * as Reading from "#modules/relay/03-domain/reading.ts";
import type * as Refusal from "#modules/relay/03-domain/refusal.ts";
import * as Conversation from "#shared/03-domain/conversation.ts";
import { LoginFingerprint, ModelId } from "#shared/03-domain/ids.ts";
import { charactersOf } from "#shared/03-domain/text.ts";
import type * as Usage from "#shared/03-domain/usage.ts";

const headersKept = [
  "anthropic-beta",
  "anthropic-version",
  "x-app",
  "x-claude-code-request-class",
  "x-claude-code-agent-type",
  "x-claude-code-agent-id",
  "x-claude-code-parent-agent-id",
  "x-claude-code-prompt-id",
  "x-stainless-retry-count",
];

const sessionHeader = "x-claude-code-session-id";
const purposeHeader = "x-claude-code-request-class";
const longestSession = 255;

type JsonObject = { readonly [key: string]: Schema.Json };

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const JsonObject = Schema.Record(Schema.String, Schema.Json);

const RequestBody = Schema.Struct({
  model: Schema.optionalKey(Schema.Unknown),
  stream: Schema.optionalKey(Schema.Unknown),
  max_tokens: Schema.optionalKey(Schema.Unknown),
  messages: Schema.optionalKey(Schema.Unknown),
  metadata: Schema.optionalKey(
    Schema.Struct({ user_id: Schema.optionalKey(Schema.Unknown) }),
  ),
});

const QuotaProbe = Schema.Struct({
  max_tokens: Schema.Literal(1),
  messages: Schema.Tuple([
    Schema.Struct({
      role: Schema.Literal("user"),
      content: Schema.Literal("quota"),
    }),
  ]),
});

const UserId = Schema.Struct({ session_id: Schema.String });

const UsageWire = Schema.Struct({
  input_tokens: Count,
  output_tokens: Count,
  cache_read_input_tokens: Schema.optionalKey(Schema.NullOr(Count)),
  cache_creation_input_tokens: Schema.optionalKey(Schema.NullOr(Count)),
  cache_creation: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        ephemeral_5m_input_tokens: Schema.optionalKey(Schema.NullOr(Count)),
        ephemeral_1h_input_tokens: Schema.optionalKey(Schema.NullOr(Count)),
      }),
    ),
  ),
  output_tokens_details: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        thinking_tokens: Schema.optionalKey(Schema.NullOr(Count)),
      }),
    ),
  ),
  service_tier: Schema.optionalKey(Schema.NullOr(Schema.String)),
  speed: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

const ErrorWire = Schema.Struct({
  type: Schema.optionalKey(Schema.NullOr(Schema.String)),
  message: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

const Message = Schema.Struct({
  type: Schema.optionalKey(Schema.Unknown),
  role: Schema.optionalKey(Schema.Unknown),
  model: Schema.optionalKey(Schema.Unknown),
  content: Schema.optionalKey(Schema.Unknown),
  stop_reason: Schema.optionalKey(Schema.Unknown),
  usage: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(Schema.Unknown),
});

const Event = Schema.Struct({
  type: Schema.String,
  index: Schema.optionalKey(Count),
  message: Schema.optionalKey(Schema.Unknown),
  content_block: Schema.optionalKey(Schema.Unknown),
  delta: Schema.optionalKey(Schema.Unknown),
  usage: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(Schema.Unknown),
});

const Delta = Schema.Struct({
  type: Schema.optionalKey(Schema.String),
  text: Schema.optionalKey(Schema.String),
  thinking: Schema.optionalKey(Schema.String),
  signature: Schema.optionalKey(Schema.String),
  partial_json: Schema.optionalKey(Schema.String),
  citation: Schema.optionalKey(Schema.Json),
  stop_reason: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

interface Block {
  readonly index: number;
  readonly content: JsonObject;
  readonly partialJson: string;
}

interface State {
  readonly reading: Reading.Reading;
  readonly role: Option.Option<string>;
  readonly usage: Option.Option<JsonObject>;
  readonly blocks: ReadonlyArray<Block>;
}

const decode = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  input: unknown,
): Option.Option<S["Type"]> => Schema.decodeUnknownOption(schema)(input);

const parseJson = (text: string): Option.Option<unknown> => {
  try {
    return Option.some(JSON.parse(text));
  } catch {
    return Option.none();
  }
};

const stringOf = (value: unknown): Option.Option<string> =>
  typeof value === "string" ? Option.some(value) : Option.none();

const operationOf = (method: string, path: string): string => {
  if (method === "POST" && path === "/v1/messages") return "messages";
  if (method === "POST" && path === "/v1/messages/count_tokens") {
    return "count_tokens";
  }
  if (method === "GET" && path === "/v1/models") return "models";
  return "other";
};

const sessionOf = (
  headers: ClientRequest.Headers,
  body: Option.Option<typeof RequestBody.Type>,
): Option.Option<Description.Session> => {
  const fromHeader = Description.sessionFrom(headers, [sessionHeader]);
  if (Option.isSome(fromHeader)) return fromHeader;
  return body.pipe(
    Option.flatMap(({ metadata }) => stringOf(metadata?.user_id)),
    Option.flatMap(parseJson),
    Option.flatMap((userId) => decode(UserId, userId)),
    Option.map(({ session_id }) => session_id.trim()),
    Option.filter((id) => id !== "" && charactersOf(id) <= longestSession),
    Option.map((id) => ({ id, source: "body" })),
  );
};

const purposeOf = (
  headers: ClientRequest.Headers,
  body: Option.Option<typeof RequestBody.Type>,
): string => {
  const stated = headers[purposeHeader]?.trim() ?? "";
  if (stated !== "") return stated;
  return Option.exists(body, (body) => Option.isSome(decode(QuotaProbe, body)))
    ? "quota_probe"
    : "";
};

const describe = (
  request: ClientRequest.ClientRequest,
): Description.Description => {
  const body = Option.flatMap(request.body, (body) =>
    decode(RequestBody, body),
  );
  return {
    operation: operationOf(request.method, request.path),
    model: Option.flatMap(body, ({ model }) => decode(ModelId, model)),
    session: sessionOf(request.headers, body),
    stream: Option.exists(body, ({ stream }) => stream === true),
    purpose: purposeOf(request.headers, body),
    serviceTier: "",
    headers: Description.keptHeaders(request.headers, headersKept),
  };
};

const fingerprint = (
  request: ClientRequest.ClientRequest,
): Option.Option<LoginFingerprint> =>
  Option.map(ClientRequest.loginOf(request.headers), (login) =>
    LoginFingerprint.make(
      new Bun.CryptoHasher("sha256").update(login).digest("hex"),
    ),
  );

const resetOf = (
  headers: ClientRequest.Headers,
): Option.Option<DateTime.Utc> => {
  const value = headers["anthropic-ratelimit-unified-reset"]?.trim() ?? "";
  if (!/^\d+(\.\d+)?$/.test(value)) return Option.none();
  return DateTime.make(Math.round(Number(value) * 1000));
};

const refusal = (head: Refusal.Head) =>
  Effect.succeed(
    head.status === 429 &&
      head.headers["anthropic-ratelimit-unified-status"]?.trim() === "rejected"
      ? Option.some({ reset: resetOf(head.headers) })
      : Option.none(),
  );

const answerHeaders = (
  headers: ClientRequest.Headers,
): Reading.AnswerHeaders => {
  const rateLimits: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (name.startsWith("anthropic-ratelimit-") || name === "retry-after") {
      rateLimits[name] = value;
    }
  }
  return {
    providerRequestId: headers["request-id"] ?? "",
    servedModel: "",
    rateLimits,
  };
};

const usageOf = (wire: JsonObject): Option.Option<Usage.Reported> =>
  Option.map(decode(UsageWire, wire), (usage) => {
    const breakdown = usage.cache_creation;
    return {
      tokens: {
        input: usage.input_tokens,
        cacheRead: usage.cache_read_input_tokens ?? 0,
        cacheWriteShort:
          breakdown == null
            ? (usage.cache_creation_input_tokens ?? 0)
            : (breakdown.ephemeral_5m_input_tokens ?? 0),
        cacheWriteLong:
          breakdown == null ? 0 : (breakdown.ephemeral_1h_input_tokens ?? 0),
        output: usage.output_tokens,
      },
      reasoning: usage.output_tokens_details?.thinking_tokens ?? 0,
      reported: JSON.stringify(wire),
    };
  });

const serviceTierOf = (wire: JsonObject): string =>
  Option.getOrElse(
    Option.orElse(stringOf(wire.speed), () => stringOf(wire.service_tier)),
    () => "",
  );

const errorOf = (wire: unknown): Option.Option<Reading.ProviderError> =>
  Option.map(decode(ErrorWire, wire), (error) => ({
    type: error.type ?? "",
    message: error.message ?? "",
  }));

const withUsage = (state: State, wire: unknown): State => {
  const fields = decode(JsonObject, wire);
  if (Option.isNone(fields)) return state;
  const merged: Record<string, Schema.Json> = {
    ...Option.getOrElse(state.usage, () => ({})),
  };
  for (const [name, value] of Object.entries(fields.value)) {
    if (value !== null) merged[name] = value;
  }
  const usage = usageOf(merged);
  return {
    ...state,
    usage: Option.some(merged),
    reading: {
      ...state.reading,
      usage: Option.isSome(usage) ? usage : state.reading.usage,
      serviceTier: serviceTierOf(merged) || state.reading.serviceTier,
    },
  };
};

const withOutput = (state: State): State => ({
  ...state,
  reading: {
    ...state.reading,
    output: [
      {
        role: Option.getOrElse(state.role, () => "assistant"),
        content: state.blocks.map(({ content }) => content),
      },
    ],
  },
});

const withBlock = (
  state: State,
  index: number,
  change: (block: Block) => Block,
): State => ({
  ...state,
  blocks: state.blocks.map((block) =>
    block.index === index ? change(block) : block,
  ),
});

const appended = (
  content: JsonObject,
  field: string,
  text: string,
): JsonObject => {
  const sofar = content[field];
  return {
    ...content,
    [field]: (typeof sofar === "string" ? sofar : "") + text,
  };
};

const applyDelta = (block: Block, wire: unknown): Block => {
  const delta = decode(Delta, wire);
  if (Option.isNone(delta)) return block;
  const { type, text, thinking, signature, partial_json, citation } =
    delta.value;
  switch (type) {
    case "text_delta":
      return text === undefined
        ? block
        : { ...block, content: appended(block.content, "text", text) };
    case "thinking_delta":
      return thinking === undefined
        ? block
        : { ...block, content: appended(block.content, "thinking", thinking) };
    case "signature_delta":
      return signature === undefined
        ? block
        : { ...block, content: { ...block.content, signature } };
    case "input_json_delta":
      return partial_json === undefined
        ? block
        : { ...block, partialJson: block.partialJson + partial_json };
    case "citations_delta": {
      if (citation === undefined) return block;
      const citations = block.content.citations;
      return {
        ...block,
        content: {
          ...block.content,
          citations: [...(Array.isArray(citations) ? citations : []), citation],
        },
      };
    }
    default:
      return block;
  }
};

const withInput = (block: Block): Block => {
  if (block.partialJson === "") return block;
  return Option.match(
    Option.flatMap(parseJson(block.partialJson), (input) =>
      decode(Schema.Json, input),
    ),
    {
      onNone: () => block,
      onSome: (input) => ({
        index: block.index,
        content: { ...block.content, input },
        partialJson: "",
      }),
    },
  );
};

const readEvent = (state: State, data: string): State => {
  const event = Option.flatMap(parseJson(data), (json) => decode(Event, json));
  if (Option.isNone(event)) return state;
  const { type, index } = event.value;
  switch (type) {
    case "message_start": {
      const message = decode(Message, event.value.message);
      if (Option.isNone(message)) return state;
      const started: State = {
        ...state,
        role: stringOf(message.value.role),
        reading: {
          ...state.reading,
          servedModel: Option.getOrElse(
            stringOf(message.value.model),
            () => state.reading.servedModel,
          ),
        },
      };
      return withOutput(withUsage(started, message.value.usage));
    }
    case "content_block_start": {
      const content = decode(JsonObject, event.value.content_block);
      if (index === undefined || Option.isNone(content)) return state;
      const block: Block = { index, content: content.value, partialJson: "" };
      return withOutput({
        ...state,
        blocks: [
          ...state.blocks.filter((each) => each.index !== index),
          block,
        ].sort((a, b) => a.index - b.index),
      });
    }
    case "content_block_delta":
      if (index === undefined) return state;
      return withOutput(
        withBlock(state, index, (block) =>
          applyDelta(block, event.value.delta),
        ),
      );
    case "content_block_stop":
      if (index === undefined) return state;
      return withOutput(withBlock(state, index, withInput));
    case "message_delta": {
      const stopReason = Option.flatMap(
        decode(Delta, event.value.delta),
        (delta) => Option.fromNullishOr(delta.stop_reason),
      );
      const delta = withUsage(state, event.value.usage);
      return {
        ...delta,
        reading: {
          ...delta.reading,
          stopReason: Option.getOrElse(
            stopReason,
            () => delta.reading.stopReason,
          ),
        },
      };
    }
    case "message_stop":
      return { ...state, reading: { ...state.reading, finished: true } };
    case "error":
      return {
        ...state,
        reading: {
          ...state.reading,
          error: errorOf(event.value.error),
          finished: true,
        },
      };
    default:
      return state;
  }
};

const readBody = (state: State, text: string): State => {
  const message = Option.flatMap(parseJson(text), (json) =>
    decode(Message, json),
  );
  if (Option.isNone(message)) return state;
  const { role, model, content, stop_reason, usage, error } = message.value;
  const blocks = decode(Schema.Array(JsonObject), content);
  const read = withUsage(state, usage);
  return {
    ...read,
    reading: {
      ...read.reading,
      output: Option.match(blocks, {
        onNone: () => read.reading.output,
        onSome: (blocks) => [
          {
            role: Option.getOrElse(stringOf(role), () => "assistant"),
            content: blocks,
          },
        ],
      }),
      servedModel: Option.getOrElse(
        stringOf(model),
        () => read.reading.servedModel,
      ),
      stopReason: Option.getOrElse(
        stringOf(stop_reason),
        () => read.reading.stopReason,
      ),
      error: errorOf(error),
    },
  };
};

const step = (state: State, part: Protocol.Part): State =>
  part._tag === "Event"
    ? readEvent(state, part.data)
    : readBody(state, part.text);

const read: Protocol.Reader = (parts) =>
  parts.pipe(
    Stream.scan(
      (): State => ({
        reading: Reading.nothingRead,
        role: Option.none(),
        usage: Option.none(),
        blocks: [],
      }),
      step,
    ),
    Stream.map(({ reading }) => reading),
  );

const error = (body: string): Option.Option<Reading.ProviderError> =>
  Option.flatMap(
    Option.flatMap(parseJson(body), (json) => decode(Message, json)),
    (message) => errorOf(message.error),
  );

const toolUses = new Set(["tool_use", "server_tool_use", "mcp_tool_use"]);

const blockText = (block: Schema.Json): ReadonlyArray<string> => {
  if (typeof block === "string") return [block];
  const type = Conversation.stringOf(block, "type");
  if (type === "text") return [Conversation.stringOf(block, "text")];
  if (type === "thinking") return [Conversation.stringOf(block, "thinking")];
  if (type === "tool_result") {
    return contentText(Conversation.fieldOf(block, "content") ?? null);
  }
  const input = Conversation.fieldOf(block, "input");
  return toolUses.has(type) && input !== undefined
    ? [Conversation.canonical(input)]
    : [];
};

const contentText = (content: Schema.Json): ReadonlyArray<string> =>
  Array.isArray(content) ? content.flatMap(blockText) : blockText(content);

const textOf = (item: Schema.Json): string =>
  (Conversation.stringOf(item, "role") === ""
    ? blockText(item)
    : contentText(Conversation.fieldOf(item, "content") ?? null)
  )
    .filter((text) => text !== "")
    .join("\n\n");

const conversation: Conversation.Rules = {
  parts: [
    { part: "system", field: "system" },
    { part: "tools", field: "tools" },
    { part: "input", field: "messages" },
  ],
  takenOut: ["cache_control"],
  textOf,
};

export const protocol: Protocol.Protocol = {
  name: "anthropic-messages",
  clientPrefix: "",
  describe,
  fingerprint,
  refusal: { _tag: "FromHead", of: refusal },
  answerHeaders,
  reader: (description) =>
    description.operation === "messages" ? Option.some(read) : Option.none(),
  conversation: (description) =>
    description.operation === "messages"
      ? Option.some(conversation)
      : Option.none(),
  error,
};
