import { Context, Effect, Layer } from "effect";
import { DisplayNamesRepository } from "#modules/display-names/02-application/interfaces/display-names.repository.ts";
import * as DisplayName from "#modules/display-names/03-domain/display-name.ts";
import type { HubStoreUnavailable } from "#shared/03-domain/hub-store.ts";

export class RemoveDisplayName extends Context.Service<
  RemoveDisplayName,
  {
    /** Removes the owner's name for the kind and key, so that its built-in name, if any, shows again. */
    readonly execute: (
      kind: DisplayName.Kind,
      key: string,
    ) => Effect.Effect<
      void,
      DisplayName.NoSuchDisplayName | HubStoreUnavailable
    >;
  }
>()("@cota/hub/display-names/RemoveDisplayName") {}

export const layer: Layer.Layer<
  RemoveDisplayName,
  never,
  DisplayNamesRepository
> = Layer.effect(
  RemoveDisplayName,
  Effect.gen(function* () {
    const repository = yield* DisplayNamesRepository;
    return RemoveDisplayName.of({
      execute: Effect.fn("RemoveDisplayName.execute")(function* (
        kind: DisplayName.Kind,
        key: string,
      ) {
        if (!(yield* repository.remove(kind, key))) {
          return yield* new DisplayName.NoSuchDisplayName({ kind, key });
        }
      }),
    });
  }),
);
