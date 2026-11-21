import { Context, Effect, Layer } from "effect";
import { ConfiguredPassword } from "#modules/sign-in/02-application/interfaces/configured-password.ts";
import { StoredPasswords } from "#modules/sign-in/02-application/interfaces/stored-passwords.repository.ts";
import { LastWayIn } from "#modules/sign-in/03-domain/way-in.ts";
import type { HubStoreUnavailable } from "#shared/03-domain/hub-store.ts";

export class ForgetOwnerPassword extends Context.Service<
  ForgetOwnerPassword,
  {
    /**
     * Turns the stored password off by forgetting it, unless it is the last
     * way in: a passkey or the configuration's password must remain (I17).
     */
    readonly execute: Effect.Effect<void, LastWayIn | HubStoreUnavailable>;
  }
>()("@cota/hub/sign-in/ForgetOwnerPassword") {}

export const layer: Layer.Layer<
  ForgetOwnerPassword,
  never,
  ConfiguredPassword | StoredPasswords
> = Layer.effect(
  ForgetOwnerPassword,
  Effect.gen(function* () {
    const configured = yield* ConfiguredPassword;
    const stored = yield* StoredPasswords;
    return ForgetOwnerPassword.of({
      execute: Effect.gen(function* () {
        if ((yield* stored.forget(configured.isSet)) === "LastWayIn") {
          return yield* new LastWayIn();
        }
      }).pipe(Effect.withSpan("ForgetOwnerPassword.execute")),
    });
  }),
);
