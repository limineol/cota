/** The clients whose launches routes choose a pool for (ADR-0023). */
export type RoutedClient = "claude-code" | "codex";

/** The protocol a routed client speaks, which every pool it bills speaks too (`docs/specs/routes/spec.md`, Values). */
export const protocolOf = (client: RoutedClient) =>
  client === "claude-code" ? "anthropic-messages" : "chatgpt-codex";

/** A route as the list being edited holds it: a key that follows it as it moves, its pattern as typed, and its pool, or none chosen yet. */
export interface Draft {
  readonly key: number;
  readonly pattern: string;
  readonly pool: string | null;
}

const swapped = <A>(list: ReadonlyArray<A>, at: number): ReadonlyArray<A> => {
  const first = list[at];
  const second = list[at + 1];
  if (first === undefined || second === undefined) return list;
  return [...list.slice(0, at), second, first, ...list.slice(at + 2)];
};

/** The list with the route at `index` one place earlier, and unchanged for the first (V43). */
export const moveUp = <A>(list: ReadonlyArray<A>, index: number) =>
  index < 1 ? list : swapped(list, index - 1);

/** The list with the route at `index` one place later, and unchanged for the last (V43). */
export const moveDown = <A>(list: ReadonlyArray<A>, index: number) =>
  swapped(list, index);

/** The list without the route at `index` (V43). */
export const removeAt = <A>(list: ReadonlyArray<A>, index: number) =>
  list.filter((_, at) => at !== index);

/** The list with a route added after its last (V43). */
export const added = <A>(list: ReadonlyArray<A>, route: A) => [...list, route];

/** What `PUT /api/routes/{client}` takes. */
export interface Sent {
  readonly revision: number;
  readonly routes: ReadonlyArray<{
    readonly pattern: string;
    readonly pool: string;
  }>;
  readonly defaultPool: string | null;
}

/**
 * What Save sends: the routes as shown, in order, so that the n-th is the
 * hub's position n, with the key of the route sent at each position, and the
 * default pool as shown; or, while a route has no pool chosen, nothing, and
 * the positions of those routes (V44).
 */
export type Sending =
  | {
      readonly _tag: "Send";
      readonly body: Sent;
      readonly keys: ReadonlyArray<number>;
    }
  | { readonly _tag: "Unchosen"; readonly positions: ReadonlyArray<number> };

export const sendingOf = (
  revision: number,
  routes: ReadonlyArray<Draft>,
  defaultPool: string | null,
): Sending => {
  const chosen = routes.flatMap(({ pattern, pool }) =>
    pool === null ? [] : [{ pattern, pool }],
  );
  if (chosen.length < routes.length) {
    return {
      _tag: "Unchosen",
      positions: routes.flatMap((route, index) =>
        route.pool === null ? [index + 1] : [],
      ),
    };
  }
  return {
    _tag: "Send",
    body: { revision, routes: chosen, defaultPool },
    keys: routes.map((route) => route.key),
  };
};

/** Why the hub refused a route or the default pool (`docs/specs/routes/spec.md`, Checking a list). */
export type Reason =
  | "not-a-pattern"
  | "no-such-pool"
  | "pool-not-for-client"
  | "same-pattern"
  | "shadowed";

/** One refusal of `routes-refused`, as the hub names it: a position, or null for the default pool. */
export interface Refusal {
  readonly position: number | null;
  readonly reason: Reason;
  readonly shadowedBy: number | null;
}

/** A refusal on the row it concerns; `shadowedBy` is the key of the route sent at the position that shadows it. */
export interface Placed {
  readonly reason: Reason;
  readonly shadowedBy: number | null;
}

export interface Refusals {
  readonly routes: ReadonlyMap<number, ReadonlyArray<Placed>>;
  readonly defaultPool: ReadonlyArray<Placed>;
  readonly unplaced: ReadonlyArray<Refusal>;
}

/**
 * Where each refusal is said: on the row of the route sent at its position,
 * found by the key sent there so that it follows the route if it moves; the
 * default pool's on the default pool; one naming a position nothing was sent
 * at among the unplaced. Each refusal once, in the hub's order (V45).
 */
export const placed = (
  refusals: ReadonlyArray<Refusal>,
  keys: ReadonlyArray<number>,
): Refusals => {
  const keyAt = (position: number | null) =>
    position === null ? undefined : keys[position - 1];
  const routes = new Map<number, ReadonlyArray<Placed>>();
  const defaultPool: Array<Placed> = [];
  const unplaced: Array<Refusal> = [];
  for (const refusal of refusals) {
    const said: Placed = {
      reason: refusal.reason,
      shadowedBy: keyAt(refusal.shadowedBy) ?? null,
    };
    if (refusal.position === null) {
      defaultPool.push(said);
      continue;
    }
    const key = keyAt(refusal.position);
    if (key === undefined) {
      unplaced.push(refusal);
      continue;
    }
    routes.set(key, [...(routes.get(key) ?? []), said]);
  }
  return { routes, defaultPool, unplaced };
};

/** What the select of a route's pool, or of the default pool, offers. */
export interface Offered<P> {
  readonly fitting: ReadonlyArray<P>;
  readonly unfit: string | null;
}

/**
 * The pools a select offers: those of the configuration that speak the
 * client's protocol, in the configuration's order; and the pool chosen, as
 * `unfit`, when it is not among them, so that a route is never shown with a
 * pool it does not have (V46).
 */
export const offeredPools = <
  P extends { readonly id: string; readonly protocol: string | null },
>(
  client: RoutedClient,
  pools: ReadonlyArray<P>,
  chosen: string | null,
): Offered<P> => {
  const fitting = pools.filter((pool) => pool.protocol === protocolOf(client));
  return {
    fitting,
    unfit:
      chosen === null || fitting.some((pool) => pool.id === chosen)
        ? null
        : chosen,
  };
};
