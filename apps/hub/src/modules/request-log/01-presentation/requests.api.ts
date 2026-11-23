import { Schema } from "effect";
import {
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
} from "effect/http-api";
import { RequestRole } from "#modules/request-log/03-domain/request-role.ts";
import {
  Origin,
  StoredProtocol,
} from "#modules/request-log/03-domain/stored-protocol.ts";
import {
  CallerMiddleware,
  mayCall,
} from "#shared/01-presentation/caller.middleware.ts";
import { JsonBody } from "#shared/01-presentation/json-body.middleware.ts";
import { Money } from "#shared/01-presentation/money.ts";
import { RequestLogProblem } from "#shared/01-presentation/problems.ts";
import { Outcome, RequestId } from "#shared/03-domain/request.entity.ts";
import { NoConversationProblem, NoSuchRequestProblem } from "./problems.ts";

const Time = Schema.DateTimeUtcFromString;
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Text = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
  cut: Count,
});
const Image = Schema.Struct({
  type: Schema.Literal("image"),
  mediaType: Schema.NullOr(Schema.String),
  bytes: Schema.NullOr(Count),
});
const Other = Schema.Struct({
  type: Schema.Literal("other"),
  json: Schema.String,
  cut: Count,
});

const placed = {
  item: Schema.String,
  part: Schema.Literals(["system", "input", "output"]),
};

/** One thing a transcript shows (`docs/specs/sessions/spec.md`, Transcripts). */
export const Entry = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("message"),
    ...placed,
    role: Schema.String,
    parts: Schema.Array(Schema.Union([Text, Image, Other])),
  }),
  Schema.Struct({
    kind: Schema.Literal("reasoning"),
    ...placed,
    text: Schema.NullOr(Schema.String),
    hidden: Schema.Boolean,
    cut: Count,
  }),
  Schema.Struct({
    kind: Schema.Literal("tool-call"),
    ...placed,
    callId: Schema.NullOr(Schema.String),
    name: Schema.String,
    input: Schema.String,
    cut: Count,
  }),
  Schema.Struct({
    kind: Schema.Literal("tool-result"),
    ...placed,
    callId: Schema.NullOr(Schema.String),
    name: Schema.NullOr(Schema.String),
    output: Schema.String,
    error: Schema.Boolean,
    cut: Count,
  }),
  Schema.Struct({
    kind: Schema.Literal("other"),
    ...placed,
    json: Schema.String,
    cut: Count,
  }),
]).annotate({ identifier: "Entry" });

export const Transcript = Schema.Struct({
  request: RequestId,
  protocol: StoredProtocol,
  entries: Schema.Array(Entry),
  cutCharacters: Count,
}).annotate({ identifier: "Transcript" });

const Strings = Schema.Record(Schema.String, Schema.String);

export const RequestRecord = Schema.Struct({
  id: RequestId,
  startedAt: Time,
  firstByteMs: Schema.NullOr(Count),
  durationMs: Count,
  session: Schema.String,
  sessionSource: Schema.String,
  machine: Schema.String,
  project: Schema.String,
  client: Schema.String,
  clientVersion: Schema.String,
  userAgent: Schema.String,
  hubKey: Schema.String,
  pool: Schema.String,
  divertedFrom: Schema.NullOr(Schema.String),
  follows: Schema.NullOr(RequestId),
  loginFingerprint: Schema.NullOr(Schema.String),
  refusalReset: Schema.NullOr(Time),
  provider: Schema.String,
  protocol: StoredProtocol,
  origin: Origin,
  operation: Schema.String,
  purpose: Schema.String,
  model: Schema.String,
  servedModel: Schema.String,
  stream: Schema.Boolean,
  outcome: Outcome,
  upstreamStatus: Count,
  errorType: Schema.String,
  errorMessage: Schema.String,
  stopReason: Schema.String,
  usageReported: Schema.Boolean,
  inputTokens: Count,
  cacheReadTokens: Count,
  cacheWriteShortTokens: Count,
  cacheWriteLongTokens: Count,
  outputTokens: Count,
  reasoningTokens: Count,
  serviceTier: Schema.String,
  costUsd: Schema.NullOr(Money),
  providerRequestId: Schema.String,
  rateLimits: Strings,
  clientHeaders: Strings,
  usage: Schema.NullOr(Schema.Json),
  errorBody: Schema.String,
  requestBytes: Count,
  responseBytes: Count,
  readingComplete: Schema.Boolean,
  promptSize: Schema.NullOr(Count),
}).annotate({ identifier: "RequestRecord" });

const Tool = Schema.Struct({
  name: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
}).annotate({ identifier: "Tool" });

const Entries = Schema.NullOr(Schema.Array(Entry));

export const Inspected = Schema.Struct({
  request: RequestRecord,
  requestRole: Schema.NullOr(RequestRole),
  segment: Schema.NullOr(Count),
  params: Schema.NullOr(Schema.JsonObject),
  tools: Schema.NullOr(Schema.Array(Tool)),
  system: Entries,
  input: Entries,
  output: Entries,
  cutCharacters: Count,
  followedBy: Schema.NullOr(RequestId),
}).annotate({ identifier: "Inspected" });

const params = { id: Schema.String };

const inspect = HttpApiEndpoint.get("request", "/requests/:id", {
  params,
  success: Inspected,
  error: [NoSuchRequestProblem, RequestLogProblem],
}).annotateMerge(mayCall("reader"));

const body = HttpApiEndpoint.get("body", "/requests/:id/body", {
  params,
  success: Schema.JsonObject,
  error: [NoSuchRequestProblem, NoConversationProblem, RequestLogProblem],
}).annotateMerge(mayCall("reader"));

/** One request of the request log, whatever its operation, and its body (`docs/specs/api/spec.md`). */
export const group = HttpApiGroup.make("requests")
  .add(inspect, body)
  .middleware(CallerMiddleware)
  .middleware(JsonBody)
  .middleware(HttpApiMiddleware.ProblemDetails)
  .prefix("/api");
