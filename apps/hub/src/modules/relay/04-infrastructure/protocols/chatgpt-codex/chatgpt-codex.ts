import { DateTime, Effect, Option, Schema, Stream } from "effect";
import type * as Protocol from "#modules/relay/02-application/interfaces/protocol.ts";
import * as ClientRequest from "#modules/relay/03-domain/client-request.ts";
import * as Description from "#modules/relay/03-domain/description.ts";
import * as Reading from "#modules/relay/03-domain/reading.ts";
import type * as Refusal from "#modules/relay/03-domain/refusal.ts";
import type * as Conversation from "#shared/03-domain/conversation.ts";
import { LoginFingerprint, ModelId } from "#shared/03-domain/ids.ts";
import * as ItemText from "#shared/03-domain/item-text.ts";
import { charactersOf } from "#shared/03-domain/text.ts";
import type * as Usage from "#shared/03-domain/usage.ts";

const sessionHeaders = ["session-id", "session_id"];
const purposeHeader = "x-openai-subagent";
const turnMetadataHeader = "x-codex-turn-metadata";
const accountHeader = "chatgpt-account-id";
const authClaims = "https://api.openai.com/auth";
const usageLimitReached = "usage_limit_reached";
const longestSession = 255;

const headersKept = [
  "originator",
  "thread-id",
  "x-codex-window-id",
  turnMetadataHeader,
  purposeHeader,
  "x-codex-parent-thread-id",
  "x-codex-beta-features",
];

const quotaSuffixes = [
  "-used-percent",
  "-window-minutes",
  "-reset-at",
  "-limit-name",
];

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const JsonObject = Schema.Record(Schema.String, Schema.Json);

const RequestBody = Schema.Struct({
  model: Schema.optionalKey(Schema.Unknown),
  stream: Schema.optionalKey(Schema.Unknown),
  service_tier: Schema.optionalKey(Schema.Unknown),
  client_metadata: Schema.optionalKey(
    Schema.Struct({ session_id: Schema.optionalKey(Schema.Unknown) }),
  ),
});

const TurnMetadata = Schema.Struct({ request_kind: Schema.String });

const AccessToken = Schema.Struct({
  [authClaims]: Schema.Struct({ chatgpt_account_user_id: Schema.String }),
});

const UsageWire = Schema.Struct({
  input_tokens: Count,
  output_tokens: Count,
  input_tokens_details: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        cached_tokens: Schema.optionalKey(Schema.NullOr(Count)),
        cache_write_tokens: Schema.optionalKey(Schema.NullOr(Count)),
      }),
    ),
  ),
  output_tokens_details: Schema.optionalKey(
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

const ErrorBody = Schema.Struct({ error: Schema.Unknown });

const UsageLimit = Schema.Struct({
  error: Schema.Struct({
    type: Schema.Literal(usageLimitReached),
    resets_at: Schema.optionalKey(Schema.Unknown),
  }),
});

const Response = Schema.Struct({
  status: Schema.optionalKey(Schema.Unknown),
  usage: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(Schema.Unknown),
  headers: Schema.optionalKey(Schema.Unknown),
  incomplete_details: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({ reason: Schema.optionalKey(Schema.Unknown) }),
    ),
  ),
});

const Event = Schema.Struct({
  type: Schema.String,
  item: Schema.optionalKey(Schema.Unknown),
  response: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(Schema.Unknown),
  code: Schema.optionalKey(Schema.Unknown),
  message: Schema.optionalKey(Schema.Unknown),
});

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

const sha256 = (text: string): LoginFingerprint =>
  LoginFingerprint.make(
    new Bun.CryptoHasher("sha256").update(text).digest("hex"),
  );

const operationOf = (method: string, path: string): string => {
  if (method === "POST" && path === "/responses") return "responses";
  if (method === "GET" && path === "/models") return "models";
  if (method === "POST" && path === "/alpha/search") return "search";
  if (
    method === "POST" &&
    (path === "/images/generations" || path === "/images/edits")
  ) {
    return "image";
  }
  return "other";
};

