import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Equal, Option, Schema } from "effect";
import * as Price from "#shared/03-domain/price.ts";
import * as Usage from "#shared/03-domain/usage.ts";
import * as Cost from "./cost.ts";

const classes = [
  "input",
  "cacheRead",
  "cacheWriteShort",
  "cacheWriteLong",
  "output",
] as const;

const flag = Arbitrary.schema(Schema.Boolean);
const int = (minimum: number, maximum: number) =>
  Arbitrary.schema(Usage.Tokens.check(Schema.isBetween({ minimum, maximum })));
const tokens = Arbitrary.all({ count: int(1, 20), present: flag }).pipe(
  Arbitrary.map(({ count, present }) => (present ? count : 0)),
);
const usage = Arbitrary.all({
  input: tokens,
  cacheRead: tokens,
  cacheWriteShort: tokens,
  cacheWriteLong: tokens,
  output: tokens,
});
const rate = Arbitrary.schema(
  Price.Rate.check(
    Schema.isBetweenBigInt({ minimum: 0n, maximum: 30_000_000n }),
  ),
);
const rates = Arbitrary.all({
  input: rate,
  cacheRead: rate,
  cacheWriteShort: rate,
  cacheWriteLong: rate,
  output: rate,
  given: Arbitrary.all([flag, flag, flag]),
}).pipe(
  Arbitrary.map(
    ({
      given: [read, short, long],
      cacheRead,
      cacheWriteShort,
      cacheWriteLong,
      ...rates
    }): Price.Rates => ({
      ...rates,
      ...(read ? { cacheRead } : {}),
      ...(short ? { cacheWriteShort } : {}),
      ...(long ? { cacheWriteLong } : {}),
    }),
  ),
);

const tiersAbove = (
  steps: ReadonlyArray<{ readonly gap: number; readonly rates: Price.Rates }>,
): ReadonlyArray<Price.Tier> => {
  let threshold = -1;
  return steps.map(({ gap, rates }) => {
    threshold += gap;
    return { threshold, rates };
  });
};
const steps = (minLength: number) =>
  Arbitrary.array(Arbitrary.all({ gap: int(1, 20), rates }), {
    minLength,
    maxLength: 3,
  });
const priceWith = (minimumTiers: number) =>
  Arbitrary.all({ base: rates, steps: steps(minimumTiers) }).pipe(
    Arbitrary.map(({ base, steps }) =>
      Price.Price.make({ base, tiers: tiersAbove(steps) }),
    ),
  );
const price = priceWith(0);

const promptOf = (usage: Usage.Usage) =>
  usage.input + usage.cacheRead + usage.cacheWriteShort + usage.cacheWriteLong;
const tiersUnder = (price: Price.Price, prompt: number) =>
  price.tiers.filter(({ threshold }) => prompt > threshold);
const ratesAt = (price: Price.Price, prompt: number) =>
  tiersUnder(price, prompt).at(-1)?.rates ?? price.base;
const filledIn = (rates: Price.Rates) => {
  const cacheWriteShort = rates.cacheWriteShort ?? rates.input;
  return {
    input: rates.input,
    cacheRead: rates.cacheRead ?? rates.input,
    cacheWriteShort,
    cacheWriteLong: rates.cacheWriteLong ?? cacheWriteShort,
    output: rates.output,
  };
};
const sum = (left: Usage.Usage, right: Usage.Usage): Usage.Usage => ({
  input: left.input + right.input,
  cacheRead: left.cacheRead + right.cacheRead,
  cacheWriteShort: left.cacheWriteShort + right.cacheWriteShort,
  cacheWriteLong: left.cacheWriteLong + right.cacheWriteLong,
  output: left.output + right.output,
});
const nothing: Usage.Usage = {
  input: 0,
  cacheRead: 0,
  cacheWriteShort: 0,
  cacheWriteLong: 0,
  output: 0,
};

const additive = Arbitrary.all({
  left: usage,
  right: usage,
  base: rates,
  below: Arbitrary.array(Arbitrary.all({ drop: int(1, 30), rates }), {
    maxLength: 2,
  }),
  above: Arbitrary.array(Arbitrary.all({ rise: int(0, 30), rates }), {
    maxLength: 2,
  }),
}).pipe(
  Arbitrary.map(({ left, right, base, below, above }) => {
    const lowest = Math.min(promptOf(left), promptOf(right));
    const together = promptOf(left) + promptOf(right);
    const tiers = [
      ...below.map(({ drop, rates }) => ({ threshold: lowest - drop, rates })),
      ...above.map(({ rise, rates }) => ({
        threshold: together + rise,
        rates,
      })),
    ]
      .filter(({ threshold }) => threshold >= 0)
      .sort((one, other) => one.threshold - other.threshold)
      .filter(
        (tier, index, tiers) => tiers[index - 1]?.threshold !== tier.threshold,
      );
    return { left, right, price: Price.Price.make({ base, tiers }) };
  }),
);

const nearThreshold = Arbitrary.all({
  price: priceWith(1),
  pick: int(0, 2),
  offset: Arbitrary.schema(
    Schema.Int.check(Schema.isBetween({ minimum: -1, maximum: 1 })),
  ),
  cuts: Arbitrary.array(int(0, 100), { minLength: 3, maxLength: 3 }),
  output: tokens,
}).pipe(
  Arbitrary.map(({ price, pick, offset, cuts, output }) => {
    const threshold = price.tiers[pick % price.tiers.length]?.threshold ?? 0;
    const prompt = Math.max(threshold + offset, 0);
    const [first = 0, second = 0, third = 0] = cuts
      .map((cut) => Math.floor((prompt * cut) / 100))
      .sort((one, other) => one - other);
    const usage: Usage.Usage = {
      input: first,
      cacheRead: second - first,
      cacheWriteShort: third - second,
      cacheWriteLong: prompt - third,
      output,
    };
    return { price, threshold, usage };
  }),
);

