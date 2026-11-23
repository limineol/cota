import { Schema } from "effect";
import { Conversation } from "./conversation.ts";
import { HubKeyName, LoginFingerprint, PoolId } from "./ids.ts";
import { ProtocolName } from "./protocol-name.ts";
import { RecordForm } from "./record-form.ts";
import * as Usage from "./usage.ts";

export const RequestId = Schema.String.check(
  Schema.isPattern(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  ),
).pipe(Schema.brand("RequestId"));
export type RequestId = typeof RequestId.Type;

export const Outcome = Schema.Literals(["ok", "error", "refused", "cancelled"]);
export type Outcome = typeof Outcome.Type;

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** What only a hub in the path can know of a request: a forwarded request's origin. */
export const Forwarded = Schema.TaggedStruct("forwarded", {
  protocol: ProtocolName,
  hubKey: HubKeyName,
  firstByteMs: Schema.Option(Count),
  sessionSource: Schema.String,
  userAgent: Schema.String,
  divertedFrom: Schema.Option(PoolId),
  follows: Schema.Option(RequestId),
  loginFingerprint: Schema.Option(LoginFingerprint),
  refusalReset: Schema.Option(Schema.DateTimeUtc),
  purpose: Schema.String,
  servedModel: Schema.String,
  stream: Schema.Boolean,
  upstreamStatus: Count,
  serviceTier: Schema.String,
  rateLimits: Schema.Record(Schema.String, Schema.String),
  clientHeaders: Schema.Record(Schema.String, Schema.String),
  errorBody: Schema.String,
  requestBytes: Count,
  responseBytes: Count,
  readingComplete: Schema.Boolean,
});
export type Forwarded = typeof Forwarded.Type;

/** A reported request's origin: its record form, and the hub key that reported it, none for the owner. */
export const Reported = Schema.TaggedStruct("reported", {
  form: RecordForm,
  reportedBy: Schema.Option(HubKeyName),
});
export type Reported = typeof Reported.Type;

export const Request = Schema.Struct({
  id: RequestId,
  startedAt: Schema.DateTimeUtc,
  durationMs: Count,
  session: Schema.String,
  machine: Schema.String,
  project: Schema.String,
  client: Schema.String,
  clientVersion: Schema.String,
  pool: PoolId,
  provider: Schema.String,
  operation: Schema.String,
  model: Schema.String,
  outcome: Outcome,
  errorType: Schema.String,
  errorMessage: Schema.String,
  stopReason: Schema.String,
  usage: Schema.Option(Usage.Reported),
  providerRequestId: Schema.String,
  conversation: Schema.Option(Conversation),
  origin: Schema.Union([Forwarded, Reported]),
});
export type Request = typeof Request.Type;

/** A request the hub forwarded: the only kind `RecordRequest` takes. */
export type ForwardedRequest = Request & { readonly origin: Forwarded };
