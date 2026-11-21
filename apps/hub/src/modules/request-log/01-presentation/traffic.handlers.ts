import { Effect, Option } from "effect";
import type { HttpApiBuilder } from "effect/http-api";
import { GroupErrors } from "#modules/request-log/02-application/queries/group-errors.query.ts";
import { ReadBreakdown } from "#modules/request-log/02-application/queries/read-breakdown.query.ts";
import { ReadFacets } from "#modules/request-log/02-application/queries/read-facets.query.ts";
import { ReadOverview } from "#modules/request-log/02-application/queries/read-overview.query.ts";
import { ReadSeries } from "#modules/request-log/02-application/queries/read-series.query.ts";
import type * as Traffic from "#modules/request-log/03-domain/traffic.ts";
import { requestLogProblem } from "#shared/01-presentation/problems.ts";
import { askedOf, utc } from "./filters.ts";
import { emptyWindowProblem } from "./problems.ts";
import type * as TrafficApi from "./traffic.api.ts";

const answered = {
  EmptyWindow: emptyWindowProblem,
  RequestLogUnavailable: requestLogProblem,
};

const sumsOf = (sums: Traffic.Sums) => ({
  requests: sums.requests,
  usage: sums.usage,
  costUsd: sums.cost,
  unpricedRequests: sums.unpricedRequests,
});

const totalsOf = (totals: Traffic.Totals) => ({
  ...sumsOf(totals),
  sessions: totals.sessions,
  outcomes: totals.outcomes,
  usageUnreported: totals.usageUnreported,
  durationMs: Option.getOrNull(totals.durationMs),
  firstByteMs: Option.getOrNull(totals.firstByteMs),
});

export const build = (
  handlers: HttpApiBuilder.Handlers.FromGroup<typeof TrafficApi.group>,
) =>
  Effect.gen(function* () {
    const readOverview = yield* ReadOverview;
    const readSeries = yield* ReadSeries;
    const readBreakdown = yield* ReadBreakdown;
    const readFacets = yield* ReadFacets;
    const groupErrors = yield* GroupErrors;

    return handlers
      .handle("overview", ({ query }) =>
        Effect.gen(function* () {
          const overview = yield* readOverview.execute(askedOf(query));
          return {
            window: overview.window,
            previous: overview.previous,
            totals: totalsOf(overview.totals),
            previousTotals: totalsOf(overview.previousTotals),
            firstRequestAt: Option.getOrNull(overview.firstRequestAt),
          };
        }).pipe(Effect.catchTags(answered)),
      )
      .handle("series", ({ query }) =>
        Effect.gen(function* () {
          const series = yield* readSeries.execute(
            askedOf(query),
            query.by ?? "pool",
            query.tz ?? utc,
          );
          return {
            bucket: series.bucket,
            keys: series.keys.map(Option.getOrNull),
            points: series.points.map((point) => ({
              ...sumsOf(point),
              at: point.at,
              key: Option.getOrNull(point.key),
              errors: point.errors,
            })),
          };
        }).pipe(Effect.catchTags(answered)),
      )
      .handle("breakdown", ({ query }) =>
        Effect.gen(function* () {
          const breakdown = yield* readBreakdown.execute(
            askedOf(query),
            query.by,
            query.limit ?? 50,
          );
          return {
            rows: breakdown.rows.map((row) => ({
              ...sumsOf(row),
              key: row.key,
              sessions: row.sessions,
              errors: row.errors,
              lastAt: row.lastAt,
            })),
            distinctKeys: breakdown.distinctKeys,
          };
        }).pipe(Effect.catchTags(answered)),
      )
      .handle("facets", ({ query }) =>
        readFacets.execute(askedOf(query)).pipe(Effect.catchTags(answered)),
      )
      .handle("errors", ({ query }) =>
        groupErrors.execute(askedOf(query)).pipe(Effect.catchTags(answered)),
      );
  });
