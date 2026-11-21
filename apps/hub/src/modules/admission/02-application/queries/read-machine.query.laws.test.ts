import { describe, expect, it } from "@effect/vitest";
import {
  Arbitrary,
  DateTime,
  Effect,
  HashMap,
  Layer,
  Option,
  Redacted,
  Schema,
} from "effect";
import * as Admission from "#modules/admission/03-domain/admission.ts";
import { ListDisplayNames } from "#modules/display-names/02-application/queries/list-display-names.query.ts";
import * as PriceLists from "#modules/request-log/04-infrastructure/prices/prices.ts";
import * as RequestLog from "#modules/request-log/module.ts";
import type { Caller } from "#shared/03-domain/caller.ts";
import { HubKeyName, PoolId, SignInId } from "#shared/03-domain/ids.ts";
import type * as Pool from "#shared/03-domain/pool.entity.ts";
import type * as Price from "#shared/03-domain/price.ts";
import { compareText } from "#shared/03-domain/text.ts";
import * as ReadMachine from "./read-machine.query.ts";

const rate = Arbitrary.schema(
  Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 9_000_000 })),
).pipe(Arbitrary.map(BigInt));
const maybeRate = Arbitrary.all({
  given: Arbitrary.schema(Schema.Boolean),
  rate,
}).pipe(
  Arbitrary.map(({ given, rate }) =>
    given ? Option.some(rate) : Option.none(),
  ),
);
const rates = Arbitrary.all({
  input: rate,
  output: rate,
  cacheRead: maybeRate,
  cacheWriteShort: maybeRate,
  cacheWriteLong: maybeRate,
}).pipe(
  Arbitrary.map(
    ({
      input,
      output,
      cacheRead,
      cacheWriteShort,
      cacheWriteLong,
    }): Price.Rates => ({
      input,
      output,
      ...Option.match(cacheRead, {
        onNone: () => ({}),
        onSome: (each) => ({ cacheRead: each }),
      }),
      ...Option.match(cacheWriteShort, {
        onNone: () => ({}),
        onSome: (each) => ({ cacheWriteShort: each }),
      }),
      ...Option.match(cacheWriteLong, {
        onNone: () => ({}),
        onSome: (each) => ({ cacheWriteLong: each }),
      }),
    }),
  ),
);
const price = Arbitrary.all({
  base: rates,
  tiers: Arbitrary.array(
    Arbitrary.all({
      threshold: Arbitrary.schema(
        Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 400_000 })),
      ),
      rates,
    }),
    { maxLength: 2 },
  ),
}).pipe(
  Arbitrary.map(
    ({ base, tiers }): Price.Price => ({
      base,
      tiers: [
        ...new Map(tiers.map((tier) => [tier.threshold, tier])).values(),
      ].sort((one, other) => one.threshold - other.threshold),
    }),
  ),
);

/** Models of the shipped lists, with and without limits, and ids no list names. */
const modelId = Arbitrary.schema(
  Schema.Literals([
    "claude-opus-5-5",
    "claude-haiku-4-5",
    "gpt-5.5",
    "gpt-image-1.5",
    "glm-5",
    "own-model",
    "constructor",
  ]),
);

const pool = Arbitrary.all({
  id: Arbitrary.schema(
    Schema.Literals(["work", "claude", "codex", "zai", "a", "b"]),
  ),
  kind: Arbitrary.schema(Admission.Kind),
  list: Arbitrary.schema(
    Schema.Literals(["none", "anthropic", "openai", "zai", "opencode-go"]),
  ),
  own: Arbitrary.array(Arbitrary.all({ model: modelId, price }), {
    maxLength: 4,
  }),
}).pipe(
  Arbitrary.map(({ id, kind, list, own }): Pool.Pool => {
    const shared = {
      id: PoolId.make(id),
      provider: `provider-${id}`,
      baseUrl: `https://${id}.example`,
      prices: list === "none" ? Option.none() : Option.some(list),
      ownPrices: Object.fromEntries(
        own.map(({ model, price }) => [model, price]),
      ),
    };
    return kind === "keyed"
      ? {
          ...shared,
          kind,
          protocol: "openai-chat",
          key: Option.some(Redacted.make(`held-key-of-${id}`)),
        }
      : {
          ...shared,
          kind,
          protocol: "anthropic-messages",
          keptLogin: Option.some(Redacted.make(`kept-login-of-${id}`)),
          fallback: Option.none(),
        };
  }),
);
const pools = Arbitrary.array(pool, { maxLength: 6 }).pipe(
  Arbitrary.map((each) =>
    HashMap.fromIterable(each.map((one) => [one.id, one])),
  ),
);

