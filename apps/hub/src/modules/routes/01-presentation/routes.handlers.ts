import { Effect, Option } from "effect";
import type { HttpApiBuilder } from "effect/http-api";
import { ChangeRoutes } from "#modules/routes/02-application/commands/change-routes.command.ts";
import {
  AnswerRoute,
  type RouteAnswer,
} from "#modules/routes/02-application/queries/answer-route.query.ts";
import { ListRoutes } from "#modules/routes/02-application/queries/list-routes.query.ts";
import * as ProjectPattern from "#modules/routes/03-domain/project-pattern.ts";
import * as RouteList from "#modules/routes/03-domain/route-list.ts";
import {
  hubStoreProblem,
  NoSuchPoolProblem,
} from "#shared/01-presentation/problems.ts";
import { PoolId } from "#shared/03-domain/ids.ts";
import * as RoutesApi from "./routes.api.ts";

const listOf = (
  list: RouteList.ListedRouteList,
): typeof RoutesApi.RouteList.Type => ({
  client: list.client,
  routes: list.routes.map(({ position, pattern, pool, fit }) => ({
    position,
    pattern: ProjectPattern.textOf(pattern),
    pool,
    fits: fit._tag === "Fits",
  })),
  defaultPool: Option.getOrNull(
    Option.map(list.defaultPool, ({ pool, fit }) => ({
      pool,
      fits: fit._tag === "Fits",
    })),
  ),
  revision: list.revision,
  changedAt: Option.getOrNull(list.changedAt),
});

const answerOf = (answer: RouteAnswer): typeof RoutesApi.RouteAnswer.Type => ({
  client: answer.client,
  project: answer.project,
  pool: {
    id: answer.pool.id,
    kind: answer.pool.kind,
    protocol: answer.pool.protocol,
    provider: answer.pool.provider,
  },
  by:
    answer.by._tag === "Route"
      ? "route"
      : answer.by._tag === "Default"
        ? "default"
        : "override",
  route:
    answer.by._tag === "Route"
      ? {
          position: answer.by.route.position,
          pattern: ProjectPattern.textOf(answer.by.route.pattern),
        }
      : null,
  defaultPool: Option.getOrNull(answer.defaultPool),
});

const refusalOf = (
  refusal: RouteList.Refusal,
): typeof RoutesApi.RouteRefusal.Type => ({
  position: Option.getOrNull(refusal.position),
  reason: refusal.reason,
  shadowedBy: Option.getOrNull(refusal.shadowedBy),
});

const sentenceOf = (refusal: RouteList.Refusal): string => {
  const which = Option.match(refusal.position, {
    onNone: () => "the default pool",
    onSome: (position) => `route ${position}`,
  });
  switch (refusal.reason) {
    case "not-a-pattern":
      return `${which}: not a project pattern`;
    case "no-such-pool":
      return `${which}: no such pool`;
    case "pool-not-for-client":
      return `${which}: the pool does not speak the client's protocol`;
    case "same-pattern":
      return `${which}: the same pattern as an earlier route`;
    case "shadowed":
      return `${which}: shadowed by route ${Option.getOrElse(refusal.shadowedBy, () => 0)}`;
  }
};

const goneDetail = (gone: RouteList.RoutePoolGone): string => {
  const which = Option.match(gone.position, {
    onNone: () => `The default pool of ${gone.client}`,
    onSome: (position) =>
      `Route ${position} of ${gone.client} (${Option.getOrElse(gone.pattern, () => "")})`,
  });
  const why =
    gone.reason === "no-such-pool"
      ? "is not in the configuration"
      : `does not speak ${RouteList.protocolOf(gone.client)}`;
  return `${which} names the pool ${gone.pool}, which ${why}.`;
};

export const build = (
  handlers: HttpApiBuilder.Handlers.FromGroup<typeof RoutesApi.group>,
) =>
  Effect.gen(function* () {
    const listRoutes = yield* ListRoutes;
    const changeRoutes = yield* ChangeRoutes;
    const answerRoute = yield* AnswerRoute;

    return handlers
      .handle("list", () =>
        listRoutes.execute.pipe(
          Effect.map((lists) => ({ clients: lists.map(listOf) })),
          Effect.catchTag("HubStoreUnavailable", hubStoreProblem),
        ),
      )
      .handle("change", ({ params, payload }) =>
        changeRoutes
          .execute({
            client: params.client,
            revision: payload.revision,
            routes: payload.routes.map(({ pattern, pool }) => ({
              pattern,
              pool: PoolId.make(pool),
            })),
            defaultPool: Option.map(
              Option.fromNullOr(payload.defaultPool),
              PoolId.make,
            ),
          })
          .pipe(
            Effect.map(listOf),
            Effect.catchTags({
              HubStoreUnavailable: hubStoreProblem,
              RoutesRefused: ({ refusals }) =>
                Effect.fail(
                  new RoutesApi.RoutesRefusedProblem({
                    detail: `The routes of ${params.client} were not stored: ${refusals.map(sentenceOf).join("; ")}.`,
                    refusals: refusals.map(refusalOf),
                  }),
                ),
              RoutesChanged: ({ client, revision }) =>
                Effect.fail(
                  new RoutesApi.RoutesChangedProblem({
                    detail: `The routes of ${client} changed since revision ${revision}; read them again.`,
                  }),
                ),
            }),
          ),
      )
      .handle("answer", ({ query }) =>
        answerRoute
          .execute({
            client: query.client,
            project: query.project,
            override: Option.map(
              Option.fromUndefinedOr(query.pool),
              PoolId.make,
            ),
          })
          .pipe(
            Effect.map(answerOf),
            Effect.catchTags({
              HubStoreUnavailable: hubStoreProblem,
              NoRoute: ({ client, project }) =>
                Effect.fail(
                  new RoutesApi.NoRouteProblem({
                    detail: `No route of ${client} matches the project ${JSON.stringify(project)}, and ${client} has no default pool.`,
                  }),
                ),
              RoutePoolGone: (gone) =>
                Effect.fail(
                  new RoutesApi.RoutePoolGoneProblem({
                    detail: goneDetail(gone),
                  }),
                ),
              NoSuchPool: ({ pool }) =>
                Effect.fail(
                  new NoSuchPoolProblem({
                    detail: `The hub has no pool ${JSON.stringify(pool)}.`,
                  }),
                ),
              PoolNotForClient: ({ client, pool, protocol }) =>
                Effect.fail(
                  new RoutesApi.PoolNotForClientProblem({
                    detail: `The pool ${pool} ${Option.match(protocol, {
                      onNone: () =>
                        "is an observed pool, which speaks no protocol",
                      onSome: (protocol) => `speaks ${protocol}`,
                    })}, and ${client} speaks ${RouteList.protocolOf(client)}.`,
                  }),
                ),
            }),
          ),
      );
  });
