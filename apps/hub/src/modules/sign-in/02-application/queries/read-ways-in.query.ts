import { Context, Effect, Layer } from "effect";
import { ConfiguredPassword } from "#modules/sign-in/02-application/interfaces/configured-password.ts";
import { Passkeys } from "#modules/sign-in/02-application/interfaces/passkeys.repository.ts";
import { StoredPasswords } from "#modules/sign-in/02-application/interfaces/stored-passwords.repository.ts";
import * as OwnerPassword from "#modules/sign-in/03-domain/owner-password.ts";
import type { HubStoreUnavailable } from "#shared/03-domain/hub-store.ts";

/** How the owner signs in on this hub, which anyone may ask: never where the password is kept. */
export interface WaysIn {
  readonly setUp: boolean;
  /** Whether an owner password signs in, the configuration's or the stored one. */
  readonly password: boolean;
  /** Whether a passkey signs in: the hub keeps one. */
  readonly passkey: boolean;
}

export class ReadWaysIn extends Context.Service<
  ReadWaysIn,
  { readonly execute: Effect.Effect<WaysIn, HubStoreUnavailable> }
>()("@cota/hub/sign-in/ReadWaysIn") {}

export const layer: Layer.Layer<
  ReadWaysIn,
  never,
  ConfiguredPassword | StoredPasswords | Passkeys
> = Layer.effect(
  ReadWaysIn,
  Effect.gen(function* () {
    const configured = yield* ConfiguredPassword;
    const stored = yield* StoredPasswords;
    const passkeys = yield* Passkeys;
    return ReadWaysIn.of({
      execute: Effect.gen(function* () {
        const kept = yield* OwnerPassword.keptBy(configured.isSet, stored.read);
        const password = kept._tag !== "None";
        const passkey = yield* passkeys.any;
        const waysIn: WaysIn = {
          setUp: password || passkey,
          password,
          passkey,
        };
        return waysIn;
      }).pipe(Effect.withSpan("ReadWaysIn.execute")),
    });
  }),
);
