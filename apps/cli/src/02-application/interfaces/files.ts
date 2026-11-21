import { Context, type Effect, type Option, Schema } from "effect";

/** A file or directory of the machine's that could not be read or written; the reason never holds what the file holds. */
export class FilesFailed extends Schema.TaggedError<
  FilesFailed,
  { readonly brand: unique symbol }
>()("FilesFailed", { path: Schema.String, reason: Schema.String }) {}

/** The machine's file system, by absolute paths. */
export class Files extends Context.Service<
  Files,
  {
    /** A file's text, or none when it does not exist. */
    readonly read: (
      path: string,
    ) => Effect.Effect<Option.Option<string>, FilesFailed>;
    /** Writes a file whole and atomically, a file beside it renamed over it, with the mode given where the system has modes. Its directory must exist. */
    readonly write: (
      path: string,
      text: string,
      mode: number,
    ) => Effect.Effect<void, FilesFailed>;
    /** Makes a directory and those above it that are missing, and gives it the mode given where the system has modes. */
    readonly makeDirectory: (
      path: string,
      mode: number,
    ) => Effect.Effect<void, FilesFailed>;
    /** The names in a directory, none when it does not exist. */
    readonly list: (
      path: string,
    ) => Effect.Effect<ReadonlyArray<string>, FilesFailed>;
    /** Removes a file, or a directory and all it holds, and says whether there was one. */
    readonly remove: (path: string) => Effect.Effect<boolean, FilesFailed>;
    /** Whether a path is a file this user may run. */
    readonly executable: (path: string) => Effect.Effect<boolean>;
    /** Whether a path is a symbolic link, whatever it points to. */
    readonly isLink: (path: string) => Effect.Effect<boolean>;
    /** The first bytes of a file, as text, or none when it does not exist or is not a file. */
    readonly head: (
      path: string,
      bytes: number,
    ) => Effect.Effect<Option.Option<string>, FilesFailed>;
    /** A file's or directory's permission bits, or none when it does not exist. */
    readonly modeOf: (
      path: string,
    ) => Effect.Effect<Option.Option<number>, FilesFailed>;
  }
>()("@cota/cli/Files") {}
