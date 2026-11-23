import { DateTime, Duration, Option, Redacted, Schema } from "effect";
import type { PoolId } from "#shared/03-domain/ids.ts";
import type * as Pool from "#shared/03-domain/pool.entity.ts";
import { charactersOf } from "#shared/03-domain/text.ts";

/** Whose quota login it is: a Claude or a ChatGPT subscription's. */
export const Provider = Schema.Literals(["anthropic", "chatgpt"]);
export type Provider = typeof Provider.Type;

/** The provider's name for people: `Claude`, `ChatGPT`. */
export const nameOf = (provider: Provider): string =>
  provider === "anthropic" ? "Claude" : "ChatGPT";

const isSentInAHeader = (longest: number, what: string) =>
  Schema.makeFilter(
    (text: string) =>
      (charactersOf(text) >= 1 &&
        charactersOf(text) <= longest &&
        !/[\s\p{Cc}]/u.test(text)) ||
      `${what}: 1 to ${longest} characters, none of them whitespace or a control character`,
    { toJsonSchema: () => ({ minLength: 1, maxLength: longest }) },
  );

/** A token as a provider gives it: sent in a header, so no whitespace or control character. */
export const Token = Schema.String.check(isSentInAHeader(16_384, "a token"));

/** ChatGPT's account id, sent in a header beside the access token. */
export const AccountId = Schema.String.check(
  isSentInAHeader(255, "an account id"),
);

/** One of the plan facts Claude Code captures when a login is made. */
export const PlanFact = Schema.String.check(
  Schema.makeFilter(
    (text: string) =>
      (charactersOf(text) >= 1 && charactersOf(text) <= 255) ||
      "1 to 255 characters",
    { toJsonSchema: () => ({ minLength: 1, maxLength: 255 }) },
  ),
);

/** Which giving of a quota login it is: made when the owner gives it and never made again, so two logins given to a pool in one millisecond stay apart. */
export const Generation = Schema.String.pipe(Schema.brand("Generation"));
export type Generation = typeof Generation.Type;

/** A secret held so that printing it prints `<redacted>`. */
export type Secret = Redacted.Redacted<string>;

/** What a login sends: its access token, its refresh token, and when the access token ends. */
export interface Tokens {
  readonly accessToken: Secret;
  readonly refreshToken: Secret;
  readonly endsAt: DateTime.Utc;
}

/** What a provider needs beside the tokens, and what the login said of its plan. */
export type Facts =
  | {
      readonly provider: "anthropic";
      readonly subscriptionType: Option.Option<string>;
      readonly rateLimitTier: Option.Option<string>;
    }
  | { readonly provider: "chatgpt"; readonly accountId: Secret };

/** A quota login as the owner gave it, with its tokens as last refreshed. */
export type QuotaLogin = Facts &
  Tokens & {
    readonly pool: PoolId;
    readonly generation: Generation;
    readonly givenAt: DateTime.Utc;
    readonly refreshedAt: Option.Option<DateTime.Utc>;
    readonly expiredAt: Option.Option<DateTime.Utc>;
  };

/** A quota login as the owner gives it, before the hub keeps it. */
export type Given = Facts & {
  readonly accessToken: Secret;
  readonly refreshToken: Secret;
  /** When a Claude login's access token ends; a ChatGPT login's is read from its token. */
  readonly endsAt: Option.Option<DateTime.Utc>;
};

/** How long before its end an access token is refreshed, and never sent. */
const freshFor = Duration.minutes(5);

/** How long Codex assumes a ChatGPT access token lasts when it does not say. */
const assumedLife = Duration.days(8);

/**
 * Whose quota login a pool takes: a subscription pool that speaks
 * `anthropic-messages` a Claude login, one that speaks `chatgpt-codex` a
 * ChatGPT login; no other pool takes one.
 */
