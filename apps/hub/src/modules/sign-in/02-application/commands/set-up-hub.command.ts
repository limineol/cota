import { Context, DateTime, Effect, Layer } from "effect";
import {
  begin,
  type Signed,
} from "#modules/sign-in/02-application/commands/sign-in-owner.command.ts";
import { ConfiguredPassword } from "#modules/sign-in/02-application/interfaces/configured-password.ts";
import { Passkeys } from "#modules/sign-in/02-application/interfaces/passkeys.repository.ts";
import { PasswordHasher } from "#modules/sign-in/02-application/interfaces/password-hasher.ts";
import { SetupCodes } from "#modules/sign-in/02-application/interfaces/setup-codes.ts";
import { SignInTokens } from "#modules/sign-in/02-application/interfaces/sign-in-tokens.ts";
import { SignIns } from "#modules/sign-in/02-application/interfaces/sign-ins.repository.ts";
import { StoredPasswords } from "#modules/sign-in/02-application/interfaces/stored-passwords.repository.ts";
import {
  Attempts,
  failAfterTheDelay,
  type TooManyAttempts,
} from "#modules/sign-in/03-domain/attempts.ts";
import * as OwnerPassword from "#modules/sign-in/03-domain/owner-password.ts";
import * as SetupCode from "#modules/sign-in/03-domain/setup-code.ts";
import { isSetUp } from "#modules/sign-in/03-domain/way-in.ts";
import type { HubStoreUnavailable } from "#shared/03-domain/hub-store.ts";

export interface Setup {
  /** The setup code as it was given. */
  readonly code: string;
  readonly password: string;
  /** The setup request's user agent, as it sent it. */
  readonly userAgent: string;
}

export class SetUpHub extends Context.Service<
  SetUpHub,
  {
    /**
     * Stores the owner password and signs the owner in, given the hub's
     * setup code: refused once the hub is set up, and when the attempt limit
     * is reached; a wrong code is counted with wrong passwords and answered
     * no sooner than a second after the setup began (I7, I8). Of setups made
     * at once, the store keeps the first one's password and refuses the
     * others (I11).
     */
    readonly execute: (
      setup: Setup,
    ) => Effect.Effect<
      Signed,
      | SetupCode.AlreadySetUp
      | SetupCode.WrongSetupCode
      | TooManyAttempts
      | HubStoreUnavailable
    >;
  }
>()("@cota/hub/sign-in/SetUpHub") {}

export const layer: Layer.Layer<
  SetUpHub,
  never,
  | Attempts
  | ConfiguredPassword
  | StoredPasswords
  | Passkeys
  | PasswordHasher
  | SetupCode.SetupCode
  | SetupCodes
  | SignIns
  | SignInTokens
> = Layer.effect(
  SetUpHub,
  Effect.gen(function* () {
    const attempts = yield* Attempts;
    const configured = yield* ConfiguredPassword;
    const stored = yield* StoredPasswords;
    const passkeys = yield* Passkeys;
    const hasher = yield* PasswordHasher;
    const setupCode = yield* SetupCode.SetupCode;
    const codes = yield* SetupCodes;
    const signIns = yield* SignIns;
    const tokens = yield* SignInTokens;
    return SetUpHub.of({
      execute: Effect.fn("SetUpHub.execute")(function* (setup: Setup) {
        const began = yield* DateTime.now;
        const kept = yield* OwnerPassword.keptBy(configured.isSet, stored.read);
        if (yield* isSetUp(kept, passkeys.any)) {
          return yield* new SetupCode.AlreadySetUp();
        }
        const right = yield* attempts.compare(
          setupCode.opens((held) =>
            codes.matches(held, SetupCode.normalised(setup.code)),
          ),
        );
        if (!right) {
          return yield* failAfterTheDelay(
            began,
            new SetupCode.WrongSetupCode(),
          );
        }
        const hash = yield* hasher.hash(setup.password);
        const first = yield* stored.keepFirst({
          hash,
          setAt: yield* DateTime.now,
        });
        if (!first) return yield* new SetupCode.AlreadySetUp();
        yield* setupCode.forget;
        return yield* begin(tokens, signIns, setup.userAgent);
      }),
    });
  }),
);
