import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Effect, HashMap, Option, Result, Schema } from "effect";
import * as Generated from "#modules/routes/05-tests/routes.ts";
import { PoolId } from "#shared/03-domain/ids.ts";
import type * as Pool from "#shared/03-domain/pool.entity.ts";
import * as ProjectPattern from "./project-pattern.ts";
import * as RouteList from "./route-list.ts";

const override = Arbitrary.all({
  some: Arbitrary.schema(Schema.Boolean),
  pool: Generated.poolId,
}).pipe(
  Arbitrary.map(({ some, pool }) =>
    some ? Option.some(pool) : Option.none<PoolId>(),
  ),
);

/** An answer in a few words, so that two can be compared whatever the project in it. */
const summaryOf = (
  answered: Result.Result<RouteList.Answered, RouteList.Unanswered>,
): string => {
  if (Result.isSuccess(answered)) {
    const { pool, by } = answered.success;
    return by._tag === "Route"
      ? `route ${by.route.position}: ${pool.id}`
      : `${by._tag.toLowerCase()}: ${pool.id}`;
  }
  const failure = answered.failure;
  switch (failure._tag) {
    case "NoRoute":
      return "no route";
    case "RoutePoolGone":
      return `gone ${Option.getOrElse(failure.position, () => "default")}: ${failure.pool}`;
    case "NoSuchPool":
      return `no such pool: ${failure.pool}`;
    case "PoolNotForClient":
      return `not for the client: ${failure.pool}`;
  }
};

const fitsBySpec = (
  pools: HashMap.HashMap<PoolId, Pool.Pool>,
  client: RouteList.RoutedClient,
  pool: PoolId,
) =>
  Option.match(HashMap.get(pools, pool), {
    onNone: () => "gone" as const,
    onSome: (found) =>
      found.kind !== "observed" &&
      found.protocol ===
        (client === "claude-code" ? "anthropic-messages" : "chatgpt-codex")
        ? ("fits" as const)
        : ("other" as const),
  });

/** The route matching picks by reading the list in order with the spec's rule. */
const firstBySpec = (list: RouteList.RouteList, project: string) =>
  list.routes.find(({ pattern }) =>
    Generated.matchesBySpec(ProjectPattern.textOf(pattern), project),
  );

/** The answer the spec's matching gives, worked out by reading the list in order. */
const answerBySpec = (
  pools: HashMap.HashMap<PoolId, Pool.Pool>,
  list: RouteList.RouteList,
  project: string,
  override: Option.Option<PoolId>,
): string => {
  if (Option.isSome(override)) {
    const fit = fitsBySpec(pools, list.client, override.value);
    if (fit === "gone") return `no such pool: ${override.value}`;
    if (fit === "other") return `not for the client: ${override.value}`;
    return `override: ${override.value}`;
  }
  const route = firstBySpec(list, project);
  if (route !== undefined) {
    return fitsBySpec(pools, list.client, route.pool) === "fits"
      ? `route ${route.position}: ${route.pool}`
      : `gone ${route.position}: ${route.pool}`;
  }
  if (Option.isNone(list.defaultPool)) return "no route";
  const pool = list.defaultPool.value;
  return fitsBySpec(pools, list.client, pool) === "fits"
    ? `default: ${pool}`
    : `gone default: ${pool}`;
};

/** Whether `later` matches no project of the search that `earlier` does not. */
const covers = (
  earlier: string,
  later: string,
  projects: ReadonlyArray<string>,
) =>
  projects.every(
    (project) =>
      !Generated.matchesBySpec(later, project) ||
      Generated.matchesBySpec(earlier, project),
  );

const searchOf = (patterns: ReadonlyArray<string>) =>
  Generated.everyProject(
    Math.max(0, ...patterns.map((pattern) => pattern.replace("*", "").length)) +
      2,
  );

const sentList = Arbitrary.array(
  Arbitrary.all({
    pattern: Generated.anyWrittenPattern,
    pool: Generated.poolId,
  }),
  { maxLength: 12 },
);

/** A configuration in which every pool of `p1` to `p4` fits Claude Code. */
const fitting = HashMap.fromIterable(
  Generated.poolIds
    .slice(0, 4)
    .map(
      (id, index) =>
        [
          id,
          Generated.poolOf(id, "anthropic-messages", index % 2 === 0),
        ] as const,
    ),
);

const runs = { arbitrary: { runs: 1000 } };

