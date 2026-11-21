import { Effect, Layer } from "effect";
import { Processes } from "#02-application/interfaces/processes.ts";
import type { Variables } from "#03-domain/system.ts";

/** A client started, as the stand-in for starting it saw it. */
export interface Started {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly variables: Variables;
}

/** Programs that are never run: each start is remembered and exits with the status given, and `git` says nothing. */
export const make = (
  status = 0,
): {
  readonly started: Array<Started>;
  readonly layer: Layer.Layer<Processes>;
} => {
  const started: Array<Started> = [];
  const layer = Layer.succeed(
    Processes,
    Processes.of({
      start: (command, args, variables) =>
        Effect.sync(() => {
          started.push({ command, args, variables });
          return status;
        }),
      output: () => Effect.succeedNone,
    }),
  );
  return { started, layer };
};
