import { Context, Effect, type HashMap, Layer, type Option } from "effect";
import { RoutesRepository } from "#modules/routes/02-application/interfaces/routes.repository.ts";
import * as RouteList from "#modules/routes/03-domain/route-list.ts";
import type { HubStoreUnavailable } from "#shared/03-domain/hub-store.ts";
import type { PoolId } from "#shared/03-domain/ids.ts";
import type * as Pool from "#shared/03-domain/pool.entity.ts";

/** Which pool a launch of a client in a project bills, with the pool it names for itself, if any. */
export interface Question {
  readonly client: RouteList.RoutedClient;
  readonly project: string;
  readonly override: Option.Option<PoolId>;
}

export interface RouteAnswer extends RouteList.Answered {
  readonly client: RouteList.RoutedClient;
  readonly project: string;
  readonly defaultPool: Option.Option<PoolId>;
}

export class AnswerRoute extends Context.Service<
  AnswerRoute,
  {
    /**
     * The pool the launch bills and why, with the client's default pool
     * whatever answered; it depends on the client's list, the configuration
     * and the question alone.
     */
    readonly execute: (
      question: Question,
    ) => Effect.Effect<RouteAnswer, RouteList.Unanswered | HubStoreUnavailable>;
  }
>()("@cota/hub/routes/AnswerRoute") {}

export const layer = (
  pools: HashMap.HashMap<PoolId, Pool.Pool>,
): Layer.Layer<AnswerRoute, never, RoutesRepository> =>
  Layer.effect(
    AnswerRoute,
    Effect.gen(function* () {
      const repository = yield* RoutesRepository;
      return AnswerRoute.of({
        execute: Effect.fn("AnswerRoute.execute")(function* (
          question: Question,
        ) {
          const list =
            (yield* repository.stored).find(
              ({ client }) => client === question.client,
            ) ?? RouteList.neverStored(question.client);
          const answered = yield* Effect.fromResult(
            RouteList.answer(pools, list, question.project, question.override),
          );
          return {
            ...answered,
            client: question.client,
            project: question.project,
            defaultPool: list.defaultPool,
          };
        }),
      });
    }),
  );
