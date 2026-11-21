import { Context, Effect, Layer, Option } from "effect";
import { ListRoutes } from "#modules/routes/02-application/queries/list-routes.query.ts";
import * as ProjectPattern from "#modules/routes/03-domain/project-pattern.ts";
import * as RouteList from "#modules/routes/03-domain/route-list.ts";
import type { HubStoreUnavailable } from "#shared/03-domain/hub-store.ts";

const whyOf = (client: RouteList.RoutedClient, fit: RouteList.Fit) =>
  fit._tag === "Gone"
    ? "is not in the configuration"
    : `does not speak ${RouteList.protocolOf(client)}`;

const linesOf = (list: RouteList.ListedRouteList): ReadonlyArray<string> => [
  ...list.routes
    .filter(({ fit }) => fit._tag !== "Fits")
    .map(
      ({ position, pattern, pool, fit }) =>
        `Route ${position} of ${list.client} (${ProjectPattern.textOf(pattern)}) names the pool ${pool}, which ${whyOf(list.client, fit)}; its projects' launches stop until the route is changed.`,
    ),
  ...Option.toArray(list.defaultPool)
    .filter(({ fit }) => fit._tag !== "Fits")
    .map(
      ({ pool, fit }) =>
        `The default pool of ${list.client} is ${pool}, which ${whyOf(list.client, fit)}; launches no route matches stop until it is changed.`,
    ),
];

export class WarnOfUnfitRoutes extends Context.Service<
  WarnOfUnfitRoutes,
  {
    /** Writes a warning for each stored route and default pool whose pool no longer fits its client. */
    readonly execute: Effect.Effect<void, HubStoreUnavailable>;
  }
>()("@cota/hub/routes/WarnOfUnfitRoutes") {}

export const layer: Layer.Layer<WarnOfUnfitRoutes, never, ListRoutes> =
  Layer.effect(
    WarnOfUnfitRoutes,
    Effect.gen(function* () {
      const listRoutes = yield* ListRoutes;
      return WarnOfUnfitRoutes.of({
        execute: Effect.gen(function* () {
          for (const list of yield* listRoutes.execute) {
            for (const line of linesOf(list)) yield* Effect.logWarning(line);
          }
        }).pipe(Effect.withSpan("WarnOfUnfitRoutes.execute")),
      });
    }),
  );
