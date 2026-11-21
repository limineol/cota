import { DateTime, Duration, Effect, Option, Schema } from "effect";
import { SignInId } from "#shared/03-domain/ids.ts";
import { cut } from "#shared/03-domain/text.ts";

/** The SHA-256 of a sign-in token, 64 hex digits: all the hub keeps of a token. */
export const TokenDigest = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{64}$/),
).pipe(Schema.brand("TokenDigest"));
export type TokenDigest = typeof TokenDigest.Type;

export const SignIn = Schema.Struct({
  id: SignInId,
  tokenDigest: TokenDigest,
  createdAt: Schema.DateTimeUtc,
  expiresAt: Schema.DateTimeUtc,
  lastUsedAt: Schema.DateTimeUtc,
  revokedAt: Schema.Option(Schema.DateTimeUtc),
  userAgent: Schema.String,
});
export type SignIn = typeof SignIn.Type;

/** A sign-in as it is made, before the store gives it an id. */
export type NewSignIn = Omit<SignIn, "id">;

/** How long a sign-in lasts from when it was made, however often it is used. */
export const lifetime = Duration.days(30);

/** How long an ended sign-in is kept before it is deleted. */
export const keptAfterEnding = Duration.days(30);

/** How often a sign-in's `lastUsedAt` is written, at most. */
const touchedEvery = Duration.minutes(1);

const maxUserAgentLength = 200;

export class NoSuchSignIn extends Schema.TaggedError<
  NoSuchSignIn,
  { readonly brand: unique symbol }
>()("NoSuchSignIn", { id: Schema.String }) {}

/** A sign-in made now, for the token with the given digest, sent by the given user agent. */
export const make = Effect.fn("SignIn.make")(function* (
  tokenDigest: TokenDigest,
  userAgent: string,
) {
  const now = yield* DateTime.now;
  const signIn: NewSignIn = {
    tokenDigest,
    createdAt: now,
    expiresAt: DateTime.addDuration(now, lifetime),
    lastUsedAt: now,
    revokedAt: Option.none(),
    userAgent: cut(userAgent, maxUserAgentLength),
  };
  return signIn;
});

/** Whether a sign-in admits a request now: it is not revoked, and it expires after now (I5). */
export const isLive = Effect.fn("SignIn.isLive")(function* (signIn: SignIn) {
  const now = yield* DateTime.now;
  return (
    Option.isNone(signIn.revokedAt) &&
    DateTime.isGreaterThan(signIn.expiresAt, now)
  );
});

/** Whether a sign-in that admits a request now should have its `lastUsedAt` written. */
export const needsTouch = Effect.fn("SignIn.needsTouch")(function* (
  signIn: SignIn,
) {
  const now = yield* DateTime.now;
  return DateTime.isGreaterThan(
    now,
    DateTime.addDuration(signIn.lastUsedAt, touchedEvery),
  );
});
