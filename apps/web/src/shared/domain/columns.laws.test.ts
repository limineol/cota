import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Schema } from "effect";
import { type Bucket, merge, stack, tallest } from "./columns.ts";

const int = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

const value = Arbitrary.all({
  digits: int(0, 7),
  value: int(0, 10_000_000),
}).pipe(Arbitrary.map(({ digits, value }) => value % 10 ** digits));
const least = int(-3, 2).pipe(Arbitrary.map((power) => 10 ** power));
const buckets = Arbitrary.all({ width: int(1, 5), count: int(0, 40) }).pipe(
  Arbitrary.flatMap(({ width, count }) =>
    Arbitrary.array(
      Arbitrary.array(value, { minLength: width, maxLength: width }),
      {
        minLength: count,
        maxLength: count,
      },
    ),
  ),
  Arbitrary.map(
    (columns): ReadonlyArray<Bucket> =>
      columns.map((parts, index) => ({ start: index, end: index + 1, parts })),
  ),
);

const sum = (values: ReadonlyArray<number>) =>
  values.reduce((total, value) => total + value, 0);

const isNice = (unit: number) => {
  const power = 10 ** Math.floor(Math.log10(unit) + 1e-9);
  return [1, 2, 5, 10].some(
    (step) => Math.abs(unit - step * power) <= 1e-9 * unit,
  );
};

const smallerThan = (unit: number) => {
  const power = 10 ** Math.floor(Math.log10(unit) + 1e-9);
  const step = Math.round(unit / power);
  return step === 1 ? power / 2 : step === 2 ? power : 2 * power;
};

describe("block columns", () => {
  it.prop(
    "V10: the unit is the smallest of 1, 2 and 5 × 10ⁿ, no less than the least unit given, of which the tallest column's total is at most fourteen",
    { buckets, least },
    ({ buckets, least }) => {
      const { unit } = stack(buckets, least);
      const highest = Math.max(0, ...buckets.map(({ parts }) => sum(parts)));
      expect(isNice(unit)).toBe(true);
      expect(unit).toBeGreaterThanOrEqual(least);
      expect(highest / unit).toBeLessThanOrEqual(tallest + 1e-9);
      const smaller = smallerThan(unit);
      if (smaller >= least * (1 - 1e-9)) {
        expect(highest / smaller).toBeGreaterThan(tallest);
      }
    },
  );

  it.prop(
    "V11: a column's blocks are its total over the unit, rounded, and at least one when its total is above zero",
    { buckets, least },
    ({ buckets, least }) => {
      const { unit, columns } = stack(buckets, least);
      columns.forEach((column) => {
        const rounded = Math.round(column.total / unit);
        expect(column.blocks).toBe(column.total > 0 ? Math.max(1, rounded) : 0);
      });
    },
  );

  it.prop(
    "V12: a column's parts' blocks sum to its blocks, and each is the part's own total over the unit rounded down or up",
    { buckets, least },
    ({ buckets, least }) => {
      const { unit, columns } = stack(buckets, least);
      columns.forEach((column) => {
        expect(sum(column.parts)).toBe(column.blocks);
        column.bucket.parts.forEach((part, index) => {
          const exact = part / unit;
          expect(column.parts[index]).toBeGreaterThanOrEqual(Math.floor(exact));
          expect(column.parts[index]).toBeLessThanOrEqual(Math.ceil(exact));
        });
      });
    },
  );

  it.prop(
    "V13: merging to fit leaves at most the columns that fit, each over adjacent buckets in runs of one length, and keeps every part's total",
    { buckets, capacity: int(1, 50) },
    ({ buckets, capacity }) => {
      const merged = merge(buckets, capacity);
      expect(merged.length).toBeLessThanOrEqual(capacity);
      const run = Math.max(1, Math.ceil(buckets.length / capacity));
      merged.forEach((column, index) => {
        expect(column.start).toBe(buckets[index * run]?.start);
        expect(column.end).toBe(
          buckets[Math.min(buckets.length, (index + 1) * run) - 1]?.end,
        );
      });
      const width = buckets[0]?.parts.length ?? 0;
      for (let part = 0; part < width; part += 1) {
        expect(sum(merged.map(({ parts }) => parts[part] ?? 0))).toBe(
          sum(buckets.map(({ parts }) => parts[part] ?? 0)),
        );
      }
    },
  );
});
