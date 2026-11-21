import { Context, Effect, Layer } from "effect";
import { Passkeys } from "#modules/sign-in/02-application/interfaces/passkeys.repository.ts";
import { WebAuthn } from "#modules/sign-in/02-application/interfaces/web-authn.ts";
import type { CreationOptions } from "#modules/sign-in/03-domain/ceremony.ts";
import { Challenges } from "#modules/sign-in/03-domain/challenges.ts";
import * as RelyingParty from "#modules/sign-in/03-domain/relying-party.ts";
import type { HubStoreUnavailable } from "#shared/03-domain/hub-store.ts";

export class PreparePasskey extends Context.Service<
  PreparePasskey,
  {
    /**
     * The options a browser makes a passkey with, at the relying party of the
     * request's `Origin`, over a challenge issued for making a passkey there,
     * excluding the passkeys it has already; refused for an origin a browser
     * offers no passkey at (I14).
     */
    readonly execute: (
      origin: string | undefined,
    ) => Effect.Effect<
      CreationOptions,
      RelyingParty.NotAPasskeyOrigin | HubStoreUnavailable
    >;
  }
>()("@cota/hub/sign-in/PreparePasskey") {}

export const layer: Layer.Layer<
  PreparePasskey,
  never,
  Challenges | Passkeys | WebAuthn
> = Layer.effect(
  PreparePasskey,
  Effect.gen(function* () {
    const challenges = yield* Challenges;
    const passkeys = yield* Passkeys;
    const webAuthn = yield* WebAuthn;
    return PreparePasskey.of({
      execute: Effect.fn("PreparePasskey.execute")(function* (
        origin: string | undefined,
      ) {
        const relyingParty = RelyingParty.of(origin);
        if (relyingParty._tag === "None") {
          return yield* new RelyingParty.NotAPasskeyOrigin({ origin });
        }
        const challenge = yield* webAuthn.challenge;
        yield* challenges.issue(challenge, "make-passkey", relyingParty.value);
        const exclude = (yield* passkeys.all).filter(
          (passkey) => passkey.relyingParty.id === relyingParty.value.id,
        );
        return yield* webAuthn.creationOptions({
          relyingParty: relyingParty.value,
          challenge,
          exclude,
        });
      }),
    });
  }),
);
