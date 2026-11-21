import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Schema } from "effect";
import type * as Price from "#shared/03-domain/price.ts";
import * as Prices from "./prices.ts";

const Rate = Schema.optionalKey(Prices.RateFromDollars);

const ModelsDevRates = Schema.Struct({
  input: Rate,
  output: Rate,
  cache_read: Rate,
  cache_write: Rate,
});
type ModelsDevRates = typeof ModelsDevRates.Type;

const ModelsDevCost = Schema.Struct({
  ...ModelsDevRates.fields,
  tiers: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        ...ModelsDevRates.fields,
        tier: Schema.Struct({ type: Schema.String, size: Schema.Int }),
      }),
    ),
  ),
  context_over_200k: Schema.optionalKey(ModelsDevRates),
});
type ModelsDevCost = typeof ModelsDevCost.Type;

const ModelsDev = Schema.Record(Schema.String, Schema.Unknown);

const ModelsDevProvider = Schema.Struct({
  models: Schema.Record(
    Schema.String,
    Schema.Struct({
      name: Schema.optionalKey(Schema.String),
      cost: Schema.optionalKey(Schema.NullOr(ModelsDevCost)),
      limit: Schema.optionalKey(
        Schema.NullOr(
          Schema.Struct({
            context: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
            output: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
          }),
        ),
      ),
      modalities: Schema.optionalKey(
        Schema.NullOr(
          Schema.Struct({
            input: Schema.optionalKey(
              Schema.NullOr(Schema.Array(Schema.String)),
            ),
          }),
        ),
      ),
    }),
  ),
});
type ModelsDevModel = (typeof ModelsDevProvider.Type)["models"][string];
const decodeProvider = Schema.decodeUnknownSync(ModelsDevProvider);

const CuratedRates = Schema.Struct({
  input: Rate,
  output: Rate,
  cacheRead: Rate,
  cacheWriteShort: Rate,
  cacheWriteLong: Rate,
});
type CuratedRates = typeof CuratedRates.Type;

const Addition = Schema.Struct({
  list: Schema.String,
  model: Schema.String,
  serviceTier: Schema.optionalKey(Schema.String),
  source: Schema.NonEmptyString,
  base: Schema.optionalKey(CuratedRates),
  contextTokens: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
  outputTokens: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
  imageInput: Schema.optionalKey(Schema.Boolean),
  tiers: Schema.optionalKey(
    Schema.Array(Schema.Struct({ over: Schema.Int, rates: CuratedRates })),
  ),
});
type Addition = typeof Addition.Type;

const Curated = Schema.Struct({
  about: Schema.String,
  additions: Schema.Array(Addition),
});

const providers: Readonly<Record<string, string>> = {
  anthropic: "anthropic",
  openai: "openai",
  "opencode-go": "opencode-go",
  zai: "zai",
};

type Fact = "contextTokens" | "outputTokens" | "imageInput";
const facts: ReadonlyArray<Fact> = [
  "contextTokens",
  "outputTokens",
  "imageInput",
];

interface Facts {
  contextTokens?: number;
  outputTokens?: number;
  imageInput?: boolean;
}

interface Building extends Facts {
  readonly name?: string;
  price: Price.Price;
  readonly serviceTiers: Record<string, Price.Price>;
}

const here = (name: string) => fileURLToPath(new URL(name, import.meta.url));

const limitOf = (tokens: number | null | undefined): number | undefined =>
  tokens !== undefined &&
  tokens !== null &&
  Number.isSafeInteger(tokens) &&
  tokens > 0
    ? tokens
    : undefined;

const factsOf = (model: ModelsDevModel): Facts => {
  const context = limitOf(model.limit?.context);
  const output = limitOf(model.limit?.output);
  const input = model.modalities?.input;
  return {
    ...(context === undefined ? {} : { contextTokens: context }),
    ...(output === undefined ? {} : { outputTokens: output }),
    ...(input === undefined || input === null
      ? {}
      : { imageInput: input.includes("image") }),
  };
};

const ratesOf = (wire: ModelsDevRates): Price.Rates | undefined => {
  if (wire.input === undefined || wire.output === undefined) return undefined;
  return {
    input: wire.input,
    output: wire.output,
    ...(wire.cache_read === undefined ? {} : { cacheRead: wire.cache_read }),
    ...(wire.cache_write === undefined
      ? {}
      : { cacheWriteShort: wire.cache_write }),
  };
};

const contextTiersOf = (cost: ModelsDevCost) => {
  if (cost.tiers !== undefined) {
    return cost.tiers.filter(({ tier }) => tier.type === "context");
  }
  if (cost.context_over_200k === undefined) return [];
  return [
    { ...cost.context_over_200k, tier: { type: "context", size: 200000 } },
  ];
};

const tiersOf = (cost: ModelsDevCost): Array<Price.Tier> =>
  contextTiersOf(cost).flatMap((tier) => {
    const rates = ratesOf(tier);
    return rates === undefined ? [] : [{ threshold: tier.tier.size, rates }];
  });

