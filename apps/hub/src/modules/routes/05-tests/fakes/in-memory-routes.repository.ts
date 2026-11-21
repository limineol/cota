import { Effect, Layer, Option } from "effect";
import { RoutesRepository } from "#modules/routes/02-application/interfaces/routes.repository.ts";
import type {
  RoutedClient,
  RouteList,
} from "#modules/routes/03-domain/route-list.ts";

/** `RoutesRepository` in memory, replacing a list as the SQLite repository does. */
export const layer: Layer.Layer<RoutesRepository> = Layer.effect(
  RoutesRepository,
  Effect.sync(() => {
    const kept = new Map<RoutedClient, RouteList>();
    return RoutesRepository.of({
      stored: Effect.sync(() => [...kept.values()]),
      replace: (change, at) =>
        Effect.sync(() => {
          if ((kept.get(change.client)?.revision ?? 0) !== change.from) {
            return false;
          }
          kept.set(change.client, {
            client: change.client,
            routes: change.routes,
            defaultPool: change.defaultPool,
            revision: change.from + 1,
            changedAt: Option.some(at),
          });
          return true;
        }),
    });
  }),
);
