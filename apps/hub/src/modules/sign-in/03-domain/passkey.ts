import { DateTime, Effect, Option, Schema } from "effect";
import type { PasskeyId } from "#shared/03-domain/ids.ts";
import { cut } from "#shared/03-domain/text.ts";
import type { RelyingParty } from "./relying-party.ts";

/** A WebAuthn credential's id, as the browser writes it: base64url. */
export const CredentialId = Schema.NonEmptyString.pipe(
  Schema.brand("CredentialId"),
);
export type CredentialId = typeof CredentialId.Type;

/** A credential a browser made and the hub verified, before it is kept. */
export interface Credential {
  readonly credentialId: CredentialId;
  /** The credential's public key, COSE-encoded: not a secret. */
  readonly publicKey: Uint8Array;
  /** The authenticator's signature counter; 0 for one that keeps none. */
  readonly counter: number;
  readonly transports: ReadonlyArray<string>;
}

/** A passkey the owner made, as the hub keeps it. */
export interface Passkey extends Credential {
  readonly id: PasskeyId;
  /** Where it was made, and so where it signs in (ADR-0021). */
  readonly relyingParty: RelyingParty;
  /** The user agent of the request that made it, cut to 200 characters. */
  readonly userAgent: string;
  readonly createdAt: DateTime.Utc;
  /** When it last signed in; none until it has. */
  readonly lastUsedAt: Option.Option<DateTime.Utc>;
}

/** A passkey as it is made, before the store gives it an id. */
export type NewPasskey = Omit<Passkey, "id">;

/** The relying party's name a browser shows when it makes a passkey. */
export const relyingPartyName = "Cota";

/** The one user every passkey of a hub is for: Cota has one owner. */
export const owner = {
  handle: "cota-owner",
  name: "owner",
  displayName: "Cota owner",
} as const;

const maxUserAgentLength = 200;

/** A passkey made now, of the credential given, where the relying party given says, by the user agent given. */
export const make = Effect.fn("Passkey.make")(function* (
  credential: Credential,
  relyingParty: RelyingParty,
  userAgent: string,
) {
  const passkey: NewPasskey = {
    ...credential,
    relyingParty,
    userAgent: cut(userAgent, maxUserAgentLength),
    createdAt: yield* DateTime.now,
    lastUsedAt: Option.none(),
  };
  return passkey;
});

export class NoSuchPasskey extends Schema.TaggedError<
  NoSuchPasskey,
  { readonly brand: unique symbol }
>()("NoSuchPasskey", { id: Schema.String }) {}

export class PasskeyExists extends Schema.TaggedError<
  PasskeyExists,
  { readonly brand: unique symbol }
>()("PasskeyExists", {}) {}

export class PasskeyNotMade extends Schema.TaggedError<
  PasskeyNotMade,
  { readonly brand: unique symbol }
>()("PasskeyNotMade", {}) {}

export class NoPasskeys extends Schema.TaggedError<
  NoPasskeys,
  { readonly brand: unique symbol }
>()("NoPasskeys", {}) {}

/** The one answer to a passkey sign-in that failed, whichever check failed (I16). */
export class PasskeyRefused extends Schema.TaggedError<
  PasskeyRefused,
  { readonly brand: unique symbol }
>()("PasskeyRefused", {}) {}
