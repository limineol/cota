import { Context, Effect, Layer, Option, Schema } from "effect";
import {
  ArchiveDirectory,
  type ArchiveDirectoryFailed,
} from "#modules/request-log/02-application/interfaces/archive-directory.ts";
import {
  type ArchiveSession,
  RequestLogArchive,
  type RequestLogArchiveFailed,
} from "#modules/request-log/02-application/interfaces/request-log-archive.ts";
import * as Archive from "#modules/request-log/03-domain/archive.ts";

/** The days a restore looks at: from and to these, both included, when given. */
export interface Range {
  readonly from: Option.Option<Archive.Day>;
  readonly to: Option.Option<Archive.Day>;
}

/** What a restore did with a day of the directory. */
export type Restored =
  /** Its rows the log did not hold were added, by table. */
  | {
      readonly _tag: "Added";
      readonly added: Readonly<Record<Archive.Table, number>>;
    }
  /** Its manifest equals the log's summary of it. */
  | { readonly _tag: "Held" }
  /** Its manifest or files did not pass the checks; nothing of it was added. */
  | { readonly _tag: "Refused"; readonly why: string }
  /** ClickHouse or the directory failed while it was checked or added, or its file loaded to other rows when it was added, or rows of it were still not held after it; the rows added before stay. */
  | { readonly _tag: "Failed"; readonly detail: string };

/** The restore could not start: the directory holds no archived day in the range. */
export class NoArchivedDay extends Schema.TaggedError<
  NoArchivedDay,
  { readonly brand: unique symbol }
>()("NoArchivedDay", {}) {}

type Checked =
  | Restored
  | { readonly _tag: "Accepted"; readonly manifest: Archive.Manifest };

class Refusal extends Schema.TaggedError<
  Refusal,
  { readonly brand: unique symbol }
>()("Refusal", { why: Schema.String }) {
  override get message(): string {
    return this.why;
  }
}

export class RestoreArchive extends Context.Service<
  RestoreArchive,
  {
    /**
     * One restore (the archive spec's "The restore"): checks each archived
     * day of the range, then adds the rows of the days it accepts that the
     * log does not hold, one table at a time in the load order across all of
     * them, and gives what it did with each day, in ascending order.
     */
    readonly execute: (
      range: Range,
    ) => Effect.Effect<
      ReadonlyArray<readonly [Archive.Day, Restored]>,
      RequestLogArchiveFailed | ArchiveDirectoryFailed | NoArchivedDay
    >;
  }
>()("@cota/hub/request-log/RestoreArchive") {}

const inRange = (day: Archive.Day, { from, to }: Range): boolean =>
  Option.match(from, { onNone: () => true, onSome: (first) => day >= first }) &&
  Option.match(to, { onNone: () => true, onSome: (last) => day <= last });

const entryOf = (manifest: Archive.Manifest, table: Archive.Table) =>
  manifest.tables.find((entry) => entry.table === table);

const columnText = (column: Archive.Column | undefined) =>
  column === undefined ? "none" : `${column.name} ${column.type}`;

/** The first column in which the log's table differs from the archive's, if any. */
export const columnDifference = (
  archived: ReadonlyArray<Archive.Column>,
  logged: ReadonlyArray<Archive.Column>,
): Option.Option<string> => {
  for (
    let index = 0;
    index < Math.max(archived.length, logged.length);
    index++
  ) {
    const inArchive = archived[index];
    const inLog = logged[index];
    if (inArchive?.name === inLog?.name && inArchive?.type === inLog?.type) {
      continue;
    }
    return Option.some(
      `column ${index + 1} is ${columnText(inArchive)} in the archive and ${columnText(inLog)} in the log`,
    );
  }
  return Option.none();
};

export const layer: Layer.Layer<
  RestoreArchive,
  never,
  ArchiveDirectory | RequestLogArchive
