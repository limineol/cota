import { Effect, type HashMap, Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { Api } from "#api.ts";
import * as RoutesHandlers from "#modules/routes/01-presentation/routes.handlers.ts";
import * as ChangeRoutes from "#modules/routes/02-application/commands/change-routes.command.ts";
import * as WarnOfUnfitRoutes from "#modules/routes/02-application/commands/warn-of-unfit-routes.command.ts";
import * as AnswerRoute from "#modules/routes/02-application/queries/answer-route.query.ts";
import * as ListRoutes from "#modules/routes/02-application/queries/list-routes.query.ts";
import * as SqliteRoutes from "#modules/routes/04-infrastructure/persistence/sqlite/sqlite-routes.repository.ts";
import type { PoolId } from "#shared/03-domain/ids.ts";
import type * as Pool from "#shared/03-domain/pool.entity.ts";

/** The routes module's tables in the hub store. */
export const steps = SqliteRoutes.steps;

/** The warnings of routes whose pools no longer fit, written once when the hub starts. */
const warnAtStart = Layer.effectDiscard(
  Effect.gen(function* () {
    const warn = yield* WarnOfUnfitRoutes.WarnOfUnfitRoutes;
    yield* warn.execute.pipe(
      Effect.catchTag("HubStoreUnavailable", ({ detail }) =>
        Effect.logWarning(
          `The routes could not be read to check them: ${detail}`,
        ),
      ),
    );
  }),
);

/** The routes module's commands and queries, and its warnings at start, over the repository given. */
export const overRepository = (pools: HashMap.HashMap<PoolId, Pool.Pool>) =>
  Layer.mergeAll(
    ChangeRoutes.layer(pools),
    AnswerRoute.layer(pools),
    warnAtStart.pipe(Layer.provide(WarnOfUnfitRoutes.layer)),
  ).pipe(Layer.provideMerge(ListRoutes.layer(pools)));

/** The routes module over the hub store. */
export const layer = (pools: HashMap.HashMap<PoolId, Pool.Pool>) =>
  overRepository(pools).pipe(Layer.provide(SqliteRoutes.layer));

/** The handlers of the `routes` group. */
export const api = HttpApiBuilder.group(Api, "routes", RoutesHandlers.build);
