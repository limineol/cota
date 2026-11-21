import { Schema } from "effect";
import {
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
} from "effect/http-api";
import * as Traffic from "#modules/request-log/03-domain/traffic.ts";
import {
  CallerMiddleware,
  mayCall,
} from "#shared/01-presentation/caller.middleware.ts";
import { JsonBody } from "#shared/01-presentation/json-body.middleware.ts";
import { Money } from "#shared/01-presentation/money.ts";
import { RequestLogProblem } from "#shared/01-presentation/problems.ts";
import { Outcome, RequestId } from "#shared/03-domain/request.entity.ts";
import { filterFields, TimeZone } from "./filters.ts";
import { EmptyWindowProblem } from "./problems.ts";

const Time = Schema.DateTimeUtcFromString;
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const Usage = Schema.Struct({
  input: Count,
  cacheRead: Count,
  cacheWriteShort: Count,
  cacheWriteLong: Count,
  output: Count,
  reasoning: Count,
}).annotate({ identifier: "Usage" });

const Window = Schema.Struct({ from: Time, to: Time });

const Percentiles = Schema.NullOr(Schema.Struct({ p50: Count, p95: Count }));

export const Totals = Schema.Struct({
  requests: Count,
  sessions: Count,
  outcomes: Schema.Struct({
    ok: Count,
    error: Count,
    refused: Count,
    cancelled: Count,
  }),
  usage: Usage,
  usageUnreported: Count,
  costUsd: Money,
  unpricedRequests: Count,
  durationMs: Percentiles,
  firstByteMs: Percentiles,
}).annotate({ identifier: "Totals" });

export const Overview = Schema.Struct({
  window: Window,
  previous: Window,
  totals: Totals,
  previousTotals: Totals,
  firstRequestAt: Schema.NullOr(Time),
}).annotate({ identifier: "Overview" });

export const Point = Schema.Struct({
  at: Time,
  key: Schema.NullOr(Schema.String),
  requests: Count,
  errors: Count,
  usage: Usage,
  costUsd: Money,
  unpricedRequests: Count,
}).annotate({ identifier: "Point" });

export const Series = Schema.Struct({
  bucket: Traffic.Bucket,
  keys: Schema.Array(Schema.NullOr(Schema.String)),
  points: Schema.Array(Point),
}).annotate({ identifier: "Series" });

export const BreakdownRow = Schema.Struct({
  key: Schema.String,
  requests: Count,
  sessions: Count,
  errors: Count,
  usage: Usage,
  costUsd: Money,
  unpricedRequests: Count,
  lastAt: Time,
}).annotate({ identifier: "BreakdownRow" });

export const Breakdown = Schema.Struct({
  rows: Schema.Array(BreakdownRow),
  distinctKeys: Count,
}).annotate({ identifier: "Breakdown" });

const Facet = Schema.Array(
  Schema.Struct({ value: Schema.String, requests: Count }),
);

export const Facets = Schema.Struct({
  pool: Facet,
  model: Facet,
  client: Facet,
  machine: Facet,
  project: Facet,
  provider: Facet,
  hub_key: Facet,
  outcome: Facet,
}).annotate({ identifier: "Facets" });

export const ErrorGroup = Schema.Struct({
  provider: Schema.String,
  model: Schema.String,
  outcome: Outcome,
  upstreamStatus: Count,
  errorType: Schema.String,
  message: Schema.String,
  requests: Count,
  firstAt: Time,
  lastAt: Time,
  pools: Schema.Array(Schema.String),
  clients: Schema.Array(Schema.String),
  latestRequest: RequestId,
}).annotate({ identifier: "ErrorGroup" });

export const Errors = Schema.Struct({
  groups: Schema.Array(ErrorGroup),
  requests: Count,
  distinctGroups: Count,
}).annotate({ identifier: "Errors" });

const reading = [EmptyWindowProblem, RequestLogProblem];

const overview = HttpApiEndpoint.get("overview", "/overview", {
  query: filterFields,
  success: Overview,
  error: reading,
}).annotateMerge(mayCall("reader"));

const series = HttpApiEndpoint.get("series", "/series", {
  query: {
    ...filterFields,
    tz: Schema.optional(TimeZone),
    by: Schema.optional(Traffic.Dimension),
  },
  success: Series,
  error: reading,
}).annotateMerge(mayCall("reader"));

const breakdown = HttpApiEndpoint.get("breakdown", "/breakdown", {
  query: {
    ...filterFields,
    by: Traffic.Dimension,
    limit: Schema.optional(
      Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 500 })),
    ),
  },
  success: Breakdown,
  error: reading,
}).annotateMerge(mayCall("reader"));

const facets = HttpApiEndpoint.get("facets", "/facets", {
  query: filterFields,
  success: Facets,
  error: reading,
}).annotateMerge(mayCall("reader"));

const errors = HttpApiEndpoint.get("errors", "/errors", {
  query: filterFields,
  success: Errors,
  error: reading,
}).annotateMerge(mayCall("reader"));

/** The request log's traffic: totals, over time, by dimension, and its failures (`docs/specs/api/spec.md`). */
export const group = HttpApiGroup.make("traffic")
  .add(overview, series, breakdown, facets, errors)
  .middleware(CallerMiddleware)
  .middleware(JsonBody)
  .middleware(HttpApiMiddleware.ProblemDetails)
  .prefix("/api");
