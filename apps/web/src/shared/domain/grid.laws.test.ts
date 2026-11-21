import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Schema } from "effect";
import { drawnRows } from "./grid.ts";

const int = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

const view = Arbitrary.all({
  rows: int(0, 400),
  rowHeight: int(1, 40),
  height: int(0, 900),
  overscan: int(0, 12),
  scroll: int(-60, 1000),
}).pipe(
  Arbitrary.map(({ rows, rowHeight, height, overscan, scroll }) => ({
    rows,
    rowHeight,
    height,
    overscan,
    top: Math.round((scroll / 1000) * (rows * rowHeight + 60)) - 30,
  })),
);

describe("the rows a virtualised grid draws", () => {
  it.prop(
    "V33: every row in view is drawn, and at most the rows in view and the overscan on each side, all of them rows there are",
    { view },
    ({ view }) => {
      const { top, height, rowHeight, rows, overscan } = view;
      const { first, last } = drawnRows(view);
      expect(0 <= first && first <= last && last <= rows).toBe(true);
      const inView = Array.from({ length: rows }, (_, row) => row).filter(
        (row) => row * rowHeight < top + height && (row + 1) * rowHeight > top,
      );
      for (const row of inView) {
        expect(first <= row && row < last).toBe(true);
      }
      const from = inView[0];
      const to = inView.at(-1);
      if (from === undefined || to === undefined) {
        expect(last - first).toBeLessThanOrEqual(2 * overscan);
      } else {
        expect(first).toBeGreaterThanOrEqual(from - overscan);
        expect(last).toBeLessThanOrEqual(to + 1 + overscan);
      }
    },
  );
});
