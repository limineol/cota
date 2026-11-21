import { Context, Effect, type HashMap, Layer } from "effect";
import { RoutesRepository } from "#modules/routes/02-application/interfaces/routes.repository.ts";
import * as RouteList from "#modules/routes/03-domain/route-list.ts";
import type { HubStoreUnavailable } from "#shared/03-domain/hub-store.ts";
import type { PoolId } from "#shared/03-domain/ids.ts";
import type * as Pool from "#shared/03-domain/pool.entity.ts";

export class ListRoutes extends Context.Service<
  ListRoutes,
  {
    /**
     * Every routed client's list, Claude Code's then Codex's, a list never
     * stored as empty at revision 0, with whether each pool fits now.
     */
    readonly execute: Effect.Effect<
      ReadonlyArray<RouteList.ListedRouteList>,
      HubStoreUnavailable
    >;
  }
>()("@cota/hub/routes/ListRoutes") {}

export const layer = (
  pools: HashMap.HashMap<PoolId, Pool.Pool>,
): Layer.Layer<ListRoutes, never, RoutesRepository> =>
  Layer.effect(
    ListRoutes,
    Effect.gen(function* () {
      const repository = yield* RoutesRepository;
      return ListRoutes.of({
        execute: Effect.gen(function* () {
          const stored = yield* repository.stored;
          return RouteList.routedClients.map((client) =>
            RouteList.listed(
              pools,
              stored.find((list) => list.client === client) ??
                RouteList.neverStored(client),
            ),
          );
        }).pipe(Effect.withSpan("ListRoutes.execute")),
      });
    }),
  );
