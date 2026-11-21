import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { PasswordHasher } from "#modules/sign-in/02-application/interfaces/password-hasher.ts";
import * as Argon2idPasswordHasher from "./argon2id-password-hasher.ts";

const password = "a password chosen in the browser 5d1c";

describe("the argon2id password hasher", () => {
  it.effect(
    "hashes with argon2id, 64 MiB of memory, 2 passes and 1 lane, and a salt of each hash's own",
    () =>
      Effect.gen(function* () {
        const hasher = yield* PasswordHasher;
        const one = yield* hasher.hash(password);
        const other = yield* hasher.hash(password);
        expect([
          one.startsWith("$argon2id$v=19$m=65536,t=2,p=1$"),
          one.includes(password),
          one === other,
        ]).toEqual([true, false, false]);
      }).pipe(Effect.provide(Argon2idPasswordHasher.layer)),
  );

  it.effect("a hash verifies its password and no other", () =>
    Effect.gen(function* () {
      const hasher = yield* PasswordHasher;
      const hash = yield* hasher.hash(password);
      expect([
        yield* hasher.verify(password, hash),
        yield* hasher.verify(`${password} `, hash),
        yield* hasher.verify(password.toUpperCase(), hash),
        yield* hasher.verify("", hash),
      ]).toEqual([true, false, false, false]);
    }).pipe(Effect.provide(Argon2idPasswordHasher.layer)),
  );
});
