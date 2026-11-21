import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as Price from "./price.ts";
import * as Usage from "./usage.ts";

const nothing: Usage.Usage = {
  input: 0,
  cacheRead: 0,
  cacheWriteShort: 0,
  cacheWriteLong: 0,
  output: 0,
};

const sonnet = { input: 3_000_000n, output: 15_000_000n };

describe("the schemas", () => {
  it("refuse tokens that are negative or not whole, and negative rates", () => {
    expect([
      Schema.is(Usage.Usage)({ ...nothing, input: -1 }),
      Schema.is(Usage.Usage)({ ...nothing, output: 0.5 }),
      Schema.is(Price.Rates)({ input: -1n, output: 0n }),
      Schema.is(Usage.Usage)(nothing),
      Schema.is(Price.Rates)({ input: 0n, output: 0n }),
    ]).toEqual([false, false, false, true, true]);
  });

  it("refuse tiers that are not listed with rising thresholds", () => {
    const tier = { threshold: 100, rates: sonnet };

    expect(
      [[tier, tier], [{ ...tier, threshold: 200 }, tier], [tier]].map((tiers) =>
        Schema.is(Price.Price)({ base: sonnet, tiers }),
      ),
    ).toEqual([false, false, true]);
  });
});