const raised = (rates: Price.Rates, raise: Price.Rates): Price.Rates => {
  const filled = filledIn(rates);
  const by = filledIn(raise);
  return {
    input: filled.input + by.input,
    cacheRead: filled.cacheRead + by.cacheRead,
    cacheWriteShort: filled.cacheWriteShort + by.cacheWriteShort,
    cacheWriteLong: filled.cacheWriteLong + by.cacheWriteLong,
    output: filled.output + by.output,
  };
};
const risingPrice = Arbitrary.all({ base: rates, steps: steps(0) }).pipe(
  Arbitrary.map(({ base, steps }) => {
    let below = base;
    const tiers = tiersAbove(steps).map(({ threshold, rates }) => {
      below = raised(below, rates);
      return { threshold, rates: below };
    });
    return Price.Price.make({ base, tiers });
  }),
);

const runs = { arbitrary: { runs: 1000 } };

describe("cost laws", () => {
  it.effect.prop(
    "C1: without a price there is no cost, and with a price there always is one",
    { usage, price, priced: flag },
    ({ usage, price, priced }) =>
      Effect.gen(function* () {
        const cost = yield* Cost.of(
          usage,
          priced ? Option.some(price) : Option.none(),
        );
        return Option.isSome(cost) === priced;
      }),
    runs,
  );

  it.effect.prop(
    "C2: usage of zero tokens costs zero",
    { price },
    ({ price }) =>
      Effect.gen(function* () {
        return Equal.equals(
          yield* Cost.of(nothing, Option.some(price)),
          Option.some(0n),
        );
      }),
    runs,
  );

  it.effect.prop(
    "C3: one token of one class, and nothing else, costs that class's rate in the tier that applies, after the fill-in of rule 4",
    { price, tokenClass: Arbitrary.schema(Schema.Literals(classes)) },
    ({ price, tokenClass }) =>
      Effect.gen(function* () {
        const usage = { ...nothing, [tokenClass]: 1 };
        return Equal.equals(
          yield* Cost.of(usage, Option.some(price)),
          Option.some(filledIn(ratesAt(price, promptOf(usage)))[tokenClass]),
        );
      }),
    runs,
  );

  it.effect.prop(
    "C4: when two usages and their sum all fall under the same rates, the cost of the sum is the sum of the costs",
    { scene: additive },
    ({ scene: { left, right, price } }) =>
      Effect.gen(function* () {
        const costOf = (usage: Usage.Usage) =>
          Cost.of(usage, Option.some(price));
        const separately = Option.all([
          yield* costOf(left),
          yield* costOf(right),
        ]).pipe(Option.map(([left, right]) => left + right));
        return Equal.equals(yield* costOf(sum(left, right)), separately);
      }),
    runs,
  );

  it.effect.prop(
    "C5: the rates used are those of the highest tier whose threshold the prompt is over, and cached tokens count towards the prompt",
    { scene: nearThreshold },
    ({ scene: { price, usage } }) =>
      Effect.gen(function* () {
        const flat = { base: ratesAt(price, promptOf(usage)), tiers: [] };
        return Equal.equals(
          yield* Cost.of(usage, Option.some(price)),
          yield* Cost.of(usage, Option.some(flat)),
        );
      }),
    runs,
  );

  it.effect.prop(
    "C6: when no tier lowers any rate, adding tokens to any class never lowers the cost",
    { price: risingPrice, usage, added: usage },
    ({ price, usage, added }) =>
      Effect.gen(function* () {
        const before = yield* Cost.of(usage, Option.some(price));
        const after = yield* Cost.of(sum(usage, added), Option.some(price));
        return (
          Option.isSome(before) &&
          Option.isSome(after) &&
          after.value >= before.value
        );
      }),
    runs,
  );

  it.effect(
    "a fixed sample of the generated cases reaches the tiers, and both sides of a threshold and the threshold itself",
    () =>
      Effect.gen(function* () {
        const share = (count: number, of: ReadonlyArray<unknown>): number =>
          (100 * count) / of.length;
        const additiveScenes = yield* Arbitrary.sampleEffect(additive, {
          count: 2000,
          seed: "coverage",
        });
        const underATier = additiveScenes.filter(
          ({ left, price }) => tiersUnder(price, promptOf(left)).length > 0,
        ).length;
        const nearScenes = yield* Arbitrary.sampleEffect(nearThreshold, {
          count: 2000,
          seed: "coverage",
        });
        const side = (side: number) =>
          nearScenes.filter(
            ({ threshold, usage }) =>
              Math.sign(promptOf(usage) - threshold) === side,
          ).length;
        const cachedTipsIt = nearScenes.filter(
          ({ price, usage }) =>
            tiersUnder(price, usage.input).length !==
            tiersUnder(price, promptOf(usage)).length,
        ).length;
        const shares = {
          additiveUnderATier: share(underATier, additiveScenes),
          additiveAtBaseRates: share(
            additiveScenes.length - underATier,
            additiveScenes,
          ),
          belowAThreshold: share(side(-1), nearScenes),
          atAThreshold: share(side(0), nearScenes),
          overAThreshold: share(side(1), nearScenes),
          cachedTokensChangeTheTier: share(cachedTipsIt, nearScenes),
        };

        expect(
          Object.entries(shares).filter(([, percent]) => percent < 5),
        ).toEqual([]);
      }),
  );
});
