import { Schema } from "effect";
import { Tokens } from "./usage.ts";

export const Rate = Schema.BigInt.check(
  Schema.isGreaterThanOrEqualToBigInt(0n),
);
export type Rate = typeof Rate.Type;

export const Rates = Schema.Struct({
  input: Rate,
  cacheRead: Schema.optionalKey(Rate),
  cacheWriteShort: Schema.optionalKey(Rate),
  cacheWriteLong: Schema.optionalKey(Rate),
  output: Rate,
});
export type Rates = typeof Rates.Type;

export const Tier = Schema.Struct({ threshold: Tokens, rates: Rates });
export type Tier = typeof Tier.Type;

export const Price = Schema.Struct({
  base: Rates,
  tiers: Schema.Array(Tier).check(
    Schema.makeFilter(
      (tiers) =>
        tiers.every((tier, index) => {
          const below = tiers[index - 1];
          return below === undefined || below.threshold < tier.threshold;
        }) || "tiers are listed with rising thresholds",
    ),
  ),
});
export type Price = typeof Price.Type;
