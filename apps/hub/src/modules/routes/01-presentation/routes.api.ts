import { Schema } from "effect";
import {
  HttpApiEndpoint,
  HttpApiError,
  HttpApiGroup,
  HttpApiMiddleware,
} from "effect/http-api";
import { longest } from "#modules/routes/03-domain/project-pattern.ts";
import {
  mostRoutes,
  Reason,
  RoutedClient,
} from "#modules/routes/03-domain/route-list.ts";
import {
  CallerMiddleware,
  mayCall,
} from "#shared/01-presentation/caller.middleware.ts";
import { JsonBody } from "#shared/01-presentation/json-body.middleware.ts";
import {
  HubStoreProblem,
  NoSuchPoolProblem,
} from "#shared/01-presentation/problems.ts";
import { ProtocolName } from "#shared/03-domain/protocol-name.ts";
import { isCharactersBetween } from "#shared/03-domain/text.ts";

const Position = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

export const RouteRefusal = Schema.Struct({
  position: Schema.NullOr(Position),
  reason: Reason,
  shadowedBy: Schema.NullOr(Position),
}).annotate({ identifier: "RouteRefusal" });

export class NoRouteProblem extends HttpApiError.Problem<NoRouteProblem>()(
  "NoRouteProblem",
  {
    type: "urn:cota:no-route",
    status: 404,
    title: "No route matches, and the client has no default pool.",
  },
) {}

export class RoutePoolGoneProblem extends HttpApiError.Problem<RoutePoolGoneProblem>()(
  "RoutePoolGoneProblem",
  {
    type: "urn:cota:route-pool-gone",
    status: 409,
    title: "The route names a pool this client cannot bill.",
  },
) {}

export class PoolNotForClientProblem extends HttpApiError.Problem<PoolNotForClientProblem>()(
  "PoolNotForClientProblem",
  {
    type: "urn:cota:pool-not-for-client",
    status: 400,
    title: "That pool does not speak this client's protocol.",
  },
) {}

export class RoutesRefusedProblem extends HttpApiError.Problem<RoutesRefusedProblem>()(
  "RoutesRefusedProblem",
  {
    type: "urn:cota:routes-refused",
    status: 400,
    title: "The routes were not stored.",
  },
  { refusals: Schema.Array(RouteRefusal) },
) {}

export class RoutesChangedProblem extends HttpApiError.Problem<RoutesChangedProblem>()(
  "RoutesChangedProblem",
  {
    type: "urn:cota:routes-changed",
    status: 409,
    title: "The routes changed since they were read.",
  },
) {}

const Revision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** A pool's id as a caller gives one: 1 to 200 characters, a string on the wire as every pool id of the API is. */
const GivenPool = Schema.String.check(isCharactersBetween(1, longest));

export const RouteList = Schema.Struct({
  client: RoutedClient,
  routes: Schema.Array(
    Schema.Struct({
      position: Position,
      pattern: Schema.String,
      pool: Schema.String,
      fits: Schema.Boolean,
    }),
  ),
  defaultPool: Schema.NullOr(
    Schema.Struct({ pool: Schema.String, fits: Schema.Boolean }),
  ),
  revision: Revision,
  changedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
}).annotate({ identifier: "RouteList" });

export const SentRouteList = Schema.Struct({
  revision: Revision,
  routes: Schema.Array(
    Schema.Struct({
      pattern: Schema.String.check(isCharactersBetween(0, longest)),
      pool: GivenPool,
    }),
  ).check(Schema.isMaxLength(mostRoutes)),
  defaultPool: Schema.NullOr(GivenPool),
}).annotate({ identifier: "SentRouteList" });

export const RouteAnswer = Schema.Struct({
  client: RoutedClient,
  project: Schema.String,
  pool: Schema.Struct({
    id: Schema.String,
    kind: Schema.Literals(["subscription", "keyed"]),
    protocol: ProtocolName,
    provider: Schema.String,
  }),
  by: Schema.Literals(["route", "default", "override"]),
  route: Schema.NullOr(
    Schema.Struct({ position: Position, pattern: Schema.String }),
  ),
  defaultPool: Schema.NullOr(Schema.String),
}).annotate({ identifier: "RouteAnswer" });

const list = HttpApiEndpoint.get("list", "/routes", {
  success: Schema.Struct({ clients: Schema.Array(RouteList) }),
  error: HubStoreProblem,
}).annotateMerge(mayCall("reader"));

const change = HttpApiEndpoint.put("change", "/routes/:client", {
  params: { client: RoutedClient },
  payload: SentRouteList,
  success: RouteList,
  error: [RoutesRefusedProblem, RoutesChangedProblem, HubStoreProblem],
}).annotateMerge(mayCall("owner"));

const answer = HttpApiEndpoint.get("answer", "/route", {
  query: {
    client: RoutedClient,
    project: Schema.Trim.check(isCharactersBetween(1, longest)),
    pool: Schema.optional(GivenPool),
  },
  success: RouteAnswer,
  error: [
    NoRouteProblem,
    RoutePoolGoneProblem,
    NoSuchPoolProblem,
    PoolNotForClientProblem,
    HubStoreProblem,
  ],
}).annotateMerge(mayCall("any-hub-key"));

/** Each routed client's routes, and the pool one launch bills (`docs/specs/routes/spec.md`). */
export const group = HttpApiGroup.make("routes")
  .add(list, change, answer)
  .middleware(CallerMiddleware)
  .middleware(JsonBody)
  .middleware(HttpApiMiddleware.ProblemDetails)
  .prefix("/api");
