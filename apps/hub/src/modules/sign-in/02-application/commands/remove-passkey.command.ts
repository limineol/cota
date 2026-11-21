import { Context, Effect, Layer } from "effect";
import { ConfiguredPassword } from "#modules/sign-in/02-application/interfaces/configured-password.ts";
import { Passkeys } from "#modules/sign-in/02-application/interfaces/passkeys.repository.ts";
import * as Passkey from "#modules/sign-in/03-domain/passkey.ts";
import { LastWayIn } from "#modules/sign-in/03-domain/way-in.ts";
import type { HubStoreUnavailable } from "#shared/03-domain/hub-store.ts";
import type { PasskeyId } from "#shared/03-domain/ids.ts";

export class RemovePasskey extends Context.Service<
  RemovePasskey,
  {
    /**
     * Removes a passkey, unless it is the last way in: another passkey, the
     * stored password or the configuration's must remain (I17).
     */
    readonly execute: (
      id: PasskeyId,
    ) => Effect.Effect<
      void,
      Passkey.NoSuchPasskey | LastWayIn | HubStoreUnavailable
    >;
  }
>()("@cota/hub/sign-in/RemovePasskey") {}

export const layer: Layer.Layer<
  RemovePasskey,
  never,
  ConfiguredPassword | Passkeys
> = Layer.effect(
  RemovePasskey,
  Effect.gen(function* () {
    const configured = yield* ConfiguredPassword;
    const passkeys = yield* Passkeys;
    return RemovePasskey.of({
      execute: Effect.fn("RemovePasskey.execute")(function* (id: PasskeyId) {
        switch (yield* passkeys.remove(id, configured.isSet)) {
          case "NoSuchPasskey":
            return yield* new Passkey.NoSuchPasskey({ id });
          case "LastWayIn":
            return yield* new LastWayIn();
          case "Removed":
            return;
        }
      }),
    });
  }),
);
