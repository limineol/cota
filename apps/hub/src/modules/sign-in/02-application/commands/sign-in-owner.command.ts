import { Context, DateTime, Effect, Layer, Option } from "effect";
import { ConfiguredPassword } from "#modules/sign-in/02-application/interfaces/configured-password.ts";
import { Passkeys } from "#modules/sign-in/02-application/interfaces/passkeys.repository.ts";
import { PasswordHasher } from "#modules/sign-in/02-application/interfaces/password-hasher.ts";
import { SignInTokens } from "#modules/sign-in/02-application/interfaces/sign-in-tokens.ts";
import { SignIns } from "#modules/sign-in/02-application/interfaces/sign-ins.repository.ts";
import { StoredPasswords } from "#modules/sign-in/02-application/interfaces/stored-passwords.repository.ts";
import {
  Attempts,
  failAfterTheDelay,
  type TooManyAttempts,
  WrongPassword,
} from "#modules/sign-in/03-domain/attempts.ts";
import * as OwnerPassword from "#modules/sign-in/03-domain/owner-password.ts";
import * as SignIn from "#modules/sign-in/03-domain/sign-in.entity.ts";
import type { HubStoreUnavailable } from "#shared/03-domain/hub-store.ts";

export interface Attempt {
  readonly password: string;
  /** The sign-in request's user agent, as it sent it. */
  readonly userAgent: string;
}

export interface Signed {
  /** The token for the browser; the hub keeps only its digest. */
  readonly token: string;
  readonly signIn: SignIn.SignIn;
}

/**
 * Makes a sign-in for the owner, sent by the given user agent, and deletes
 * the sign-ins that ended more than 30 days before.
 */
export const begin = Effect.fn("SignInOwner.begin")(function* (
  tokens: SignInTokens["Service"],
  signIns: SignIns["Service"],
  userAgent: string,
) {
  const { token, digest } = yield* tokens.make;
  const made = yield* SignIn.make(digest, userAgent);
  yield* signIns.forget(
    DateTime.subtractDuration(made.createdAt, SignIn.keptAfterEnding),
  );
  const signIn = yield* signIns.add(made);
  const signed: Signed = { token, signIn };
  return signed;
});

export class SignInOwner extends Context.Service<
  SignInOwner,
  {
    /**
     * Makes a sign-in for the owner password: refused when the hub is not
     * set up, when it has a passkey and no password, or when the attempt
     * limit is reached, and a wrong password is
     * answered no sooner than a second after the attempt began (I7, I8). A
     * sign-in made with a stored password that was changed while it was
     * compared is revoked at once and answered as a wrong password (I13).
     */
    readonly execute: (
      attempt: Attempt,
    ) => Effect.Effect<
      Signed,
      | OwnerPassword.NotSetUp
      | OwnerPassword.PasswordOff
      | TooManyAttempts
      | WrongPassword
      | HubStoreUnavailable
    >;
  }
>()("@cota/hub/sign-in/SignInOwner") {}

export const layer: Layer.Layer<
  SignInOwner,
  never,
  | Attempts
  | ConfiguredPassword
  | StoredPasswords
  | Passkeys
  | PasswordHasher
  | SignIns
  | SignInTokens
> = Layer.effect(
  SignInOwner,
  Effect.gen(function* () {
    const attempts = yield* Attempts;
    const configured = yield* ConfiguredPassword;
    const stored = yield* StoredPasswords;
    const passkeys = yield* Passkeys;
    const hasher = yield* PasswordHasher;
    const signIns = yield* SignIns;
    const tokens = yield* SignInTokens;
    return SignInOwner.of({
      execute: Effect.fn("SignInOwner.execute")(function* (attempt: Attempt) {
        const began = yield* DateTime.now;
        const kept = yield* OwnerPassword.keptBy(configured.isSet, stored.read);
        if (kept._tag === "None") {
          if (yield* passkeys.any)
            return yield* new OwnerPassword.PasswordOff();
          return yield* new OwnerPassword.NotSetUp();
        }
        const right = yield* attempts.compare(
          kept._tag === "Configuration"
            ? Effect.sync(() => configured.matches(attempt.password))
            : hasher.verify(attempt.password, kept.stored.hash),
        );
        if (!right) return yield* failAfterTheDelay(began, new WrongPassword());
        const signed = yield* begin(tokens, signIns, attempt.userAgent);
        if (kept._tag === "HubStore") {
          const current = yield* stored.read;
          if (
            !Option.exists(current, ({ hash }) => hash === kept.stored.hash)
          ) {
            yield* signIns.revoke([signed.signIn.id], yield* DateTime.now);
            return yield* failAfterTheDelay(began, new WrongPassword());
          }
        }
        return signed;
      }),
    });
  }),
);
