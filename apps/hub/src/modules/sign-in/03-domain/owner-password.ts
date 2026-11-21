import { type DateTime, Effect, Option, Schema } from "effect";

/** A one-way hash of an owner password, as the password hasher writes it: all the hub store keeps of it. */
export const PasswordHash = Schema.NonEmptyString.pipe(
  Schema.brand("PasswordHash"),
);
export type PasswordHash = typeof PasswordHash.Type;

/** The owner password set in the browser, as the hub store keeps it. */
export interface StoredPassword {
  readonly hash: PasswordHash;
  readonly setAt: DateTime.Utc;
}

/** Where the owner password is kept; `None` is a hub with no password, which is set up only when it has a passkey. */
export type Kept =
  | { readonly _tag: "Configuration" }
  | { readonly _tag: "HubStore"; readonly stored: StoredPassword }
  | { readonly _tag: "None" };

/**
 * Where the owner password is kept: the configuration's wins, and the hub
 * store's is read only when the configuration holds none (I12).
 */
export const keptBy = <E>(
  configured: boolean,
  stored: Effect.Effect<Option.Option<StoredPassword>, E>,
): Effect.Effect<Kept, E> =>
  Effect.gen(function* () {
    if (configured) return { _tag: "Configuration" } as const;
    const found = yield* stored;
    if (Option.isNone(found)) return { _tag: "None" } as const;
    return { _tag: "HubStore", stored: found.value } as const;
  });

export class NotSetUp extends Schema.TaggedError<
  NotSetUp,
  { readonly brand: unique symbol }
>()("NotSetUp", {}) {}

/** The answer to a password sign-in on a hub whose owner turned the password off and signs in with a passkey. */
export class PasswordOff extends Schema.TaggedError<
  PasswordOff,
  { readonly brand: unique symbol }
>()("PasswordOff", {}) {}

export class PasswordInConfiguration extends Schema.TaggedError<
  PasswordInConfiguration,
  { readonly brand: unique symbol }
>()("PasswordInConfiguration", {}) {}
