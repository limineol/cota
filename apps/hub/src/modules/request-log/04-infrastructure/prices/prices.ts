import {
  Effect,
  HashMap,
  Layer,
  Option,
  Schema,
  SchemaIssue,
  SchemaTransformation,
} from "effect";
import {
  type PricedModel,
  PricedModels,
} from "#modules/request-log/02-application/interfaces/priced-models.ts";
import {
  type Asked,
  Prices,
} from "#modules/request-log/02-application/interfaces/prices.ts";
import type { PoolId } from "#shared/03-domain/ids.ts";
import type * as Pool from "#shared/03-domain/pool.entity.ts";
import * as Price from "#shared/03-domain/price.ts";
import { compareText } from "#shared/03-domain/text.ts";
import shipped from "./prices.json" with { type: "json" };

const TokenLimit = Schema.Int.check(Schema.isGreaterThan(0));

export const Model = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  contextTokens: Schema.optionalKey(TokenLimit),
  outputTokens: Schema.optionalKey(TokenLimit),
  imageInput: Schema.optionalKey(Schema.Boolean),
  price: Price.Price,
  serviceTiers: Schema.Record(Schema.String, Price.Price),
});
export type Model = typeof Model.Type;

export const PriceList = Schema.Record(Schema.String, Model);
export type PriceList = typeof PriceList.Type;

export const File = Schema.Struct({
  notice: Schema.String,
  lists: Schema.Record(Schema.String, PriceList),
});
export type File = typeof File.Type;

export const decodeFile = Schema.decodeUnknownSync(Schema.toCodecJson(File));

/** The price lists the hub ships, by name. */
export const lists: Readonly<Record<string, PriceList>> =
  decodeFile(shipped).lists;

export const listNames: ReadonlyArray<string> = Object.keys(lists).sort();

const firstNamesIn = (
  lists: Readonly<Record<string, PriceList>>,
): ReadonlyMap<string, string> => {
  const names = new Map<string, string>();
  for (const list of Object.keys(lists).sort()) {
    for (const [id, { name }] of Object.entries(lists[list] ?? {})) {
      if (name !== undefined && !names.has(id)) names.set(id, name);
    }
  }
  return names;
};

/**
 * The name models.dev gives each model of the shipped price lists, by model
 * id; when two lists name one id differently, the first list's by name.
 */
export const modelNames: ReadonlyMap<string, string> = firstNamesIn(lists);

const decimal = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/;

/**
 * Turns a price in dollars per million tokens into a rate in picodollars per
 * token, exactly: nothing when the price is negative, not finite, or finer
 * than a picodollar per token.
 */
export const rateOf = (dollarsPerMillion: number): Option.Option<bigint> => {
  const [, whole, fraction = "", exponent = "0"] =
    decimal.exec(String(dollarsPerMillion)) ?? [];
  if (whole === undefined) return Option.none();
  const shift = Number(exponent) - fraction.length + 6;
  const digits = BigInt(whole + fraction);
  if (shift >= 0) return Option.some(digits * 10n ** BigInt(shift));
  const divisor = 10n ** BigInt(-shift);
  return digits % divisor === 0n
    ? Option.some(digits / divisor)
    : Option.none();
};

/** A rate written in dollars per million tokens, as price lists and the configuration give it. */
export const RateFromDollars = Schema.Finite.pipe(
  Schema.decodeTo(
    Price.Rate,
    SchemaTransformation.transformEffect({
      decode: (dollars, options) =>
        Effect.fromOption(rateOf(dollars)).pipe(
          Effect.mapError(
            () =>
              new SchemaIssue.InvalidValue(
                {
                  message:
                    "dollars per million tokens: zero or more, to at most six decimal places",
                },
                dollars,
                options,
              ),
          ),
        ),
      encode: (rate) => Effect.succeed(Number(rate) / 1_000_000),
    }),
  ),
);

const trailingDate = /-\d{8}$/;

const idsOf = (asked: Asked): ReadonlyArray<string> => {
  const ids: Array<string> = [];
  for (const model of [asked.servedModel, asked.model]) {
    if (model === "") continue;
    ids.push(model);
    if (asked.protocol === "anthropic-messages" && trailingDate.test(model)) {
      ids.push(model.replace(trailingDate, ""));
    }
  }
  return [...new Set(ids)];
};

// A model id and a service tier are whatever a client or provider sent, and
// `record["constructor"]` is a function on any object.
const ownOf = <A>(
  record: Readonly<Record<string, A>>,
  key: string,
): Option.Option<A> =>
  Object.hasOwn(record, key)
    ? Option.fromUndefinedOr(record[key])
    : Option.none();

/**
 * Finds a request's price: by the model that served it, else the model asked
 * for, and an Anthropic id also without its trailing date; in the pool's own
 * prices first, then in its price list, at the rates of the service tier the
 * request ran in when the list has them.
 */
export const priceOf = (
  pool: Pick<Pool.Pool, "prices" | "ownPrices">,
  asked: Asked,
): Option.Option<Price.Price> => {
  const list = Option.flatMap(pool.prices, (name) => ownOf(lists, name));
  for (const id of idsOf(asked)) {
    const own = ownOf(pool.ownPrices, id);
    if (Option.isSome(own)) return own;
    const model = Option.flatMap(list, (models) => ownOf(models, id));
    if (Option.isSome(model)) {
      return Option.orElseSome(
        ownOf(model.value.serviceTiers, asked.serviceTier),
        () => model.value.price,
      );
    }
  }
  return Option.none();
};

export const layer = (
  pools: HashMap.HashMap<PoolId, Pool.Pool>,
): Layer.Layer<Prices> =>
  Layer.succeed(
    Prices,
    Prices.of({
      of: (asked) =>
        Option.flatMap(HashMap.get(pools, asked.pool), (pool) =>
          priceOf(pool, asked),
        ),
    }),
  );

/**
 * The models of a pool's price list and of its own prices, in order of id,
 * each at the pool's own price when it has one, else at its list's.
 */
export const modelsOf = (
  pool: Pick<Pool.Pool, "prices" | "ownPrices">,
): ReadonlyArray<PricedModel> => {
  const models = new Map<string, PricedModel>();
  const list = Option.flatMap(pool.prices, (name) => ownOf(lists, name));
  for (const [id, model] of Object.entries(
    Option.getOrElse(list, () => ({})),
  )) {
    models.set(id, {
      id,
      contextTokens: Option.fromUndefinedOr(model.contextTokens),
      outputTokens: Option.fromUndefinedOr(model.outputTokens),
      imageInput: Option.fromUndefinedOr(model.imageInput),
      price: model.price,
    });
  }
  for (const [id, price] of Object.entries(pool.ownPrices)) {
    const listed = models.get(id);
    models.set(
      id,
      listed === undefined
        ? {
            id,
            contextTokens: Option.none(),
            outputTokens: Option.none(),
            imageInput: Option.none(),
            price,
          }
        : { ...listed, price },
    );
  }
  return [...models.values()].sort((one, other) =>
    compareText(one.id, other.id),
  );
};

export const pricedModels = (
  pools: HashMap.HashMap<PoolId, Pool.Pool>,
): Layer.Layer<PricedModels> =>
  Layer.succeed(
    PricedModels,
    PricedModels.of({
      of: (pool) =>
        Option.match(HashMap.get(pools, pool), {
          onNone: () => [],
          onSome: modelsOf,
        }),
    }),
  );
