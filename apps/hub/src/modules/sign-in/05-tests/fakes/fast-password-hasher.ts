import { Effect, Layer } from "effect";
import { PasswordHasher } from "#modules/sign-in/02-application/interfaces/password-hasher.ts";
import { PasswordHash } from "#modules/sign-in/03-domain/owner-password.ts";

/** What every hash of the stand-in starts with. */
export const prefix = "$sha256-stand-in$";

/** The stand-in's hash of a password, as the laws expect to find it in the store. */
export const hashOf = (password: string): PasswordHash =>
  PasswordHash.make(
    `${prefix}${new Bun.CryptoHasher("sha256").update(password).digest("hex")}`,
  );

/** How many times the stand-in lets other fibers run while it compares, and while it hashes. */
const turns = { verify: 3, hash: 1 };

/**
 * A stand-in for argon2id in the laws: a SHA-256 of the password, which never
 * holds it in the clear, made in no time. Like argon2id it lets other fibers
 * run while it hashes and compares, comparing for longer than it hashes, so
 * attempts sent together interleave, and a sign-in begun while a change is
 * made is compared after the change is done.
 */
export const layer: Layer.Layer<PasswordHasher> = Layer.succeed(
  PasswordHasher,
  PasswordHasher.of({
    hash: (password) =>
      Effect.gen(function* () {
        for (let turn = 0; turn < turns.hash; turn++) yield* Effect.yieldNow;
        return hashOf(password);
      }),
    verify: (password, hash) =>
      Effect.gen(function* () {
        for (let turn = 0; turn < turns.verify; turn++) yield* Effect.yieldNow;
        return hashOf(password) === hash;
      }),
  }),
);
