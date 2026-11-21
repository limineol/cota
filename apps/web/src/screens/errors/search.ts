import { Option, Schema } from "effect";
import { Range } from "#shared/range.ts";
import { type Dimension, valuesOf } from "#shared/sessions-search.ts";

export const failures = ["error", "refused", "cancelled"] as const;

export type Failure = (typeof failures)[number];

export const filtered = [
  "pool",
  "provider",
  "model",
  "client",
] as const satisfies ReadonlyArray<Dimension>;

export type Filtered = (typeof filtered)[number];

export const defaultRange = "7d" satisfies Range;

/** What the errors screen can be asked to show; a default is left out of the URL. */
export type ErrorsSearch = {
  readonly range?: Exclude<Range, typeof defaultRange>;
  readonly outcome?: Exclude<Failure, "error">;
} & { readonly [D in Filtered]?: ReadonlyArray<string> };

const decodeRange = Schema.decodeUnknownOption(Range);
const decodeOutcome = Schema.decodeUnknownOption(
  Schema.Literals(["refused", "cancelled"]),
);

/** Keeps each parameter that decodes and drops one that does not, so a stale link still opens the screen. */
export const validateSearch = (
  search: Record<string, unknown>,
): ErrorsSearch => {
  const range = Option.getOrUndefined(decodeRange(search.range));
  const outcome = Option.getOrUndefined(decodeOutcome(search.outcome));
  const chosen = Object.fromEntries(
    filtered.flatMap((dimension) => {
      const values = valuesOf(search[dimension]);
      return values.length === 0 ? [] : [[dimension, values]];
    }),
  );
  return {
    ...(range === undefined || range === defaultRange ? {} : { range }),
    ...(outcome === undefined ? {} : { outcome }),
    ...chosen,
  };
};
