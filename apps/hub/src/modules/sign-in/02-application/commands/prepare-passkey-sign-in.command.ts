import { Context, Effect, Layer } from "effect";
import { Passkeys } from "#modules/sign-in/02-application/interfaces/passkeys.repository.ts";
import { WebAuthn } from "#modules/sign-in/02-application/interfaces/web-authn.ts";
import type { RequestOptions } from "#modules/sign-in/03-domain/ceremony.ts";
import { Challenges } from "#modules/sign-in/03-domain/challenges.ts";
import { NoPasskeys } from "#modules/sign-in/03-domain/passkey.ts";
import * as RelyingParty from "#modules/sign-in/03-domain/relying-party.ts";
import type { HubStoreUnavailable } from "#shared/03-domain/hub-store.ts";

export class PreparePasskeySignIn extends Context.Service<
  PreparePasskeySignIn,
  {
    /**
     * The options a browser signs in with a passkey with, at the relying party
     * of the request's `Origin`, over a challenge issued for signing in,
     * naming no passkey; refused for an origin a browser offers no passkey at
     * (I14), and on a hub with no passkey.
     */
    readonly execute: (
      origin: string | undefined,
    ) => Effect.Effect<
      RequestOptions,
      RelyingParty.NotAPasskeyOrigin | NoPasskeys | HubStoreUnavailable
    >;
  }
>()("@cota/hub/sign-in/PreparePasskeySignIn") {}

export const layer: Layer.Layer<
  PreparePasskeySignIn,
  never,
  Challenges | Passkeys | WebAuthn
> = Layer.effect(
  PreparePasskeySignIn,
  Effect.gen(function* () {
    const challenges = yield* Challenges;
    const passkeys = yield* Passkeys;
    const webAuthn = yield* WebAuthn;
    return PreparePasskeySignIn.of({
      execute: Effect.fn("PreparePasskeySignIn.execute")(function* (
        origin: string | undefined,
      ) {
        const relyingParty = RelyingParty.of(origin);
        if (relyingParty._tag === "None") {
          return yield* new RelyingParty.NotAPasskeyOrigin({ origin });
        }
        if (!(yield* passkeys.any)) return yield* new NoPasskeys();
        const challenge = yield* webAuthn.challenge;
        yield* challenges.issue(challenge, "sign-in", relyingParty.value);
        return yield* webAuthn.requestOptions({
          relyingParty: relyingParty.value,
          challenge,
        });
      }),
    });
  }),
);
