import {
  Context,
  type DateTime,
  type Effect,
  type Option,
  Schema,
} from "effect";
import type * as Archive from "#modules/request-log/03-domain/archive.ts";
import type * as Import from "#modules/request-log/03-domain/import.ts";

/** The import source could not answer: `detail` says what failed, never with its connection details. */
export class ImportSourceFailed extends Schema.TaggedError<
  ImportSourceFailed,
  { readonly brand: unique symbol }
>()("ImportSourceFailed", { detail: Schema.String }) {
  override get message(): string {
    return this.detail;
  }
}

/** The days an import reads: from and to these, both included, when given. */
export interface Range {
  readonly from: Option.Option<Archive.Day>;
  readonly to: Option.Option<Archive.Day>;
}

/** What the source holds of a day, read before and after the day is read (`docs/specs/import/spec.md`, A day). */
export interface DaySummary {
  readonly requests: number;
  /** `sum(cityHash64(id))` of its requests, as text. */
  readonly fingerprint: string;
  /** Items first seen on the day. */
  readonly items: number;
  /** `request_items` rows of the day: of its requests, and those of no request whose own time is on it. */
  readonly requestItems: number;
}

/** A session of a day, and how much of a page it takes. */
export interface Weight {
  readonly sessionKey: string;
  readonly requests: number;
  readonly hashes: number;
}

/** A page of a day's sessions, as the source reads it: those of the day from the first key to the last, both included. */
export interface PageKeys {
  readonly day: Archive.Day;
  readonly first: string;
  readonly last: string;
}

/** An item a page lists, and the size of its content. */
export interface Listed extends Import.ListedItem {
  readonly bytes: number;
}

/** Each value of one of the source's columns over a range, with how many requests have it. */
export type Counted = ReadonlyArray<readonly [string, number]>;

/** What a dry run lists of the source over its range. */
export interface Tallies {
  readonly pools: Counted;
  /** The requests of each source pool by source provider. */
  readonly providers: ReadonlyArray<Import.PoolProvider>;
  readonly machines: Counted;
  readonly userAgents: Counted;
  readonly statuses: Counted;
  readonly objectTypes: Counted;
}

/**
 * The prototype's log, read only (`docs/specs/import/spec.md`, What is read):
 * every statement it sends is a `SELECT`, or a read of `system.columns` (Z1).
 */
export class ImportSource extends Context.Service<
  ImportSource,
  {
    /** What the source's tables lack of the columns and types the import reads: empty when it has them all. */
    readonly columnProblems: Effect.Effect<
      ReadonlyArray<string>,
      ImportSourceFailed
    >;
    /** The source pools of the range's requests, `metadata.fallback-from` included, with how many requests each bills or was diverted from. */
    readonly pools: (
      range: Range,
    ) => Effect.Effect<Counted, ImportSourceFailed>;
    /** What a dry run lists of the range. */
    readonly tallies: (
      range: Range,
    ) => Effect.Effect<Tallies, ImportSourceFailed>;
    /** The days of the range the source's requests and request items fall on, ascending. */
    readonly days: (
      range: Range,
    ) => Effect.Effect<ReadonlyArray<Archive.Day>, ImportSourceFailed>;
    readonly summary: (
      day: Archive.Day,
    ) => Effect.Effect<DaySummary, ImportSourceFailed>;
    /** The day's sessions in the order of their keys: those of its requests, of its request items, and of the items first seen on it. */
    readonly sessions: (
      day: Archive.Day,
    ) => Effect.Effect<ReadonlyArray<Weight>, ImportSourceFailed>;
    /** The day's requests of the page's sessions. */
    readonly requests: (
      page: PageKeys,
    ) => Effect.Effect<ReadonlyArray<Import.SourceRequest>, ImportSourceFailed>;
    /** The `request_items` rows of the page's requests, and the day's of its sessions whose request is not in Bifrost's log. */
    readonly requestItems: (
      page: PageKeys,
    ) => Effect.Effect<
      ReadonlyArray<Import.SourceRequestItems>,
      ImportSourceFailed
    >;
    /** The page's items, in the order of their keys: those first seen on its day, and those its requests' rows name. */
    readonly listed: (
      page: PageKeys,
    ) => Effect.Effect<ReadonlyArray<Listed>, ImportSourceFailed>;
    /** For each item given, the earliest request of Bifrost's log whose `request_items` row names it. */
    readonly firstNamings: (
      items: ReadonlyArray<{
        readonly sessionKey: string;
        readonly hash: string;
      }>,
    ) => Effect.Effect<ReadonlyArray<Import.FirstNaming>, ImportSourceFailed>;
    /** The content of the page's listed items from the first to the last given, in the order of their keys. */
    readonly contents: (
      page: PageKeys,
      first: Import.ListedItem,
      last: Import.ListedItem,
    ) => Effect.Effect<ReadonlyArray<Import.SourceContent>, ImportSourceFailed>;
    /** The latest start of each session's requests, of the sessions that have one. */
    readonly latest: (
      sessions: ReadonlyArray<string>,
    ) => Effect.Effect<ReadonlyMap<string, DateTime.Utc>, ImportSourceFailed>;
  }
>()("@cota/hub/request-log/ImportSource") {}

/** The prototype dashboard's files, as the import file names them. */
export class ImportFiles extends Context.Service<
  ImportFiles,
  {
    /** The titles file's titles: none when it names no titles file. */
    readonly titles: Effect.Effect<
      ReadonlyArray<Import.SourceTitle>,
      ImportSourceFailed
    >;
    /** The names file, read as JSON: none when it names no names file. */
    readonly names: Effect.Effect<unknown, ImportSourceFailed>;
  }
>()("@cota/hub/request-log/ImportFiles") {}
