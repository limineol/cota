import { type DateTime, HashMap, Option, Result, Schema } from "effect";
import { PoolId } from "#shared/03-domain/ids.ts";
import type * as Pool from "#shared/03-domain/pool.entity.ts";
import { ProtocolName } from "#shared/03-domain/protocol-name.ts";
import * as ProjectPattern from "./project-pattern.ts";

/** The clients whose pool a launch chooses (ADR-0023). */
export const RoutedClient = Schema.Literals(["claude-code", "codex"]);
export type RoutedClient = typeof RoutedClient.Type;

export const routedClients: ReadonlyArray<RoutedClient> = [
  "claude-code",
  "codex",
];

/** The protocol a routed client speaks, which every pool it bills must speak. */
export const protocolOf = (client: RoutedClient): ProtocolName =>
  client === "claude-code" ? "anthropic-messages" : "chatgpt-codex";

/** The most routes one client's list holds. */
export const mostRoutes = 200;

export interface Route {
  readonly position: number;
  readonly pattern: ProjectPattern.ProjectPattern;
  readonly pool: PoolId;
}

/** A client's routes in order, its default pool, and its revision: 0, with no change, for a list never stored. */
export interface RouteList {
  readonly client: RoutedClient;
  readonly routes: ReadonlyArray<Route>;
  readonly defaultPool: Option.Option<PoolId>;
  readonly revision: number;
  readonly changedAt: Option.Option<DateTime.Utc>;
}

export const neverStored = (client: RoutedClient): RouteList => ({
  client,
  routes: [],
  defaultPool: Option.none(),
  revision: 0,
  changedAt: Option.none(),
});

/** Whether a pool fits a client: the configuration has it, and it speaks the client's protocol. */
export type Fit =
  | { readonly _tag: "Fits"; readonly pool: Pool.Pool }
  | { readonly _tag: "Gone" }
  | { readonly _tag: "OtherProtocol"; readonly protocol: ProtocolName };

export const fitOf = (
  pools: HashMap.HashMap<PoolId, Pool.Pool>,
  client: RoutedClient,
  id: PoolId,
): Fit => {
  const pool = HashMap.get(pools, id);
  if (Option.isNone(pool)) return { _tag: "Gone" };
  if (pool.value.protocol !== protocolOf(client)) {
    return { _tag: "OtherProtocol", protocol: pool.value.protocol };
  }
  return { _tag: "Fits", pool: pool.value };
};

export type Match =
  | { readonly _tag: "Route"; readonly route: Route }
  | { readonly _tag: "Default"; readonly pool: PoolId }
  | { readonly _tag: "NoRoute" };

/** The first route whose pattern matches the project, else the default pool, else no route (N1 to N4). */
export const match = (list: RouteList, project: string): Match => {
  const route = list.routes.find(({ pattern }) =>
    ProjectPattern.matches(pattern, project),
  );
  if (route !== undefined) return { _tag: "Route", route };
  return Option.match(list.defaultPool, {
    onNone: (): Match => ({ _tag: "NoRoute" }),
    onSome: (pool): Match => ({ _tag: "Default", pool }),
  });
};

export const Reason = Schema.Literals([
  "not-a-pattern",
  "no-such-pool",
  "pool-not-for-client",
  "same-pattern",
  "shadowed",
]);
export type Reason = typeof Reason.Type;

/** Why a list was not stored: a route by its position, or the default pool with none. */
export const Refusal = Schema.Struct({
  position: Schema.Option(Schema.Int),
  reason: Reason,
  shadowedBy: Schema.Option(Schema.Int),
});
export type Refusal = typeof Refusal.Type;

/** A route as the owner sends it, its pattern as written. */
export interface SentRoute {
  readonly pattern: string;
  readonly pool: PoolId;
}

const unfitReason = (fit: Fit): Option.Option<Reason> => {
  switch (fit._tag) {
    case "Fits":
      return Option.none();
    case "Gone":
      return Option.some("no-such-pool");
    case "OtherProtocol":
      return Option.some("pool-not-for-client");
  }
};

/**
 * The routes of a list the owner sends, each pattern trimmed and lowercased,
 * or every reason it is refused: a pattern that is not one, a pool that does
 * not fit, a pattern equal to an earlier one's, or one an earlier prefix
 * pattern shadows (N5 to N7).
 */
export const check = (
  pools: HashMap.HashMap<PoolId, Pool.Pool>,
  client: RoutedClient,
  sent: ReadonlyArray<SentRoute>,
  defaultPool: Option.Option<PoolId>,
): Result.Result<ReadonlyArray<Route>, ReadonlyArray<Refusal>> => {
  const refusals: Array<Refusal> = [];
  const routes: Array<Route> = [];
  const refuse = (
    position: Option.Option<number>,
    reason: Reason,
    shadowedBy: Option.Option<number> = Option.none(),
  ) => refusals.push({ position, reason, shadowedBy });
  for (const [index, { pattern: written, pool }] of sent.entries()) {
    const position = index + 1;
    const pattern = ProjectPattern.parse(written);
    if (Option.isNone(pattern)) refuse(Option.some(position), "not-a-pattern");
    const unfit = unfitReason(fitOf(pools, client, pool));
    if (Option.isSome(unfit)) refuse(Option.some(position), unfit.value);
    if (Option.isNone(pattern)) continue;
    const text = ProjectPattern.textOf(pattern.value);
    const shadowing = routes.find((earlier) =>
      ProjectPattern.shadows(earlier.pattern, pattern.value),
    );
    if (
      routes.some((earlier) => ProjectPattern.textOf(earlier.pattern) === text)
    ) {
      refuse(Option.some(position), "same-pattern");
    } else if (shadowing !== undefined) {
      refuse(
        Option.some(position),
        "shadowed",
        Option.some(shadowing.position),
      );
    }
    routes.push({ position, pattern: pattern.value, pool });
  }
  if (Option.isSome(defaultPool)) {
    const unfit = unfitReason(fitOf(pools, client, defaultPool.value));
    if (Option.isSome(unfit)) refuse(Option.none(), unfit.value);
  }
  return refusals.length === 0 ? Result.succeed(routes) : Result.fail(refusals);
};

