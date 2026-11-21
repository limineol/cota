import { Context, type Effect, type Option } from "effect";
import type {
  CreationOptions,
  CreationResponse,
  RequestOptions,
  SignInResponse,
} from "#modules/sign-in/03-domain/ceremony.ts";
import type { Challenge } from "#modules/sign-in/03-domain/challenges.ts";
import type {
  Credential,
  Passkey,
} from "#modules/sign-in/03-domain/passkey.ts";
import type { RelyingParty } from "#modules/sign-in/03-domain/relying-party.ts";

/** How passkeys are made and checked: WebAuthn's options for the browser, and the verification of what it answers. */
export class WebAuthn extends Context.Service<
  WebAuthn,
  {
    /** A new challenge: 32 bytes from a cryptographic source. */
    readonly challenge: Effect.Effect<Challenge>;
    /**
     * The options a browser makes a discoverable passkey with, for the owner,
     * at the relying party given, over the challenge given, with the user
     * verified and no attestation, excluding the passkeys given.
     */
    readonly creationOptions: (input: {
      readonly relyingParty: RelyingParty;
      readonly challenge: Challenge;
      readonly exclude: ReadonlyArray<Passkey>;
    }) => Effect.Effect<CreationOptions>;
    /**
     * The credential a browser's answer makes, when it answers the challenge
     * given at the relying party given with the user verified; none when it
     * does not.
     */
    readonly verifyCreation: (input: {
      readonly response: CreationResponse;
      readonly challenge: Challenge;
      readonly relyingParty: RelyingParty;
    }) => Effect.Effect<Option.Option<Credential>>;
    /** The options a browser signs in with a passkey of the relying party given with, over the challenge given, naming no credential. */
    readonly requestOptions: (input: {
      readonly relyingParty: RelyingParty;
      readonly challenge: Challenge;
    }) => Effect.Effect<RequestOptions>;
    /**
     * The signature counter of a browser's answer to a sign-in, when it is
     * signed by the passkey given over the challenge given, at the relying
     * party given, with the user verified and the counter not behind the
     * passkey's; none when it is not.
     */
    readonly verifySignIn: (input: {
      readonly response: SignInResponse;
      readonly challenge: Challenge;
      readonly passkey: Passkey;
      readonly relyingParty: RelyingParty;
    }) => Effect.Effect<Option.Option<number>>;
    /** The challenge a browser's answer says it answers, read from its client data; none when that does not say one. */
    readonly challengeOf: (clientDataJSON: string) => Option.Option<Challenge>;
  }
>()("@cota/hub/sign-in/WebAuthn") {}
