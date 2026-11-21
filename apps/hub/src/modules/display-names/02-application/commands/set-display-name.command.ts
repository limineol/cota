import { Context, DateTime, Effect, Layer, Option } from "effect";
import { DisplayNamesRepository } from "#modules/display-names/02-application/interfaces/display-names.repository.ts";
import { BuiltInNames } from "#modules/display-names/03-domain/built-in-names.ts";
import * as DisplayName from "#modules/display-names/03-domain/display-name.ts";
import type { HubStoreUnavailable } from "#shared/03-domain/hub-store.ts";

export class SetDisplayName extends Context.Service<
  SetDisplayName,
  {
    /**
     * Sets the owner's name for its kind and key, each lone surrogate in it
     * made U+FFFD, and gives it; a name that is its key removes the owner's
     * name instead, and gives the built-in name, else the key itself as
     * built-in.
     */
    readonly execute: (
      name: DisplayName.OwnerName,
    ) => Effect.Effect<DisplayName.DisplayName, HubStoreUnavailable>;
  }
>()("@cota/hub/display-names/SetDisplayName") {}

export const layer: Layer.Layer<
  SetDisplayName,
  never,
  DisplayNamesRepository | BuiltInNames
> = Layer.effect(
  SetDisplayName,
  Effect.gen(function* () {
    const repository = yield* DisplayNamesRepository;
    const builtIn = yield* BuiltInNames;
    return SetDisplayName.of({
      execute: Effect.fn("SetDisplayName.execute")(function* (
        given: DisplayName.OwnerName,
      ) {
        const name = { ...given, name: given.name.toWellFormed() };
        if (DisplayName.isItsKey(name)) {
          yield* repository.remove(name.kind, name.key);
          return Option.getOrElse(
            builtIn.of(name.kind, name.key),
            (): DisplayName.DisplayName => ({ ...name, source: "built-in" }),
          );
        }
        yield* repository.set(name, yield* DateTime.now);
        return { ...name, source: "owner" as const };
      }),
    });
  }),
);
