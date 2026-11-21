import { Context, DateTime, Effect, HashMap, Layer, Option } from "effect";
import { QuotaLogins } from "#modules/quota/02-application/interfaces/quota-logins.ts";
import * as QuotaLogin from "#modules/quota/03-domain/quota-login.ts";
import { Refreshes } from "#modules/quota/03-domain/refreshes.ts";
import type { PoolId } from "#shared/03-domain/ids.ts";
import type * as Pool from "#shared/03-domain/pool.entity.ts";
import { RefreshQuotaLogin } from "./refresh-quota-login.command.ts";

export class KeepQuotaLoginsAlive extends Context.Service<
  KeepQuotaLoginsAlive,
  {
    /**
     * One keep-alive check: every kept quota login of a pool of the
     * configuration that is not expired and whose access token ends within 5
     * minutes of the check is refreshed, one after another (G8), and a
     * refreshed login the hub store has not taken is written again. A failure
     * is logged by the refresh and changes nothing else.
     */
    readonly execute: Effect.Effect<void>;
  }
>()("@cota/hub/quota/KeepQuotaLoginsAlive") {}

export const layer = (
  pools: HashMap.HashMap<PoolId, Pool.Pool>,
): Layer.Layer<
  KeepQuotaLoginsAlive,
  never,
  QuotaLogins | Refreshes | RefreshQuotaLogin
> =>
  Layer.effect(
    KeepQuotaLoginsAlive,
    Effect.gen(function* () {
      const store = yield* QuotaLogins;
      const refreshes = yield* Refreshes;
      const refreshQuotaLogin = yield* RefreshQuotaLogin;

      return KeepQuotaLoginsAlive.of({
        execute: Effect.gen(function* () {
          const now = yield* DateTime.now;
          const logins = yield* store.all.pipe(
            Effect.tapError(() =>
              Effect.logWarning("quota logins could not be read"),
            ),
            Effect.orElseSucceed(() => []),
          );
          for (const stored of logins) {
            const pool = HashMap.get(pools, stored.pool);
            if (
              Option.isNone(pool) ||
              !Option.contains(QuotaLogin.takenBy(pool.value), stored.provider)
            ) {
              continue;
            }
            const unwritten = yield* refreshes.unwritten(stored);
            if (
              Option.isNone(unwritten) &&
              (Option.isSome(stored.expiredAt) ||
                !QuotaLogin.isDue(stored, now))
            ) {
              continue;
            }
            yield* refreshQuotaLogin
              .execute(pool.value, Option.none())
              .pipe(Effect.ignore);
          }
        }).pipe(Effect.withSpan("KeepQuotaLoginsAlive.execute")),
      });
    }),
  );
