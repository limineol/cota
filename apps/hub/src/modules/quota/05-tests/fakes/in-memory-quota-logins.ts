import { Context, Effect, Layer, Option } from "effect";
import { QuotaLogins } from "#modules/quota/02-application/interfaces/quota-logins.ts";
import {
  isReplacedBy,
  type QuotaLogin,
} from "#modules/quota/03-domain/quota-login.ts";
import { HubStoreUnavailable } from "#shared/03-domain/hub-store.ts";
import type { PoolId } from "#shared/03-domain/ids.ts";

/** The rows of the in-memory quota logins, and whether its writes fail as a full disk's would. */
export class Rows extends Context.Service<
  Rows,
  { readonly rows: Map<PoolId, QuotaLogin>; writesFail: boolean }
>()("@cota/hub/quota/InMemoryQuotaLogins/Rows") {}

const full = () =>
  new HubStoreUnavailable({ detail: "database or disk is full" });

const overRows: Layer.Layer<QuotaLogins, never, Rows> = Layer.effect(
  QuotaLogins,
  Effect.gen(function* () {
    const held = yield* Rows;
    const { rows } = held;
    const written = <A>(write: () => A) =>
      held.writesFail ? Effect.fail(full()) : Effect.sync(write);
    return QuotaLogins.of({
      all: Effect.sync(() =>
        [...rows.values()].sort((one, other) =>
          one.pool < other.pool ? -1 : one.pool > other.pool ? 1 : 0,
        ),
      ),
      find: (pool) => Effect.sync(() => Option.fromNullishOr(rows.get(pool))),
      give: (login) =>
        written(() => {
          rows.set(login.pool, login);
        }),
      update: (replacement) =>
        written(() => {
          const { next } = replacement;
          const row = rows.get(next.pool);
          if (row === undefined || !isReplacedBy(row, replacement)) {
            return false;
          }
          rows.set(next.pool, {
            ...row,
            accessToken: next.accessToken,
            refreshToken: next.refreshToken,
            endsAt: next.endsAt,
            refreshedAt: next.refreshedAt,
            expiredAt: next.expiredAt,
          });
          return true;
        }),
      forget: (pool) => written(() => rows.delete(pool)),
    });
  }),
);

/** `QuotaLogins` in memory, as the SQLite adapter keeps them, over rows of its own. */
export const layer: Layer.Layer<QuotaLogins | Rows> = overRows.pipe(
  Layer.provideMerge(
    Layer.sync(Rows, () => Rows.of({ rows: new Map(), writesFail: false })),
  ),
);

/** `QuotaLogins` over rows that outlive it, as a store file outlives the hub. */
export const over = (rows: Rows["Service"]): Layer.Layer<QuotaLogins | Rows> =>
  overRows.pipe(Layer.provideMerge(Layer.succeed(Rows, rows)));