/** A route of a list, and whether its pool fits the client now. */
export interface ListedRoute extends Route {
  readonly fit: Fit;
}

export interface ListedRouteList
  extends Omit<RouteList, "routes" | "defaultPool"> {
  readonly routes: ReadonlyArray<ListedRoute>;
  readonly defaultPool: Option.Option<{
    readonly pool: PoolId;
    readonly fit: Fit;
  }>;
}

/** A list with each route's and the default pool's fit under the configuration given. */
export const listed = (
  pools: HashMap.HashMap<PoolId, Pool.Pool>,
  list: RouteList,
): ListedRouteList => ({
  ...list,
  routes: list.routes.map((route) => ({
    ...route,
    fit: fitOf(pools, list.client, route.pool),
  })),
  defaultPool: Option.map(list.defaultPool, (pool) => ({
    pool,
    fit: fitOf(pools, list.client, pool),
  })),
});

export type By =
  | { readonly _tag: "Route"; readonly route: Route }
  | { readonly _tag: "Default" }
  | { readonly _tag: "Override" };

/** The pool one launch bills, and why. */
export interface Answered {
  readonly pool: Pool.Pool;
  readonly by: By;
}

/** No route matches the project, and the client has no default pool. */
export class NoRoute extends Schema.TaggedError<
  NoRoute,
  { readonly brand: unique symbol }
>()("NoRoute", { client: RoutedClient, project: Schema.String }) {}

/** The route or default pool that matching picked names a pool that does not fit the client: by position, or none for the default pool. */
export class RoutePoolGone extends Schema.TaggedError<
  RoutePoolGone,
  { readonly brand: unique symbol }
>()("RoutePoolGone", {
  client: RoutedClient,
  position: Schema.Option(Schema.Int),
  pattern: Schema.Option(Schema.String),
  pool: PoolId,
  protocol: Schema.Option(ProtocolName),
}) {}

/** An override names a pool the configuration does not have. */
export class NoSuchPool extends Schema.TaggedError<
  NoSuchPool,
  { readonly brand: unique symbol }
>()("NoSuchPool", { pool: PoolId }) {}

/** An override names a pool that does not speak the client's protocol. */
export class PoolNotForClient extends Schema.TaggedError<
  PoolNotForClient,
  { readonly brand: unique symbol }
>()("PoolNotForClient", {
  client: RoutedClient,
  pool: PoolId,
  protocol: ProtocolName,
}) {}

export type Unanswered =
  | NoRoute
  | RoutePoolGone
  | NoSuchPool
  | PoolNotForClient;

/**
 * The pool one launch of the list's client bills for a project: an override
 * that fits, whatever the list (N9), else what matching picks, never another
 * pool when the one it picks does not fit (N8).
 */
export const answer = (
  pools: HashMap.HashMap<PoolId, Pool.Pool>,
  list: RouteList,
  project: string,
  override: Option.Option<PoolId>,
): Result.Result<Answered, Unanswered> => {
  const { client } = list;
  if (Option.isSome(override)) {
    const fit = fitOf(pools, client, override.value);
    switch (fit._tag) {
      case "Fits":
        return Result.succeed({ pool: fit.pool, by: { _tag: "Override" } });
      case "Gone":
        return Result.fail(new NoSuchPool({ pool: override.value }));
      case "OtherProtocol":
        return Result.fail(
          new PoolNotForClient({
            client,
            pool: override.value,
            protocol: fit.protocol,
          }),
        );
    }
  }
  const matched = match(list, project);
  if (matched._tag === "NoRoute") {
    return Result.fail(new NoRoute({ client, project }));
  }
  const pool = matched._tag === "Route" ? matched.route.pool : matched.pool;
  const by: By =
    matched._tag === "Route"
      ? { _tag: "Route", route: matched.route }
      : { _tag: "Default" };
  const fit = fitOf(pools, client, pool);
  if (fit._tag === "Fits") return Result.succeed({ pool: fit.pool, by });
  return Result.fail(
    new RoutePoolGone({
      client,
      position:
        matched._tag === "Route"
          ? Option.some(matched.route.position)
          : Option.none(),
      pattern:
        matched._tag === "Route"
          ? Option.some(ProjectPattern.textOf(matched.route.pattern))
          : Option.none(),
      pool,
      protocol:
        fit._tag === "OtherProtocol"
          ? Option.some(fit.protocol)
          : Option.none(),
    }),
  );
};

/** The list was not stored: every reason, by position. */
export class RoutesRefused extends Schema.TaggedError<
  RoutesRefused,
  { readonly brand: unique symbol }
>()("RoutesRefused", {
  client: RoutedClient,
  refusals: Schema.Array(Refusal),
}) {}

/** The change was made from a revision that is no longer the stored one. */
export class RoutesChanged extends Schema.TaggedError<
  RoutesChanged,
  { readonly brand: unique symbol }
>()("RoutesChanged", { client: RoutedClient, revision: Schema.Int }) {}
