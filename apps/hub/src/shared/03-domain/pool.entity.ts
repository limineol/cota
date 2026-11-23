import { HashMap, Result, Schema } from "effect";
import { PoolId } from "./ids.ts";
import { Price } from "./price.ts";

const Secret = Schema.Redacted(Schema.String);

export const KeyedPool = Schema.Struct({
  kind: Schema.Literal("keyed"),
  id: PoolId,
  protocol: Schema.Literals(["anthropic-messages", "openai-chat"]),
  provider: Schema.String,
  baseUrl: Schema.String,
  key: Schema.Option(Secret),
  prices: Schema.Option(Schema.String),
  ownPrices: Schema.Record(Schema.String, Price),
});
export type KeyedPool = typeof KeyedPool.Type;

export const SubscriptionPool = Schema.Struct({
  kind: Schema.Literal("subscription"),
  id: PoolId,
  protocol: Schema.Literals(["anthropic-messages", "chatgpt-codex"]),
  provider: Schema.String,
  baseUrl: Schema.String,
  keptLogin: Schema.Option(Secret),
  fallback: Schema.Option(PoolId),
  prices: Schema.Option(Schema.String),
  ownPrices: Schema.Record(Schema.String, Price),
});
export type SubscriptionPool = typeof SubscriptionPool.Type;

/** A pool the hub never forwards for and holds no login or key for, which only reported requests bill. */
export const ObservedPool = Schema.Struct({
  kind: Schema.Literal("observed"),
  id: PoolId,
  provider: Schema.String,
  prices: Schema.Option(Schema.String),
  ownPrices: Schema.Record(Schema.String, Price),
});
export type ObservedPool = typeof ObservedPool.Type;

export const Pool = Schema.Union([KeyedPool, SubscriptionPool, ObservedPool]);
export type Pool = typeof Pool.Type;

/** A pool the hub forwards for: every pool but an observed one. */
export type ForwardedPool = KeyedPool | SubscriptionPool;

/** The pools the hub forwards for, without the observed ones. */
export const forwarded = (
  pools: HashMap.HashMap<PoolId, Pool>,
): HashMap.HashMap<PoolId, ForwardedPool> =>
  HashMap.filterMap(pools, (pool) =>
    pool.kind === "observed" ? Result.failVoid : Result.succeed(pool),
  );
