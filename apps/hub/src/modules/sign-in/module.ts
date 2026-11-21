import { Effect, Layer, type Option, type Redacted } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { Api } from "#api.ts";
import * as CallerMiddleware from "#modules/sign-in/01-presentation/caller.middleware.ts";
import * as SignInHandlers from "#modules/sign-in/01-presentation/sign-in.handlers.ts";
import * as ChangeOwnerPassword from "#modules/sign-in/02-application/commands/change-owner-password.command.ts";
import * as ForgetOwnerPassword from "#modules/sign-in/02-application/commands/forget-owner-password.command.ts";
import * as MakePasskey from "#modules/sign-in/02-application/commands/make-passkey.command.ts";
import * as MakeSetupCode from "#modules/sign-in/02-application/commands/make-setup-code.command.ts";
import * as PreparePasskey from "#modules/sign-in/02-application/commands/prepare-passkey.command.ts";
import * as PreparePasskeySignIn from "#modules/sign-in/02-application/commands/prepare-passkey-sign-in.command.ts";
import * as RemovePasskey from "#modules/sign-in/02-application/commands/remove-passkey.command.ts";
import * as RevokeOtherSignIns from "#modules/sign-in/02-application/commands/revoke-other-sign-ins.command.ts";
import * as RevokeSignIn from "#modules/sign-in/02-application/commands/revoke-sign-in.command.ts";
import * as SetUpHub from "#modules/sign-in/02-application/commands/set-up-hub.command.ts";
import * as SignInOwner from "#modules/sign-in/02-application/commands/sign-in-owner.command.ts";
import * as SignInWithPasskey from "#modules/sign-in/02-application/commands/sign-in-with-passkey.command.ts";
import type { Passkeys } from "#modules/sign-in/02-application/interfaces/passkeys.repository.ts";
import type { PasswordHasher } from "#modules/sign-in/02-application/interfaces/password-hasher.ts";
import type { SetupCodes } from "#modules/sign-in/02-application/interfaces/setup-codes.ts";
import type { SignIns } from "#modules/sign-in/02-application/interfaces/sign-ins.repository.ts";
import type { StoredPasswords } from "#modules/sign-in/02-application/interfaces/stored-passwords.repository.ts";
import type { WebAuthn } from "#modules/sign-in/02-application/interfaces/web-authn.ts";
import * as IdentifyOwner from "#modules/sign-in/02-application/queries/identify-owner.query.ts";
import * as ListPasskeys from "#modules/sign-in/02-application/queries/list-passkeys.query.ts";
import * as ListSignIns from "#modules/sign-in/02-application/queries/list-sign-ins.query.ts";
import * as ReadOwnerPassword from "#modules/sign-in/02-application/queries/read-owner-password.query.ts";
import * as ReadWaysIn from "#modules/sign-in/02-application/queries/read-ways-in.query.ts";
import * as Attempts from "#modules/sign-in/03-domain/attempts.ts";
import * as Challenges from "#modules/sign-in/03-domain/challenges.ts";
import * as SetupCode from "#modules/sign-in/03-domain/setup-code.ts";
import * as Argon2idPasswordHasher from "#modules/sign-in/04-infrastructure/argon2id-password-hasher.ts";
import * as SqlitePasskeys from "#modules/sign-in/04-infrastructure/persistence/sqlite/sqlite-passkeys.repository.ts";
import * as SqliteSignIns from "#modules/sign-in/04-infrastructure/persistence/sqlite/sqlite-sign-ins.repository.ts";
import * as SqliteStoredPasswords from "#modules/sign-in/04-infrastructure/persistence/sqlite/sqlite-stored-passwords.repository.ts";
import * as RandomSetupCodes from "#modules/sign-in/04-infrastructure/random-setup-codes.ts";
import * as RandomSignInTokens from "#modules/sign-in/04-infrastructure/random-sign-in-tokens.ts";
import * as Sha256ConfiguredPassword from "#modules/sign-in/04-infrastructure/sha256-configured-password.ts";
import * as SimpleWebAuthn from "#modules/sign-in/04-infrastructure/simple-web-authn.ts";

