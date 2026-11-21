import { Context, DateTime, Effect, HashMap, Layer, Option } from "effect";
import { ReadQuota } from "#modules/quota/02-application/commands/read-quota.command.ts";
import { QuotaLogins } from "#modules/quota/02-application/interfaces/quota-logins.ts";
import * as Plan from "#modules/quota/03-domain/plan.ts";
import * as Quota from "#modules/quota/03-domain/quota.ts";
import * as QuotaHeaders from "#modules/quota/03-domain/quota-headers.ts";
import * as QuotaLogin from "#modules/quota/03-domain/quota-login.ts";
import * as Readers from "#modules/quota/03-domain/readers.ts";
import * as Readings from "#modules/quota/03-domain/readings.ts";
import { Refreshes } from "#modules/quota/03-domain/refreshes.ts";
import * as Sources from "#modules/quota/03-domain/sources.ts";
import { ReadQuotaHeaders } from "#modules/request-log/02-application/queries/read-quota-headers.query.ts";
import type { HubStoreUnavailable } from "#shared/03-domain/hub-store.ts";
import type { PoolId } from "#shared/03-domain/ids.ts";
import type * as Pool from "#shared/03-domain/pool.entity.ts";
import type { RequestLogUnavailable } from "#shared/03-domain/request-log.ts";
import { compareText } from "#shared/03-domain/text.ts";

/** A window of a pool's quota with where it stands at the answer's time. */
export interface StandingWindow {
  readonly window: Quota.Window;
  readonly standing: Quota.Standing;
}

/** A pool of the configuration with its quota. */
export interface PoolAnswer {
  readonly pool: Pool.Pool;
  readonly plan: Option.Option<string>;
  readonly windows: ReadonlyArray<StandingWindow>;
  readonly observedAt: Option.Option<DateTime.Utc>;
  /** What is kept of its quota readings; none for a pool the hub does not read. */
  readonly reading: Option.Option<Readings.Kept>;
  /** Whose quota login it takes, and the one it has; none for a pool that takes none. */
  readonly quotaLogin: Option.Option<{
    readonly provider: QuotaLogin.Provider;
    readonly login: Option.Option<QuotaLogin.QuotaLogin>;
  }>;
}

export class ReadPools extends Context.Service<
  ReadPools,
  {
    /**
     * Every pool of the configuration, in order of id, with its windows, their
     * standing now, its plan, its quota readings and its quota login, after
     * reading each pool whose read is due.
     */
    readonly execute: Effect.Effect<
      ReadonlyArray<PoolAnswer>,
      RequestLogUnavailable | HubStoreUnavailable
    >;
  }
>()("@cota/hub/quota/ReadPools") {}

export const layer = (
  pools: HashMap.HashMap<PoolId, Pool.Pool>,
): Layer.Layer<
  ReadPools,
  never,
  ReadQuotaHeaders | ReadQuota | QuotaLogins | Refreshes | Readings.Readings
> =>
  Layer.effect(
    ReadPools,
    Effect.gen(function* () {
      const readQuotaHeaders = yield* ReadQuotaHeaders;
      const readQuota = yield* ReadQuota;
      const quotaLogins = yield* QuotaLogins;
      const refreshes = yield* Refreshes;
      const readings = yield* Readings.Readings;
      const ordered = [...HashMap.values(pools)].sort((one, other) =>
        compareText(one.id, other.id),
      );

      const readingOf = (
        pool: Pool.Pool,
        login: Option.Option<QuotaLogin.QuotaLogin>,
      ): Effect.Effect<Option.Option<Readings.Kept>> =>
        Option.match(Readers.readerOf(pool, login), {
          onNone: () => Effect.succeedNone,
          onSome: (reader) =>
            readings
              .ask(
                pool.id,
                reader.period,
                readQuota.execute(pool, reader).pipe(
                  Effect.tapErrorTag("ReadFailure", (failure) =>
                    Effect.logWarning("quota reading failed").pipe(
                      Effect.annotateLogs({
                        pool: pool.id,
                        provider: pool.provider,
                        kind: failure.kind,
                        ...Option.match(failure.status, {
                          onNone: () => ({}),
                          onSome: (status) => ({ status }),
                        }),
                      }),
                    ),
                  ),
                ),
              )
              .pipe(Effect.asSome),
        });

      const answerOf = Effect.fn("ReadPools.answerOf")(function* (
        pool: Pool.Pool,
        sources: Sources.Sources,
        reading: Option.Option<Readings.Kept>,
        quotaLogin: PoolAnswer["quotaLogin"],
      ) {
        const quota = yield* Sources.quotaOf(sources);
        const windows: Array<StandingWindow> = [];
        for (const window of quota.windows) {
          windows.push({ window, standing: yield* Quota.standing(window) });
        }
        return { pool, ...quota, windows, reading, quotaLogin };
      });

      /** Each pool's quota login of the provider it takes, as the hub holds it. */
      const loginsOf = Effect.fn("ReadPools.loginsOf")(function* () {
        const logins = new Map<PoolId, QuotaLogin.QuotaLogin>();
        for (const row of yield* quotaLogins.all) {
          logins.set(row.pool, yield* refreshes.latest(row));
        }
        return (pool: Pool.Pool) =>
          Option.map(QuotaLogin.takenBy(pool), (provider) => ({
            provider,
            login: Option.filter(
              Option.fromNullishOr(logins.get(pool.id)),
              (login) => login.provider === provider,
            ),
          }));
      });

      return ReadPools.of({
        execute: Effect.gen(function* () {
          const now = yield* DateTime.now;
          const loginBefore = yield* loginsOf();
          const loginsNow = ordered.map(loginBefore);
          const [latest, kept] = yield* Effect.all(
            [
              readQuotaHeaders.execute(
                ordered.flatMap((pool) =>
                  QuotaHeaders.namesOf(pool.protocol).map((name) => ({
                    pool: pool.id,
                    name,
                  })),
                ),
                DateTime.subtractDuration(now, Sources.headersFor),
              ),
              Effect.forEach(
                ordered,
                (pool, index) =>
                  readingOf(
                    pool,
                    Option.flatMap(
                      loginsNow[index] ?? Option.none(),
                      ({ login }) => login,
                    ),
                  ),
                { concurrency: "unbounded" },
              ),
            ],
            { concurrency: "unbounded" },
          );
          const loginAfter = yield* loginsOf();
          const answers: Array<PoolAnswer> = [];
          for (const [index, pool] of ordered.entries()) {
            const quotaLogin = loginAfter(pool);
            const login = Option.flatMap(quotaLogin, ({ login }) => login);
            const reading = Option.isSome(Readers.readerOf(pool, login))
              ? (kept[index] ?? Option.none())
              : Option.none<Readings.Kept>();
            answers.push(
              yield* answerOf(
                pool,
                {
                  reading: Option.flatMap(reading, ({ last }) =>
                    Option.map(last, ({ reading }) => reading),
                  ),
                  headers: QuotaHeaders.observe(
                    pool.protocol,
                    new Map(
                      latest
                        .filter((each) => each.pool === pool.id)
                        .map((each) => [each.name, each]),
                    ),
                  ),
                  loginPlan: Option.flatMap(login, (login) =>
                    login.provider === "anthropic"
                      ? Plan.claude(login.subscriptionType, login.rateLimitTier)
                      : Option.none(),
                  ),
                },
                reading,
                quotaLogin,
              ),
            );
          }
          return answers;
        }).pipe(Effect.withSpan("ReadPools.execute")),
      });
    }),
  );
