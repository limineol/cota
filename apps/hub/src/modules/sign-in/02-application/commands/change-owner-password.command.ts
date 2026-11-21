import { Context, DateTime, Effect, Layer, Option } from "effect";
import { RevokeOtherSignIns } from "#modules/sign-in/02-application/commands/revoke-other-sign-ins.command.ts";
import { ConfiguredPassword } from "#modules/sign-in/02-application/interfaces/configured-password.ts";
import { PasswordHasher } from "#modules/sign-in/02-application/interfaces/password-hasher.ts";
import { StoredPasswords } from "#modules/sign-in/02-application/interfaces/stored-passwords.repository.ts";
import {
  Attempts,
  failAfterTheDelay,
  type TooManyAttempts,
  WrongPassword,
} from "#modules/sign-in/03-domain/attempts.ts";
import * as OwnerPassword from "#modules/sign-in/03-domain/owner-password.ts";
import type { HubStoreUnavailable } from "#shared/03-domain/hub-store.ts";
import type { SignInId } from "#shared/03-domain/ids.ts";

export interface Change {
  /** The sign-in that asks for the change, which stays live. */
  readonly signIn: SignInId;
  /** The stored password, which a change of it must give; a hub with none takes one without it. */
  readonly current: Option.Option<string>;
  readonly password: string;
}

export class ChangeOwnerPassword extends Context.Service<
  ChangeOwnerPassword,
  {
    /**
     * Replaces the stored password, given the current one, or sets one on a
     * hub with none, and revokes every live sign-in but the one that asked
     * (I13): refused while the configuration holds the owner password (I12),
     * and when the attempt limit is reached; a wrong or missing current
     * password is counted and answered no sooner than a second after the
     * change began (I7, I8). Of changes made at once, the store keeps the
     * first, and the others are answered as a wrong password, uncounted
     * (I13).
     */
    readonly execute: (
      change: Change,
    ) => Effect.Effect<
      void,
      | OwnerPassword.PasswordInConfiguration
      | TooManyAttempts
      | WrongPassword
      | HubStoreUnavailable
    >;
  }
>()("@cota/hub/sign-in/ChangeOwnerPassword") {}

export const layer: Layer.Layer<
  ChangeOwnerPassword,
  never,
  | Attempts
  | ConfiguredPassword
  | StoredPasswords
  | PasswordHasher
  | RevokeOtherSignIns
> = Layer.effect(
  ChangeOwnerPassword,
  Effect.gen(function* () {
    const attempts = yield* Attempts;
    const configured = yield* ConfiguredPassword;
    const stored = yield* StoredPasswords;
    const hasher = yield* PasswordHasher;
    const revokeOtherSignIns = yield* RevokeOtherSignIns;
    return ChangeOwnerPassword.of({
      execute: Effect.fn("ChangeOwnerPassword.execute")(function* (
        change: Change,
      ) {
        const began = yield* DateTime.now;
        const kept = yield* OwnerPassword.keptBy(configured.isSet, stored.read);
        if (kept._tag === "Configuration") {
          return yield* new OwnerPassword.PasswordInConfiguration();
        }
        if (kept._tag === "None") {
          const first = yield* stored.keepFirst({
            hash: yield* hasher.hash(change.password),
            setAt: yield* DateTime.now,
          });
          if (!first) {
            return yield* failAfterTheDelay(began, new WrongPassword());
          }
          yield* revokeOtherSignIns.execute(change.signIn);
          return;
        }
        const right = yield* attempts.compare(
          Option.match(change.current, {
            onNone: () => Effect.succeed(false),
            onSome: (current) => hasher.verify(current, kept.stored.hash),
          }),
        );
        if (!right) return yield* failAfterTheDelay(began, new WrongPassword());
        const next = {
          hash: yield* hasher.hash(change.password),
          setAt: yield* DateTime.now,
        };
        const replaced =
          (yield* stored.replace(kept.stored.hash, next)) ||
          (yield* stored.keepFirst(next));
        if (!replaced) {
          return yield* failAfterTheDelay(began, new WrongPassword());
        }
        yield* revokeOtherSignIns.execute(change.signIn);
      }),
    });
  }),
);
