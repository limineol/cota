import { Context, DateTime, Effect, Layer, Option } from "effect";
import { Passkeys } from "#modules/sign-in/02-application/interfaces/passkeys.repository.ts";
import { StoredPasswords } from "#modules/sign-in/02-application/interfaces/stored-passwords.repository.ts";
import type { StoredPassword } from "#modules/sign-in/03-domain/owner-password.ts";
import type { Passkey } from "#modules/sign-in/03-domain/passkey.ts";
import { PasskeyId } from "#shared/03-domain/ids.ts";

/**
 * The owner's ways in, in memory: the stored password, one at most as the
 * SQLite table's constraint keeps it, from the one given if any, and the
 * passkeys, one per credential id.
 */
export const layer = (
  before: Option.Option<StoredPassword> = Option.none(),
): Layer.Layer<StoredPasswords | Passkeys> =>
  Layer.effectContext(
    Effect.sync(() => {
      let kept = before;
      const passkeys = new Map<PasskeyId, Passkey>();
      const stored = StoredPasswords.of({
        read: Effect.sync(() => kept),
        keepFirst: (password) =>
          Effect.sync(() => {
            if (Option.isSome(kept)) return false;
            kept = Option.some(password);
            return true;
          }),
        replace: (compared, password) =>
          Effect.sync(() => {
            if (!Option.exists(kept, ({ hash }) => hash === compared)) {
              return false;
            }
            kept = Option.some(password);
            return true;
          }),
        forget: (passwordConfigured) =>
          Effect.sync(() => {
            if (
              !passwordConfigured &&
              passkeys.size === 0 &&
              Option.isSome(kept)
            ) {
              return "LastWayIn" as const;
            }
            kept = Option.none();
            return "Forgotten" as const;
          }),
      });
      const keys = Passkeys.of({
        add: (passkey) =>
          Effect.sync(() => {
            const taken = [...passkeys.values()].some(
              ({ credentialId }) => credentialId === passkey.credentialId,
            );
            if (taken) return Option.none();
            const id = PasskeyId.make(
              Bun.randomUUIDv7(
                "hex",
                DateTime.toEpochMillis(passkey.createdAt),
              ),
            );
            const added = { ...passkey, id };
            passkeys.set(id, added);
            return Option.some(added);
          }),
        all: Effect.sync(() => [...passkeys.values()]),
        any: Effect.sync(() => passkeys.size > 0),
        findByCredentialId: (credentialId) =>
          Effect.sync(() =>
            Option.fromUndefinedOr(
              [...passkeys.values()].find(
                (each) => each.credentialId === credentialId,
              ),
            ),
          ),
        signedIn: (id, counter, at) =>
          Effect.sync(() => {
            const passkey = passkeys.get(id);
            if (passkey === undefined) return false;
            passkeys.set(id, {
              ...passkey,
              counter: Math.max(passkey.counter, counter),
              lastUsedAt: Option.some(at),
            });
            return true;
          }),
        remove: (id, passwordConfigured) =>
          Effect.sync(() => {
            if (!passkeys.has(id)) return "NoSuchPasskey" as const;
            if (
              !passwordConfigured &&
              Option.isNone(kept) &&
              passkeys.size === 1
            ) {
              return "LastWayIn" as const;
            }
            passkeys.delete(id);
            return "Removed" as const;
          }),
      });
      return Context.make(StoredPasswords, stored).pipe(
        Context.add(Passkeys, keys),
      );
    }),
  );
