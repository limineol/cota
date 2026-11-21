import { Effect, Option, Schema } from "effect";
import type * as Price from "#shared/03-domain/price.ts";
import type * as Usage from "#shared/03-domain/usage.ts";

export const Cost = Schema.BigInt.check(
  Schema.isGreaterThanOrEqualToBigInt(0n),
);
export type Cost = typeof Cost.Type;

/**
 * Gives each class's tokens times its rate, summed, at the rates of the
 * highest tier whose threshold the whole prompt is over with a missing cache
 * rate filled in, and no cost without a price (C1 to C6).
 */
// biome-ignore lint/correctness/useYield: Effect.fn takes a generator, and the arithmetic needs nothing to yield.
export const of = Effect.fn("Cost.of")(function* (
  usage: Usage.Usage,
  price: Option.Option<Price.Price>,
): Effect.fn.Return<Option.Option<Cost>> {
  if (Option.isNone(price)) return Option.none();
  const rates = filled(ratesFor(promptOf(usage), price.value));
  return Option.some(
    BigInt(usage.input) * rates.input +
      BigInt(usage.cacheRead) * rates.cacheRead +
      BigInt(usage.cacheWriteShort) * rates.cacheWriteShort +
      BigInt(usage.cacheWriteLong) * rates.cacheWriteLong +
      BigInt(usage.output) * rates.output,
  );
});

/** Every class's rate, as a cost is worked out at. */
export type FilledRates = Required<Price.Rates>;

/** A price whose base and tiers have every class's rate. */
export interface FilledPrice {
  readonly base: FilledRates;
  readonly tiers: ReadonlyArray<{
    readonly threshold: number;
    readonly rates: FilledRates;
  }>;
}

/**
 * Fills in a missing cache rate: `cacheRead` and `cacheWriteShort` take the
 * `input` rate, and `cacheWriteLong` the `cacheWriteShort` rate after that.
 */
export const filled = (rates: Price.Rates): FilledRates => {
  const cacheWriteShort = rates.cacheWriteShort ?? rates.input;
  return {
    input: rates.input,
    cacheRead: rates.cacheRead ?? rates.input,
    cacheWriteShort,
    cacheWriteLong: rates.cacheWriteLong ?? cacheWriteShort,
    output: rates.output,
  };
};

/** A price with every rate of its base and its tiers filled in, as `filled` does. */
export const filledPrice = (price: Price.Price): FilledPrice => ({
  base: filled(price.base),
  tiers: price.tiers.map(({ threshold, rates }) => ({
    threshold,
    rates: filled(rates),
  })),
});

const promptOf = (usage: Usage.Usage): bigint =>
  BigInt(usage.input) +
  BigInt(usage.cacheRead) +
  BigInt(usage.cacheWriteShort) +
  BigInt(usage.cacheWriteLong);

const ratesFor = (prompt: bigint, price: Price.Price): Price.Rates => {
  let rates = price.base;
  for (const tier of price.tiers) {
    if (prompt > BigInt(tier.threshold)) rates = tier.rates;
  }
  return rates;
};
