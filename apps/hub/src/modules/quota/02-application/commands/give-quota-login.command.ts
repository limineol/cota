import { Context, DateTime, Effect, HashMap, Layer, Option } from "effect";
import { QuotaLogins } from "#modules/quota/02-application/interfaces/quota-logins.ts";
import * as QuotaLogin from "#modules/quota/03-domain/quota-login.ts";
import { Readings } from "#modules/quota/03-domain/readings.ts";
import { Refreshes } from "#modules/quota/03-domain/refreshes.ts";
import type { HubStoreUnavailable } from "#shared/03-domain/hub-store.ts";
import type { PoolId } from "#shared/03-domain/ids.ts";
import type * as Pool from "#shared/03-domain/pool.entity.ts";

export class GiveQuotaLogin extends Context.Service<
  GiveQuotaLogin,
  {
    /**
     * Keeps a quota login for a pool that takes one of its provider (G9),
     * replacing the one it had, and forgets the pool's reading state; a
     * ChatGPT login ends at its access token's `exp`, else 8 days after now.
     */
    readonly execute: (
      pool: PoolId,
      given: QuotaLogin.Given,
    ) => Effect.Effect<
      QuotaLogin.QuotaLogin,
      | QuotaLogin.NoSuchPool
      | QuotaLogin.QuotaLoginNotTaken
      | HubStoreUnavailable
    >;
  }
>()("@cota/hub/quota/GiveQuotaLogin") {}

export const layer = (
  pools: HashMap.HashMap<PoolId, Pool.Pool>,
): Layer.Layer<GiveQuotaLogin, never, QuotaLogins | Refreshes | Readings> =>
  Layer.effect(
    GiveQuotaLogin,
    Effect.gen(function* () {
      const store = yield* QuotaLogins;
      const refreshes = yield* Refreshes;
      const readings = yield* Readings;

      return GiveQuotaLogin.of({
        execute: Effect.fn("GiveQuotaLogin.execute")(function* (
          id: PoolId,
          given: QuotaLogin.Given,
        ) {
          const found = HashMap.get(pools, id);
          if (Option.isNone(found)) {
            return yield* new QuotaLogin.NoSuchPool({ pool: id });
          }
          const pool = found.value;
          const takes = QuotaLogin.takenBy(pool);
          if (!Option.contains(takes, given.provider)) {
            return yield* new QuotaLogin.QuotaLoginNotTaken({
              pool: id,
              takes,
              given: given.provider,
            });
          }
          const now = yield* DateTime.now;
          const { endsAt, ...facts } = given;
          const login: QuotaLogin.QuotaLogin = {
            ...facts,
            pool: pool.id,
            generation: QuotaLogin.Generation.make(
              yield* Effect.sync(() => Bun.randomUUIDv7()),
            ),
            endsAt: Option.getOrElse(endsAt, () =>
              QuotaLogin.chatGptEndsAt(given.accessToken, now),
            ),
            givenAt: now,
            refreshedAt: Option.none(),
            expiredAt: Option.none(),
          };
          yield* store.give(login);
          yield* refreshes.drop(pool.id);
          yield* readings.forget(pool.id);
          return login;
        }),
      });
    }),
  );
