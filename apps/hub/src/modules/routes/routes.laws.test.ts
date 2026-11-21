import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "@effect/vitest";
import {
  Arbitrary,
  Effect,
  HashMap,
  Layer,
  Option,
  Result,
  Schema,
} from "effect";
import { ChangeRoutes } from "#modules/routes/02-application/commands/change-routes.command.ts";
import { ListRoutes } from "#modules/routes/02-application/queries/list-routes.query.ts";
import * as ProjectPattern from "#modules/routes/03-domain/project-pattern.ts";
import * as RouteList from "#modules/routes/03-domain/route-list.ts";
import * as SqliteRoutes from "#modules/routes/04-infrastructure/persistence/sqlite/sqlite-routes.repository.ts";
import * as InMemoryRoutes from "#modules/routes/05-tests/fakes/in-memory-routes.repository.ts";
import * as Generated from "#modules/routes/05-tests/routes.ts";
import * as RoutesModule from "#modules/routes/module.ts";
import { PoolId } from "#shared/03-domain/ids.ts";
import type * as Pool from "#shared/03-domain/pool.entity.ts";
import * as HubStore from "#shared/04-infrastructure/hub-store/hub-store.ts";

const scratch = mkdtempSync(join(tmpdir(), "cota-routes-laws-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let stores = 0;
const freshPath = () => {
  stores += 1;
  return join(scratch, `${stores}.sqlite`);
};

const inMemory = (pools: HashMap.HashMap<PoolId, Pool.Pool>) =>
  RoutesModule.overRepository(pools).pipe(Layer.provide(InMemoryRoutes.layer));

const inSqlite = (pools: HashMap.HashMap<PoolId, Pool.Pool>, path: string) =>
  RoutesModule.overRepository(pools).pipe(
    Layer.provide(SqliteRoutes.layer),
    Layer.provide(HubStore.layer({ path, steps: SqliteRoutes.steps })),
    Layer.orDie,
  );

const fitsBySpec = (
  pools: HashMap.HashMap<PoolId, Pool.Pool>,
  client: RouteList.RoutedClient,
  pool: PoolId,
) =>
  Option.exists(
    HashMap.get(pools, pool),
    ({ protocol }) =>
      protocol ===
      (client === "claude-code" ? "anthropic-messages" : "chatgpt-codex"),
  );

const sentList = Arbitrary.all({
  client: Generated.client,
  routes: Arbitrary.array(
    Arbitrary.all({
      pattern: Generated.writtenPattern,
      pool: Generated.poolId,
    }),
    { maxLength: 3 },
  ),
  withDefault: Arbitrary.schema(Schema.Boolean),
  defaultPool: Generated.poolId,
});

const p = (id: string) => PoolId.make(id);

/** Every pool fits one client or the other: `p1` and `p2` Claude Code, `p3` Codex. */
const pools = HashMap.make(
  [p("p1"), Generated.poolOf(p("p1"), "anthropic-messages", false)],
  [p("p2"), Generated.poolOf(p("p2"), "anthropic-messages", true)],
  [p("p3"), Generated.poolOf(p("p3"), "chatgpt-codex", false)],
);

interface Content {
  readonly routes: ReadonlyArray<RouteList.SentRoute>;
  readonly defaultPool: Option.Option<PoolId>;
}

/** Lists a client's change may send, every one of which is accepted. */
const contents = (
  client: RouteList.RoutedClient,
): readonly [Content, Content, Content, Content] => {
  const [one, two] =
    client === "claude-code" ? [p("p1"), p("p2")] : [p("p3"), p("p3")];
  return [
    { routes: [], defaultPool: Option.none() },
    {
      routes: [{ pattern: "acme/*", pool: one }],
      defaultPool: Option.some(two),
    },
    {
      routes: [
        { pattern: "acme/api", pool: two },
        { pattern: "acme/*", pool: one },
      ],
      defaultPool: Option.none(),
    },
    { routes: [{ pattern: "beta", pool: one }], defaultPool: Option.some(one) },
  ];
};

/** A change of one client's list, from its revision then (`current`), the one before, or one no step reaches. */
const Change = Schema.Struct({
  client: RouteList.RoutedClient,
  from: Schema.Literals(["current", "before", "after"]),
  content: Schema.Literals([0, 1, 2, 3]),
});
type Change = typeof Change.Type;

/** Steps of changes, each step's sent together; a step of one is a change sent alone. */
const steps = Arbitrary.array(
  Arbitrary.array(
    Arbitrary.all({
      change: Arbitrary.schema(Change),
      current: Arbitrary.schema(Schema.Boolean),
    }).pipe(
      Arbitrary.map(({ change, current }) =>
        current ? { ...change, from: "current" as const } : change,
      ),
    ),
    { minLength: 1, maxLength: 3 },
  ),
  { minLength: 1, maxLength: 6 },
);

const listOf = (
  lists: ReadonlyArray<RouteList.ListedRouteList>,
  client: RouteList.RoutedClient,
) => {
  const list = lists.find((each) => each.client === client);
  return {
    revision: list?.revision ?? -1,
    routes: (list?.routes ?? []).map(({ pattern, pool }) => ({
      pattern: ProjectPattern.textOf(pattern),
      pool,
    })),
    defaultPool:
      list?.defaultPool.pipe(Option.map(({ pool }) => pool)) ?? Option.none(),
  };
};

/**
 * Sends each step's changes together, and gives, per step, which changes were
 * answered as stored, with the lists read after it.
 */
const run = (sequence: ReadonlyArray<ReadonlyArray<Change>>) =>
  Effect.gen(function* () {
    const change = yield* ChangeRoutes;
    const list = yield* ListRoutes;
    const revisions = new Map<RouteList.RoutedClient, number>([
      ["claude-code", 0],
      ["codex", 0],
    ]);
    const answered: Array<{
      readonly sent: ReadonlyArray<Change & { readonly revision: number }>;
      readonly stored: ReadonlyArray<boolean>;
      readonly after: ReadonlyArray<RouteList.ListedRouteList>;
    }> = [];
    for (const step of sequence) {
      const sent = step.map((each) => {
        const current = revisions.get(each.client) ?? 0;
        return {
          ...each,
          revision:
            each.from === "current"
              ? current
              : each.from === "before" && current > 0
                ? current - 1
                : current + 5,
        };
      });
      const results = yield* Effect.all(
        sent.map((each) =>
          Effect.result(
            change.execute({
              client: each.client,
              revision: each.revision,
              ...contents(each.client)[each.content],
            }),
          ),
        ),
        { concurrency: "unbounded" },
      );
      const after = yield* list.execute.pipe(Effect.orDie);
      for (const client of RouteList.routedClients) {
        revisions.set(client, listOf(after, client).revision);
      }
      answered.push({
        sent,
        stored: results.map(Result.isSuccess),
        after,
      });
    }
    return answered;
  });

const holds = (answered: Effect.Success<ReturnType<typeof run>>) => {
  const revisions = new Map<RouteList.RoutedClient, number>([
    ["claude-code", 0],
    ["codex", 0],
  ]);
  const kept = new Map<RouteList.RoutedClient, ReturnType<typeof listOf>>([
    ["claude-code", { revision: 0, routes: [], defaultPool: Option.none() }],
    ["codex", { revision: 0, routes: [], defaultPool: Option.none() }],
  ]);
  for (const { sent, stored, after } of answered) {
    for (const client of RouteList.routedClients) {
      const current = revisions.get(client) ?? 0;
      const fromCurrent = sent.flatMap((each, index) =>
        each.client === client && each.revision === current ? [index] : [],
      );
      const others = sent.flatMap((each, index) =>
        each.client === client && each.revision !== current ? [index] : [],
      );
      const winners = fromCurrent.filter((index) => stored[index]);
      expect(winners.length).toBe(fromCurrent.length === 0 ? 0 : 1);
      expect(others.filter((index) => stored[index])).toEqual([]);
      const winner = sent[winners[0] ?? -1];
      if (winner !== undefined) {
        const content = contents(client)[winner.content];
        kept.set(client, {
          revision: current + 1,
          routes: [...content.routes],
          defaultPool: content.defaultPool,
        });
        revisions.set(client, current + 1);
      }
      expect(listOf(after, client)).toEqual(kept.get(client));
    }
  }
};

describe("routes laws over the store", () => {
  it.effect.prop(
    "N7: a list is stored only when each of its routes' pools, and its default pool, fits the client at that moment",
    { pools: Generated.pools, sent: sentList },
    ({ pools, sent }) =>
      Effect.gen(function* () {
        const defaultPool = sent.withDefault
          ? Option.some(sent.defaultPool)
          : Option.none();
        const changed = yield* Effect.result(
          (yield* ChangeRoutes).execute({
            client: sent.client,
            revision: 0,
            routes: sent.routes,
            defaultPool,
          }),
        );
        if (Result.isFailure(changed)) return;
        expect(
          [
            ...sent.routes.map(({ pool }) => pool),
            ...Option.toArray(defaultPool),
          ].filter((pool) => !fitsBySpec(pools, sent.client, pool)),
        ).toEqual([]);
      }).pipe(Effect.provide(inMemory(pools))),
    { arbitrary: { runs: 500 } },
  );

  it.effect.prop(
    "N10: of changes sent from the same revision, one at a time or together, exactly one is stored, and every stored list is exactly the routes and default pool of one change, in memory and in SQLite",
    { sequence: steps },
    ({ sequence }) =>
      Effect.gen(function* () {
        holds(yield* run(sequence).pipe(Effect.provide(inMemory(pools))));
        holds(
          yield* run(sequence).pipe(
            Effect.provide(inSqlite(pools, freshPath())),
          ),
        );
      }),
    { arbitrary: { runs: 100 } },
  );
});
