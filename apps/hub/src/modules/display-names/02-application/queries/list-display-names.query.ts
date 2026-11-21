import { Context, Effect, Layer } from "effect";
import { DisplayNamesRepository } from "#modules/display-names/02-application/interfaces/display-names.repository.ts";
import { BuiltInNames } from "#modules/display-names/03-domain/built-in-names.ts";
import * as DisplayName from "#modules/display-names/03-domain/display-name.ts";
import type { HubStoreUnavailable } from "#shared/03-domain/hub-store.ts";

export class ListDisplayNames extends Context.Service<
  ListDisplayNames,
  {
    /** Every owner name, and every built-in name the owner has not replaced, by kind, then key. */
    readonly execute: Effect.Effect<
      ReadonlyArray<DisplayName.DisplayName>,
      HubStoreUnavailable
    >;
  }
>()("@cota/hub/display-names/ListDisplayNames") {}

export const layer: Layer.Layer<
  ListDisplayNames,
  never,
  DisplayNamesRepository | BuiltInNames
> = Layer.effect(
  ListDisplayNames,
  Effect.gen(function* () {
    const repository = yield* DisplayNamesRepository;
    const builtIn = yield* BuiltInNames;
    return ListDisplayNames.of({
      execute: Effect.gen(function* () {
        return DisplayName.listed(yield* repository.all, builtIn.all);
      }).pipe(Effect.withSpan("ListDisplayNames.execute")),
    });
  }),
);
