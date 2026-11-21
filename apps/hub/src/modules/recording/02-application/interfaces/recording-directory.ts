import { Context, type Effect, Schema } from "effect";

export class ExchangeFileNotWritten extends Schema.TaggedError<
  ExchangeFileNotWritten,
  { readonly brand: unique symbol }
>()("ExchangeFileNotWritten", { detail: Schema.String }) {}

/** Where the recorder writes exchange files. */
export class RecordingDirectory extends Context.Service<
  RecordingDirectory,
  {
    readonly path: string;
    /** Writes an exchange file under its name, so that a file under its name is always whole. */
    readonly write: (
      name: string,
      text: string,
    ) => Effect.Effect<void, ExchangeFileNotWritten>;
  }
>()("@cota/hub/recording/RecordingDirectory") {}
