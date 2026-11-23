import { Context, type DateTime, type Effect } from "effect";
import type { ReportedClient } from "#shared/03-domain/client.ts";
import type { HubStoreUnavailable } from "#shared/03-domain/hub-store.ts";
import type { PoolId } from "#shared/03-domain/ids.ts";

/** How far a machine has reported a client's calls to a pool (`docs/specs/reported-requests/spec.md`, Reported through). */
export interface Through {
  readonly machine: string;
  readonly client: ReportedClient;
  readonly pool: PoolId;
  readonly through: DateTime.Utc;
  readonly reportedAt: DateTime.Utc;
  /** The name of the hub key that reported it, or `owner`. */
  readonly reportedBy: string;
}

export class ReportedThrough extends Context.Service<
  ReportedThrough,
  {
    /**
     * Keeps a report's `through` for its machine, client and pool: the row's
     * `through` becomes the later of the two, its `reportedAt` and
     * `reportedBy` the report's.
     */
    readonly keep: (
      through: Through,
    ) => Effect.Effect<void, HubStoreUnavailable>;
    readonly all: Effect.Effect<ReadonlyArray<Through>, HubStoreUnavailable>;
  }
>()("@cota/hub/request-log/ReportedThrough") {}
