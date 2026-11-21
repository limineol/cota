import { Context, type DateTime, type Effect } from "effect";
import type {
  Kind,
  OwnerName,
} from "#modules/display-names/03-domain/display-name.ts";
import type { HubStoreUnavailable } from "#shared/03-domain/hub-store.ts";

/** The owner's display names, one per kind and key. */
export class DisplayNamesRepository extends Context.Service<
  DisplayNamesRepository,
  {
    readonly all: Effect.Effect<ReadonlyArray<OwnerName>, HubStoreUnavailable>;
    /** Keeps the owner's name for its kind and key, replacing the one it had. */
    readonly set: (
      name: OwnerName,
      at: DateTime.Utc,
    ) => Effect.Effect<void, HubStoreUnavailable>;
    /** Removes the owner's name for the kind and key, and says whether there was one. */
    readonly remove: (
      kind: Kind,
      key: string,
    ) => Effect.Effect<boolean, HubStoreUnavailable>;
  }
>()("@cota/hub/display-names/DisplayNamesRepository") {}
