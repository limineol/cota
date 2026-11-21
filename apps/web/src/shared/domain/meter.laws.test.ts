import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Schema } from "effect";
import { meter, meterBlocks } from "./meter.ts";

const int = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

const used = int(-400, 2400).pipe(
  Arbitrary.map((twentieths) => twentieths / 20),
);
const elapsed = int(-200, 1200).pipe(
  Arbitrary.map((thousandths) => thousandths / 1000),
);
const window = Arbitrary.all({
  usedPercent: used,
  elapsed,
  placed: int(0, 4),
}).pipe(
  Arbitrary.map(({ usedPercent, elapsed, placed }) => ({
    usedPercent,
    elapsed: placed === 0 ? null : elapsed,
  })),
);

const held = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

describe("a meter's fill", () => {
  it.prop(
    "V5: a meter has twenty blocks: full ones, then at most one partial, then empty ones",
    { window },
    ({ window }) => {
      const { blocks } = meter(window);
      expect(blocks).toHaveLength(meterBlocks);
      const full = blocks.filter((block) => block === 1).length;
      const partial = blocks.filter((block) => block > 0 && block < 1).length;
      expect(partial).toBeLessThanOrEqual(1);
      blocks.forEach((block, index) => {
        expect(block).toBeGreaterThanOrEqual(0);
        expect(block).toBeLessThanOrEqual(1);
        if (index < full) expect(block).toBe(1);
        if (index > full) expect(block).toBe(0);
      });
    },
  );

  it.prop(
    "V6: the blocks' fills add up to the used percentage held between 0 and 100, over 5",
    { window },
    ({ window }) => {
      const { blocks } = meter(window);
      const filled = blocks.reduce((sum, block) => sum + block, 0);
      expect(filled).toBeCloseTo(held(window.usedPercent, 0, 100) / 5, 9);
    },
  );

  it.prop(
    "V8: a meter is near its limit from 80% used and full at 100%",
    { window },
    ({ window }) => {
      const expected =
        window.usedPercent >= 100
          ? "full"
          : window.usedPercent >= 80
            ? "near"
            : "normal";
      expect(meter(window).severity).toBe(expected);
    },
  );

  it.prop(
    "V9: the pace marker stands at the share of the window gone, held between 0 and 1, and there is none without one",
    { window },
    ({ window }) => {
      expect(meter(window).pace).toBe(
        window.elapsed === null ? null : held(window.elapsed, 0, 1),
      );
    },
  );
});
