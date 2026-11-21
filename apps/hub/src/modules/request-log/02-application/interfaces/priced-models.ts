import { Context, type Option } from "effect";
import type { PoolId } from "#shared/03-domain/ids.ts";
import type * as Price from "#shared/03-domain/price.ts";

/** A model a pool's prices name, with what its price list knows of it. */
export interface PricedModel {
  readonly id: string;
  readonly contextTokens: Option.Option<number>;
  readonly outputTokens: Option.Option<number>;
  readonly imageInput: Option.Option<boolean>;
  readonly price: Price.Price;
}

/** The models a pool's price list and its own prices name. */
export class PricedModels extends Context.Service<
  PricedModels,
  {
    /**
     * The models of a pool's price list and of its own prices, in order of
     * id, each at the pool's own price when it has one, else at its list's
     * (A8); none for a pool the hub does not have.
     */
    readonly of: (pool: PoolId) => ReadonlyArray<PricedModel>;
  }
>()("@cota/hub/request-log/PricedModels") {}
