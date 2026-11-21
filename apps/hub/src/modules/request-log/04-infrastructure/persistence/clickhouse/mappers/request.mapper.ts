import { Option, Schema } from "effect";
import type * as Cost from "#modules/request-log/03-domain/cost.ts";
import type * as Session from "#modules/request-log/03-domain/session.ts";
import * as Request from "#shared/03-domain/request.entity.ts";
import type * as Usage from "#shared/03-domain/usage.ts";
import { Time, timeOf, UInt16, UInt32, Uuid } from "./columns.ts";

const Dollars = Schema.String.check(Schema.isPattern(/^\d{1,6}\.\d{12}$/));
const Strings = Schema.Record(Schema.String, Schema.String);

/** A row of `requests`, as ClickHouse takes and gives it in JSON. */
export const RequestRow = Schema.Struct({
  id: Uuid,
  started_at: Time,
  first_byte_ms: Schema.NullOr(UInt32),
  duration_ms: UInt32,
  session: Schema.String,
  session_source: Schema.String,
  machine: Schema.String,
  project: Schema.String,
  client: Schema.String,
  client_version: Schema.String,
  user_agent: Schema.String,
  hub_key: Schema.String,
  pool: Schema.String,
  diverted_from: Schema.String,
  follows: Schema.NullOr(Uuid),
  login_fingerprint: Schema.String,
  refusal_reset: Schema.NullOr(Time),
  provider: Schema.String,
  protocol: Schema.String,
  operation: Schema.String,
  purpose: Schema.String,
  model: Schema.String,
  served_model: Schema.String,
  stream: Schema.Boolean,
  outcome: Request.Outcome,
  upstream_status: UInt16,
  error_type: Schema.String,
  error_message: Schema.String,
  stop_reason: Schema.String,
  usage_reported: Schema.Boolean,
  input_tokens: UInt32,
  cache_read_tokens: UInt32,
  cache_write_short_tokens: UInt32,
  cache_write_long_tokens: UInt32,
  output_tokens: UInt32,
  reasoning_tokens: UInt32,
  service_tier: Schema.String,
  cost_usd: Schema.NullOr(Dollars),
  provider_request_id: Schema.String,
  rate_limits: Strings,
  client_headers: Strings,
  usage: Schema.String,
  error_body: Schema.String,
  request_bytes: UInt32,
  response_bytes: UInt32,
  reading_complete: Schema.Boolean,
});
export type RequestRow = typeof RequestRow.Type;

const picodollarsPerDollar = 10n ** 12n;
const mostDollars = 10n ** 6n;

/**
 * Writes a cost in picodollars as the dollars of a `Decimal(18, 12)`, exactly,
 * and gives nothing for a cost past what the column holds.
 */
export const dollarsOf = (cost: Cost.Cost): Option.Option<string> => {
  const dollars = cost / picodollarsPerDollar;
  if (dollars >= mostDollars) return Option.none();
  const fraction = (cost % picodollarsPerDollar).toString().padStart(12, "0");
  return Option.some(`${dollars}.${fraction}`);
};

export const requestRowOf = ({
  request,
  cost,
}: Session.RequestRecord): RequestRow => {
  const tokens = Option.map(request.usage, (usage) => usage.tokens);
  const count = (pick: (usage: Usage.Usage) => number) =>
    Option.match(tokens, { onNone: () => 0, onSome: pick });
  return {
    id: request.id,
    started_at: timeOf(request.startedAt),
    first_byte_ms: Option.getOrNull(request.firstByteMs),
    duration_ms: request.durationMs,
    session: request.session,
    session_source: request.sessionSource,
    machine: request.machine,
    project: request.project,
    client: request.client,
    client_version: request.clientVersion,
    user_agent: request.userAgent,
    hub_key: request.hubKey,
    pool: request.pool,
    diverted_from: Option.getOrElse(request.divertedFrom, () => ""),
    follows: Option.getOrNull(request.follows),
    login_fingerprint: Option.getOrElse(request.loginFingerprint, () => ""),
    refusal_reset: Option.getOrNull(Option.map(request.refusalReset, timeOf)),
    provider: request.provider,
    protocol: request.protocol,
    operation: request.operation,
    purpose: request.purpose,
    model: request.model,
    served_model: request.servedModel,
    stream: request.stream,
    outcome: request.outcome,
    upstream_status: request.upstreamStatus,
    error_type: request.errorType,
    error_message: request.errorMessage,
    stop_reason: request.stopReason,
    usage_reported: Option.isSome(request.usage),
    input_tokens: count(({ input }) => input),
    cache_read_tokens: count(({ cacheRead }) => cacheRead),
    cache_write_short_tokens: count(({ cacheWriteShort }) => cacheWriteShort),
    cache_write_long_tokens: count(({ cacheWriteLong }) => cacheWriteLong),
    output_tokens: count(({ output }) => output),
    reasoning_tokens: Option.match(request.usage, {
      onNone: () => 0,
      onSome: ({ reasoning }) => reasoning,
    }),
    service_tier: request.serviceTier,
    cost_usd: Option.getOrNull(Option.flatMap(cost, dollarsOf)),
    provider_request_id: request.providerRequestId,
    rate_limits: request.rateLimits,
    client_headers: request.clientHeaders,
    usage: Option.match(request.usage, {
      onNone: () => "",
      onSome: ({ reported }) => reported,
    }),
    error_body: request.errorBody,
    request_bytes: request.requestBytes,
    response_bytes: request.responseBytes,
    reading_complete: request.readingComplete,
  };
};
