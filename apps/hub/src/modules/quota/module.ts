import { Duration, Effect, type HashMap, Layer, Schedule } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { Api } from "#api.ts";
import * as PoolsHandlers from "#modules/quota/01-presentation/pools.handlers.ts";
import * as ForgetQuotaLogin from "#modules/quota/02-application/commands/forget-quota-login.command.ts";
import * as GiveQuotaLogin from "#modules/quota/02-application/commands/give-quota-login.command.ts";
import * as KeepQuotaLoginsAlive from "#modules/quota/02-application/commands/keep-quota-logins-alive.command.ts";
import * as ReadQuota from "#modules/quota/02-application/commands/read-quota.command.ts";
import * as RefreshQuotaLogin from "#modules/quota/02-application/commands/refresh-quota-login.command.ts";
import * as ReadPools from "#modules/quota/02-application/queries/read-pools.query.ts";
import * as Readings from "#modules/quota/03-domain/readings.ts";
import * as Refreshes from "#modules/quota/03-domain/refreshes.ts";
import * as SqliteQuotaLogins from "#modules/quota/04-infrastructure/persistence/sqlite/sqlite-quota-logins.ts";
import * as QuotaReaders from "#modules/quota/04-infrastructure/readers/readers.ts";
import * as TokenEndpoints from "#modules/quota/04-infrastructure/token-endpoints/token-endpoints.ts";
import type { PoolId } from "#shared/03-domain/ids.ts";
import type * as Pool from "#shared/03-domain/pool.entity.ts";

/** The endpoints a quota login reads and refreshes at: the providers' own, unless a test points them at its fake. */
export interface Endpoints {
  readonly usage: QuotaReaders.Endpoints;
  readonly tokens: TokenEndpoints.Endpoints;
}

export interface Options {
  readonly pools: HashMap.HashMap<PoolId, Pool.Pool>;
  readonly endpoints?: Endpoints | undefined;
}

/** The quota module's tables in the hub store. */
export const steps = SqliteQuotaLogins.steps;

/** The keep-alive: a check when the hub starts and every hour after it, on the clock (G8). */
const keepAlive = Layer.effectDiscard(
  Effect.gen(function* () {
    const keep = yield* KeepQuotaLoginsAlive.KeepQuotaLoginsAlive;
    yield* Effect.forkScoped(
      keep.execute.pipe(Effect.repeat(Schedule.fixed(Duration.hours(1)))),
    );
  }),
);

/**
 * The quota module's query and commands, and the keep-alive, over the ports
 * given: one `Readings` and one `Refreshes` for all of them, so that giving
 * or forgetting a quota login forgets the reading state the query keeps.
 */
export const overPorts = (pools: HashMap.HashMap<PoolId, Pool.Pool>) => {
  const refresh = RefreshQuotaLogin.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(Readings.layer, Refreshes.layer)),
  );
  const read = ReadQuota.layer.pipe(Layer.provideMerge(refresh));
  return Layer.mergeAll(
    ReadPools.layer(pools),
    GiveQuotaLogin.layer(pools),
    ForgetQuotaLogin.layer(pools),
    keepAlive.pipe(Layer.provideMerge(KeepQuotaLoginsAlive.layer(pools))),
  ).pipe(Layer.provideMerge(read));
};

/**
 * The quota module over the request log's quota sources
 * (`RequestLog.quotaSources`), the hub store's quota logins, and the quota
 * readers and token endpoints over HTTP.
 */
export const layer = (options: Options) =>
  overPorts(options.pools).pipe(
    Layer.provide([
      SqliteQuotaLogins.layer,
      QuotaReaders.layer(options.endpoints?.usage),
      TokenEndpoints.layer(options.endpoints?.tokens),
    ]),
  );

/** The handlers of the `pools` group. */
export const api = HttpApiBuilder.group(Api, "pools", PoolsHandlers.build);
