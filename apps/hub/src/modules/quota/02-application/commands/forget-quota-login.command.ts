import { Context, Effect, HashMap, Layer } from "effect";
import { QuotaLogins } from "#modules/quota/02-application/interfaces/quota-logins.ts";
import * as QuotaLogin from "#modules/quota/03-domain/quota-login.ts";
import { Readings } from "#modules/quota/03-domain/readings.ts";
import { Refreshes } from "#modules/quota/03-domain/refreshes.ts";
import type { HubStoreUnavailable } from "#shared/03-domain/hub-store.ts";
import type { PoolId } from "#shared/03-domain/ids.ts";
import type * as Pool from "#shared/03-domain/pool.entity.ts";

export class ForgetQuotaLogin extends Context.Service<
  ForgetQuotaLogin,
  {
    /** Forgets a pool's quota login, expired or not, and the pool's reading state. */
    readonly execute: (
      pool: PoolId,
    ) => Effect.Effect<
      void,
      QuotaLogin.NoSuchPool | QuotaLogin.NoQuotaLogin | HubStoreUnavailable
    >;
  }
>()("@cota/hub/quota/ForgetQuotaLogin") {}

export const layer = (
  pools: HashMap.HashMap<PoolId, Pool.Pool>,
): Layer.Layer<ForgetQuotaLogin, never, QuotaLogins | Refreshes | Readings> =>
  Layer.effect(
    ForgetQuotaLogin,
    Effect.gen(function* () {
      const store = yield* QuotaLogins;
      const refreshes = yield* Refreshes;
      const readings = yield* Readings;

      return ForgetQuotaLogin.of({
        execute: Effect.fn("ForgetQuotaLogin.execute")(function* (id: PoolId) {
          if (!HashMap.has(pools, id)) {
            return yield* new QuotaLogin.NoSuchPool({ pool: id });
          }
          if (!(yield* store.forget(id))) {
            return yield* new QuotaLogin.NoQuotaLogin({ pool: id });
          }
          yield* refreshes.drop(id);
          yield* readings.forget(id);
        }),
      });
    }),
  );
