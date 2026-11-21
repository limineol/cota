import {
  type DateTime,
  Duration,
  Option,
  type Redacted,
  Result,
  Schema,
} from "effect";
import type { HttpClient } from "effect/http";
import * as Plan from "#modules/quota/03-domain/plan.ts";
import type { QuotaReading } from "#modules/quota/03-domain/sources.ts";
import * as ProviderCall from "#modules/quota/04-infrastructure/provider-call.ts";
import type * as Pool from "#shared/03-domain/pool.entity.ts";
import { type Given, readingOf } from "./reading.ts";
import * as UsageEndpoint from "./usage-endpoint.ts";

const Answer = Schema.Struct({
  data: Schema.Struct({
    limits: Schema.Array(Schema.Unknown),
    level: Schema.optionalKey(Schema.NullOr(Schema.String)),
  }),
});
type Answer = typeof Answer.Type;

const Unit = Schema.Struct({ unit: Schema.Int });

const Count = Schema.optionalKey(Schema.NullOr(Schema.Finite));

const Entry = Schema.Struct({
  type: Schema.String,
  unit: Schema.Int,
  number: Schema.Int,
  usage: Count,
  currentValue: Count,
  percentage: Count,
  nextResetTime: Schema.optionalKey(Schema.NullOr(Schema.Int)),
});
type Entry = typeof Entry.Type;

/** Z.ai's units of a window's length: the prototype author's reading of the API, not documented. */
const units: ReadonlyMap<number, Duration.Duration> = new Map([
  [1, Duration.days(1)],
  [3, Duration.hours(1)],
  [5, Duration.minutes(1)],
  [6, Duration.weeks(1)],
]);

const usedOf = (entry: Entry): Option.Option<number> => {
  if (
    typeof entry.usage === "number" &&
    entry.usage > 0 &&
    typeof entry.currentValue === "number"
  ) {
    return Option.some((entry.currentValue / entry.usage) * 100);
  }
  return Option.fromNullishOr(entry.percentage);
};

const givenOf = (
  value: unknown,
  index: number,
): Result.Result<Option.Option<Given>, string> => {
  const at = `data.limits[${index}]`;
  const unit = ProviderCall.decodeAt(Unit, value, at);
  if (Result.isFailure(unit)) return Result.fail(unit.failure);
  const length = units.get(unit.success.unit);
  if (length === undefined) return Result.succeed(Option.none());
  const entry = ProviderCall.decodeAt(Entry, value, at);
  if (Result.isFailure(entry)) return Result.fail(entry.failure);
  const used = usedOf(entry.success);
  if (Option.isNone(used)) {
    return Result.fail(`${at} has neither currentValue nor percentage`);
  }
  return Result.succeed(
    Option.some({
      lengthMs: Duration.toMillis(length) * entry.success.number,
      scope:
        entry.success.type === "TIME_LIMIT"
          ? Option.some("TIME_LIMIT")
          : Option.none(),
      used: used.value,
      resetMs: Option.fromNullishOr(entry.success.nextResetTime),
    }),
  );
};

const readingFrom = (
  answer: Answer,
  at: DateTime.Utc,
): Result.Result<QuotaReading, string> => {
  const given: Array<Given> = [];
  for (const [index, value] of answer.data.limits.entries()) {
    const one = givenOf(value, index);
    if (Result.isFailure(one)) return Result.fail(one.failure);
    if (Option.isSome(one.success)) given.push(one.success.value);
  }
  return Result.succeed(
    readingOf(
      given,
      Option.flatMap(Option.fromNullishOr(answer.data.level), (level) =>
        level === "" ? Option.none() : Option.some(Plan.capitalised(level)),
      ),
      at,
    ),
  );
};

/** Z.ai's usage endpoint, at the origin of the pool's base URL. */
export const urlOf = (baseUrl: string): string =>
  `${new URL(baseUrl).origin}/api/monitor/usage/quota/limit`;

/** Reads a Z.ai pool's windows and plan with its held key (`docs/specs/quota-readers/spec.md`, Z.ai). */
export const read = (
  http: HttpClient.HttpClient,
  pool: Pool.Pool,
  key: Redacted.Redacted<string>,
) =>
  UsageEndpoint.read(http, {
    provider: "Z.ai",
    url: urlOf(pool.baseUrl),
    credential: key,
    answer: Answer,
    reading: readingFrom,
  });
