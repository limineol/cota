import { Config, Effect, Layer, Option } from "effect";
import * as RecordExchange from "#modules/recording/02-application/commands/record-exchange.command.ts";
import * as FileSystemRecordingDirectory from "#modules/recording/04-infrastructure/file-system-recording-directory.ts";

export interface Options extends RecordExchange.Options {
  readonly directory: string;
}

/** The recorder, writing into `directory` on disk. */
export const layer = (
  options: Options,
): Layer.Layer<
  RecordExchange.RecordExchange,
  FileSystemRecordingDirectory.RecorderUnavailable
> =>
  RecordExchange.layer(options).pipe(
    Layer.provide(FileSystemRecordingDirectory.layer(options.directory)),
  );

/** The recording directory the hub is started with, from `COTA_RECORD_TO`; none leaves the recorder off. */
const directoryOf = Config.option(Config.String("COTA_RECORD_TO")).pipe(
  Config.map((directory) =>
    Option.filter(
      Option.map(directory, (each) => each.trim()),
      (each) => each !== "",
    ),
  ),
);

/** The recorder `COTA_RECORD_TO` asks for, or none. */
export const fromEnvironment: Layer.Layer<
  RecordExchange.RecordExchange,
  FileSystemRecordingDirectory.RecorderUnavailable | Config.ConfigError
> = Layer.unwrap(
  Effect.gen(function* () {
    const directory = yield* directoryOf;
    return Option.match(directory, {
      onNone: () => RecordExchange.off,
      onSome: (each) => layer({ directory: each, ...RecordExchange.defaults }),
    });
  }),
);
