import { DateTime, Duration, Effect, Option, Schema } from "effect";
import type * as Request from "#shared/03-domain/request.entity.ts";
import { compareText } from "#shared/03-domain/text.ts";
import type * as Cost from "./cost.ts";

/** Whether a request is traffic: every request but a model listing. */
export const isTraffic = (
  request: Pick<Request.Request, "operation">,
): boolean => request.operation !== "models";

export const Dimension = Schema.Literals([
  "pool",
  "model",
  "client",
  "machine",
  "project",
  "provider",
  "hub_key",
  "outcome",
]);
export type Dimension = typeof Dimension.Type;
export const dimensions = Dimension.literals;

/** A request's value for a dimension; `model` is the model asked for. */
export const valueIn = (
  request: Request.Request,
  dimension: Dimension,
): string => {
  switch (dimension) {
    case "pool":
      return request.pool;
    case "model":
      return request.model;
    case "client":
      return request.client;
    case "machine":
      return request.machine;
    case "project":
      return request.project;
    case "provider":
      return request.provider;
    case "hub_key":
      return request.hubKey;
    case "outcome":
      return request.outcome;
  }
};

/** For each dimension, the values a request must have one of; none selects every value. */
export type Filters = {
  readonly [D in Dimension]: ReadonlyArray<
    D extends "outcome" ? Request.Outcome : string
  >;
};

export const noFilters: Filters = {
  pool: [],
  model: [],
  client: [],
  machine: [],
  project: [],
  provider: [],
  hub_key: [],
  outcome: [],
};

/** Whether a request has, for every dimension but `except`, one of its filter's values. */
export const matches = (
  filters: Filters,
  request: Request.Request,
  except?: Dimension,
): boolean =>
  dimensions.every((dimension) => {
    const values: ReadonlyArray<string> = filters[dimension];
    return (
      dimension === except ||
      values.length === 0 ||
      values.includes(valueIn(request, dimension))
    );
  });

/** The instants `[from, to)` a reading endpoint counts requests that started in. */
export interface Window {
  readonly from: DateTime.Utc;
  readonly to: DateTime.Utc;
}

const isIn = (window: Window, at: DateTime.Utc): boolean =>
  DateTime.isGreaterThanOrEqualTo(at, window.from) &&
  DateTime.isLessThan(at, window.to);

export class EmptyWindow extends Schema.TaggedError<
  EmptyWindow,
  { readonly brand: unique symbol }
>()("EmptyWindow", {
  from: Schema.DateTimeUtc,
  to: Schema.DateTimeUtc,
}) {}

const defaultLength = Duration.days(7);

/**
 * The window a caller asks for: `to` now unless given, `from` 7 days before
 * `to` unless given, and `from` before `to`.
 */
export const windowOf = Effect.fn("Traffic.windowOf")(function* (
  from: Option.Option<DateTime.Utc>,
  to: Option.Option<DateTime.Utc>,
): Effect.fn.Return<Window, EmptyWindow> {
  const end = Option.isSome(to) ? to.value : yield* DateTime.now;
  const start = Option.getOrElse(from, () =>
    DateTime.subtractDuration(end, defaultLength),
  );
  if (!DateTime.isLessThan(start, end)) {
    return yield* new EmptyWindow({ from: start, to: end });
  }
  return { from: start, to: end };
});

/** The window as long as `window` that ends where it starts (H6). */
export const previous = (window: Window): Window => ({
  from: DateTime.subtractDuration(
    window.from,
    DateTime.distance(window.from, window.to),
  ),
  to: window.from,
});

/** What a reading endpoint counts: the traffic that started in the window and matches the filters. */
export interface Selection {
  readonly window: Window;
  readonly filters: Filters;
}

/** What a caller asks a reading endpoint to count: a window, perhaps open at either end, and filters. */
export interface Asked {
  readonly from: Option.Option<DateTime.Utc>;
  readonly to: Option.Option<DateTime.Utc>;
  readonly filters: Filters;
}

export const selectionOf = Effect.fn("Traffic.selectionOf")(function* (
  asked: Asked,
): Effect.fn.Return<Selection, EmptyWindow> {
  const window = yield* windowOf(asked.from, asked.to);
  return { window, filters: asked.filters };
});

export const isSelected = (
  selection: Selection,
  request: Request.Request,
  except?: Dimension,
): boolean =>
  isTraffic(request) &&
  isIn(selection.window, request.startedAt) &&
  matches(selection.filters, request, except);

export const Bucket = Schema.Literals([
  "5m",
  "15m",
  "30m",
  "1h",
  "3h",
  "6h",
  "12h",
  "1d",
  "7d",
]);
export type Bucket = typeof Bucket.Type;

export const lengthOf: Readonly<Record<Bucket, Duration.Duration>> = {
  "5m": Duration.minutes(5),
  "15m": Duration.minutes(15),
  "30m": Duration.minutes(30),
  "1h": Duration.hours(1),
  "3h": Duration.hours(3),
  "6h": Duration.hours(6),
  "12h": Duration.hours(12),
  "1d": Duration.days(1),
  "7d": Duration.days(7),
};

const mostBuckets = 150;

/** The shortest bucket at least a 150th of the window long, and 7 days for a longer window. */
export const bucketFor = (window: Window): Bucket => {
  const length = DateTime.distance(window.from, window.to);
  return (
    Bucket.literals.find(
      (bucket) =>
        Duration.toMillis(lengthOf[bucket]) * mostBuckets >=
        Duration.toMillis(length),
    ) ?? "7d"
  );
};