const merged = (
  base: Price.Rates,
  rates: CuratedRates,
  where: string,
): Price.Rates => {
  for (const name of Object.keys(rates)) {
    if (name in base) {
      throw new Error(
        `${where} adds ${name}, which models.dev already gives; remove it from curated.json`,
      );
    }
  }
  return { ...base, ...rates };
};

const fullRates = (rates: CuratedRates, where: string): Price.Rates => {
  const { input, output, ...cache } = rates;
  if (input === undefined || output === undefined) {
    throw new Error(`${where} needs input and output rates`);
  }
  return { input, output, ...cache };
};

const addFacts = (model: Building, addition: Addition, where: string) => {
  for (const fact of facts) {
    if (addition[fact] !== undefined && model[fact] !== undefined) {
      throw new Error(
        `${where} adds ${fact}, which models.dev already gives; remove it from curated.json`,
      );
    }
  }
  if (addition.contextTokens !== undefined) {
    model.contextTokens = addition.contextTokens;
  }
  if (addition.outputTokens !== undefined) {
    model.outputTokens = addition.outputTokens;
  }
  if (addition.imageInput !== undefined) {
    model.imageInput = addition.imageInput;
  }
};

const apply = (
  lists: Record<string, Record<string, Building>>,
  addition: Addition,
) => {
  const where = `the curated addition for ${addition.list}/${addition.model}${addition.serviceTier === undefined ? "" : ` (${addition.serviceTier})`}`;
  const model = lists[addition.list]?.[addition.model];
  if (model === undefined) {
    throw new Error(`${where} names a model models.dev does not list`);
  }
  if (addition.serviceTier !== undefined) {
    if (facts.some((fact) => addition[fact] !== undefined)) {
      throw new Error(
        `${where} states a model's limits or image input, which belong to the model, not to a service tier`,
      );
    }
    model.serviceTiers[addition.serviceTier] = {
      base: fullRates(addition.base ?? {}, where),
      tiers: (addition.tiers ?? []).map(({ over, rates }) => ({
        threshold: over,
        rates: fullRates(rates, where),
      })),
    };
    return;
  }
  for (const { over } of addition.tiers ?? []) {
    if (!model.price.tiers.some(({ threshold }) => threshold === over)) {
      throw new Error(
        `${where} has a tier over ${over}, which models.dev does not`,
      );
    }
  }
  addFacts(model, addition, where);
  model.price = {
    base: merged(model.price.base, addition.base ?? {}, where),
    tiers: model.price.tiers.map((tier) => {
      const added = addition.tiers?.find(({ over }) => over === tier.threshold);
      return added === undefined
        ? tier
        : { ...tier, rates: merged(tier.rates, added.rates, where) };
    }),
  };
};

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: { from: { type: "string" } },
});
const source = values.from ?? "https://models.dev/api.json";
const text =
  values.from === undefined
    ? await fetch(source, {
        headers: { "user-agent": "cota-prices-update" },
      }).then((response) => {
        if (!response.ok) {
          throw new Error(`${source} answered ${response.status}`);
        }
        return response.text();
      })
    : readFileSync(values.from, "utf8");
const modelsDev = Schema.decodeSync(Schema.fromJsonString(ModelsDev))(text);
const curated = Schema.decodeSync(Schema.fromJsonString(Curated))(
  readFileSync(here("curated.json"), "utf8"),
);

const lists: Record<string, Record<string, Building>> = {};
for (const [list, provider] of Object.entries(providers)) {
  if (!(provider in modelsDev))
    throw new Error(`models.dev has no ${provider}`);
  const { models } = decodeProvider(modelsDev[provider]);
  const priced: Record<string, Building> = {};
  for (const [id, model] of Object.entries(models)) {
    const { name, cost } = model;
    if (cost === undefined || cost === null) continue;
    const base = ratesOf(cost);
    if (base === undefined) continue;
    priced[id] = {
      ...(name === undefined || name === "" ? {} : { name }),
      ...factsOf(model),
      price: { base, tiers: tiersOf(cost) },
      serviceTiers: {},
    };
  }
  lists[list] = priced;
}
for (const addition of curated.additions) apply(lists, addition);

const sorted = <A>(record: Readonly<Record<string, A>>): Record<string, A> =>
  Object.fromEntries(
    Object.entries(record).sort(([one], [other]) => (one < other ? -1 : 1)),
  );

const file: Prices.File = {
  notice:
    "Written by `bun run prices:update` from models.dev (https://models.dev, MIT License, Copyright (c) 2025 models.dev, see LICENSE.models-dev) and the curated additions in curated.json. A model's name, context and output limits in tokens and image input are those models.dev gives it, or curated.json's where it gives none. Rates are picodollars per token. Do not edit by hand.",
  lists: sorted(
    Object.fromEntries(
      Object.entries(lists).map(([name, models]) => [name, sorted(models)]),
    ),
  ),
};
writeFileSync(
  here("prices.json"),
  `${JSON.stringify(Schema.encodeSync(Schema.toCodecJson(Prices.File))(file), null, 2)}\n`,
);
console.log(
  Object.entries(lists)
    .map(([name, models]) => `${name}: ${Object.keys(models).length} models`)
    .join("\n"),
);
