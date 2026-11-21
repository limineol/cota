import { Context, type Effect, type Option } from "effect";
import type {
  PasswordHash,
  StoredPassword,
} from "#modules/sign-in/03-domain/owner-password.ts";
import type { HubStoreUnavailable } from "#shared/03-domain/hub-store.ts";

/** The owner password set in the browser, as the hub keeps it: one at most, and only as a hash. */
export class StoredPasswords extends Context.Service<
  StoredPasswords,
  {
    readonly read: Effect.Effect<
      Option.Option<StoredPassword>,
      HubStoreUnavailable
    >;
    /**
     * Keeps the first stored password, and gives whether it did: when one is
     * kept already, the store refuses the write and keeps that one (I11).
     */
    readonly keepFirst: (
      stored: StoredPassword,
    ) => Effect.Effect<boolean, HubStoreUnavailable>;
    /**
     * Replaces the kept password with the given one while its hash is still
     * `compared`, and gives whether it did: of changes compared with one
     * hash, the first replaces it and the others find it gone (I13).
     */
    readonly replace: (
      compared: PasswordHash,
      stored: StoredPassword,
    ) => Effect.Effect<boolean, HubStoreUnavailable>;
    /**
     * Forgets the kept password unless it is the last way in: no passkey and,
     * as `passwordConfigured` says, no password in the configuration. The
     * check and the forgetting are one call, so of a forgetting and a removal
     * of a passkey sent together, both cannot pass (I17).
     */
    readonly forget: (
      passwordConfigured: boolean,
    ) => Effect.Effect<"Forgotten" | "LastWayIn", HubStoreUnavailable>;
  }
>()("@cota/hub/sign-in/StoredPasswords") {}
