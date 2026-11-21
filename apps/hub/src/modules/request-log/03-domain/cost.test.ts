import { describe, expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import * as Price from "#shared/03-domain/price.ts";
import type * as Usage from "#shared/03-domain/usage.ts";
import * as Cost from "./cost.ts";

const nothing: Usage.Usage = {
  input: 0,
  cacheRead: 0,
  cacheWriteShort: 0,
  cacheWriteLong: 0,
  output: 0,
};

const flat = (base: Price.Rates) =>
  Option.some(Price.Price.make({ base, tiers: [] }));

const sonnet = { input: 3_000_000n, output: 15_000_000n };

const longContext = Option.some(
  Price.Price.make({
    base: { ...sonnet, cacheRead: 300_000n },
    tiers: [
      {
        threshold: 200_000,
        rates: {
          input: 6_000_000n,
          cacheRead: 600_000n,
          output: 22_500_000n,
        },
      },
    ],
  }),
);

describe("of", () => {
  it.effect("gives no cost without a price", () =>
    Effect.gen(function* () {
      expect(
        yield* Cost.of({ ...nothing, input: 1000 }, Option.none()),
      ).toEqual(Option.none());
    }),
  );

  it.effect(
    "prices a million input tokens at 4 dollars per million as 4 million million picodollars",
    () =>
      Effect.gen(function* () {
        expect(
          yield* Cost.of(
            { ...nothing, input: 1_000_000 },
            flat({ input: 4_000_000n, output: 20_000_000n }),
          ),
        ).toEqual(Option.some(4_000_000_000_000n));
      }),
  );

  it.effect("adds each class's tokens times its rate", () =>
    Effect.gen(function* () {
      expect(
        yield* Cost.of(
          {
            input: 1234,
            cacheRead: 10_000,
            cacheWriteShort: 100,
            cacheWriteLong: 10,
            output: 567,
          },
          flat({
            ...sonnet,
            cacheRead: 300_000n,
            cacheWriteShort: 3_750_000n,
            cacheWriteLong: 6_000_000n,
          }),
        ),
      ).toEqual(
        Option.some(
          3_702_000_000n +
            3_000_000_000n +
            375_000_000n +
            60_000_000n +
            8_505_000_000n,
        ),
      );
    }),
  );

  it.effect(
    "prices the largest usage exactly, past what a float can hold",
    () =>
      Effect.gen(function* () {
        expect(
          yield* Cost.of(
            { ...nothing, input: Number.MAX_SAFE_INTEGER },
            flat({ input: 4_000_000n, output: 20_000_000n }),
          ),
        ).toEqual(Option.some(36_028_797_018_963_964_000_000n));
      }),
  );
});

describe("a missing cache rate", () => {
  it.effect("bills cache reads at the input rate", () =>
    Effect.gen(function* () {
      expect(
        yield* Cost.of({ ...nothing, cacheRead: 10 }, flat(sonnet)),
      ).toEqual(Option.some(30_000_000n));
    }),
  );

  it.effect(
    "bills short cache writes at the input rate, not the cache read rate",
    () =>
      Effect.gen(function* () {
        expect(
          yield* Cost.of(
            { ...nothing, cacheWriteShort: 10 },
            flat({ ...sonnet, cacheRead: 300_000n }),
          ),
        ).toEqual(Option.some(30_000_000n));
      }),
  );

  it.effect("bills long cache writes at the short cache write rate", () =>
    Effect.gen(function* () {
      expect(
        yield* Cost.of(
          { ...nothing, cacheWriteLong: 10 },
          flat({ ...sonnet, cacheWriteShort: 3_750_000n }),
        ),
      ).toEqual(Option.some(37_500_000n));
    }),
  );

  it.effect(
    "bills long cache writes at the input rate when neither cache write rate is given",
    () =>
      Effect.gen(function* () {
        expect(
          yield* Cost.of({ ...nothing, cacheWriteLong: 10 }, flat(sonnet)),
        ).toEqual(Option.some(30_000_000n));
      }),
  );
});

describe("tiers", () => {
  it.effect("keep the base rates for a prompt of exactly the threshold", () =>
    Effect.gen(function* () {
      expect(
        yield* Cost.of(
          { ...nothing, input: 200_000, output: 1000 },
          longContext,
        ),
      ).toEqual(Option.some(615_000_000_000n));
    }),
  );

  it.effect("apply from one token over the threshold", () =>
    Effect.gen(function* () {
      expect(
        yield* Cost.of(
          { ...nothing, input: 200_001, output: 1000 },
          longContext,
        ),
      ).toEqual(Option.some(1_222_506_000_000n));
    }),
  );

  it.effect("count cached tokens towards the threshold", () =>
    Effect.gen(function* () {
      expect(
        yield* Cost.of(
          { ...nothing, input: 1, cacheRead: 200_000 },
          longContext,
        ),
      ).toEqual(Option.some(120_006_000_000n));
    }),
  );

  it.effect("apply the highest tier the prompt is over", () =>
    Effect.gen(function* () {
      const price = Price.Price.make({
        base: { input: 1n, output: 1n },
        tiers: [
          { threshold: 100, rates: { input: 2n, output: 2n } },
          { threshold: 200, rates: { input: 3n, output: 3n } },
        ],
      });

      expect([
        yield* Cost.of({ ...nothing, input: 100 }, Option.some(price)),
        yield* Cost.of({ ...nothing, input: 200 }, Option.some(price)),
        yield* Cost.of({ ...nothing, input: 201 }, Option.some(price)),
      ]).toEqual([Option.some(100n), Option.some(400n), Option.some(603n)]);
    }),
  );
});
