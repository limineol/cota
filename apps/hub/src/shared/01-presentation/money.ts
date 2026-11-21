import { Schema, SchemaTransformation } from "effect";

const picodollarsPerDollar = 10n ** 12n;

/** Dollars as a string with 12 decimals, so no sum is rounded; picodollars inside. */
export const Money = Schema.String.check(
  Schema.isPattern(/^\d+\.\d{12}$/),
).pipe(
  Schema.decodeTo(
    Schema.BigInt,
    SchemaTransformation.transform({
      decode: (dollars) => BigInt(dollars.replace(".", "")),
      encode: (picodollars) =>
        `${picodollars / picodollarsPerDollar}.${(picodollars % picodollarsPerDollar).toString().padStart(12, "0")}`,
    }),
  ),
);