const sessionOf = (
  headers: ClientRequest.Headers,
  body: Option.Option<typeof RequestBody.Type>,
): Option.Option<Description.Session> => {
  const fromHeader = Description.sessionFrom(headers, sessionHeaders);
  if (Option.isSome(fromHeader)) return fromHeader;
  return body.pipe(
    Option.flatMap(({ client_metadata }) =>
      stringOf(client_metadata?.session_id),
    ),
    Option.map((id) => id.trim()),
    Option.filter((id) => id !== "" && charactersOf(id) <= longestSession),
    Option.map((id) => ({ id, source: "body" })),
  );
};

const purposeOf = (headers: ClientRequest.Headers): string => {
  const stated = headers[purposeHeader]?.trim() ?? "";
  if (stated !== "") return stated;
  return Option.match(
    Option.flatMap(parseJson(headers[turnMetadataHeader] ?? ""), (metadata) =>
      decode(TurnMetadata, metadata),
    ),
    { onNone: () => "", onSome: ({ request_kind }) => request_kind.trim() },
  );
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
    purpose: purposeOf(request.headers),
    serviceTier: Option.getOrElse(
      Option.flatMap(body, ({ service_tier }) => stringOf(service_tier)),
      () => "",
    ),
    headers: Description.keptHeaders(request.headers, headersKept),
  };
};

const accountUserOf = (login: string): Option.Option<string> => {
  const parts = login.split(".");
  if (parts.length !== 3) return Option.none();
  return parseJson(
    Buffer.from(parts[1] ?? "", "base64url").toString("utf8"),
  ).pipe(
    Option.flatMap((claims) => decode(AccessToken, claims)),
    Option.map((claims) => claims[authClaims].chatgpt_account_user_id.trim()),
    Option.filter((id) => id !== ""),
  );
};

const fingerprint = (
  request: ClientRequest.ClientRequest,
): Option.Option<LoginFingerprint> =>
  Option.map(ClientRequest.loginOf(request.headers), (login) => {
    const account = request.headers[accountHeader]?.trim() ?? "";
    if (account === "") return sha256(login);
    return Option.match(accountUserOf(login), {
      onNone: () => sha256(account),
      onSome: (user) => sha256(`${account}\n${user}`),
    });
  });

const resetOf = (resetsAt: unknown): Option.Option<DateTime.Utc> =>
  typeof resetsAt === "number" && Number.isFinite(resetsAt)
    ? DateTime.make(Math.round(resetsAt * 1000))
    : Option.none();

const refusalOf = Effect.fn("ChatgptCodex.refusal")(function* (
  answer: Refusal.Answer,
): Effect.fn.Return<Option.Option<Refusal.Refusal>> {
  if (answer.status !== 429) return Option.none();
  return Option.map(
    Option.flatMap(parseJson(answer.body), (body) => decode(UsageLimit, body)),
    ({ error }) => ({ reset: resetOf(error.resets_at) }),
  );
});

const isQuotaHeader = (name: string): boolean =>
  (name.startsWith("x-codex-") && name !== "x-codex-turn-state") ||
  quotaSuffixes.some((suffix) => name.endsWith(suffix));

const answerHeaders = (
  headers: ClientRequest.Headers,
): Reading.AnswerHeaders => {
  const rateLimits: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (isQuotaHeader(name)) rateLimits[name] = value;
  }
  return {
    providerRequestId:
      headers["x-request-id"] ?? headers["x-oai-request-id"] ?? "",
    servedModel: headers["openai-model"] ?? "",
    rateLimits,
  };
};

const usageOf = (wire: unknown): Option.Option<Usage.Reported> =>
  Option.map(decode(UsageWire, wire), (usage) => {
    const cached = usage.input_tokens_details?.cached_tokens ?? 0;
    const written = usage.input_tokens_details?.cache_write_tokens ?? 0;
    return {
      tokens: {
        input: Math.max(usage.input_tokens - cached - written, 0),
        cacheRead: cached,
        cacheWriteShort: written,
        cacheWriteLong: 0,
        output: usage.output_tokens,
      },
      reasoning: usage.output_tokens_details?.reasoning_tokens ?? 0,
      reported: JSON.stringify(wire),
    };
  });