describe("routes laws", () => {
  it.effect.prop(
    "N1: for every list and project, matching gives exactly one of a route, the default pool or no route, and the same one every time",
    {
      pools: Generated.pools,
      list: Generated.list,
      project: Generated.project,
      override,
    },
    ({ pools, list, project, override }) =>
      Effect.sync(() => {
        const once = RouteList.match(list, project);
        expect(["Route", "Default", "NoRoute"]).toContain(once._tag);
        expect(RouteList.match(list, project)).toEqual(once);
        const answered = summaryOf(
          RouteList.answer(pools, list, project, override),
        );
        expect([
          answered,
          summaryOf(RouteList.answer(pools, list, project, override)),
        ]).toEqual([
          answerBySpec(pools, list, project, override),
          answerBySpec(pools, list, project, override),
        ]);
      }),
    runs,
  );

  it.effect.prop(
    "N2: the route answered matches the project, and no route before it does",
    { list: Generated.list, project: Generated.project },
    ({ list, project }) =>
      Effect.sync(() => {
        const matched = RouteList.match(list, project);
        const first = firstBySpec(list, project);
        expect(
          matched._tag === "Route" ? matched.route.position : undefined,
        ).toBe(first?.position);
      }),
    runs,
  );

  it.effect.prop(
    "N3: the default pool is answered exactly when no route matches and the client has one, and no route exactly when it has neither",
    { list: Generated.list, project: Generated.project },
    ({ list, project }) =>
      Effect.sync(() => {
        const matched = RouteList.match(list, project);
        const none = firstBySpec(list, project) === undefined;
        expect([
          matched._tag === "Default"
            ? Option.some(matched.pool)
            : Option.none(),
          matched._tag === "NoRoute",
        ]).toEqual([
          none ? list.defaultPool : Option.none(),
          none && Option.isNone(list.defaultPool),
        ]);
      }),
    runs,
  );

  it.effect.prop(
    "N4: a project gives the same answer as the same project lowercased",
    {
      pools: Generated.pools,
      list: Generated.list,
      project: Generated.project,
      override,
    },
    ({ pools, list, project, override }) =>
      Effect.sync(() => {
        expect(
          summaryOf(RouteList.answer(pools, list, project, override)),
        ).toBe(
          summaryOf(
            RouteList.answer(pools, list, project.toLowerCase(), override),
          ),
        );
        expect(RouteList.match(list, project)).toEqual(
          RouteList.match(list, project.toLowerCase()),
        );
      }),
    runs,
  );

  it.effect.prop(
    "N5: a route is refused as shadowed, or as the same pattern, exactly when an earlier route of its list matches every project it matches",
    { pools: Generated.pools, client: Generated.client, sent: sentList },
    ({ pools, client, sent }) =>
      Effect.sync(() => {
        const checked = RouteList.check(pools, client, sent, Option.none());
        const refused = Result.isFailure(checked) ? checked.failure : [];
        const patterns = sent.map(({ pattern }) =>
          Option.map(ProjectPattern.parse(pattern), ProjectPattern.textOf),
        );
        const projects = searchOf(
          patterns.flatMap((pattern) => Option.toArray(pattern)),
        );
        const asShadowed = sent.map((_, index) =>
          refused.some(
            ({ position, reason }) =>
              Option.getOrUndefined(position) === index + 1 &&
              (reason === "shadowed" || reason === "same-pattern"),
          ),
        );
        const coveredByEarlier = patterns.map((pattern, index) =>
          Option.match(pattern, {
            onNone: () => false,
            onSome: (later) =>
              patterns.slice(0, index).some((earlier) =>
                Option.match(earlier, {
                  onNone: () => false,
                  onSome: (earlier) => covers(earlier, later, projects),
                }),
              ),
          }),
        );
        expect(asShadowed).toEqual(coveredByEarlier);
      }),
    { arbitrary: { runs: 200 } },
  );

  it.effect.prop(
    "N6: in every list the hub stores, each route is the first match of some project",
    { sent: sentList },
    ({ sent }) =>
      Effect.sync(() => {
        const pool = PoolId.make("p1");
        const accepted: Array<RouteList.SentRoute> = [];
        for (const route of sent) {
          const tried = [...accepted, { pattern: route.pattern, pool }];
          if (
            Result.isSuccess(
              RouteList.check(fitting, "claude-code", tried, Option.none()),
            )
          ) {
            accepted.push({ pattern: route.pattern, pool });
          }
        }
        const checked = RouteList.check(
          fitting,
          "claude-code",
          accepted,
          Option.none(),
        );
        expect(Result.isSuccess(checked)).toBe(true);
        const routes = Result.isSuccess(checked) ? checked.success : [];
        const list: RouteList.RouteList = {
          ...RouteList.neverStored("claude-code"),
          routes,
        };
        const projects = searchOf(
          routes.map(({ pattern }) => ProjectPattern.textOf(pattern)),
        );
        const winners = new Set(
          projects.flatMap((project) =>
            Option.toArray(
              Option.fromUndefinedOr(firstBySpec(list, project)?.position),
            ),
          ),
        );
        expect(routes.filter(({ position }) => !winners.has(position))).toEqual(
          [],
        );
      }),
    { arbitrary: { runs: 200 } },
  );

  it.effect.prop(
    "N8: when the route or default pool that matching picks does not fit the client, the answer is route-pool-gone, never another pool",
    {
      pools: Generated.pools,
      list: Generated.list,
      project: Generated.project,
    },
    ({ pools, list, project }) =>
      Effect.sync(() => {
        const route = firstBySpec(list, project);
        const picked =
          route === undefined
            ? Option.map(list.defaultPool, (pool) => ({
                which: "default",
                pool,
              }))
            : Option.some({ which: String(route.position), pool: route.pool });
        const answered = summaryOf(
          RouteList.answer(pools, list, project, Option.none()),
        );
        if (
          Option.isSome(picked) &&
          fitsBySpec(pools, list.client, picked.value.pool) !== "fits"
        ) {
          expect(answered).toBe(
            `gone ${picked.value.which}: ${picked.value.pool}`,
          );
        }
      }),
    runs,
  );

  it.effect.prop(
    "N9: with an override that fits the client, the answer is that pool, whatever the client's list",
    {
      pools: Generated.pools,
      list: Generated.list,
      project: Generated.project,
      pool: Generated.poolId,
    },
    ({ pools, list, project, pool }) =>
      Effect.sync(() => {
        if (fitsBySpec(pools, list.client, pool) !== "fits") return;
        expect(
          summaryOf(RouteList.answer(pools, list, project, Option.some(pool))),
        ).toBe(`override: ${pool}`);
      }),
    runs,
  );
});
