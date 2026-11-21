import { DateTime, Effect, Option, Schema, Stream } from "effect";
import type * as Protocol from "#modules/relay/02-application/interfaces/protocol.ts";
import type * as ClientRequest from "#modules/relay/03-domain/client-request.ts";
import * as Description from "#modules/relay/03-domain/description.ts";
import * as Reading from "#modules/relay/03-domain/reading.ts";
import type * as Refusal from "#modules/relay/03-domain/refusal.ts";
import type * as Conversation from "#shared/03-domain/conversation.ts";
import { ModelId } from "#shared/03-domain/ids.ts";
import * as ItemText from "#shared/03-domain/item-text.ts";
import type * as Usage from "#shared/03-domain/usage.ts";

const sessionHeaders = [
  "x-session-affinity",
  "x-opencode-session-id",
  "x-opencode-session",
  "x-session-id",
  "session_id",
];

const headersKept = [
  "x-opencode-parent-session-id",
  "x-parent-session-id",
  "x-opencode-request",
  "x-stainless-retry-count",
];

const zaiRefusalCodes = new Set([
  "1308",
  "1310",
  "1316",
  "1317",
  "1318",
  "1319",
  "1320",
  "1321",
]);
const openCodeGoRefusal = "GoUsageLimitError";

const RequestBody = Schema.Struct({
  model: Schema.optionalKey(Schema.Unknown),
  stream: Schema.optionalKey(Schema.Unknown),
});

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const UsageWire = Schema.Struct({
  prompt_tokens: Count,
  completion_tokens: Count,
  prompt_tokens_details: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        cached_tokens: Schema.optionalKey(Schema.NullOr(Count)),
      }),
    ),
  ),
  completion_tokens_details: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        reasoning_tokens: Schema.optionalKey(Schema.NullOr(Count)),
      }),
    ),
  ),
});

