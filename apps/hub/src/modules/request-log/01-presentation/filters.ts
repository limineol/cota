import { DateTime, Option, Schema } from "effect";
import * as Search from "#modules/request-log/03-domain/search.ts";
import type * as Traffic from "#modules/request-log/03-domain/traffic.ts";
import { Outcome } from "#shared/03-domain/request.entity.ts";
import { isCharactersBetween } from "#shared/03-domain/text.ts";

const valuesOf = <S extends Schema.Top>(value: S) =>
  Schema.optional(Schema.Array(value).check(Schema.isMaxLength(50)));

const Value = Schema.String.check(isCharactersBetween(0, 255));

/** The query parameters that select requests, shared by every reading endpoint (`docs/specs/api/spec.md`, Filters). */
export const filterFields = {
  from: Schema.optional(Schema.DateTimeUtcFromString),
  to: Schema.optional(Schema.DateTimeUtcFromString),
  pool: valuesOf(Value),
  model: valuesOf(Value),
  client: valuesOf(Value),
  machine: valuesOf(Value),
  project: valuesOf(Value),
  provider: valuesOf(Value),
  hub_key: valuesOf(Value),
  outcome: valuesOf(Outcome),
};

type FilterQuery = Schema.Struct.Type<typeof filterFields>;

export const askedOf = (query: FilterQuery): Traffic.Asked => ({
  from: Option.fromUndefinedOr(query.from),
  to: Option.fromUndefinedOr(query.to),
  filters: {
    pool: query.pool ?? [],
    model: query.model ?? [],
    client: query.client ?? [],
    machine: query.machine ?? [],
    project: query.project ?? [],
    provider: query.provider ?? [],
    hub_key: query.hub_key ?? [],
    outcome: query.outcome ?? [],
  },
});

/** The query parameters of a search's tolerance, beside `q` (`docs/specs/search/spec.md`, Tolerance). */
export const toleranceFields = {
  prefix: Schema.optional(Schema.Boolean),
  fuzzy: Schema.optional(Search.Fuzzy),
};

type ToleranceQuery = Schema.Struct.Type<typeof toleranceFields>;

export const toleranceOf = (query: ToleranceQuery): Search.Tolerance => ({
  prefix: query.prefix ?? Search.exact.prefix,
  fuzzy: query.fuzzy ?? Search.exact.fuzzy,
});

/** An IANA time zone's name, as ClickHouse and `Intl` know it; never an offset. */
export const TimeZone = Schema.TimeZoneNamedFromString.check(
  Schema.makeFilter((zone) => /^[A-Za-z][\w+-]*(?:\/[\w+-]+)*$/.test(zone.id), {
    expected: "an IANA time zone's name, such as Europe/Berlin",
  }),
);

export const utc = DateTime.zoneMakeNamedUnsafe("UTC");
