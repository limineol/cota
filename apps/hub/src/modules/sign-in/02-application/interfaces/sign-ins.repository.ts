import { Context, type DateTime, type Effect, type Option } from "effect";
import type {
  NewSignIn,
  SignIn,
  TokenDigest,
} from "#modules/sign-in/03-domain/sign-in.entity.ts";
import type { HubStoreUnavailable } from "#shared/03-domain/hub-store.ts";
import type { SignInId } from "#shared/03-domain/ids.ts";

/** The owner's sign-ins, as the hub keeps them: by the digest of their token, never the token. */
export class SignIns extends Context.Service<
  SignIns,
  {
    /** Keeps a new sign-in under a new id, a UUID version 7. */
    readonly add: (
      signIn: NewSignIn,
    ) => Effect.Effect<SignIn, HubStoreUnavailable>;
    readonly findByDigest: (
      digest: TokenDigest,
    ) => Effect.Effect<Option.Option<SignIn>, HubStoreUnavailable>;
    /** Every sign-in kept, live or ended. */
    readonly all: Effect.Effect<ReadonlyArray<SignIn>, HubStoreUnavailable>;
    readonly touch: (
      id: SignInId,
      at: DateTime.Utc,
    ) => Effect.Effect<void, HubStoreUnavailable>;
    /** Revokes, at the given time, each of the sign-ins named that is not revoked yet, and no other. */
    readonly revoke: (
      ids: ReadonlyArray<SignInId>,
      at: DateTime.Utc,
    ) => Effect.Effect<void, HubStoreUnavailable>;
    /** Deletes the sign-ins revoked, or expired, before the given time. */
    readonly forget: (
      endedBefore: DateTime.Utc,
    ) => Effect.Effect<void, HubStoreUnavailable>;
  }
>()("@cota/hub/sign-in/SignIns") {}
