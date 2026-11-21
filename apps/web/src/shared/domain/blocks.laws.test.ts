import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Schema } from "effect";
import { apportion, mixBlocks } from "./blocks.ts";

const int = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

const part = Arbitrary.all({
  digits: int(0, 6),
  value: int(0, 1_000_000),
}).pipe(Arbitrary.map(({ digits, value }) => value % 10 ** digits));
const parts = Arbitrary.array(part, { minLength: 1, maxLength: 8 });
const blocks = Arbitrary.all({ any: int(1, 60), mix: int(0, 1) }).pipe(
  Arbitrary.map(({ any, mix }) => (mix === 1 ? mixBlocks : any)),
);

const sum = (values: ReadonlyArray<number>) =>
  values.reduce((total, value) => total + value, 0);

describe("apportioning blocks", () => {
  it.prop(
    "V1: when the total is above zero, the parts' blocks sum to the blocks given",
    { parts, blocks },
    ({ parts, blocks }) => {
      if (sum(parts) === 0) return;
      expect(sum(apportion(parts, blocks))).toBe(blocks);
    },
  );

  it.prop(
    "V2: a part's blocks are its exact share of the blocks rounded down or up, so a part of zero gets none",
    { parts, blocks },
    ({ parts, blocks }) => {
      const total = sum(parts);
      if (total === 0) return;
      const given = apportion(parts, blocks);
      parts.forEach((part, index) => {
        const exact = (part * blocks) / total;
        expect(given[index]).toBeGreaterThanOrEqual(Math.floor(exact));
        expect(given[index]).toBeLessThanOrEqual(Math.ceil(exact));
      });
    },
  );

  it.prop(
    "V3: a larger part never gets fewer blocks than a smaller one",
    { parts, blocks },
    ({ parts, blocks }) => {
      const given = apportion(parts, blocks);
      parts.forEach((larger, i) => {
        parts.forEach((smaller, j) => {
          if (larger > smaller) {
            expect(given[i]).toBeGreaterThanOrEqual(given[j] ?? 0);
          }
        });
      });
    },
  );

  it.prop(
    "V4: with a total of zero, no part gets a block",
    { count: int(0, 8), blocks },
    ({ count, blocks }) => {
      expect(
        apportion(
          Array.from({ length: count }, () => 0),
          blocks,
        ),
      ).toEqual(Array.from({ length: count }, () => 0));
    },
  );
});
