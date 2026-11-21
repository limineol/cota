import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Schema } from "effect";
import { type Named, nameRows, type Seen } from "./names.ts";

const int = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

const keys = ["a", "b", "c", "d", "e", "f", "a/b", "%25", "é"];

/** Some of the keys, each at most once, in an order of their own. */
const someKeys = Arbitrary.array(int(0, keys.length - 1), {
  maxLength: keys.length,
}).pipe(
  Arbitrary.map((picked) => [
    ...new Set(picked.map((index) => keys[index] ?? "a")),
  ]),
);

const seen = Arbitrary.all({
  values: someKeys,
  requests: Arbitrary.array(int(1, 5000), {
    minLength: keys.length,
    maxLength: keys.length,
  }),
}).pipe(
  Arbitrary.map(
    ({ values, requests }): ReadonlyArray<Seen> =>
      values.map((value, index) => ({ value, requests: requests[index] ?? 1 })),
  ),
);

const names = Arbitrary.all({
  named: someKeys,
  owner: Arbitrary.array(Arbitrary.schema(Schema.Boolean), {
    minLength: keys.length,
    maxLength: keys.length,
  }),
}).pipe(
  Arbitrary.map(
    ({ named, owner }): ReadonlyArray<Named> =>
      named.map((key, index) => ({
        key,
        name: `Name of ${key}`,
        source: owner[index] === true ? "owner" : "built-in",
      })),
  ),
);

describe("the rows of a kind's display names", () => {
  it.prop(
    "V35: every id seen and every name of the kind is one row, the ids seen first in their order with their requests, then the names of ids not seen in theirs; a row carries its id's name and where it comes from, and an id not seen has no requests when the ids seen are all there are, and an unknown count otherwise",
    { seen, names, whole: Arbitrary.schema(Schema.Boolean) },
    ({ seen, names, whole }) => {
      const rows = nameRows(seen, names, whole);
      const seenKeys = seen.map((each) => each.value);
      expect(rows.map((row) => row.key)).toEqual([
        ...seenKeys,
        ...names
          .map((named) => named.key)
          .filter((key) => !seenKeys.includes(key)),
      ]);
      for (const row of rows) {
        const named = names.find((each) => each.key === row.key);
        expect(row.name).toBe(named?.name ?? null);
        expect(row.source).toBe(named?.source ?? null);
        const counted = seen.find((each) => each.value === row.key);
        expect(row.requests).toBe(
          counted === undefined ? (whole ? 0 : null) : counted.requests,
        );
      }
    },
  );
});
