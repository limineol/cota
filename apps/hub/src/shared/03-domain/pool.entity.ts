import { Schema } from "effect";
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

export const Pool = Schema.Union([KeyedPool, SubscriptionPool]);
export type Pool = typeof Pool.Type;
