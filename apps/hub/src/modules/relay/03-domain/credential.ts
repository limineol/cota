import { type Effect, type Option, Schema } from "effect";
import type { PoolId } from "#shared/03-domain/ids.ts";
import type * as Pool from "#shared/03-domain/pool.entity.ts";
import type * as Refusal from "./refusal.ts";

const Secret = Schema.Redacted(Schema.String);
type Secret = typeof Secret.Type;

export type Credential =
  | {
      readonly _tag: "Held";
      readonly key: Option.Option<Secret>;
    }
  | { readonly _tag: "Client" }
  | { readonly _tag: "Kept"; readonly login: Secret };

/**
 * Which pool a request bills, with which credential, and, only for a kept
 * request with a login and a model to a pool whose protocol tells a refusal
 * from the answer's head, what its refusal sets off.
 */
export interface Plan {
  readonly pool: Pool.ForwardedPool;
  readonly credential: Credential;
  readonly divertedFrom: Option.Option<PoolId>;
  readonly onRefusal: Option.Option<OnRefusal>;
}

export interface OnRefusal {
  readonly record: (refusal: Refusal.Refusal) => Effect.Effect<void>;
  readonly divert: Effect.Effect<Option.Option<Plan>>;
}