/** Token sums by usage class, over the requests that reported usage. */
export interface UsageSums {
  readonly input: number;
  readonly cacheRead: number;
  readonly cacheWriteShort: number;
  readonly cacheWriteLong: number;
  readonly output: number;
  readonly reasoning: number;
}

/** What every count of traffic sums: requests, their usage, and their cost with how many lack one. */
export interface Sums {
  readonly requests: number;
  readonly usage: UsageSums;
  /** The sum of the requests' costs that are known. */
  readonly cost: Cost.Cost;
  /** Requests that reported usage and have no cost. */
  readonly unpricedRequests: number;
}

/**
 * Of n values sorted, the value at index ⌊p·n⌋ counted from 0, and the
 * largest when that is n.
 */
export interface Percentiles {
  readonly p50: number;
  readonly p95: number;
}

export interface Totals extends Sums {
  readonly sessions: number;
  readonly outcomes: Readonly<Record<Request.Outcome, number>>;
  readonly usageUnreported: number;
  /** Of `ok` requests. */
  readonly durationMs: Option.Option<Percentiles>;
  /** Of requests that got a first byte. */
  readonly firstByteMs: Option.Option<Percentiles>;
}

export interface Overview {
  readonly totals: Totals;
  readonly previousTotals: Totals;
  /** When the earliest traffic request in the request log started, whatever the selection. */
  readonly firstRequestAt: Option.Option<DateTime.Utc>;
}

/** One bucket's traffic for one key; no key for the values beyond the series' keys. */
export interface Point extends Sums {
  readonly at: DateTime.Utc;
  readonly key: Option.Option<string>;
  readonly errors: number;
}

export interface Series {
  readonly bucket: Bucket;
  /** Most requests first, then by text; no key last. */
  readonly keys: ReadonlyArray<Option.Option<string>>;
  /** By bucket, then in the order of `keys`. */
  readonly points: ReadonlyArray<Point>;
}

const keyOrder = (
  one: Option.Option<string>,
  other: Option.Option<string>,
): number => {
  if (Option.isNone(one) || Option.isNone(other)) {
    return Number(Option.isNone(one)) - Number(Option.isNone(other));
  }
  return compareText(one.value, other.value);
};

/** Orders a series' points, and gives its keys in the order their requests make. */
export const seriesOf = (
  bucket: Bucket,
  points: ReadonlyArray<Point>,
): Series => {
  const requests = new Map<string | undefined, number>();
  for (const point of points) {
    const key = Option.getOrUndefined(point.key);
    requests.set(key, (requests.get(key) ?? 0) + point.requests);
  }
  const keys = [...requests.entries()]
    .map(([key, count]) => ({ key: Option.fromUndefinedOr(key), count }))
    .sort((one, other) =>
      Option.isNone(one.key) || Option.isNone(other.key)
        ? keyOrder(one.key, other.key)
        : other.count - one.count || keyOrder(one.key, other.key),
    )
    .map(({ key }) => key);
  const rank = new Map(keys.map((key, at) => [Option.getOrUndefined(key), at]));
  const rankOf = (point: Point) =>
    rank.get(Option.getOrUndefined(point.key)) ?? 0;
  return {
    bucket,
    keys,
    points: [...points].sort(
      (one, other) =>
        DateTime.toEpochMillis(one.at) - DateTime.toEpochMillis(other.at) ||
        rankOf(one) - rankOf(other),
    ),
  };
};

export interface BreakdownRow extends Sums {
  /** Empty for requests without a value. */
  readonly key: string;
  readonly sessions: number;
  readonly errors: number;
  readonly lastAt: DateTime.Utc;
}

export interface Breakdown {
  /** By requests, most first, then by key. */
  readonly rows: ReadonlyArray<BreakdownRow>;
  /** How many values the dimension has in the selection, beyond the rows' limit included. */
  readonly distinctKeys: number;
}

export interface FacetValue {
  readonly value: string;
  readonly requests: number;
}

/** For each dimension, its non-empty values counted under every filter but its own, most requests first, then by value. */
export type Facets = { readonly [D in Dimension]: ReadonlyArray<FacetValue> };

/** How many characters of its message an error group shares. */
export const messageLength = 500;

/** The first characters of an error message that its group shares, counted in code points. */
export const messageOf = (errorMessage: string): string =>
  [...errorMessage].slice(0, messageLength).join("");

/** Failed requests that share their provider, model, outcome, status, error type and message. */
export interface ErrorGroup {
  readonly provider: string;
  readonly model: string;
  readonly outcome: Request.Outcome;
  readonly upstreamStatus: number;
  readonly errorType: string;
  readonly message: string;
  readonly requests: number;
  readonly firstAt: DateTime.Utc;
  readonly lastAt: DateTime.Utc;
  /** Sorted. */
  readonly pools: ReadonlyArray<string>;
  /** Sorted. */
  readonly clients: ReadonlyArray<string>;
  /** The latest request's id, the greatest id among requests that started at once. */
  readonly latestRequest: Request.RequestId;
}

export interface ErrorGroups {
  /** The groups whose last request is latest, latest first, then by `latestRequest`, greatest first. */
  readonly groups: ReadonlyArray<ErrorGroup>;
  /** Every request selected, in every group. */
  readonly requests: number;
  readonly distinctGroups: number;
}
