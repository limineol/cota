import { Context, type Effect, type Option, Schema } from "effect";
import type { FilesFailed } from "./files.ts";

/** A source's file: its path, its size in bytes, and when it last changed, in milliseconds since the epoch. */
export interface SourceFile {
  readonly path: string;
  readonly size: number;
  readonly changedAt: number;
}

/** A source that exists but could not be read; the reason never holds what it holds. */
export class SourceUnreadable extends Schema.TaggedError<
  SourceUnreadable,
  { readonly brand: unique symbol }
>()("SourceUnreadable", { source: Schema.String, reason: Schema.String }) {}

/** The files and the database the clients write their sessions' titles to, read and never written. */
export class TitleSources extends Context.Service<
  TitleSources,
  {
    /** The `*.jsonl` files in each directory of a directory (Claude Code's projects), none when it does not exist. */
    readonly transcripts: (
      projects: string,
    ) => Effect.Effect<ReadonlyArray<SourceFile>, FilesFailed>;
    /** A file, or none when it does not exist. */
    readonly file: (
      path: string,
    ) => Effect.Effect<Option.Option<SourceFile>, FilesFailed>;
    /** A file's bytes from an offset to its end, or none when it does not exist. */
    readonly bytesFrom: (
      path: string,
      offset: number,
    ) => Effect.Effect<Option.Option<Uint8Array>, FilesFailed>;
    /**
     * T3 Code's thread titles, each for the session of a client thread behind
     * it, from its database opened read only; none when it does not exist.
     */
    readonly threadTitles: (
      database: string,
    ) => Effect.Effect<
      Option.Option<ReadonlyArray<readonly [string, string]>>,
      SourceUnreadable
    >;
  }
>()("@cota/cli/TitleSources") {}
