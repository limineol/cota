import { Duration, Effect, Option, Schema } from "effect";
import type { HttpApiBuilder } from "effect/http-api";
import { ForgetQuotaLogin } from "#modules/quota/02-application/commands/forget-quota-login.command.ts";
import { GiveQuotaLogin } from "#modules/quota/02-application/commands/give-quota-login.command.ts";
import {
  type PoolAnswer,
  ReadPools,
  type StandingWindow,
} from "#modules/quota/02-application/queries/read-pools.query.ts";
import type * as Quota from "#modules/quota/03-domain/quota.ts";
import * as QuotaLogin from "#modules/quota/03-domain/quota-login.ts";
import type * as Readings from "#modules/quota/03-domain/readings.ts";
import {
  hubStoreProblem,
  NoSuchPoolProblem,
  requestLogProblem,
} from "#shared/01-presentation/problems.ts";
import { PoolId } from "#shared/03-domain/ids.ts";
import * as PoolsApi from "./pools.api.ts";

const millis = (duration: Duration.Duration) =>
  Math.floor(Duration.toMillis(duration));

const paceOf = (pace: Quota.Pace): typeof PoolsApi.Pace.Type => {
  switch (pace._tag) {
    case "Full":
      return "full";
    case "OnPace":
      return "on-pace";
    case "InReserve":
      return "in-reserve";
    case "AheadOfPace":
      return "ahead-of-pace";
  }
};

const standingOf = (
  standing: Quota.Standing,
): typeof PoolsApi.Standing.Type | null =>
  standing._tag === "Unplaced"
    ? null
    : {
        elapsed: standing.elapsed,
        resetsInMs: millis(standing.resetsIn),
        pace: paceOf(standing.pace),
        points:
          standing.pace._tag === "InReserve" ||
          standing.pace._tag === "AheadOfPace"
            ? standing.pace.points
            : null,
        emptiesInMs:
          standing.pace._tag === "AheadOfPace" &&
          standing.pace.emptiesIn !== undefined
            ? millis(standing.pace.emptiesIn)
            : null,
      };

const windowOf = ({
  window,
  standing,
}: StandingWindow): typeof PoolsApi.Window.Type => ({
  lengthMs: millis(window.length),
  scope: Option.getOrNull(window.scope),
  source: window.source,
  usedPercent: window.used,
  startsAt: window.span?.start ?? null,
  resetsAt: window.span?.reset ?? null,
  observedAt: window.observedAt,
  standing: standingOf(standing),
});

const readingOf = (kept: Readings.Kept): typeof PoolsApi.Reading.Type => ({
  at: Option.getOrNull(Option.map(kept.last, ({ at }) => at)),
  failure: Option.getOrNull(
    Option.map(kept.failure, ({ failure, at }) => ({
      at,
      kind: failure.kind,
      status: Option.getOrNull(failure.status),
      detail: failure.detail,
    })),
  ),
  nextAttemptAt: Option.getOrNull(kept.nextAt),
});

/** A pool's quota login as the API gives it: its state and times, never a token, the account id or the plan facts. */
const quotaLoginOf = (
  provider: QuotaLogin.Provider,
  login: Option.Option<QuotaLogin.QuotaLogin>,
): typeof PoolsApi.QuotaLogin.Type =>
  Option.match(login, {
    onNone: () => ({
      provider,
      state: "none",
      givenAt: null,
      refreshedAt: null,
      endsAt: null,
      expiredAt: null,
    }),
    onSome: (login) => ({
      provider,
      state: Option.isSome(login.expiredAt) ? "expired" : "active",
      givenAt: login.givenAt,
      refreshedAt: Option.getOrNull(login.refreshedAt),
      endsAt: login.endsAt,
      expiredAt: Option.getOrNull(login.expiredAt),
    }),
  });