export const takenBy = (pool: Pool.Pool): Option.Option<Provider> => {
  if (pool.kind !== "subscription") return Option.none();
  return Option.some(
    pool.protocol === "anthropic-messages" ? "anthropic" : "chatgpt",
  );
};

/** Whether a login's access token ends within 5 minutes of `now`, or has ended: it is refreshed before it is sent (G5). */
export const isDue = (tokens: Tokens, now: DateTime.Utc): boolean =>
  DateTime.isLessThanOrEqualTo(
    tokens.endsAt,
    DateTime.addDuration(now, freshFor),
  );

/** Whether two quota logins are the one the owner gave, however refreshed since. */
export const isSameGiven = (one: QuotaLogin, other: QuotaLogin): boolean =>
  one.pool === other.pool && one.generation === other.generation;

/**
 * A login a refresh made, to write over its row in the hub store, and the
 * refresh tokens the row may hold while it is that login's: the one stored
 * when the refresh began, and the one the refresh sent, which a write of an
 * earlier refresh may have put there meanwhile.
 */
export interface Replacement {
  readonly next: QuotaLogin;
  readonly over: ReadonlyArray<Secret>;
}

/** Whether a row of the hub store is the one a replacement is written over: the same giving of the login, holding one of its refresh tokens. */
export const isReplacedBy = (
  row: QuotaLogin,
  replacement: Replacement,
): boolean =>
  isSameGiven(row, replacement.next) &&
  replacement.over.some(
    (token) => Redacted.value(token) === Redacted.value(row.refreshToken),
  );

const Claims = Schema.fromJsonString(Schema.Struct({ exp: Schema.Finite }));

const payloadOf = (token: string): Option.Option<string> => {
  const [, payload] = token.split(".");
  if (
    payload === undefined ||
    !/^[A-Za-z0-9_-]*$/.test(payload) ||
    payload.length % 4 === 1
  ) {
    return Option.none();
  }
  const base64 = payload.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Option.some(
    new TextDecoder().decode(
      Uint8Array.from(binary, (character) => character.charCodeAt(0)),
    ),
  );
};

/**
 * When a ChatGPT access token ends: its `exp` when it is a JWT whose payload
 * is a JSON object with a numeric `exp`, in Unix seconds, read without
 * verifying the token, as Codex does; else 8 days after `now`.
 */
export const chatGptEndsAt = (
  accessToken: Secret,
  now: DateTime.Utc,
): DateTime.Utc =>
  payloadOf(Redacted.value(accessToken)).pipe(
    Option.flatMap(Schema.decodeUnknownOption(Claims)),
    Option.flatMap(({ exp }) => DateTime.make(exp * 1000)),
    Option.getOrElse(() => DateTime.addDuration(now, assumedLife)),
  );

/** A refresh the provider's token endpoint refused: the quota login becomes expired. */
export class RefreshRefused extends Schema.TaggedError<
  RefreshRefused,
  { readonly brand: unique symbol }
>()("RefreshRefused", {}) {}

/** A pool the configuration does not have. */
export class NoSuchPool extends Schema.TaggedError<
  NoSuchPool,
  { readonly brand: unique symbol }
>()("NoSuchPool", { pool: Schema.String }) {}

/** A quota login given for a pool that takes none, or takes the other provider's. */
export class QuotaLoginNotTaken extends Schema.TaggedError<
  QuotaLoginNotTaken,
  { readonly brand: unique symbol }
>()("QuotaLoginNotTaken", {
  pool: Schema.String,
  kind: Schema.Literals(["subscription", "keyed", "observed"]),
  /** The provider whose login the pool takes; none for a keyed or observed pool. */
  takes: Schema.Option(Provider),
  given: Provider,
}) {}

/** A pool that has no quota login to forget. */
export class NoQuotaLogin extends Schema.TaggedError<
  NoQuotaLogin,
  { readonly brand: unique symbol }
>()("NoQuotaLogin", { pool: Schema.String }) {}
