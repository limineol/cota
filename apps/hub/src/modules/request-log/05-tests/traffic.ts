import { Arbitrary, DateTime, Effect, Option, Predicate, Schema } from "effect";
import type { PricedRequest } from "#modules/request-log/02-application/interfaces/requests.repository.ts";
import { GroupErrors } from "#modules/request-log/02-application/queries/group-errors.query.ts";
import { ReadBreakdown } from "#modules/request-log/02-application/queries/read-breakdown.query.ts";
import { ReadFacets } from "#modules/request-log/02-application/queries/read-facets.query.ts";
import { ReadOverview } from "#modules/request-log/02-application/queries/read-overview.query.ts";
import { ReadSeries } from "#modules/request-log/02-application/queries/read-series.query.ts";
import * as Traffic from "#modules/request-log/03-domain/traffic.ts";
import { HubKeyName, PoolId } from "#shared/03-domain/ids.ts";
import * as Request from "#shared/03-domain/request.entity.ts";
import { compareText } from "#shared/03-domain/text.ts";
import * as Harness from "#shared/05-tests/harness.ts";

const int = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

const pick = <const A extends readonly [unknown, ...Array<unknown>]>(
  values: A,
): Arbitrary.Arbitrary<A[number]> =>
  int(0, values.length - 1).pipe(
    Arbitrary.map((index): A[number] => values[index] ?? values[0]),
  );

/**
 * Where generated requests start: from 1 March to 8 April 2026, across the
 * changes of clock in New York (8 March), Europe (29 March) and Adelaide
 * (5 April).
 */
export const span = {
  from: Date.UTC(2026, 2, 1),
  to: Date.UTC(2026, 3, 8),
};

/** The values generated requests take, and filters pick from, with one no request has. */
export const values = {
  pool: ["claude", "codex", "work", "café", "nowhere"],
  model: ["claude-opus-5-5", "claude-haiku-4-5", "gpt-5.5", "", "unasked"],
  client: ["claude-code", "codex", "pi", "", "unknown"],
  machine: ["workstation", "laptop", "", "elsewhere"],
  project: ["cota", "acme/shop", "", "nothing"],
  provider: ["anthropic", "openai", "zai", "nobody"],
  hub_key: ["clients", "fleet", "nobody"],
  outcome: ["ok", "error", "refused", "cancelled"],
} as const satisfies Record<Traffic.Dimension, ReadonlyArray<string>>;

/** Time zones whose midnights all exist, with offsets of whole, half and three-quarter hours, some changing their clocks in the span. */
export const zones = [
  "UTC",
  "Europe/Berlin",
  "America/New_York",
  "Asia/Kathmandu",
  "Australia/Adelaide",
  "Asia/Kolkata",
] as const;

const longMessage = `${"Überlastet — ".repeat(40)}😀 and then some`;

const instant = Arbitrary.all({
  fine: int(0, span.to - span.from - 1),
  coarse: int(0, 300),
  sharp: Arbitrary.schema(Schema.Boolean),
}).pipe(
  Arbitrary.map(
    ({ fine, coarse, sharp }) =>
      span.from +
      (sharp ? Math.floor((coarse * (span.to - span.from)) / 301) : fine),
  ),
);

const tokens = int(0, 300_000);

const seed = Arbitrary.all({
  at: instant,
  idPart: int(0, 0xfff),
  session: pick(["s1", "s2", "s3", "request:x", ""]),
  pool: pick(["claude", "codex", "work", "café"]),
  model: pick(["claude-opus-5-5", "claude-haiku-4-5", "gpt-5.5", ""]),
  client: pick(["claude-code", "codex", "pi", ""]),
  machine: pick(["workstation", "laptop", ""]),
  project: pick(["cota", "acme/shop", ""]),
  provider: pick(["anthropic", "openai", "zai"]),
  hubKey: pick(["clients", "fleet"]),
  operation: pick([
    "messages",
    "messages",
    "messages",
    "models",
    "count_tokens",
  ]),
  outcome: pick(["ok", "ok", "error", "refused", "cancelled"]),
  upstreamStatus: pick([200, 429, 500, 529, 0]),
  errorType: pick(["", "overloaded_error", "rate_limit_error"]),
  errorMessage: pick(["", "Overloaded", longMessage, `${longMessage}!`]),
  durationMs: int(0, 20_000),
  firstByteMs: Arbitrary.all({ ms: int(0, 5_000), got: pick([true, false]) }),
  usage: Arbitrary.all({
    reported: pick([true, true, false]),
    input: tokens,
    cacheRead: tokens,
    cacheWriteShort: tokens,
    cacheWriteLong: tokens,
    output: tokens,
    reasoning: tokens,
  }),
  cost: Arbitrary.all({
    priced: pick([true, true, false]),
    picodollars: int(0, 2_000_000_000),
  }),
});

