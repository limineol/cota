import { Effect, Layer } from "effect";
import { DisplayNamesRepository } from "#modules/display-names/02-application/interfaces/display-names.repository.ts";
import type { OwnerName } from "#modules/display-names/03-domain/display-name.ts";

/** `DisplayNamesRepository` in memory, as the SQLite repository keeps names. */
export const layer: Layer.Layer<DisplayNamesRepository> = Layer.effect(
  DisplayNamesRepository,
  Effect.sync(() => {
    const kept = new Map<string, OwnerName>();
    const idOf = (kind: string, key: string) => JSON.stringify([kind, key]);
    return DisplayNamesRepository.of({
      all: Effect.sync(() => [...kept.values()]),
      set: (name) =>
        Effect.sync(() => {
          kept.set(idOf(name.kind, name.key), name);
        }),
      remove: (kind, key) => Effect.sync(() => kept.delete(idOf(kind, key))),
    });
  }),
);