const ErrorWire = Schema.Struct({
  type: Schema.optionalKey(Schema.NullOr(Schema.String)),
  code: Schema.optionalKey(
    Schema.NullOr(Schema.Union([Schema.String, Schema.Finite])),
  ),
  message: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

const Fields = Schema.Record(Schema.String, Schema.Unknown);

const ToolCallDelta = Schema.Struct({
  index: Schema.optionalKey(Count),
  id: Schema.optionalKey(Schema.String),
  type: Schema.optionalKey(Schema.String),
  function: Schema.optionalKey(
    Schema.Struct({
      name: Schema.optionalKey(Schema.NullOr(Schema.String)),
      arguments: Schema.optionalKey(Schema.NullOr(Schema.String)),
    }),
  ),
});

const Choice = Schema.Struct({
  index: Schema.optionalKey(Count),
  delta: Schema.optionalKey(Schema.NullOr(Fields)),
  message: Schema.optionalKey(Schema.NullOr(Schema.Json)),
  finish_reason: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

const Answer = Schema.Struct({
  model: Schema.optionalKey(Schema.Unknown),
  choices: Schema.optionalKey(Schema.Unknown),
  usage: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(Schema.Unknown),
});

interface ToolCall {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly arguments: string;
}

interface Message {
  readonly started: boolean;
  readonly content: Option.Option<string>;
  readonly reasoning: ReadonlyArray<readonly [string, string]>;
  readonly toolCalls: ReadonlyArray<readonly [number, ToolCall]>;
}

interface State {
  readonly reading: Reading.Reading;
  readonly message: Message;
}

const noMessage: Message = {
  started: false,
  content: Option.none(),
  reasoning: [],
  toolCalls: [],
};

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

const operationOf = (method: string, path: string): string => {
  if (method === "POST" && path === "/chat/completions") return "chat";
  if (method === "GET" && path === "/models") return "models";
  return "other";
};

const describe = (
  request: ClientRequest.ClientRequest,
): Description.Description => {
  const body = Option.flatMap(request.body, (body) =>
    decode(RequestBody, body),
  );
  const model = Option.flatMap(body, ({ model }) => decode(ModelId, model));
  return {
    operation: operationOf(request.method, request.path),
    model,
    session: Description.sessionFrom(request.headers, sessionHeaders),
    stream: Option.exists(body, ({ stream }) => stream === true),
    purpose: "",
    serviceTier: "",
    headers: Description.keptHeaders(request.headers, headersKept),
  };
};

const usageOf = (wire: unknown): Option.Option<Usage.Reported> =>
  Option.map(decode(UsageWire, wire), (usage) => {
    const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
    return {
      tokens: {
        input: Math.max(usage.prompt_tokens - cached, 0),
        cacheRead: cached,
        cacheWriteShort: 0,
        cacheWriteLong: 0,
        output: usage.completion_tokens,
      },
      reasoning: usage.completion_tokens_details?.reasoning_tokens ?? 0,
      reported: JSON.stringify(wire),
    };
  });

const errorOf = (wire: unknown): Option.Option<Reading.ProviderError> =>
  Option.map(decode(ErrorWire, wire), (error) => ({
    type: error.type ?? (error.code == null ? "" : String(error.code)),
    message: error.message ?? "",
  }));

const firstChoice = (choices: unknown) =>
  Option.flatMap(decode(Schema.Array(Schema.Unknown), choices), (all) => {
    for (const choice of all) {
      const decoded = decode(Choice, choice);
      if (Option.isSome(decoded) && (decoded.value.index ?? 0) === 0) {
        return decoded;
      }
    }
    return Option.none();
  });

const stringOf = (value: unknown): Option.Option<string> =>
  typeof value === "string" ? Option.some(value) : Option.none();

const appended = (
  pairs: ReadonlyArray<readonly [string, string]>,
  field: string,
  text: string,
): ReadonlyArray<readonly [string, string]> =>
  pairs.some(([name]) => name === field)
    ? pairs.map(([name, sofar]) =>
        name === field ? [name, sofar + text] : [name, sofar],
      )
    : [...pairs, [field, text]];

const withToolCall = (
  calls: ReadonlyArray<readonly [number, ToolCall]>,
  delta: typeof ToolCallDelta.Type,
): ReadonlyArray<readonly [number, ToolCall]> => {
  const index = delta.index ?? 0;
  const known = calls.find(([at]) => at === index)?.[1];
  const call: ToolCall = {
    id: delta.id ?? known?.id ?? "",
    type: delta.type ?? known?.type ?? "function",
    name: (known?.name ?? "") + (delta.function?.name ?? ""),
    arguments: (known?.arguments ?? "") + (delta.function?.arguments ?? ""),
  };
  const entry: readonly [number, ToolCall] = [index, call];
  return known === undefined
    ? [...calls, entry].sort(([a], [b]) => a - b)
    : calls.map(([at, sofar]) => (at === index ? entry : [at, sofar]));
};

const foldDelta = (
  message: Message,
  delta: Readonly<Record<string, unknown>>,
): Message => {
  let folded: Message = { ...message, started: true };
  const content = stringOf(delta.content);
  if (Option.isSome(content)) {
    folded = {
      ...folded,
      content: Option.some(
        Option.getOrElse(folded.content, () => "") + content.value,
      ),
    };
  }
  for (const field of ItemText.reasoningFields) {
    const text = stringOf(delta[field]);
    if (Option.isSome(text)) {
      folded = {
        ...folded,
        reasoning: appended(folded.reasoning, field, text.value),
      };
    }
  }
  const toolCalls = decode(Schema.Array(ToolCallDelta), delta.tool_calls);
  if (Option.isSome(toolCalls)) {
    folded = {
      ...folded,
      toolCalls: toolCalls.value.reduce(withToolCall, folded.toolCalls),
    };
  }
  return folded;
};

const messageJson = (message: Message): Schema.Json => {
  const json: Record<string, Schema.Json> = {
    role: "assistant",
    content: Option.getOrNull(message.content),
  };
  for (const [field, text] of message.reasoning) json[field] = text;
  if (message.toolCalls.length > 0) {
    json.tool_calls = message.toolCalls.map(([, call]) => ({
      id: call.id,
      type: call.type,
      function: { name: call.name, arguments: call.arguments },
    }));
  }
  return json;
};

const readCommon = (
  reading: Reading.Reading,
  answer: typeof Answer.Type,
): Reading.Reading => {
  const usage = usageOf(answer.usage);
  const servedModel = stringOf(answer.model);
  const error = errorOf(answer.error);
  return {
    ...reading,
    usage: Option.isSome(usage) ? usage : reading.usage,
    servedModel: Option.getOrElse(servedModel, () => reading.servedModel),
    error: Option.isSome(error) ? error : reading.error,
  };
};

const readChunk = (state: State, data: string): State => {
  if (data.trim() === "[DONE]") {
    return { ...state, reading: { ...state.reading, finished: true } };
  }
  const chunk = Option.flatMap(parseJson(data), (json) => decode(Answer, json));
  if (Option.isNone(chunk)) return state;
  const reading = readCommon(state.reading, chunk.value);
  const choice = firstChoice(chunk.value.choices);
  if (Option.isNone(choice)) return { ...state, reading };
  const message = Option.match(Option.fromNullishOr(choice.value.delta), {
    onNone: () => state.message,
    onSome: (delta) => foldDelta(state.message, delta),
  });
  const stopReason = choice.value.finish_reason ?? reading.stopReason;
  return {
    message,
    reading: {
      ...reading,
      stopReason,
      output: message.started ? [messageJson(message)] : reading.output,
    },
  };
};

const readBody = (state: State, text: string): State => {
  const answer = Option.flatMap(parseJson(text), (json) =>
    decode(Answer, json),
  );
  if (Option.isNone(answer)) return state;
  const reading = readCommon(state.reading, answer.value);
  const choice = firstChoice(answer.value.choices);
  if (Option.isNone(choice)) return { ...state, reading };
  const message = Option.fromNullishOr(choice.value.message);
  return {
    ...state,
    reading: {
      ...reading,
      stopReason: choice.value.finish_reason ?? reading.stopReason,
      output: Option.match(message, {
        onNone: () => reading.output,
        onSome: (message) => [message],
      }),
    },
  };
};

const step = (state: State, part: Protocol.Part): State =>
  part._tag === "Event"
    ? readChunk(state, part.data)
    : readBody(state, part.text);

const retryAfterSeconds = (
  headers: ClientRequest.Headers,
): Option.Option<number> => {
  const value = headers["retry-after"]?.trim() ?? "";
  return /^\d+$/.test(value) ? Option.some(Number(value)) : Option.none();
};

const refusalMarked = (body: string): boolean =>
  Option.exists(
    Option.flatMap(parseJson(body), (json) => decode(Answer, json)),
    (answer) =>
      Option.exists(decode(ErrorWire, answer.error), (error) => {
        const code = error.code == null ? "" : String(error.code);
        return zaiRefusalCodes.has(code) || error.type === openCodeGoRefusal;
      }),
  );

const refusalOf = Effect.fn("OpenAiChat.refusal")(function* (
  answer: Refusal.Answer,
): Effect.fn.Return<Option.Option<Refusal.Refusal>> {
  if (answer.status !== 429 || !refusalMarked(answer.body)) {
    return Option.none();
  }
  const seconds = retryAfterSeconds(answer.headers);
  if (Option.isNone(seconds)) return Option.some({ reset: Option.none() });
  const now = yield* DateTime.now;
  return Option.some({
    reset: Option.some(DateTime.add(now, { seconds: seconds.value })),
  });
});

const answerHeaders = (
  headers: ClientRequest.Headers,
): Reading.AnswerHeaders => {
  const retryAfter = headers["retry-after"];
  return {
    providerRequestId: headers["x-request-id"] ?? "",
    servedModel: "",
    rateLimits: retryAfter === undefined ? {} : { "retry-after": retryAfter },
  };
};

const read = <E>(
  parts: Stream.Stream<Protocol.Part, E>,
): Stream.Stream<Reading.Reading, E> =>
  parts.pipe(
    Stream.scan(
      (): State => ({ reading: Reading.nothingRead, message: noMessage }),
      step,
    ),
    Stream.map(({ reading }) => reading),
  );

const error = (body: string): Option.Option<Reading.ProviderError> =>
  Option.flatMap(
    Option.flatMap(parseJson(body), (json) => decode(Answer, json)),
    (answer) => errorOf(answer.error),
  );

const conversation: Conversation.Rules = {
  parts: [
    { part: "tools", field: "tools" },
    { part: "input", field: "messages" },
  ],
  takenOut: [],
  textOf: ItemText.chatTextOf,
};

export const protocol: Protocol.Protocol = {
  name: "openai-chat",
  clientPrefix: "",
  describe,
  fingerprint: () => Option.none(),
  refusal: { _tag: "FromBody", of: refusalOf },
  answerHeaders,
  reader: (description) =>
    description.operation === "chat" ? Option.some(read) : Option.none(),
  conversation: (description) =>
    description.operation === "chat"
      ? Option.some(conversation)
      : Option.none(),
  error,
};
