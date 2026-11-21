import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Layer, Schema } from "effect";
import {
  ExchangeFileNotWritten,
  RecordingDirectory,
} from "#modules/recording/02-application/interfaces/recording-directory.ts";

export class RecorderUnavailable extends Schema.TaggedError<
  RecorderUnavailable,
  { readonly brand: unique symbol }
>()("RecorderUnavailable", { directory: Schema.String }) {
  override get message(): string {
    return `The recording directory ${this.directory} cannot be made. COTA_RECORD_TO names a directory the hub can write to.`;
  }
}

/** A directory on disk, made if it is missing, where each file is written to a hidden partial file and renamed. */
export const layer = (
  directory: string,
): Layer.Layer<RecordingDirectory, RecorderUnavailable> =>
  Layer.effect(
    RecordingDirectory,
    Effect.gen(function* () {
      yield* Effect.tryPromise({
        try: () => mkdir(directory, { recursive: true }),
        catch: () => new RecorderUnavailable({ directory }),
      });
      return RecordingDirectory.of({
        path: directory,
        write: (name, text) =>
          Effect.tryPromise({
            try: async () => {
              const partial = join(directory, `.${name}.partial`);
              try {
                await writeFile(partial, text, { flag: "wx" });
                await rename(partial, join(directory, name));
              } finally {
                await rm(partial, { force: true });
              }
            },
            catch: (cause) =>
              new ExchangeFileNotWritten({
                detail: cause instanceof Error ? cause.message : "unknown",
              }),
          }),
      });
    }),
  );