const errorOf = (wire: unknown): Reading.ProviderError =>
  Option.match(decode(ErrorWire, wire), {
    onNone: () => ({ type: "", message: "" }),
    onSome: (error) => ({
      type: error.type ?? (error.code == null ? "" : String(error.code)),
      message: error.message ?? "",
    }),
  });

const servedModelOf = (headers: unknown): Option.Option<string> =>
  Option.flatMap(decode(JsonObject, headers), (fields) => {
    for (const [name, value] of Object.entries(fields)) {
      const lower = name.toLowerCase();
      if (lower === "openai-model" || lower === "x-openai-model") {
        return stringOf(value);
      }
    }
    return Option.none();
  });

const withResponse = (
  reading: Reading.Reading,
  response: Option.Option<typeof Response.Type>,
): Reading.Reading =>
  Option.match(response, {
    onNone: () => reading,
    onSome: (response) => {
      const usage = usageOf(response.usage);
      const stopReason = Option.orElse(
        stringOf(response.incomplete_details?.reason),
        () => stringOf(response.status),
      );
      return {
        ...reading,
        usage: Option.isSome(usage) ? usage : reading.usage,
        stopReason: Option.getOrElse(stopReason, () => reading.stopReason),
      };
    },
  });

const readEvent = (sofar: Reading.Reading, data: string): Reading.Reading => {
  const event = Option.flatMap(parseJson(data), (json) => decode(Event, json));
  if (Option.isNone(event)) return sofar;
  const response = decode(Response, event.value.response);
  const reading: Reading.Reading = {
    ...sofar,
    servedModel: Option.getOrElse(
      Option.flatMap(response, ({ headers }) => servedModelOf(headers)),
      () => sofar.servedModel,
    ),
  };
  switch (event.value.type) {
    case "response.output_item.done":
      return Option.match(decode(JsonObject, event.value.item), {
        onNone: () => reading,
        onSome: (item) => ({ ...reading, output: [...reading.output, item] }),
      });
    case "response.completed":
    case "response.incomplete":
      return { ...withResponse(reading, response), finished: true };
    case "response.failed":
      return {
        ...withResponse(reading, response),
        error: Option.some(errorOf(Option.getOrUndefined(response)?.error)),
        finished: true,
      };
    case "error":
      return {
        ...reading,
        error: Option.some(
          errorOf(
            event.value.error ?? {
              code: event.value.code,
              message: event.value.message,
            },
          ),
        ),
        finished: true,
      };
    default:
      return reading;
  }
};

const read: Protocol.Reader = (parts) =>
  parts.pipe(
    Stream.scan(
      (): Reading.Reading => Reading.nothingRead,
      (reading, part) =>
        part._tag === "Event" ? readEvent(reading, part.data) : reading,
    ),
  );

const error = (body: string): Option.Option<Reading.ProviderError> =>
  Option.map(
    Option.flatMap(parseJson(body), (json) => decode(ErrorBody, json)),
    ({ error }) => errorOf(error),
  );

const conversation: Conversation.Rules = {
  parts: [
    { part: "system", field: "instructions" },
    { part: "tools", field: "tools" },
    { part: "input", field: "input" },
  ],
  takenOut: [],
  textOf: ItemText.responsesTextOf,
};

export const protocol: Protocol.Protocol = {
  name: "chatgpt-codex",
  clientPrefix: "/backend-api/codex",
  describe,
  fingerprint,
  refusal: { _tag: "FromBody", of: refusalOf },
  answerHeaders,
  reader: (description) =>
    description.operation === "responses" ? Option.some(read) : Option.none(),
  conversation: (description) =>
    description.operation === "responses"
      ? Option.some(conversation)
      : Option.none(),
  error,
};
