import {
  Context,
  DateTime,
  Effect,
  type HashMap,
  Layer,
  Option,
  Result,
} from "effect";
import { RoutesRepository } from "#modules/routes/02-application/interfaces/routes.repository.ts";
import * as RouteList from "#modules/routes/03-domain/route-list.ts";
import type { HubStoreUnavailable } from "#shared/03-domain/hub-store.ts";
import type { PoolId } from "#shared/03-domain/ids.ts";
import type * as Pool from "#shared/03-domain/pool.entity.ts";

/** A client's whole list as the owner sends it, and the revision it was read at. */
export interface SentList {
  readonly client: RouteList.RoutedClient;
  readonly revision: number;
  readonly routes: ReadonlyArray<RouteList.SentRoute>;
  readonly defaultPool: Option.Option<PoolId>;
}

export class ChangeRoutes extends Context.Service<
  ChangeRoutes,
  {
    /**
     * Stores the client's list in place of its own when every route and the
     * default pool are accepted (N5 to N7) and the list is still at the
     * revision it was read at (N10), and gives it as stored.
     */
    readonly execute: (
      sent: SentList,
    ) => Effect.Effect<
      RouteList.ListedRouteList,
      RouteList.RoutesRefused | RouteList.RoutesChanged | HubStoreUnavailable
    >;
  }
>()("@cota/hub/routes/ChangeRoutes") {}

export const layer = (
  pools: HashMap.HashMap<PoolId, Pool.Pool>,
): Layer.Layer<ChangeRoutes, never, RoutesRepository> =>
  Layer.effect(
    ChangeRoutes,
    Effect.gen(function* () {
      const repository = yield* RoutesRepository;
      return ChangeRoutes.of({
        execute: Effect.fn("ChangeRoutes.execute")(function* (sent: SentList) {
          const checked = RouteList.check(
            pools,
            sent.client,
            sent.routes,
            sent.defaultPool,
          );
          if (Result.isFailure(checked)) {
            return yield* new RouteList.RoutesRefused({
              client: sent.client,
              refusals: checked.failure,
            });
          }
          const at = yield* DateTime.now;
          const stored = yield* repository.replace(
            {
              client: sent.client,
              from: sent.revision,
              routes: checked.success,
              defaultPool: sent.defaultPool,
            },
            at,
          );
          if (!stored) {
            return yield* new RouteList.RoutesChanged({
              client: sent.client,
              revision: sent.revision,
            });
          }
          return RouteList.listed(pools, {
            client: sent.client,
            routes: checked.success,
            defaultPool: sent.defaultPool,
            revision: sent.revision + 1,
            changedAt: Option.some(at),
          });
        }),
      });
    }),
  );
