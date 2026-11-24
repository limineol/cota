import { Clock, DateTime, Effect, Option } from "effect";
import { type Client, useApiQuery } from "#shared/api.ts";
import { fifteenMinutes, type Start, thirtyDays } from "#shared/range.ts";

const thirtySeconds = 30_000;

const fiveMinutes = 5 * 60_000;

const poll = { refetchInterval: thirtySeconds };

const instant = (milliseconds: number) => DateTime.makeUnsafe(milliseconds);

/** The viewer's time zone, which the series' buckets follow; UTC when the browser names none the hub would know. */
export const viewerZone = DateTime.zoneMakeNamed(
  Intl.DateTimeFormat().resolvedOptions().timeZone,
).pipe(Option.getOrElse(() => DateTime.zoneMakeNamedUnsafe("UTC")));

/** The start of the viewer's day that holds `now`. */
export const startOfToday = (now: number) =>
  DateTime.makeZonedUnsafe(now, { timeZone: viewerZone }).pipe(
    DateTime.startOf("day"),
    DateTime.toEpochMillis,
  );

const selection = (pool: string | null) =>
  pool === null ? {} : { pool: [pool] };

const listPools = (client: Client) => client.pools.list();

const breakdownSince =
  (
    since: (now: number) => number,
    by: "pool" | "project" | "model",
    pool: string | null,
    limit: number,
  ) =>
  (client: Client) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      return yield* client.traffic.breakdown({
        query: {
          from: instant(since(now)),
          to: instant(now),
          by,
          limit,
          ...selection(pool),
        },
      });
    });

export type Pools = Effect.Success<ReturnType<typeof listPools>>["pools"];
export type Pool = Pools[number];
export type QuotaWindow = Pool["windows"][number];
export type Breakdown = Effect.Success<
  ReturnType<ReturnType<typeof breakdownSince>>
>;
export type BreakdownRow = Breakdown["rows"][number];

/** Every pool of the configuration with its quota windows. */
export const usePools = () =>
  useApiQuery(["overview", "pools"], listPools, poll);

/** Each pool's traffic today in the viewer's zone (from `today`, its start), over the last 30 days, and in the last 15 minutes. */
export const usePoolFigures = (today: number) => {
  const sinceToday = useApiQuery(
    ["overview", "by-pool", "today", today],
    breakdownSince(() => today, "pool", null, 500),
    poll,
  );
  const month = useApiQuery(
    ["overview", "by-pool", "30d"],
    breakdownSince((now) => now - thirtyDays, "pool", null, 500),
    poll,
  );
  const active = useApiQuery(
    ["overview", "by-pool", "15m"],
    breakdownSince((now) => now - fifteenMinutes, "pool", null, 500),
    poll,
  );
  return { today: sinceToday, month, active };
};

/**
 * Each pool's traffic from when the request log begins (`first`) to the start
 * of today, which with today's makes its traffic since the log began. It reads
 * the whole log but changes only when an older request is added, so it is read
 * every five minutes, and only while the log is older than the 30 days.
 */
export const useBeforeToday = (
  first: number | null | undefined,
  today: number,
  enabled: boolean,
) =>
  useApiQuery(
    ["overview", "by-pool", "before-today", first ?? null, today],
    first === null || first === undefined
      ? null
      : (client) =>
          client.traffic.breakdown({
            query: {
              from: instant(first),
              to: instant(today),
              by: "pool",
              limit: 500,
            },
          }),
    { refetchInterval: fiveMinutes, enabled },
  );

/** The distinct sessions of every pool together in the last 15 minutes, and when the request log begins. */
export const useLogNow = () =>
  useApiQuery(
    ["overview", "active"],
    (client) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const answer = yield* client.traffic.overview({
          query: { from: instant(now - fifteenMinutes), to: instant(now) },
        });
        return {
          sessions: answer.totals.sessions,
          firstRequestAt:
            answer.firstRequestAt === null
              ? null
              : DateTime.toEpochMillis(answer.firstRequestAt),
        };
      }),
    poll,
  );

/** The range's totals beside the window before it, for the pool chosen or all of them. */
export const useTotals = (pool: string | null, start: Start | null) =>
  useApiQuery(
    ["overview", "totals", pool, start?.key ?? null],
    start === null
      ? null
      : (client) =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            return yield* client.traffic.overview({
              query: {
                from: instant(start.at(now)),
                to: instant(now),
                ...selection(pool),
              },
            });
          }),
    { ...poll, keepPrevious: true },
  );

/** The range's traffic over time, by pool, in buckets of the viewer's zone. */
export const useSeries = (pool: string | null, start: Start | null) =>
  useApiQuery(
    ["overview", "series", pool, start?.key ?? null],
    start === null
      ? null
      : (client) =>
          Effect.gen(function* () {
            const to = yield* Clock.currentTimeMillis;
            const from = start.at(to);
            const series = yield* client.traffic.series({
              query: {
                from: instant(from),
                to: instant(to),
                tz: viewerZone,
                by: "pool",
                ...selection(pool),
              },
            });
            return { ...series, from, to };
          }),
    { ...poll, keepPrevious: true },
  );

export type SeriesAnswer = NonNullable<ReturnType<typeof useSeries>["data"]>;

/** The range's traffic by project or by model, its 50 with the most requests. */
export const useBreakdown = (
  by: "project" | "model",
  pool: string | null,
  start: Start | null,
  enabled: boolean,
) =>
  useApiQuery(
    ["overview", "breakdown", by, pool, start?.key ?? null],
    start === null ? null : breakdownSince(start.at, by, pool, 50),
    { ...poll, keepPrevious: true, enabled },
  );

/** A pool's projects or models over the last 30 days, ranked by tokens among its 500 with the most requests. */
export const useTop = (
  by: "project" | "model",
  pool: string,
  enabled: boolean,
) =>
  useApiQuery(
    ["overview", "top", by, pool],
    breakdownSince((now) => now - thirtyDays, by, pool, 500),
    { ...poll, enabled },
  );

const readReportedThrough = (client: Client) =>
  client.reports.reportedThrough();

export type Reporter = Effect.Success<
  ReturnType<typeof readReportedThrough>
>["reporters"][number];

/** How far each machine has reported each client's calls to each observed pool, late or not as the hub says. */
export const useReportedThrough = () =>
  useApiQuery(["overview", "reported-through"], readReportedThrough, poll);
