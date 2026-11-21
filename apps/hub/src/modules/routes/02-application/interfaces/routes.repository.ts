import { Context, type DateTime, type Effect, type Option } from "effect";
import type {
  Route,
  RoutedClient,
  RouteList,
} from "#modules/routes/03-domain/route-list.ts";
import type { HubStoreUnavailable } from "#shared/03-domain/hub-store.ts";
import type { PoolId } from "#shared/03-domain/ids.ts";

/** A client's whole list as one change stores it, and the revision it was made from. */
export interface Change {
  readonly client: RoutedClient;
  readonly from: number;
  readonly routes: ReadonlyArray<Route>;
  readonly defaultPool: Option.Option<PoolId>;
}

/** The routed clients' lists, each replaced whole. */
export class RoutesRepository extends Context.Service<
  RoutesRepository,
  {
    /** Every list ever stored. */
    readonly stored: Effect.Effect<
      ReadonlyArray<RouteList>,
      HubStoreUnavailable
    >;
    /**
     * Replaces the client's list and makes its revision one more, only when
     * its stored revision is the change's (0 for a list never stored), and
     * says whether it did (N10).
     */
    readonly replace: (
      change: Change,
      at: DateTime.Utc,
    ) => Effect.Effect<boolean, HubStoreUnavailable>;
  }
>()("@cota/hub/routes/RoutesRepository") {}
