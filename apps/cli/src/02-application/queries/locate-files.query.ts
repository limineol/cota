import { Context, Effect, Layer } from "effect";
import { Environment } from "#02-application/interfaces/environment.ts";
import * as Paths from "#03-domain/paths.ts";

export class LocateFiles extends Context.Service<
  LocateFiles,
  {
    /** Where the machine's files are, from the system and its environment. */
    readonly execute: Effect.Effect<Paths.Paths, Paths.DirectoryUnknown>;
  }
>()("@cota/cli/LocateFiles") {}

export const layer: Layer.Layer<LocateFiles, never, Environment> = Layer.effect(
  LocateFiles,
  Effect.gen(function* () {
    const { system, variables } = yield* Environment;
    return LocateFiles.of({
      execute: Effect.fromResult(Paths.pathsOf(system, variables)),
    });
  }),
);