export interface Options {
  /** The configuration's owner password, which wins over a stored one. */
  readonly password: Option.Option<Redacted.Redacted<string>>;
}

/** The sign-in module's tables in the hub store. */
export const steps = [
  ...SqliteSignIns.steps,
  ...SqliteStoredPasswords.steps,
  ...SqlitePasskeys.steps,
];

/** Makes the setup code of a hub that is not set up as the layer is built, and prints it. */
const setupCodeMadeAtStart = Layer.effectDiscard(
  Effect.gen(function* () {
    const makeSetupCode = yield* MakeSetupCode.MakeSetupCode;
    yield* makeSetupCode.execute.pipe(Effect.orDie);
  }),
);

/**
 * The sign-in module's commands and queries over the ports given (the
 * sign-ins, the stored password, the passkeys, the password hasher, where
 * setup codes come from and WebAuthn), with the configuration's owner
 * password, the attempt count, the challenges and the setup code of the whole
 * hub, which it makes at start when the hub is not set up.
 */
export const overPorts = (
  options: Options,
): Layer.Layer<
  | SignInOwner.SignInOwner
  | SetUpHub.SetUpHub
  | ChangeOwnerPassword.ChangeOwnerPassword
  | RevokeSignIn.RevokeSignIn
  | RevokeOtherSignIns.RevokeOtherSignIns
  | IdentifyOwner.IdentifyOwner
  | ListSignIns.ListSignIns
  | ReadWaysIn.ReadWaysIn
  | ReadOwnerPassword.ReadOwnerPassword
  | ForgetOwnerPassword.ForgetOwnerPassword
  | PreparePasskey.PreparePasskey
  | MakePasskey.MakePasskey
  | ListPasskeys.ListPasskeys
  | RemovePasskey.RemovePasskey
  | PreparePasskeySignIn.PreparePasskeySignIn
  | SignInWithPasskey.SignInWithPasskey,
  never,
  SignIns | StoredPasswords | Passkeys | PasswordHasher | SetupCodes | WebAuthn
> =>
  Layer.mergeAll(
    SignInOwner.layer,
    SetUpHub.layer,
    ChangeOwnerPassword.layer.pipe(Layer.provide(RevokeOtherSignIns.layer)),
    RevokeSignIn.layer,
    RevokeOtherSignIns.layer,
    IdentifyOwner.layer,
    ListSignIns.layer,
    ReadWaysIn.layer,
    ReadOwnerPassword.layer,
    ForgetOwnerPassword.layer,
    PreparePasskey.layer,
    MakePasskey.layer,
    ListPasskeys.layer,
    RemovePasskey.layer,
    PreparePasskeySignIn.layer,
    SignInWithPasskey.layer,
    setupCodeMadeAtStart.pipe(Layer.provide(MakeSetupCode.layer)),
  ).pipe(
    Layer.provide([
      Sha256ConfiguredPassword.layer(options.password),
      RandomSignInTokens.layer,
      Attempts.layer,
      Challenges.layer,
      SetupCode.layer,
    ]),
  );

/**
 * The sign-in module's commands and queries, over the hub store, hashing with
 * argon2id, making setup codes at random, and passkeys with
 * `@simplewebauthn/server`.
 */
export const layer = (options: Options) =>
  overPorts(options).pipe(
    Layer.provide([
      SqliteSignIns.layer,
      SqliteStoredPasswords.layer,
      SqlitePasskeys.layer,
      Argon2idPasswordHasher.layer,
      RandomSetupCodes.layer,
      SimpleWebAuthn.layer,
    ]),
  );

/** The handlers of the `sign-in` group. */
export const api = HttpApiBuilder.group(Api, "sign-in", SignInHandlers.build);

/** Who is asking, for every group that declares `CallerMiddleware`. */
export const callers = CallerMiddleware.layer;
