import { Context, type Effect, Schema, type Stream } from "effect";
import type * as Archive from "#modules/request-log/03-domain/archive.ts";
import type * as Session from "#modules/request-log/03-domain/session.ts";
import type * as StoredItems from "#modules/request-log/03-domain/stored-items.ts";
import type * as Title from "#modules/request-log/03-domain/title.ts";

/** The request log could not answer the archive: `detail` says what failed, never with the hub's connection details. */
export class RequestLogArchiveFailed extends Schema.TaggedError<
  RequestLogArchiveFailed,
  { readonly brand: unique symbol }
>()("RequestLogArchiveFailed", { detail: Schema.String }) {
  override get message(): string {
    return this.detail;
  }
}

/**
 * One session of the request log's store, whose `archive_<table>` tables
 * hold the files loaded into it, are seen by nothing else, and go with it.
 */
export interface ArchiveSession {
  /**
   * A table's rows of a day, as the store writes them compressed: the bytes
   * of its file. No rows give no bytes. It fails when the answer is not
   * whole, so that bytes it gave are never taken for the day's rows.
   */
  readonly export: (
    day: Archive.Day,
    table: Archive.Table,
  ) => Stream.Stream<Uint8Array, RequestLogArchiveFailed>;
  /**
   * Makes `archive_<table>`, of the table's columns, loads a file into it,
   * and gives the count, checksum and fingerprint of what it loaded. A table
   * is loaded once in a session, unless it is dropped.
   */
  readonly load: <E>(
    table: Archive.Table,
    file: Stream.Stream<Uint8Array, E>,
  ) => Effect.Effect<Archive.Measure, RequestLogArchiveFailed | E>;
  /** The count and checksum of the log's rows of a table and day. */
  readonly logged: (
    day: Archive.Day,
    table: Archive.Table,
  ) => Effect.Effect<Archive.Logged, RequestLogArchiveFailed>;
  /** How many rows of `archive_<table>` the log does not hold. */
  readonly lacking: (
    table: Archive.Table,
  ) => Effect.Effect<number, RequestLogArchiveFailed>;
  /** Adds to the table the rows of `archive_<table>` the log does not hold, naming the columns given, and gives how many it added. */
  readonly add: (
    table: Archive.Table,
    columns: ReadonlyArray<string>,
  ) => Effect.Effect<number, RequestLogArchiveFailed>;
  /** Drops `archive_<table>`. */
  readonly drop: (
    table: Archive.Table,
  ) => Effect.Effect<void, RequestLogArchiveFailed>;
  /** Makes an empty `archive_<table>`, of the table's columns, as `load` does before it loads. */
  readonly make: (
    table: Archive.Table,
  ) => Effect.Effect<void, RequestLogArchiveFailed>;
  /** Writes built rows into their `archive_<table>`, made before. */
  readonly append: (
    built: Built,
  ) => Effect.Effect<void, RequestLogArchiveFailed>;
  /** The count and checksum of the rows of `archive_<table>`, and of those of them the log does not hold. */
  readonly measure: (table: Archive.Table) => Effect.Effect<
    {
      readonly loaded: Archive.Logged;
      readonly lacking: Archive.Logged;
    },
    RequestLogArchiveFailed
  >;
  /** The count and checksum of the log's rows of the requests whose ids `archive_<table>` holds. */
  readonly ofLoaded: (
    table: "requests" | "request_items",
  ) => Effect.Effect<Archive.Logged, RequestLogArchiveFailed>;
  /**
   * How many requests of `archive_request_items` the log does not hold name
   * an item neither their session holds in the log nor `archive_items` holds.
   */
  readonly unresolved: Effect.Effect<number, RequestLogArchiveFailed>;
}

/** Rows built for one table, as the request log's own types hold them. */
export type Built =
  | {
      readonly table: "items";
      readonly rows: ReadonlyArray<StoredItems.StoredItem>;
    }
  | {
      readonly table: "request_items";
      readonly rows: ReadonlyArray<StoredItems.RequestItems>;
    }
  | {
      readonly table: "requests";
      readonly rows: ReadonlyArray<Session.RequestRecord>;
    }
  | {
      readonly table: "session_titles";
      readonly rows: ReadonlyArray<Title.Report>;
    };

/**
 * The request log's side of the archive (`docs/specs/archive/spec.md`): it
 * sends the log's tables nothing but `SELECT` and `INSERT`, apart from
 * `prepare` (B8).
 */
export class RequestLogArchive extends Context.Service<
  RequestLogArchive,
  {
    /** Makes the request log's tables that are missing; doing it again changes nothing. */
    readonly prepare: Effect.Effect<void, RequestLogArchiveFailed>;
    /** The summary of every day the log holds rows of. */
    readonly summaries: Effect.Effect<
      ReadonlyMap<Archive.Day, Archive.Summary>,
      RequestLogArchiveFailed
    >;
    /** The store's version, the log's database, and each table's columns and `CREATE`. */
    readonly source: Effect.Effect<Archive.Source, RequestLogArchiveFailed>;
    /** A new session, which the store ends once it has been idle for a minute. */
    readonly session: Effect.Effect<ArchiveSession>;
    /**
     * A new session for an import, which the store ends once it has been
     * idle for ten minutes, since a day's source is read between its writes.
     * A dry run's `add` adds to temporary tables of its own instead of the
     * log's, and counts what it added as held: a dry run checks, adds and
     * verifies as a real import does, and changes no table.
     */
    readonly importing: (dryRun: boolean) => Effect.Effect<ArchiveSession>;
  }
>()("@cota/hub/request-log/RequestLogArchive") {}
