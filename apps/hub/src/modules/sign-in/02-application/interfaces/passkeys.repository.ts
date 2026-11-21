import { Context, type DateTime, type Effect, type Option } from "effect";
import type {
  CredentialId,
  NewPasskey,
  Passkey,
} from "#modules/sign-in/03-domain/passkey.ts";
import type { HubStoreUnavailable } from "#shared/03-domain/hub-store.ts";
import type { PasskeyId } from "#shared/03-domain/ids.ts";

/** What removing a passkey did. */
export type Removal = "Removed" | "NoSuchPasskey" | "LastWayIn";

/** The owner's passkeys, as the hub keeps them: their public keys, never a private one. */
export class Passkeys extends Context.Service<
  Passkeys,
  {
    /** Keeps a new passkey under a new id, a UUID version 7; none when its credential id is kept already. */
    readonly add: (
      passkey: NewPasskey,
    ) => Effect.Effect<Option.Option<Passkey>, HubStoreUnavailable>;
    readonly all: Effect.Effect<ReadonlyArray<Passkey>, HubStoreUnavailable>;
    readonly any: Effect.Effect<boolean, HubStoreUnavailable>;
    readonly findByCredentialId: (
      credentialId: CredentialId,
    ) => Effect.Effect<Option.Option<Passkey>, HubStoreUnavailable>;
    /**
     * Notes that a passkey signed in at the given time with the given
     * counter, and gives whether it is still kept.
     */
    readonly signedIn: (
      id: PasskeyId,
      counter: number,
      at: DateTime.Utc,
    ) => Effect.Effect<boolean, HubStoreUnavailable>;
    /**
     * Removes a passkey unless it is the last way in: no other passkey, no
     * stored password, and, as `passwordConfigured` says, none in the
     * configuration. The check and the removal are one call, so of a removal
     * and a forgetting of the password sent together, both cannot pass (I17).
     */
    readonly remove: (
      id: PasskeyId,
      passwordConfigured: boolean,
    ) => Effect.Effect<Removal, HubStoreUnavailable>;
  }
>()("@cota/hub/sign-in/Passkeys") {}
