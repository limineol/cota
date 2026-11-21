import { Context, DateTime, Effect, Layer, Option } from "effect";
import { ConfiguredPassword } from "#modules/sign-in/02-application/interfaces/configured-password.ts";
import { Passkeys } from "#modules/sign-in/02-application/interfaces/passkeys.repository.ts";
import { SignInTokens } from "#modules/sign-in/02-application/interfaces/sign-in-tokens.ts";
import { SignIns } from "#modules/sign-in/02-application/interfaces/sign-ins.repository.ts";
import { StoredPasswords } from "#modules/sign-in/02-application/interfaces/stored-passwords.repository.ts";
import * as OwnerPassword from "#modules/sign-in/03-domain/owner-password.ts";
import * as SignIn from "#modules/sign-in/03-domain/sign-in.entity.ts";
import { isSetUp } from "#modules/sign-in/03-domain/way-in.ts";
import type { HubStoreUnavailable } from "#shared/03-domain/hub-store.ts";

export class IdentifyOwner extends Context.Service<
  IdentifyOwner,
  {
    /**
     * Gives the live sign-in a token opens, and nothing for a token the hub
     * does not know, one whose sign-in is revoked or expired, or any token on
     * a hub that is not set up (I5). Writes the sign-in's `lastUsedAt`
     * when it was last written more than a minute before.
     */
    readonly execute: (
      token: string,
    ) => Effect.Effect<Option.Option<SignIn.SignIn>, HubStoreUnavailable>;
  }
>()("@cota/hub/sign-in/IdentifyOwner") {}

export const layer: Layer.Layer<
  IdentifyOwner,
  never,
  ConfiguredPassword | StoredPasswords | Passkeys | SignIns | SignInTokens
> = Layer.effect(
  IdentifyOwner,
  Effect.gen(function* () {
    const configured = yield* ConfiguredPassword;
    const stored = yield* StoredPasswords;
    const passkeys = yield* Passkeys;
    const signIns = yield* SignIns;
    const tokens = yield* SignInTokens;
    return IdentifyOwner.of({
      execute: Effect.fn("IdentifyOwner.execute")(function* (token: string) {
        const kept = yield* OwnerPassword.keptBy(configured.isSet, stored.read);
        if (!(yield* isSetUp(kept, passkeys.any))) return Option.none();
        const found = yield* signIns.findByDigest(tokens.digestOf(token));
        if (Option.isNone(found) || !(yield* SignIn.isLive(found.value))) {
          return Option.none();
        }
        if (!(yield* SignIn.needsTouch(found.value))) return found;
        const now = yield* DateTime.now;
        yield* signIns.touch(found.value.id, now);
        return Option.some({ ...found.value, lastUsedAt: now });
      }),
    });
  }),
);
