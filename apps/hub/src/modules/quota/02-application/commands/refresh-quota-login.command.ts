import { Context, DateTime, Effect, Layer, Option, Redacted } from "effect";
import { QuotaLogins } from "#modules/quota/02-application/interfaces/quota-logins.ts";
import { TokenEndpoints } from "#modules/quota/02-application/interfaces/token-endpoints.ts";
import * as QuotaLogin from "#modules/quota/03-domain/quota-login.ts";
import {
  QuotaLoginExpired,
  ReadFailure,
  Readings,
} from "#modules/quota/03-domain/readings.ts";
import { Refreshes } from "#modules/quota/03-domain/refreshes.ts";
import type * as Pool from "#shared/03-domain/pool.entity.ts";

/** A pool's quota login as the hub holds it, and the row the hub store holds for it. */
interface Held {
  readonly stored: QuotaLogin.QuotaLogin;
  readonly login: QuotaLogin.QuotaLogin;
}

export class RefreshQuotaLogin extends Context.Service<
  RefreshQuotaLogin,
  {
    /**
     * The pool's quota login to send now: as kept while its access token
     * does not end within 5 minutes, else refreshed first (G5), one refresh at
     * a time per login (G3). With `refused`, the access token a usage
     * endpoint just answered 401 to, it is refreshed whatever its end while
     * that token is still the login's. A refusal of the refresh makes the
     * login expired (G4); a login that is expired, or gone, is
     * `QuotaLoginExpired`.
     */
    readonly execute: (
      pool: Pool.Pool,
      refused: Option.Option<QuotaLogin.Secret>,
    ) => Effect.Effect<QuotaLogin.QuotaLogin, ReadFailure | QuotaLoginExpired>;
  }
>()("@cota/hub/quota/RefreshQuotaLogin") {}

export const layer: Layer.Layer<
  RefreshQuotaLogin,
  never,
  QuotaLogins | TokenEndpoints | Refreshes | Readings
> = Layer.effect(
  RefreshQuotaLogin,
  Effect.gen(function* () {
    const store = yield* QuotaLogins;
    const tokenEndpoints = yield* TokenEndpoints;
    const refreshes = yield* Refreshes;
    const readings = yield* Readings;

    /**
     * Writes a refreshed login over its row, if the row is still that
     * login's; when the store fails, holds it to write again at the next use.
     * Says whether the login is still the pool's: not when the row was
     * forgotten or given again meanwhile.
     */
    const write = (replacement: QuotaLogin.Replacement) =>
      store.update(replacement).pipe(
        Effect.matchEffect({
          onSuccess: (written) =>
            refreshes.written(replacement.next).pipe(Effect.as(written)),
          onFailure: () =>
            Effect.logWarning("quota login not written").pipe(
              Effect.annotateLogs({ pool: replacement.next.pool }),
              Effect.andThen(refreshes.hold(replacement)),
              Effect.as(true),
            ),
        }),
      );

    /** The replacement of a held login by `next`: over the row as read, or the login it refreshed if a write put that there since. */
    const replacing = (
      { stored, login }: Held,
      next: QuotaLogin.QuotaLogin,
    ): QuotaLogin.Replacement => ({
      next,
      over: [stored.refreshToken, login.refreshToken],
    });

    const current = (
      pool: Pool.Pool,
    ): Effect.Effect<Option.Option<Held>, ReadFailure> =>
      Effect.gen(function* () {
        const row = yield* store.find(pool.id).pipe(
          Effect.mapError(
            () =>
              new ReadFailure({
                kind: "failed",
                status: Option.none(),
                detail: `${Option.match(QuotaLogin.takenBy(pool), { onNone: () => "The", onSome: (provider) => `${QuotaLogin.nameOf(provider)}'s` })} quota login could not be read from the hub store.`,
                retryAt: Option.none(),
              }),
          ),
        );
        if (Option.isNone(row)) {
          yield* refreshes.drop(pool.id);
          return Option.none();
        }
        const unwritten = yield* refreshes.unwritten(row.value);
        if (Option.isSome(unwritten)) {
          yield* write(unwritten.value);
          return Option.some({
            stored: row.value,
            login: unwritten.value.next,
          });
        }
        return Option.some({ stored: row.value, login: row.value });
      });

    const usable = (held: Option.Option<Held>) =>
      Effect.fromOption(
        Option.filter(held, ({ login }) => Option.isNone(login.expiredAt)),
      ).pipe(Effect.mapError(() => new QuotaLoginExpired()));

    const isNeeded = (
      login: QuotaLogin.QuotaLogin,
      now: DateTime.Utc,
      refused: Option.Option<QuotaLogin.Secret>,
    ) =>
      QuotaLogin.isDue(login, now) ||
      Option.exists(
        refused,
        (token) => Redacted.value(token) === Redacted.value(login.accessToken),
      );

    const failed = (pool: Pool.Pool, failure: ReadFailure) =>
      Effect.logWarning("quota login refresh failed").pipe(
        Effect.annotateLogs({
          pool: pool.id,
          provider: Option.getOrElse(QuotaLogin.takenBy(pool), () => ""),
          kind: failure.kind,
          ...Option.match(failure.status, {
            onNone: () => ({}),
            onSome: (status) => ({ status }),
          }),
        }),
        Effect.andThen(Effect.fail(failure)),
      );

    const refresh = Effect.fn("RefreshQuotaLogin.refresh")(function* (
      pool: Pool.Pool,
      held: Held,
    ) {
      const { login } = held;
      const outcome = yield* Effect.result(tokenEndpoints.refresh(login));
      const now = yield* DateTime.now;
      if (outcome._tag === "Failure") {
        if (outcome.failure._tag === "ReadFailure") {
          return yield* failed(pool, outcome.failure);
        }
        yield* write(
          replacing(held, { ...login, expiredAt: Option.some(now) }),
        );
        yield* readings.forget(pool.id);
        yield* Effect.logWarning("quota login expired").pipe(
          Effect.annotateLogs({ pool: pool.id }),
        );
        return yield* new QuotaLoginExpired();
      }
      const refreshed = outcome.success;
      const next: QuotaLogin.QuotaLogin = {
        ...login,
        accessToken: refreshed.accessToken,
        refreshToken: Option.getOrElse(
          refreshed.refreshToken,
          () => login.refreshToken,
        ),
        endsAt: refreshed.endsAt,
        refreshedAt: Option.some(now),
      };
      if (!(yield* write(replacing(held, next)))) {
        return yield* new QuotaLoginExpired();
      }
      if (QuotaLogin.isDue(next, now)) {
        return yield* failed(
          pool,
          new ReadFailure({
            kind: "unreadable",
            status: Option.none(),
            detail: `${QuotaLogin.nameOf(login.provider)}'s token endpoint gave an access token that ends within 5 minutes.`,
            retryAt: Option.none(),
          }),
        );
      }
      return next;
    });

    return RefreshQuotaLogin.of({
      execute: Effect.fn("RefreshQuotaLogin.execute")(function* (
        pool: Pool.Pool,
        refused: Option.Option<QuotaLogin.Secret>,
      ) {
        const held = yield* usable(yield* current(pool));
        if (!isNeeded(held.login, yield* DateTime.now, refused)) {
          return held.login;
        }
        return yield* refreshes.once(
          held.login,
          Effect.gen(function* () {
            const again = yield* usable(yield* current(pool));
            if (!isNeeded(again.login, yield* DateTime.now, refused)) {
              return again.login;
            }
            return yield* refresh(pool, again);
          }),
        );
      }),
    });
  }),
);