const hex = (value: number, digits: number) =>
  value.toString(16).padStart(digits, "0");

/** A generated request log: requests, and their costs as `RecordRequest` would have given them. */
export const requestLog = (maxLength: number) =>
  Arbitrary.array(seed, {
    minLength: Math.floor((maxLength * 2) / 3),
    maxLength,
  }).pipe(
    Arbitrary.map((seeds) =>
      seeds.map((generated, index): PricedRequest => {
        const at = hex(generated.at, 12);
        const reported = generated.usage.reported;
        return {
          request: Harness.requestOf({
            id: Request.RequestId.make(
              `${at.slice(0, 8)}-${at.slice(8)}-7${hex(generated.idPart, 3)}-8${hex(index, 3)}-${hex(index, 12)}`,
            ),
            startedAt: DateTime.makeUnsafe(generated.at),
            session: generated.session,
            pool: PoolId.make(generated.pool),
            model: generated.model,
            client: generated.client,
            machine: generated.machine,
            project: generated.project,
            provider: generated.provider,
            hubKey: HubKeyName.make(generated.hubKey),
            operation: generated.operation,
            outcome: generated.outcome,
            upstreamStatus: generated.upstreamStatus,
            errorType: generated.errorType,
            errorMessage: generated.errorMessage,
            durationMs: generated.durationMs,
            firstByteMs: generated.firstByteMs.got
              ? Option.some(generated.firstByteMs.ms)
              : Option.none(),
            usage: reported
              ? Option.some({
                  tokens: {
                    input: generated.usage.input,
                    cacheRead: generated.usage.cacheRead,
                    cacheWriteShort: generated.usage.cacheWriteShort,
                    cacheWriteLong: generated.usage.cacheWriteLong,
                    output: generated.usage.output,
                  },
                  reasoning: generated.usage.reasoning,
                  reported: "{}",
                })
              : Option.none(),
          }),
          cost:
            reported && generated.cost.priced
              ? Option.some(BigInt(generated.cost.picodollars) * 1000n)
              : Option.none(),
        };
      }),
    ),
  );

const valuesOf = <A extends string>(
  choices: readonly [A, ...Array<A>],
): Arbitrary.Arbitrary<ReadonlyArray<A>> =>
  Arbitrary.all({
    used: int(0, 9),
    chosen: Arbitrary.array(pick(choices), { minLength: 1, maxLength: 2 }),
  }).pipe(Arbitrary.map(({ used, chosen }) => (used < 9 ? [] : chosen)));

export const filters: Arbitrary.Arbitrary<Traffic.Filters> = Arbitrary.all({
  pool: valuesOf(values.pool),
  model: valuesOf(values.model),
  client: valuesOf(values.client),
  machine: valuesOf(values.machine),
  project: valuesOf(values.project),
  provider: valuesOf(values.provider),
  hub_key: valuesOf(values.hub_key),
  outcome: valuesOf(values.outcome),
});

const hour = 60 * 60 * 1000;

/** A window inside the span or around it, from half an hour to 800 days long. */
export const window: Arbitrary.Arbitrary<Traffic.Window> = Arbitrary.all({
  start: int(-2 * 24, 40 * 24),
  length: pick([
    1,
    24,
    24 * 3,
    24 * 9,
    24 * 9,
    24 * 40,
    24 * 40,
    24 * 100,
    24 * 400,
  ]),
  stretch: int(25, 100),
}).pipe(
  Arbitrary.map(({ start, length, stretch }) => {
    const from = span.from + start * hour;
    return {
      from: DateTime.makeUnsafe(from),
      to: DateTime.makeUnsafe(from + Math.ceil((length * hour * stretch) / 50)),
    };
  }),
);

export const selection: Arbitrary.Arbitrary<Traffic.Selection> = Arbitrary.all({
  window,
  filters,
});

export const dimension = pick(Traffic.dimensions);
export const bucket = pick(Traffic.Bucket.literals);
export const zone = pick(zones).pipe(
  Arbitrary.map((id) => DateTime.zoneMakeNamedUnsafe(id)),
);

/** An answer with its instants as ISO text, options as their value or null, and sums of money as text, so answers compare as data. */
export const plain = (value: unknown): unknown => {
  if (DateTime.isDateTime(value))
    return DateTime.formatIso(DateTime.toUtc(value));
  if (Option.isOption(value)) return plain(Option.getOrNull(value));
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(plain);
  if (Predicate.isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, each]) => [key, plain(each)]),
    );
  }
  return value;
};

