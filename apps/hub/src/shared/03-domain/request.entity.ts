import { Schema } from "effect";
import { Conversation } from "./conversation.ts";
import { HubKeyName, LoginFingerprint, PoolId } from "./ids.ts";
import { ProtocolName } from "./protocol-name.ts";
import { Reported } from "./usage.ts";

export const RequestId = Schema.String.check(
  Schema.isPattern(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  ),
).pipe(Schema.brand("RequestId"));
export type RequestId = typeof RequestId.Type;

export const Outcome = Schema.Literals(["ok", "error", "refused", "cancelled"]);
export type Outcome = typeof Outcome.Type;

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const Request = Schema.Struct({
  id: RequestId,
  startedAt: Schema.DateTimeUtc,
  firstByteMs: Schema.Option(Count),
  durationMs: Count,
  session: Schema.String,
  sessionSource: Schema.String,
  machine: Schema.String,
  project: Schema.String,
  client: Schema.String,
  clientVersion: Schema.String,
  userAgent: Schema.String,
  hubKey: HubKeyName,
  pool: PoolId,
  divertedFrom: Schema.Option(PoolId),
  follows: Schema.Option(RequestId),
  loginFingerprint: Schema.Option(LoginFingerprint),
  refusalReset: Schema.Option(Schema.DateTimeUtc),
  provider: Schema.String,
  protocol: ProtocolName,
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
  usage: Schema.Option(Reported),
  serviceTier: Schema.String,
  providerRequestId: Schema.String,
  rateLimits: Schema.Record(Schema.String, Schema.String),
  clientHeaders: Schema.Record(Schema.String, Schema.String),
  conversation: Schema.Option(Conversation),
  errorBody: Schema.String,
  requestBytes: Count,
  responseBytes: Count,
  readingComplete: Schema.Boolean,
});
export type Request = typeof Request.Type;
