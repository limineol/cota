import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Schema } from "effect";
import {
  added,
  type Draft,
  moveDown,
  moveUp,
  offeredPools,
  type Placed,
  placed,
  type Reason,
  type Refusal,
  type RoutedClient,
  removeAt,
  sendingOf,
} from "./routes.ts";

const int = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

const pick = <A>(choices: ReadonlyArray<A>) =>
  int(0, choices.length - 1).pipe(
    Arbitrary.map((index) => choices[index] as A),
  );

const patterns = ["acme/*", "acme/api", "notes", "", "  Acme/*  ", "a*b"];
const pools = ["work", "personal", "codex", "gone"];

/** Routes whose keys are distinct and apart from their positions, as the screen's are. */
const draftsOf = (minLength: number) =>
  Arbitrary.array(
    Arbitrary.all({
      pattern: pick(patterns),
      pool: pick<string | null>([...pools, null]),
    }),
    { minLength, maxLength: 12 },
  ).pipe(
    Arbitrary.map(
      (routes): ReadonlyArray<Draft> =>
        routes.map((route, index) => ({ key: 100 + index * 7, ...route })),
    ),
    Arbitrary.flatMap((routes) =>
      int(0, 1_000_000).pipe(
        Arbitrary.map((seed) =>
          [...routes].sort(
            (a, b) => ((a.key * seed) % 97) - ((b.key * seed) % 97),
          ),
        ),
      ),
    ),
  );

const drafts = draftsOf(0);

const withIndex = draftsOf(1).pipe(
  Arbitrary.flatMap((routes) =>
    int(0, routes.length - 1).pipe(
      Arbitrary.map((index) => ({ routes, index })),
    ),
  ),
);

const keysOf = (routes: ReadonlyArray<Draft>) =>
  routes.map((route) => route.key);

const without = (keys: ReadonlyArray<number>, key: number) =>
  keys.filter((each) => each !== key);

describe("editing a client's routes", () => {
  it.prop(
    "V43: moving a route up or down takes it one place earlier or later, but at the end it is already at, removing takes out that route alone, and adding puts the new route after the last; every other route keeps its order",
    { picked: withIndex, pattern: pick(patterns) },
    ({ picked: { routes, index }, pattern }) => {
      const before = keysOf(routes);
      const moved = before[index] ?? -1;
      const last = routes.length - 1;

      const up = keysOf(moveUp(routes, index));
      expect([...up].sort()).toEqual([...before].sort());
      expect(up.indexOf(moved)).toBe(Math.max(index - 1, 0));
      expect(without(up, moved)).toEqual(without(before, moved));

      const down = keysOf(moveDown(routes, index));
      expect([...down].sort()).toEqual([...before].sort());
      expect(down.indexOf(moved)).toBe(Math.min(index + 1, last));
      expect(without(down, moved)).toEqual(without(before, moved));

      expect(keysOf(removeAt(routes, index))).toEqual(without(before, moved));

      const route: Draft = { key: 1, pattern, pool: null };
      expect(added(routes, route)).toEqual([...routes, route]);
    },
  );

  it.prop(
    "V44: what is sent is the routes as shown, the n-th at position n with its pattern and pool, the key of each beside it, and the default pool as shown, at the revision read; while a route has no pool nothing is sent, and the positions of those routes are named",
    {
      routes: drafts,
      revision: int(0, 50),
      defaultPool: pick<string | null>([...pools, null]),
    },
    ({ routes, revision, defaultPool }) => {
      const sending = sendingOf(revision, routes, defaultPool);
      const unchosen = routes.flatMap((route, index) =>
        route.pool === null ? [index + 1] : [],
      );
      if (unchosen.length > 0) {
        expect(sending).toEqual({ _tag: "Unchosen", positions: unchosen });
        return;
      }
      expect(sending._tag).toBe("Send");
      if (sending._tag !== "Send") return;
      expect(sending.body.revision).toBe(revision);
      expect(sending.body.defaultPool).toBe(defaultPool);
      expect(sending.body.routes).toHaveLength(routes.length);
      routes.forEach((route, index) => {
        expect(sending.body.routes[index]).toEqual({
          pattern: route.pattern,
          pool: route.pool,
        });
        expect(sending.keys[index]).toBe(route.key);
      });
    },
  );

  const reasons: ReadonlyArray<Reason> = [
    "not-a-pattern",
    "no-such-pool",
    "pool-not-for-client",
    "same-pattern",
    "shadowed",
  ];

  const refused = drafts.pipe(
    Arbitrary.flatMap((routes) =>
      Arbitrary.array(
        Arbitrary.all({
          position: pick<number | null>([
            null,
            ...Array.from({ length: routes.length + 2 }, (_, at) => at + 1),
          ]),
          reason: pick(reasons),
          shadowedBy: pick<number | null>([
            null,
            ...Array.from({ length: routes.length + 2 }, (_, at) => at + 1),
          ]),
        }),
        { maxLength: 10 },
      ).pipe(
        Arbitrary.map((refusals: ReadonlyArray<Refusal>) => ({
          keys: keysOf(routes),
          refusals,
        })),
      ),
    ),
  );

  it.prop(
    "V45: each refusal is said once, on the row of the route sent at its position, which it follows as the route moves, the default pool's on the default pool, and one at a position nothing was sent at apart from the rows; a row's refusals keep the hub's order, and a shadowed route names the route sent at the position that shadows it",
    { refused },
    ({ refused: { keys, refusals } }) => {
      const where = placed(refusals, keys);
      const said = (refusal: Refusal): Placed => ({
        reason: refusal.reason,
        shadowedBy:
          refusal.shadowedBy === null
            ? null
            : (keys[refusal.shadowedBy - 1] ?? null),
      });
      keys.forEach((key, index) => {
        expect(where.routes.get(key) ?? []).toEqual(
          refusals
            .filter((refusal) => refusal.position === index + 1)
            .map(said),
        );
      });
      expect([...where.routes.keys()].every((key) => keys.includes(key))).toBe(
        true,
      );
      expect(where.defaultPool).toEqual(
        refusals.filter((refusal) => refusal.position === null).map(said),
      );
      expect(where.unplaced).toEqual(
        refusals.filter(
          (refusal) =>
            refusal.position !== null && refusal.position > keys.length,
        ),
      );
    },
  );

  const protocols = ["anthropic-messages", "chatgpt-codex", "openai-chat"];
  const spoken: Record<RoutedClient, string> = {
    "claude-code": "anthropic-messages",
    codex: "chatgpt-codex",
  };

  const configuration = Arbitrary.array(pick(protocols), {
    maxLength: 10,
  }).pipe(
    Arbitrary.map((each) =>
      each.map((protocol, index) => ({ id: `pool-${index}`, protocol })),
    ),
  );

  it.prop(
    "V46: a select offers every pool of the configuration that speaks the client's protocol and no other, in the configuration's order, and the pool chosen beside them when it is not among them",
    {
      client: pick<RoutedClient>(["claude-code", "codex"]),
      pools: configuration,
      chosen: pick<string | null>([null, "pool-0", "pool-3", "pool-9", "gone"]),
    },
    ({ client, pools, chosen }) => {
      const offered = offeredPools(client, pools, chosen);
      expect(offered.fitting).toEqual(
        pools.filter((pool) => pool.protocol === spoken[client]),
      );
      const among = offered.fitting.some((pool) => pool.id === chosen);
      expect(offered.unfit).toBe(chosen === null || among ? null : chosen);
    },
  );
});
