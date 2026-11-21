import { DateTime, Option, Redacted } from "effect";
import * as QuotaLogin from "#modules/quota/03-domain/quota-login.ts";
import { PoolId } from "#shared/03-domain/ids.ts";

/** A made-up ChatGPT access token: a JWT whose payload holds `exp`, or no `exp` when none is given. */
export const jwt = (exp: Option.Option<number>, salt = ""): string => {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    ...Option.match(exp, { onNone: () => ({}), onSome: (exp) => ({ exp }) }),
    salt,
  })}.c2lnbmF0dXJl`;
};

/** A Claude quota login of `pool`, given at `givenAt`, ending at `endsAt`, with the plan facts of a Max 20x plan. */
export const claudeLogin = (
  pool: string,
  tokens: { readonly access: string; readonly refresh: string },
  givenAt: DateTime.Utc,
  endsAt: DateTime.Utc,
): QuotaLogin.QuotaLogin => ({
  provider: "anthropic",
  subscriptionType: Option.some("max"),
  rateLimitTier: Option.some("default_claude_max_20x"),
  pool: PoolId.make(pool),
  generation: QuotaLogin.Generation.make(`${pool}-given`),
  accessToken: Redacted.make(tokens.access),
  refreshToken: Redacted.make(tokens.refresh),
  endsAt,
  givenAt,
  refreshedAt: Option.none(),
  expiredAt: Option.none(),
});

/** A ChatGPT quota login of `pool`, given at `givenAt`, ending at `endsAt`. */
export const chatGptLogin = (
  pool: string,
  tokens: { readonly access: string; readonly refresh: string },
  givenAt: DateTime.Utc,
  endsAt: DateTime.Utc,
  accountId = "account-5c1e",
): QuotaLogin.QuotaLogin => ({
  provider: "chatgpt",
  accountId: Redacted.make(accountId),
  pool: PoolId.make(pool),
  generation: QuotaLogin.Generation.make(`${pool}-given`),
  accessToken: Redacted.make(tokens.access),
  refreshToken: Redacted.make(tokens.refresh),
  endsAt,
  givenAt,
  refreshedAt: Option.none(),
  expiredAt: Option.none(),
});

export const at = (iso: string) => DateTime.makeUnsafe(iso);
