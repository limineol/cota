import { Context, Effect, Layer } from "effect";
import { ConfiguredPassword } from "#modules/sign-in/02-application/interfaces/configured-password.ts";
import { Passkeys } from "#modules/sign-in/02-application/interfaces/passkeys.repository.ts";
import { SetupCodes } from "#modules/sign-in/02-application/interfaces/setup-codes.ts";
import { StoredPasswords } from "#modules/sign-in/02-application/interfaces/stored-passwords.repository.ts";
import * as OwnerPassword from "#modules/sign-in/03-domain/owner-password.ts";
import { SetupCode } from "#modules/sign-in/03-domain/setup-code.ts";
import { isSetUp } from "#modules/sign-in/03-domain/way-in.ts";
import type { HubStoreUnavailable } from "#shared/03-domain/hub-store.ts";

export class MakeSetupCode extends Context.Service<
  MakeSetupCode,
  {
    /**
     * On a hub that is not set up, makes its setup code, holds it, and prints
     * it in the log with what to do with it; on one that is set up, nothing.
     */
    readonly execute: Effect.Effect<void, HubStoreUnavailable>;
  }
>()("@cota/hub/sign-in/MakeSetupCode") {}

export const layer: Layer.Layer<
  MakeSetupCode,
  never,
  ConfiguredPassword | StoredPasswords | Passkeys | SetupCode | SetupCodes
> = Layer.effect(
  MakeSetupCode,
  Effect.gen(function* () {
    const configured = yield* ConfiguredPassword;
    const stored = yield* StoredPasswords;
    const passkeys = yield* Passkeys;
    const setupCode = yield* SetupCode;
    const codes = yield* SetupCodes;
    return MakeSetupCode.of({
      execute: Effect.gen(function* () {
        const kept = yield* OwnerPassword.keptBy(configured.isSet, stored.read);
        if (yield* isSetUp(kept, passkeys.any)) return;
        const { written, digest } = yield* codes.make;
        yield* setupCode.hold(digest);
        yield* Effect.logInfo(
          `this hub is not set up: open its dashboard, give it the setup code ${written} and choose the owner password`,
        );
      }).pipe(Effect.withSpan("MakeSetupCode.execute")),
    });
  }),
);
