import { Context, Effect, Layer, Option } from "effect";
import { Passkeys } from "#modules/sign-in/02-application/interfaces/passkeys.repository.ts";
import { WebAuthn } from "#modules/sign-in/02-application/interfaces/web-authn.ts";
import type { CreationResponse } from "#modules/sign-in/03-domain/ceremony.ts";
import { Challenges } from "#modules/sign-in/03-domain/challenges.ts";
import * as Passkey from "#modules/sign-in/03-domain/passkey.ts";
import type { HubStoreUnavailable } from "#shared/03-domain/hub-store.ts";

export interface Making {
  readonly response: CreationResponse;
  /** The request's user agent, as it sent it. */
  readonly userAgent: string;
}

export class MakePasskey extends Context.Service<
  MakePasskey,
  {
    /**
     * Keeps the passkey a browser made, when its answer is to a challenge
     * issued for making a passkey and not yet used, and verifies at that
     * challenge's relying party with the user verified; refused as not made
     * otherwise, and as existing when the hub keeps its credential already.
     */
    readonly execute: (
      making: Making,
    ) => Effect.Effect<
      Passkey.Passkey,
      Passkey.PasskeyNotMade | Passkey.PasskeyExists | HubStoreUnavailable
    >;
  }
>()("@cota/hub/sign-in/MakePasskey") {}

export const layer: Layer.Layer<
  MakePasskey,
  never,
  Challenges | Passkeys | WebAuthn
> = Layer.effect(
  MakePasskey,
  Effect.gen(function* () {
    const challenges = yield* Challenges;
    const passkeys = yield* Passkeys;
    const webAuthn = yield* WebAuthn;
    return MakePasskey.of({
      execute: Effect.fn("MakePasskey.execute")(function* (making: Making) {
        const challenge = webAuthn.challengeOf(
          making.response.response.clientDataJSON,
        );
        if (Option.isNone(challenge)) {
          return yield* new Passkey.PasskeyNotMade();
        }
        const issued = yield* challenges.take(challenge.value);
        if (Option.isNone(issued) || issued.value.purpose !== "make-passkey") {
          return yield* new Passkey.PasskeyNotMade();
        }
        const credential = yield* webAuthn.verifyCreation({
          response: making.response,
          challenge: challenge.value,
          relyingParty: issued.value.relyingParty,
        });
        if (Option.isNone(credential)) {
          return yield* new Passkey.PasskeyNotMade();
        }
        const added = yield* passkeys.add(
          yield* Passkey.make(
            credential.value,
            issued.value.relyingParty,
            making.userAgent,
          ),
        );
        if (Option.isNone(added)) return yield* new Passkey.PasskeyExists();
        return added.value;
      }),
    });
  }),
);