> = Layer.effect(
  RestoreArchive,
  Effect.gen(function* () {
    const directory = yield* ArchiveDirectory;
    const log = yield* RequestLogArchive;

    const filesRefusal = Effect.fn("RestoreArchive.filesRefusal")(function* (
      manifest: Archive.Manifest,
      source: Archive.Source,
    ) {
      for (const entry of manifest.tables) {
        if (entry.file === null) continue;
        const found = yield* directory.measure(manifest.day, entry.file);
        if (Option.isNone(found))
          return Option.some(`${entry.file} is missing`);
        if (found.value.bytes !== entry.bytes) {
          return Option.some(
            `${entry.file} does not match its manifest (size)`,
          );
        }
        if (found.value.sha256 !== entry.sha256) {
          return Option.some(
            `${entry.file} does not match its manifest (SHA-256)`,
          );
        }
      }
      for (const entry of manifest.tables) {
        const difference = columnDifference(
          entry.columns,
          source.tables[entry.table].columns,
        );
        if (Option.isSome(difference)) {
          return Option.some(
            `the log's ${entry.table} has other columns than the archive's: ${difference.value}`,
          );
        }
      }
      return Option.none<string>();
    });

    /** Loads a table's file of a day into `archive_<table>` and refuses it unless it loads to the manifest's count and checksum. */
    const loaded = Effect.fn("RestoreArchive.loaded")(function* (
      session: ArchiveSession,
      manifest: Archive.Manifest,
      entry: Archive.Entry,
      file: string,
      source: Archive.Source,
    ) {
      const measure = yield* session.load(
        entry.table,
        directory.read(manifest.day, file),
      );
      const differs =
        measure.rows !== entry.rows
          ? "rows"
          : measure.checksum !== entry.checksum
            ? "checksum"
            : undefined;
      if (differs !== undefined) {
        return yield* new Refusal({
          why: `${file} loads to other rows than its manifest says (${differs}), on ClickHouse ${source.version}; it was archived on ${manifest.clickhouse}`,
        });
      }
    });

    const loadRefusal = Effect.fn("RestoreArchive.loadRefusal")(function* (
      session: ArchiveSession,
      manifest: Archive.Manifest,
      source: Archive.Source,
    ) {
      for (const entry of manifest.tables) {
        const file = entry.file;
        if (file === null) continue;
        const refusal = yield* loaded(
          session,
          manifest,
          entry,
          file,
          source,
        ).pipe(
          Effect.as(Option.none<string>()),
          Effect.catchTag("Refusal", ({ why }) =>
            Effect.succeed(Option.some(why)),
          ),
          Effect.ensuring(Effect.ignore(session.drop(entry.table))),
        );
        if (Option.isSome(refusal)) return refusal;
      }
      return Option.none<string>();
    });

    const failedOf = (error: { readonly message: string }): Restored => ({
      _tag: "Failed",
      detail: error.message,
    });

    const check = Effect.fn("RestoreArchive.check")(function* (
      reading: Archive.Reading,
      summary: Archive.Summary,
      source: Archive.Source,
      session: ArchiveSession,
    ): Effect.fn.Return<Checked> {
      if (reading._tag === "Unreadable") {
        return {
          _tag: "Refused",
          why: `its manifest cannot be read: ${reading.why}`,
        };
      }
      const manifest = reading.manifest;
      if (Archive.matches(manifest, summary)) return { _tag: "Held" };
      const refusal = yield* filesRefusal(manifest, source).pipe(
        Effect.flatMap((found) =>
          Option.isSome(found)
            ? Effect.succeed(found)
            : loadRefusal(session, manifest, source),
        ),
        Effect.mapError(failedOf),
        Effect.result,
      );
      if (refusal._tag === "Failure") return refusal.failure;
      if (Option.isSome(refusal.success)) {
        return { _tag: "Refused", why: refusal.success.value };
      }
      return { _tag: "Accepted", manifest };
    });

    /** Adds a table's rows of a day that the log does not hold, and gives how many. */
    const add = Effect.fn("RestoreArchive.add")(function* (
      session: ArchiveSession,
      manifest: Archive.Manifest,
      table: Archive.Table,
      source: Archive.Source,
    ) {
      const entry = entryOf(manifest, table);
      const file = entry?.file;
      if (entry === undefined || file === null || file === undefined) return 0;
      return yield* Effect.gen(function* () {
        yield* loaded(session, manifest, entry, file, source);
        const added = yield* session.add(
          table,
          entry.columns.map(({ name }) => name),
        );
        const still = yield* session.lacking(table);
        if (still > 0) {
          return yield* new Refusal({
            why: `${still} rows of ${file} are still not held after they were added`,
          });
        }
        return added;
      }).pipe(Effect.ensuring(Effect.ignore(session.drop(table))));
    });

    return RestoreArchive.of({
      execute: Effect.fn("RestoreArchive.execute")(function* (range: Range) {
        const manifests = yield* directory.manifests;
        const days = [...manifests.keys()]
          .filter((day) => inRange(day, range))
          .sort();
        if (days.length === 0) return yield* new NoArchivedDay();
        yield* log.prepare;
        const summaries = yield* log.summaries;
        const source = yield* log.source;
        const session = yield* log.session;

        const outcomes = new Map<Archive.Day, Restored>();
        const accepted: Array<Archive.Manifest> = [];
        for (const day of days) {
          const reading = manifests.get(day);
          if (reading === undefined) continue;
          const checked = yield* check(
            reading,
            summaries.get(day) ?? Archive.emptySummary,
            source,
            session,
          );
          if (checked._tag === "Accepted") accepted.push(checked.manifest);
          else outcomes.set(day, checked);
        }

        const added = new Map<Archive.Day, Record<Archive.Table, number>>();
        for (const table of Archive.tables) {
          for (const manifest of accepted) {
            if (outcomes.has(manifest.day)) continue;
            const result = yield* Effect.result(
              add(session, manifest, table, source),
            );
            if (result._tag === "Failure") {
              outcomes.set(manifest.day, failedOf(result.failure));
              continue;
            }
            const counts = added.get(manifest.day) ?? {
              items: 0,
              request_items: 0,
              requests: 0,
              session_titles: 0,
            };
            counts[table] = result.success;
            added.set(manifest.day, counts);
          }
        }
        for (const [day, counts] of added) {
          if (!outcomes.has(day))
            outcomes.set(day, { _tag: "Added", added: counts });
        }
        return days.flatMap((day) => {
          const outcome = outcomes.get(day);
          return outcome === undefined ? [] : [[day, outcome] as const];
        });
      }),
    });
  }),
);