export const askedOf = (selection: Traffic.Selection): Traffic.Asked => ({
  from: Option.some(selection.window.from),
  to: Option.some(selection.window.to),
  filters: selection.filters,
});

/** Every traffic query's answer to what was asked, as data. */
export const answersOf = (
  asked: Traffic.Asked,
  by: Traffic.Dimension,
  zone: DateTime.TimeZone.Named,
) =>
  Effect.gen(function* () {
    return plain({
      overview: yield* (yield* ReadOverview).execute(asked),
      series: yield* (yield* ReadSeries).execute(asked, by, zone),
      breakdown: yield* (yield* ReadBreakdown).execute(asked, by, 500),
      facets: yield* (yield* ReadFacets).execute(asked),
      errors: yield* (yield* GroupErrors).execute(asked),
    });
  }).pipe(Effect.orDie);

interface Summed {
  readonly requests: number;
  readonly errors: number;
  readonly usage: Traffic.UsageSums;
  readonly cost: bigint;
  readonly unpricedRequests: number;
}

const summed = (
  rows: ReadonlyArray<Traffic.Sums & { readonly errors: number }>,
): Summed =>
  rows.reduce(
    (sum: Summed, row) => ({
      requests: sum.requests + row.requests,
      errors: sum.errors + row.errors,
      usage: {
        input: sum.usage.input + row.usage.input,
        cacheRead: sum.usage.cacheRead + row.usage.cacheRead,
        cacheWriteShort: sum.usage.cacheWriteShort + row.usage.cacheWriteShort,
        cacheWriteLong: sum.usage.cacheWriteLong + row.usage.cacheWriteLong,
        output: sum.usage.output + row.usage.output,
        reasoning: sum.usage.reasoning + row.usage.reasoning,
      },
      cost: sum.cost + row.cost,
      unpricedRequests: sum.unpricedRequests + row.unpricedRequests,
    }),
    {
      requests: 0,
      errors: 0,
      usage: {
        input: 0,
        cacheRead: 0,
        cacheWriteShort: 0,
        cacheWriteLong: 0,
        output: 0,
        reasoning: 0,
      },
      cost: 0n,
      unpricedRequests: 0,
    },
  );

/**
 * The sums over a breakdown and a series by every dimension, and what H5 says
 * each is: the overview's.
 */
export const sumsBy = (asked: Traffic.Asked, zone: DateTime.TimeZone.Named) =>
  Effect.gen(function* () {
    const { totals } = yield* (yield* ReadOverview).execute(asked);
    const overview = plain(
      summed([{ ...totals, errors: totals.outcomes.error }]),
    );
    const found: Array<unknown> = [];
    const expected: Array<unknown> = [];
    for (const by of Traffic.dimensions) {
      const breakdown = yield* (yield* ReadBreakdown).execute(asked, by, 500);
      const series = yield* (yield* ReadSeries).execute(asked, by, zone);
      found.push(
        { by, over: "breakdown", sums: plain(summed(breakdown.rows)) },
        { by, over: "series", sums: plain(summed(series.points)) },
      );
      expected.push(
        { by, over: "breakdown", sums: overview },
        { by, over: "series", sums: overview },
      );
    }
    return { found, expected };
  }).pipe(Effect.orDie);

/**
 * Each dimension's facet, and what H7 says it is: the values of the
 * dimension in the log for which the overview, with that value as its
 * dimension's only filter, counts requests, with that count.
 */
export const facetsAndCounts = (
  asked: Traffic.Asked,
  log: ReadonlyArray<PricedRequest>,
) =>
  Effect.gen(function* () {
    const facets = yield* (yield* ReadFacets).execute(asked);
    const counted: Record<string, unknown> = {};
    for (const dimension of Traffic.dimensions) {
      const candidates = new Set(
        log.map(({ request }) => Traffic.valueIn(request, dimension)),
      );
      const values: Array<Traffic.FacetValue> = [];
      for (const value of candidates) {
        if (value === "") continue;
        const { totals } = yield* (yield* ReadOverview).execute({
          ...asked,
          filters: { ...asked.filters, [dimension]: [value] },
        });
        if (totals.requests > 0)
          values.push({ value, requests: totals.requests });
      }
      counted[dimension] = values
        .sort(
          (one, other) =>
            other.requests - one.requests ||
            compareText(one.value, other.value),
        )
        .slice(0, 100);
    }
    return { facets: plain(facets), counted };
  }).pipe(Effect.orDie);
