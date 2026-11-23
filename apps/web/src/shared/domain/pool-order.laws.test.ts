import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Schema } from "effect";
import {
  ordered,
  type Placed,
  type PoolOrder,
  poolOrders,
} from "./pool-order.ts";

const int = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

const pick = <A>(values: ReadonlyArray<A>) =>
  int(0, values.length - 1).pipe(Arbitrary.map((index) => values[index] as A));

const textOf = (characters: ReadonlyArray<string>, maxLength: number) =>
  Arbitrary.array(pick(characters), { minLength: 1, maxLength }).pipe(
    Arbitrary.map((picked) => picked.join("")),
  );

/** Few names, ids and usages, so that pools often share one, a name often only by its case, and some share all three. */
const pools = Arbitrary.array(
  Arbitrary.all({
    id: textOf(["a", "b", "B"], 2),
    name: textOf(["a", "A", "b", "B", "é", "z"], 2),
    usage: int(0, 3),
  }),
  { maxLength: 9 },
).pipe(
  Arbitrary.map((made) => made.map((each, given) => ({ ...each, given }))),
);

const order = pick(poolOrders);

const byCodeUnits = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Where `a` stands against `b` by the law's keys, without the order given: negative before, positive after, zero when equal in all. */
const keysCompared = (a: Placed, b: Placed, by: PoolOrder) =>
  (by === "usage" ? Math.sign(b.usage - a.usage) : 0) ||
  byCodeUnits(a.name.toLowerCase(), b.name.toLowerCase()) ||
  byCodeUnits(a.id, b.id);

describe("the order of the overview's pools", () => {
  it.prop(
    "V47: the pools are each shown once, by usage, most first, then by the name shown ignoring case, then by id, or by name and id alone whatever their usage, and pools equal in all of these keep the order given",
    { pools, order },
    ({ pools, order }) => {
      const shown = ordered(pools, order);
      expect([...shown].sort((a, b) => a.given - b.given)).toEqual(pools);
      for (const [index, pool] of shown.entries()) {
        const next = shown[index + 1];
        if (next === undefined) continue;
        const keys = keysCompared(pool, next, order);
        expect(keys).toBeLessThanOrEqual(0);
        if (keys === 0) expect(pool.given).toBeLessThan(next.given);
      }
    },
  );
});
