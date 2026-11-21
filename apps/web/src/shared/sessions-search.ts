import { Option, Schema } from "effect";
import { Range } from "#shared/range.ts";

export const dimensions = [
  "pool",
  "project",
  "machine",
  "client",
  "provider",
  "model",
] as const;

export type Dimension = (typeof dimensions)[number];

export const sorts = ["recent", "tokens", "cost", "requests"] as const;

export type Sort = (typeof sorts)[number];

export const defaultRange = "7d" satisfies Range;

/** What the sessions list can be asked to show; a default is left out of the URL. */
export type SessionsSearch = {
  readonly range?: Exclude<Range, typeof defaultRange>;
  readonly q?: string;
  readonly match?: "loose";
  readonly outcome?: "ok" | "error";
  readonly sort?: Exclude<Sort, "recent">;
  readonly page?: number;
} & { readonly [D in Dimension]?: ReadonlyArray<string> };

const decodeRange = Schema.decodeUnknownOption(Range);
const decodeText = Schema.decodeUnknownOption(Schema.NonEmptyString);
const decodeMatch = Schema.decodeUnknownOption(Schema.Literal("loose"));
const decodeOutcome = Schema.decodeUnknownOption(
  Schema.Literals(["ok", "error"]),
);
const decodeSort = Schema.decodeUnknownOption(
  Schema.Literals(["tokens", "cost", "requests"]),
);
const decodePage = Schema.decodeUnknownOption(
  Schema.Union([
    Schema.Int,
    Schema.FiniteFromString.pipe(Schema.decodeTo(Schema.Int)),
  ]).check(Schema.isGreaterThanOrEqualTo(2)),
);
const decodeValues = Schema.decodeUnknownOption(
  Schema.Union([Schema.String, Schema.Array(Schema.String)]),
);

/** A repeatable parameter's values, once each and none empty; nothing when it does not decode. */
export const valuesOf = (given: unknown): ReadonlyArray<string> =>
  Option.match(decodeValues(given), {
    onNone: () => [],
    onSome: (values) => [
      ...new Set(
        (typeof values === "string" ? [values] : values).filter(
          (value) => value !== "",
        ),
      ),
    ],
  });

/** Keeps each parameter that decodes and drops one that does not, so a stale link still opens the list. */
export const validateSearch = (
  search: Record<string, unknown>,
): SessionsSearch => {
  const range = Option.getOrUndefined(decodeRange(search.range));
  const q = Option.getOrUndefined(
    decodeText(typeof search.q === "string" ? search.q.trim() : search.q),
  );
  const match = Option.getOrUndefined(decodeMatch(search.match));
  const outcome = Option.getOrUndefined(decodeOutcome(search.outcome));
  const sort = Option.getOrUndefined(decodeSort(search.sort));
  const page = Option.getOrUndefined(decodePage(search.page));
  const chosen = Object.fromEntries(
    dimensions.flatMap((dimension) => {
      const values = valuesOf(search[dimension]);
      return values.length === 0 ? [] : [[dimension, values]];
    }),
  );
  return {
    ...(range === undefined || range === defaultRange ? {} : { range }),
    ...(q === undefined ? {} : { q }),
    ...(q === undefined || match === undefined ? {} : { match }),
    ...(outcome === undefined ? {} : { outcome }),
    ...(sort === undefined ? {} : { sort }),
    ...(page === undefined ? {} : { page }),
    ...chosen,
  };
};
