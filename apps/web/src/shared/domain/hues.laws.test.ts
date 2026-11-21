import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Schema } from "effect";
import { hues, poolHues } from "./hues.ts";

const pools = Arbitrary.schema(
  Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 20 })),
).pipe(
  Arbitrary.map((count) =>
    Array.from({ length: count }, (_, index) => `pool-${index}`),
  ),
);

describe("pool hues", () => {
  it.prop(
    "V18: pools take the hues in the order given, one each, and a pool beyond the set is neutral",
    { pools },
    ({ pools }) => {
      const given = poolHues(pools);
      expect(pools.map((pool) => given.get(pool))).toEqual(
        pools.map((_, index) =>
          index < hues.length ? hues[index] : "neutral",
        ),
      );
    },
  );
});
