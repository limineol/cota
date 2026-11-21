import { Context, type Effect } from "effect";
import type { PasswordHash } from "#modules/sign-in/03-domain/owner-password.ts";

/** How an owner password set in the browser is made into what the hub store keeps, and checked against it. */
export class PasswordHasher extends Context.Service<
  PasswordHasher,
  {
    /** A new hash of the password, with a salt of its own. */
    readonly hash: (password: string) => Effect.Effect<PasswordHash>;
    /** Whether a password given is the one the hash was made of. */
    readonly verify: (
      password: string,
      hash: PasswordHash,
    ) => Effect.Effect<boolean>;
  }
>()("@cota/hub/sign-in/PasswordHasher") {}
