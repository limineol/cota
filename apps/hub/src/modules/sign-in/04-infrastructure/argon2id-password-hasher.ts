import { Effect, Layer } from "effect";
import { PasswordHasher } from "#modules/sign-in/02-application/interfaces/password-hasher.ts";
import { PasswordHash } from "#modules/sign-in/03-domain/owner-password.ts";

/** The argon2id parameters a stored password is hashed with: 64 MiB of memory and 2 passes, in 1 lane (Bun's). */
const parameters = {
  algorithm: "argon2id",
  memoryCost: 65_536,
  timeCost: 2,
} as const;

/** Owner passwords hashed with argon2id by `Bun.password`, which hashes and verifies off the main thread. */
export const layer: Layer.Layer<PasswordHasher> = Layer.succeed(
  PasswordHasher,
  PasswordHasher.of({
    hash: (password) =>
      Effect.gen(function* () {
        return PasswordHash.make(
          yield* Effect.promise(() => Bun.password.hash(password, parameters)),
        );
      }),
    verify: (password, hash) =>
      Effect.promise(() => Bun.password.verify(password, hash, "argon2id")),
  }),
);
