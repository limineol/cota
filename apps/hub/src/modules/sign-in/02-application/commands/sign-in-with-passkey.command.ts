import { Context, DateTime, Effect, Layer, Option } from "effect";
import {
  begin,
  type Signed,
} from "#modules/sign-in/02-application/commands/sign-in-owner.command.ts";
import { Passkeys } from "#modules/sign-in/02-application/interfaces/passkeys.repository.ts";
import { SignInTokens } from "#modules/sign-in/02-application/interfaces/sign-in-tokens.ts";
import { SignIns } from "#modules/sign-in/02-application/interfaces/sign-ins.repository.ts";
import { WebAuthn } from "#modules/sign-in/02-application/interfaces/web-authn.ts";
import type { SignInResponse } from "#modules/sign-in/03-domain/ceremony.ts";
import { Challenges } from "#modules/sign-in/03-domain/challenges.ts";
import {
  CredentialId,
  PasskeyRefused,
} from "#modules/sign-in/03-domain/passkey.ts";
import type { HubStoreUnavailable } from "#shared/03-domain/hub-store.ts";

export interface PasskeyAttempt {
  readonly response: SignInResponse;
  /** The sign-in request's user agent, as it sent it. */
  readonly userAgent: string;
}

export class SignInWithPasskey extends Context.Service<
  SignInWithPasskey,
  {
    /**
     * Makes a sign-in for the owner when a browser's answer is signed by a
     * kept passkey, at the relying party kept with it, over a challenge
     * issued for signing in and not yet used, with the user verified and the
     * counter not behind; refused alike for every other answer (I16). It is
     * not counted toward the attempt limit, nor paused by it: a passkey
     * cannot be guessed.
     */
    readonly execute: (
      attempt: PasskeyAttempt,
    ) => Effect.Effect<Signed, PasskeyRefused | HubStoreUnavailable>;
  }
>()("@cota/hub/sign-in/SignInWithPasskey") {}

export const layer: Layer.Layer<
  SignInWithPasskey,
  never,
  Challenges | Passkeys | WebAuthn | SignIns | SignInTokens
> = Layer.effect(
  SignInWithPasskey,
  Effect.gen(function* () {
    const challenges = yield* Challenges;
    const passkeys = yield* Passkeys;
    const webAuthn = yield* WebAuthn;
    const signIns = yield* SignIns;
    const tokens = yield* SignInTokens;
    return SignInWithPasskey.of({
      execute: Effect.fn("SignInWithPasskey.execute")(function* (
        attempt: PasskeyAttempt,
      ) {
        const { response } = attempt;
        const challenge = webAuthn.challengeOf(
          response.response.clientDataJSON,
        );
        if (Option.isNone(challenge)) return yield* new PasskeyRefused();
        const issued = yield* challenges.take(challenge.value);
        if (Option.isNone(issued) || issued.value.purpose !== "sign-in") {
          return yield* new PasskeyRefused();
        }
        const passkey = yield* passkeys.findByCredentialId(
          CredentialId.make(response.id),
        );
        if (Option.isNone(passkey)) return yield* new PasskeyRefused();
        const counter = yield* webAuthn.verifySignIn({
          response,
          challenge: challenge.value,
          passkey: passkey.value,
          relyingParty: passkey.value.relyingParty,
        });
        if (Option.isNone(counter)) return yield* new PasskeyRefused();
        const kept = yield* passkeys.signedIn(
          passkey.value.id,
          counter.value,
          yield* DateTime.now,
        );
        if (!kept) return yield* new PasskeyRefused();
        return yield* begin(tokens, signIns, attempt.userAgent);
      }),
    });
  }),
);
