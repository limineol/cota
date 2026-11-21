import {
  Context,
  Effect,
  Fiber,
  HashMap,
  Layer,
  Option,
  Redacted,
  Ref,
} from "effect";
import type { PoolId } from "#shared/03-domain/ids.ts";
import {
  type Generation,
  isReplacedBy,
  type QuotaLogin,
  type Replacement,
} from "./quota-login.ts";
import type { QuotaLoginExpired, ReadFailure } from "./readings.ts";

/** A refresh's outcome: the login refreshed, the refresh's failure, or the login found or made expired. */
export type Refresh = Effect.Effect<
  QuotaLogin,
  ReadFailure | QuotaLoginExpired
>;

interface Running {
  readonly token: object;
  readonly start: Effect.Effect<
    Fiber.Fiber<QuotaLogin, ReadFailure | QuotaLoginExpired>
  >;
}

/** The refreshes of quota logins under way, and the refreshed logins the hub store has not taken yet. */
export class Refreshes extends Context.Service<
  Refreshes,
  {
    /**
     * Runs `refresh` of a quota login unless a refresh of that login runs,
     * whose outcome it then takes: one refresh at a time per login (G3). A
     * refresh runs to its end even when nobody waits for it any more, since
     * the provider may have rotated its refresh token already.
     */
    readonly once: (login: QuotaLogin, refresh: Refresh) => Refresh;
    /** The refreshed login the store has not taken over `row`, if any. */
    readonly unwritten: (
      row: QuotaLogin,
    ) => Effect.Effect<Option.Option<Replacement>>;
    /** The login as the hub holds it: the refreshed one the store has not taken over `row`, else `row`. */
    readonly latest: (row: QuotaLogin) => Effect.Effect<QuotaLogin>;
    /** Holds a refreshed login the store did not take, in place of one held of the same login. */
    readonly hold: (unwritten: Replacement) => Effect.Effect<void>;
    /** Lets go of a held login the store has now taken: one of the same login holding the same refresh token. */
    readonly written: (login: QuotaLogin) => Effect.Effect<void>;
    /** Lets go of every refreshed login held for the pool. */
    readonly drop: (pool: PoolId) => Effect.Effect<void>;
  }
>()("@cota/hub/quota/Refreshes") {}

export const layer: Layer.Layer<Refreshes> = Layer.effect(
  Refreshes,
  Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const running = yield* Ref.make(HashMap.empty<Generation, Running>());
    const held = yield* Ref.make(
      HashMap.empty<PoolId, HashMap.HashMap<Generation, Replacement>>(),
    );

    const heldOf = (
      map: HashMap.HashMap<PoolId, HashMap.HashMap<Generation, Replacement>>,
      pool: PoolId,
    ) => Option.getOrElse(HashMap.get(map, pool), () => HashMap.empty());

    const unwritten = (row: QuotaLogin) =>
      Effect.map(Ref.get(held), (map) =>
        Option.filter(
          HashMap.get(heldOf(map, row.pool), row.generation),
          (replacement) => isReplacedBy(row, replacement),
        ),
      );

    return Refreshes.of({
      once: Effect.fn("Refreshes.once")(function* (
        login: QuotaLogin,
        refresh: Refresh,
      ) {
        const key = login.generation;
        const token = {};
        const ended = Ref.update(running, (map) =>
          Option.exists(HashMap.get(map, key), (entry) => entry.token === token)
            ? HashMap.remove(map, key)
            : map,
        );
        const start = yield* Effect.cached(
          Effect.forkIn(refresh.pipe(Effect.ensuring(ended)), scope),
        );
        const chosen = yield* Ref.modify(running, (map) => {
          const entry = HashMap.get(map, key);
          if (Option.isSome(entry)) return [entry.value.start, map] as const;
          return [start, HashMap.set(map, key, { token, start })] as const;
        });
        const fiber = yield* Effect.uninterruptible(chosen);
        return yield* Fiber.join(fiber);
      }),
      unwritten,
      latest: (row) =>
        Effect.map(
          unwritten(row),
          Option.match({ onNone: () => row, onSome: ({ next }) => next }),
        ),
      hold: (replacement) =>
        Ref.update(held, (map) =>
          HashMap.set(
            map,
            replacement.next.pool,
            HashMap.set(
              heldOf(map, replacement.next.pool),
              replacement.next.generation,
              replacement,
            ),
          ),
        ),
      written: (login) =>
        Ref.update(held, (map) =>
          Option.exists(
            HashMap.get(heldOf(map, login.pool), login.generation),
            ({ next }) =>
              Redacted.value(next.refreshToken) ===
              Redacted.value(login.refreshToken),
          )
            ? HashMap.set(
                map,
                login.pool,
                HashMap.remove(heldOf(map, login.pool), login.generation),
              )
            : map,
        ),
      drop: (pool) => Ref.update(held, HashMap.remove(pool)),
    });
  }),
);
