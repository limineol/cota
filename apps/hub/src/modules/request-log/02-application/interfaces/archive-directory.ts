import { Context, type Effect, type Option, Schema, type Stream } from "effect";
import type * as Archive from "#modules/request-log/03-domain/archive.ts";

/** The archive directory could not be read or written: `detail` says what the file system answered. */
export class ArchiveDirectoryFailed extends Schema.TaggedError<
  ArchiveDirectoryFailed,
  { readonly brand: unique symbol }
>()("ArchiveDirectoryFailed", { detail: Schema.String }) {
  override get message(): string {
    return this.detail;
  }
}

/**
 * The archive directory: one directory per day, holding its table files and
 * its manifest (`docs/specs/archive/spec.md`, The archive directory). Nothing
 * in it but `.partial` files and the files of a replaced archive is ever
 * removed, and only a day's directory is read or written.
 */
export class ArchiveDirectory extends Context.Service<
  ArchiveDirectory,
  {
    /** The manifest of every day whose directory holds one, read or found unreadable. */
    readonly manifests: Effect.Effect<
      ReadonlyMap<Archive.Day, Archive.Reading>,
      ArchiveDirectoryFailed
    >;
    /**
     * Writes a table's file of a day from `bytes`, as they arrive, to its
     * `.partial` name, making the day's directory if it is missing, and gives
     * its size and SHA-256; bytes that never come leave no file.
     */
    readonly write: <E>(
      day: Archive.Day,
      table: Archive.Table,
      bytes: Stream.Stream<Uint8Array, E>,
    ) => Effect.Effect<
      Option.Option<Archive.Written>,
      ArchiveDirectoryFailed | E
    >;
    /** A file of a day's directory, by its name, as a stream. */
    readonly read: (
      day: Archive.Day,
      name: string,
    ) => Stream.Stream<Uint8Array, ArchiveDirectoryFailed>;
    /** A file of a day's directory, by its name: its size and SHA-256, or none when it is missing. */
    readonly measure: (
      day: Archive.Day,
      name: string,
    ) => Effect.Effect<Option.Option<Archive.Written>, ArchiveDirectoryFailed>;
    /**
     * Archives a day whose files were written and verified: renames each
     * `.partial` file the manifest names to its final name, writes the
     * manifest under its `.partial` name and renames it into place, each
     * flushed to the disk before its rename, then removes the files of the
     * manifest it replaced that it does not name.
     */
    readonly commit: (
      manifest: Archive.Manifest,
      replacing: Option.Option<Archive.Manifest>,
    ) => Effect.Effect<void, ArchiveDirectoryFailed>;
    /** Removes the regular `.partial` files of a day. */
    readonly discard: (
      day: Archive.Day,
    ) => Effect.Effect<void, ArchiveDirectoryFailed>;
    /** Removes the regular `.partial` files of every day, and nothing else. */
    readonly sweep: Effect.Effect<void, ArchiveDirectoryFailed>;
  }
>()("@cota/hub/request-log/ArchiveDirectory") {}