const givenOf = (
  payload: typeof PoolsApi.GivenQuotaLogin.Type,
): QuotaLogin.Given =>
  payload.provider === "anthropic"
    ? {
        provider: "anthropic",
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken,
        endsAt: Option.some(payload.endsAt),
        subscriptionType: Option.fromNullishOr(payload.subscriptionType),
        rateLimitTier: Option.fromNullishOr(payload.rateLimitTier),
      }
    : {
        provider: "chatgpt",
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken,
        endsAt: Option.none(),
        accountId: payload.accountId,
      };

const poolIdOf = (pool: string): Effect.Effect<PoolId, QuotaLogin.NoSuchPool> =>
  Option.match(Schema.decodeOption(PoolId)(pool), {
    onNone: () => Effect.fail(new QuotaLogin.NoSuchPool({ pool })),
    onSome: Effect.succeed,
  });

const noSuchPool = ({ pool }: QuotaLogin.NoSuchPool) =>
  Effect.fail(
    new NoSuchPoolProblem({
      detail: `The hub has no pool ${JSON.stringify(pool)}.`,
    }),
  );

const notTaken = ({
  pool,
  kind,
  takes,
  given,
}: QuotaLogin.QuotaLoginNotTaken) =>
  Effect.fail(
    new PoolsApi.QuotaLoginNotTakenProblem({
      detail: Option.match(takes, {
        onNone: () =>
          `The pool ${JSON.stringify(pool)} is ${kind === "observed" ? "an observed" : "a keyed"} pool: only a subscription pool takes a quota login.`,
        onSome: (takes) =>
          `The pool ${JSON.stringify(pool)} takes a ${QuotaLogin.nameOf(takes)} login, not a ${QuotaLogin.nameOf(given)} one.`,
      }),
    }),
  );

const poolOf = (answer: PoolAnswer): typeof PoolsApi.Pool.Type => ({
  id: answer.pool.id,
  kind: answer.pool.kind,
  protocol: answer.pool.kind === "observed" ? null : answer.pool.protocol,
  provider: answer.pool.provider,
  plan: Option.getOrNull(answer.plan),
  windows: answer.windows.map(windowOf),
  observedAt: Option.getOrNull(answer.observedAt),
  reading: Option.getOrNull(Option.map(answer.reading, readingOf)),
  quotaLogin: Option.getOrNull(
    Option.map(answer.quotaLogin, ({ provider, login }) =>
      quotaLoginOf(provider, login),
    ),
  ),
});

export const build = (
  handlers: HttpApiBuilder.Handlers.FromGroup<typeof PoolsApi.group>,
) =>
  Effect.gen(function* () {
    const readPools = yield* ReadPools;
    const giveQuotaLogin = yield* GiveQuotaLogin;
    const forgetQuotaLogin = yield* ForgetQuotaLogin;

    return handlers
      .handle("list", () =>
        readPools.execute.pipe(
          Effect.map((answers) => ({ pools: answers.map(poolOf) })),
          Effect.catchTags({
            RequestLogUnavailable: requestLogProblem,
            HubStoreUnavailable: hubStoreProblem,
          }),
        ),
      )
      .handle("give", ({ params, payload }) =>
        poolIdOf(params.pool).pipe(
          Effect.flatMap((pool) =>
            giveQuotaLogin.execute(pool, givenOf(payload)),
          ),
          Effect.map((login) =>
            quotaLoginOf(login.provider, Option.some(login)),
          ),
          Effect.catchTags({
            NoSuchPool: noSuchPool,
            QuotaLoginNotTaken: notTaken,
            HubStoreUnavailable: hubStoreProblem,
          }),
        ),
      )
      .handle("forget", ({ params }) =>
        poolIdOf(params.pool).pipe(
          Effect.flatMap(forgetQuotaLogin.execute),
          Effect.catchTags({
            NoSuchPool: noSuchPool,
            NoQuotaLogin: ({ pool }) =>
              Effect.fail(
                new PoolsApi.NoQuotaLoginProblem({
                  detail: `The pool ${JSON.stringify(pool)} has no quota login.`,
                }),
              ),
            HubStoreUnavailable: hubStoreProblem,
          }),
        ),
      );
  });
