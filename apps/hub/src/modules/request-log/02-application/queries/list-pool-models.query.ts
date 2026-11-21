import { Context, Effect, Layer, type Option } from "effect";
import { PricedModels } from "#modules/request-log/02-application/interfaces/priced-models.ts";
import * as Cost from "#modules/request-log/03-domain/cost.ts";
import type { PoolId } from "#shared/03-domain/ids.ts";

/** A model a pool's prices name, priced at every class's rate. */
export interface PoolModel {
  readonly id: string;
  readonly contextTokens: Option.Option<number>;
  readonly outputTokens: Option.Option<number>;
  readonly imageInput: Option.Option<boolean>;
  readonly price: Cost.FilledPrice;
}

export class ListPoolModels extends Context.Service<
  ListPoolModels,
  {
    /**
     * The models of a pool's price list and of its own prices, in order of
     * id, each with its limits and image input from the list, and at the
     * pool's own price when it has one, else at its list's, with a missing
     * cache rate filled in as a cost fills it in (A8).
     */
    readonly execute: (pool: PoolId) => Effect.Effect<ReadonlyArray<PoolModel>>;
  }
>()("@cota/hub/request-log/ListPoolModels") {}

export const layer: Layer.Layer<ListPoolModels, never, PricedModels> =
  Layer.effect(
    ListPoolModels,
    Effect.gen(function* () {
      const pricedModels = yield* PricedModels;
      return ListPoolModels.of({
        execute: Effect.fn("ListPoolModels.execute")(function* (pool: PoolId) {
          return pricedModels.of(pool).map((model) => ({
            ...model,
            price: Cost.filledPrice(model.price),
          }));
        }),
      });
    }),
  );
