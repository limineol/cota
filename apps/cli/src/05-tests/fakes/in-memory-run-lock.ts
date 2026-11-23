import { Effect, Layer } from "effect";
import { RunLock } from "#02-application/interfaces/run-lock.ts";

/** A run lock in memory: the paths held, by this run or, when given, another live one. */
export const make = (
  heldByOthers: ReadonlyArray<string> = [],
): { readonly held: Set<string>; readonly layer: Layer.Layer<RunLock> } => {
  const held = new Set(heldByOthers);
  const layer = Layer.succeed(
    RunLock,
    RunLock.of({
      take: (path) =>
        Effect.sync(() => {
          if (held.has(path)) return false;
          held.add(path);
          return true;
        }),
      release: (path) => Effect.sync(() => void held.delete(path)),
    }),
  );
  return { held, layer };
};
