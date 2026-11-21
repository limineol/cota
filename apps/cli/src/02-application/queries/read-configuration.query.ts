import { Context, Effect, Layer, Option, Result } from "effect";
import { Files, type FilesFailed } from "#02-application/interfaces/files.ts";
import * as Configuration from "#03-domain/configuration.ts";
import type * as Paths from "#03-domain/paths.ts";

export class ReadConfiguration extends Context.Service<
  ReadConfiguration,
  {
    /** Reads and decodes `config.toml`, once. */
    readonly execute: (
      paths: Paths.Paths,
    ) => Effect.Effect<
      Configuration.Configuration,
      Configuration.NotJoined | Configuration.ConfigurationInvalid | FilesFailed
    >;
  }
>()("@cota/cli/ReadConfiguration") {}

const parseToml = (text: string): Result.Result<unknown, string> => {
  try {
    return Result.succeed(Bun.TOML.parse(text));
  } catch (cause) {
    return Result.fail(cause instanceof Error ? cause.message : String(cause));
  }
};

export const layer: Layer.Layer<ReadConfiguration, never, Files> = Layer.effect(
  ReadConfiguration,
  Effect.gen(function* () {
    const files = yield* Files;
    return ReadConfiguration.of({
      execute: Effect.fn("ReadConfiguration.execute")(function* (
        paths: Paths.Paths,
      ) {
        const file = paths.configurationFile;
        const text = yield* files.read(file);
        if (Option.isNone(text)) {
          return yield* new Configuration.NotJoined({ file });
        }
        const decoded = Result.flatMap(
          parseToml(text.value),
          Configuration.decode,
        );
        if (Result.isFailure(decoded)) {
          return yield* new Configuration.ConfigurationInvalid({
            file,
            problems: decoded.failure,
          });
        }
        return decoded.success;
      }),
    });
  }),
);