const caller = Arbitrary.all({
  owner: Arbitrary.schema(Schema.Boolean),
  scope: Arbitrary.schema(Admission.Scope),
}).pipe(
  Arbitrary.map(
    ({ owner, scope }): Caller =>
      owner
        ? {
            _tag: "Owner",
            signIn: {
              id: SignInId.make("sign-in"),
              createdAt: DateTime.makeUnsafe(0),
              expiresAt: DateTime.makeUnsafe(1),
            },
          }
        : {
            _tag: "HubKey",
            hubKey: { name: HubKeyName.make(`a-${scope}-key`), scope },
          },
  ),
);

const noNames = Layer.succeed(
  ListDisplayNames,
  ListDisplayNames.of({ execute: Effect.succeed([]) }),
);

const readUnder = (pools: HashMap.HashMap<PoolId, Pool.Pool>, caller: Caller) =>
  Effect.gen(function* () {
    const read = yield* ReadMachine.ReadMachine;
    return yield* read.execute(caller);
  }).pipe(
    Effect.provide(
      ReadMachine.layer(pools).pipe(
        Layer.provide([RequestLog.poolModels(pools), noNames]),
      ),
    ),
  );

const filled = (rates: Price.Rates) => {
  const cacheWriteShort = rates.cacheWriteShort ?? rates.input;
  return {
    input: rates.input,
    cacheRead: rates.cacheRead ?? rates.input,
    cacheWriteShort,
    cacheWriteLong: rates.cacheWriteLong ?? cacheWriteShort,
    output: rates.output,
  };
};

const modelsOf = (pool: Pool.Pool) => {
  const list: PriceLists.PriceList = Option.match(pool.prices, {
    onNone: () => ({}),
    onSome: (name) => PriceLists.lists[name] ?? {},
  });
  const ids = [
    ...new Set([...Object.keys(list), ...Object.keys(pool.ownPrices)]),
  ].sort(compareText);
  return ids.map((id) => {
    const listed = Object.hasOwn(list, id) ? list[id] : undefined;
    const own = Object.hasOwn(pool.ownPrices, id)
      ? pool.ownPrices[id]
      : undefined;
    const price = own ?? listed?.price;
    return {
      id,
      contextTokens: Option.fromUndefinedOr(listed?.contextTokens),
      outputTokens: Option.fromUndefinedOr(listed?.outputTokens),
      imageInput: Option.fromUndefinedOr(listed?.imageInput),
      price:
        price === undefined
          ? undefined
          : {
              base: filled(price.base),
              tiers: price.tiers.map(({ threshold, rates }) => ({
                threshold,
                rates: filled(rates),
              })),
            },
    };
  });
};

describe("ReadMachine laws", () => {
  it.effect.prop(
    "A7: the pools answered are exactly those whose kind is the caller's scope, in order of id: every pool for the owner and none for a reader key",
    { pools, caller },
    ({ pools, caller }) =>
      Effect.gen(function* () {
        const machine = yield* readUnder(pools, caller);
        const opened = [...HashMap.values(pools)]
          .filter(
            (pool) =>
              caller._tag === "Owner" || caller.hubKey.scope === pool.kind,
          )
          .sort((one, other) => compareText(one.id, other.id));
        expect([
          machine.hubKey,
          machine.pools.map(({ id, kind, protocol, provider }) => ({
            id,
            kind,
            protocol,
            provider,
          })),
        ]).toEqual([
          caller._tag === "Owner" ? Option.none() : Option.some(caller.hubKey),
          opened.map(({ id, kind, protocol, provider }) => ({
            id,
            kind,
            protocol,
            provider,
          })),
        ]);
      }),
    { arbitrary: { runs: 300 } },
  );

  it.effect.prop(
    "A8: a keyed pool's models are those of its price list and its own prices, with the list's limits and image input, each at the pool's own price when it has one, else the list's, every missing cache rate filled in; a subscription pool has none",
    { pools },
    ({ pools }) =>
      Effect.gen(function* () {
        const owner: Caller = {
          _tag: "Owner",
          signIn: {
            id: SignInId.make("sign-in"),
            createdAt: DateTime.makeUnsafe(0),
            expiresAt: DateTime.makeUnsafe(1),
          },
        };
        const machine = yield* readUnder(pools, owner);
        expect(
          machine.pools.map(({ id, models }) => ({
            id,
            models: models.map(({ name: _name, ...model }) => model),
          })),
        ).toEqual(
          [...HashMap.values(pools)]
            .sort((one, other) => compareText(one.id, other.id))
            .map((pool) => ({
              id: pool.id,
              models: pool.kind === "keyed" ? modelsOf(pool) : [],
            })),
        );
      }),
    { arbitrary: { runs: 300 } },
  );
});
