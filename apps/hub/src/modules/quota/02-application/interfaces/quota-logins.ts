import { Context, type Effect, type Option } from "effect";
import type {
  QuotaLogin,
  Replacement,
} from "#modules/quota/03-domain/quota-login.ts";
import type { HubStoreUnavailable } from "#shared/03-domain/hub-store.ts";
import type { PoolId } from "#shared/03-domain/ids.ts";

/** The quota logins the owner gave, at most one per pool. */
export class QuotaLogins extends Context.Service<
  QuotaLogins,
  {
    readonly all: Effect.Effect<ReadonlyArray<QuotaLogin>, HubStoreUnavailable>;
    readonly find: (
      pool: PoolId,
    ) => Effect.Effect<Option.Option<QuotaLogin>, HubStoreUnavailable>;
    /** Keeps a login given for its pool, replacing the one the pool had. */
    readonly give: (
      login: QuotaLogin,
    ) => Effect.Effect<void, HubStoreUnavailable>;
    /**
     * Replaces the tokens, end, refresh and expiry of the pool's login with
     * the replacement's, in one statement, when the row is the one it is
     * written over (`isReplacedBy`). Says whether it did.
     */
    readonly update: (
      replacement: Replacement,
    ) => Effect.Effect<boolean, HubStoreUnavailable>;
    /** Forgets the pool's login, and says whether it had one. */
    readonly forget: (
      pool: PoolId,
    ) => Effect.Effect<boolean, HubStoreUnavailable>;
  }
>()("@cota/hub/quota/QuotaLogins") {}
