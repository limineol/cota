import {
  Context,
  DateTime,
  Effect,
  Layer,
  Metric,
  Option,
  Result,
  Schema,
} from "effect";
import {
  ArchiveDirectory,
  type ArchiveDirectoryFailed,
} from "#modules/request-log/02-application/interfaces/archive-directory.ts";
import {
  RequestLogArchive,
  type RequestLogArchiveFailed,
} from "#modules/request-log/02-application/interfaces/request-log-archive.ts";
import * as Archive from "#modules/request-log/03-domain/archive.ts";

/** What a run did with a day it had something to do or say about. */
export type Outcome =
  | {
      readonly _tag: "Archived";
      readonly again: boolean;
      readonly rows: number;
      readonly bytes: number;
    }
  /** Its export, load, check or files failed; its earlier archive, if any, is as it was. */
  | { readonly _tag: "Failed"; readonly detail: string }
  | { readonly _tag: "Unreadable"; readonly why: string }
  /** Its archive's files do not match their manifest. */
  | { readonly _tag: "Mismatched"; readonly why: string }
  /** The log lacks rows its archive holds, by table. */
  | {
      readonly _tag: "Lacking";
      readonly lacking: Readonly<Record<Archive.Table, number>>;
    }
  | { readonly _tag: "Missing" };

export type Run =
  /** The run could not read the request log or the archive directory, and touched no file. */
  | { readonly _tag: "Stopped"; readonly detail: string }
  | {
      readonly _tag: "Ran";
      readonly days: ReadonlyArray<readonly [Archive.Day, Outcome]>;
    };

export const failures = Metric.counter("cota_archive_failures", {
  description:
    "Days the archive could not archive, and runs that could not read the request log or the archive directory.",
  incremental: true,
});

class NotVerified extends Schema.TaggedError<
  NotVerified,
  { readonly brand: unique symbol }
>()("NotVerified", { detail: Schema.String }) {
  override get message(): string {
    return this.detail;
  }
}

export class ArchiveDays extends Context.Service<
  ArchiveDays,
  {
    /**
     * One run of the archiver (the archive spec's "A run"): sweeps the
     * directory, decides each day, archives the days due and the changed
     * days whose archived rows the log all holds, and logs what it did. It
     * never fails: a failure stops its day, or its run when the log or the
     * directory cannot be read.
     */
    readonly execute: Effect.Effect<Run>;
  }
>()("@cota/hub/request-log/ArchiveDays") {}

const sum = (counts: ReadonlyArray<number>) =>
  counts.reduce((total, count) => total + count, 0);

export const layer: Layer.Layer<
  ArchiveDays,
  never,
  ArchiveDirectory | RequestLogArchive
> = Layer.effect(
  ArchiveDays,
  Effect.gen(function* () {
    const directory = yield* ArchiveDirectory;
    const log = yield* RequestLogArchive;

    const archive = Effect.fn("ArchiveDays.archive")(function* (
      day: Archive.Day,
      source: Archive.Source,
      replacing: Option.Option<Archive.Manifest>,
    ) {
      const session = yield* log.session;
      const written = yield* Archive.eachTable((table) =>
        directory.write(day, table, session.export(day, table)),
      );
      const archived = yield* Archive.eachTable((table) =>
        Effect.gen(function* () {
          const file = written[table];
          if (Option.isNone(file)) {
            return { file, measure: Archive.nothingLoaded };
          }
          const measure = yield* session
            .load(table, directory.read(day, Archive.partialName(table)))
            .pipe(Effect.ensuring(Effect.ignore(session.drop(table))));
          return { file, measure };
        }),
      );
      const logged = yield* Archive.eachTable((table) =>
        session.logged(day, table),
      );
      const differences = Archive.differences(archived, logged);
      if (differences.length > 0) {
        return yield* new NotVerified({ detail: differences.join("; ") });
      }
      const manifest = Archive.manifestOf(
        day,
        yield* DateTime.now,
        source,
        archived,
      );
      yield* directory.commit(manifest, replacing);
      const again = Option.isSome(replacing);
      const rows = sum(
        Archive.tables.map((table) => archived[table].measure.rows),
      );
      const bytes = sum(
        Archive.tables.map((table) =>
          Option.match(written[table], {
            onNone: () => 0,
            onSome: (file) => file.bytes,
          }),
        ),
      );
      yield* Effect.logInfo(
        `the archive archived ${day}${again ? " again" : ""}: ${rows} rows in ${bytes} bytes`,
      );
      return { _tag: "Archived", again, rows, bytes } satisfies Outcome;
    });

    const mismatchOf = Effect.fn("ArchiveDays.mismatchOf")(function* (
      manifest: Archive.Manifest,
    ) {
      for (const entry of manifest.tables) {
        if (entry.file === null) continue;
        const found = yield* directory.measure(manifest.day, entry.file);
        if (Option.isNone(found))
          return Option.some(`${entry.file} is missing`);
        if (found.value.bytes !== entry.bytes) {
          return Option.some(`${entry.file} differs from it in size`);
        }
        if (found.value.sha256 !== entry.sha256) {
          return Option.some(`${entry.file} differs from it in SHA-256`);
        }
      }
      return Option.none<string>();
    });

    const lackingOf = Effect.fn("ArchiveDays.lackingOf")(function* (
      manifest: Archive.Manifest,
    ) {
      const session = yield* log.session;
      return yield* Archive.eachTable((table) =>
        Effect.gen(function* () {
          const file = manifest.tables.find(
            (entry) => entry.table === table,
          )?.file;
          if (file === null || file === undefined) return 0;
          return yield* session
            .load(table, directory.read(manifest.day, file))
            .pipe(
              Effect.andThen(session.lacking(table)),
              Effect.ensuring(Effect.ignore(session.drop(table))),
            );
        }),
      );
    });

    const changed = Effect.fn("ArchiveDays.changed")(function* (
      manifest: Archive.Manifest,
      source: Archive.Source,
    ) {
      const day = manifest.day;
      const mismatch = yield* mismatchOf(manifest);
      if (Option.isSome(mismatch)) {
        yield* Effect.logWarning(
          `the archive of ${day} does not match its manifest: ${mismatch.value}; the day is left as it is`,
        );
        return { _tag: "Mismatched", why: mismatch.value } satisfies Outcome;
      }
      const lacking = yield* lackingOf(manifest);
      const total = sum(Archive.tables.map((table) => lacking[table]));
      if (total > 0) {
        const tables = Archive.tables
          .filter((table) => lacking[table] > 0)
          .map((table) => `${table} ${lacking[table]}`)
          .join(", ");
        yield* Effect.logWarning(
          `the request log lacks ${total} rows of ${day} that its archive holds (${tables}); bun run archive:restore puts them back`,
        );
        return { _tag: "Lacking", lacking } satisfies Outcome;
      }
      return yield* archive(day, source, Option.some(manifest));
    });

    const failedDay = (
      day: Archive.Day,
      error: ArchiveDirectoryFailed | RequestLogArchiveFailed | NotVerified,
    ) =>
      Effect.gen(function* () {
        yield* Effect.ignore(directory.discard(day));
        yield* Effect.logWarning(
          `the archive could not archive ${day}; it will try again in an hour`,
          { error: error.message },
        );
        return { _tag: "Failed", detail: error.message } satisfies Outcome;
      });

    const outcomeOf = Effect.fn("ArchiveDays.outcomeOf")(function* (
      day: Archive.Day,
      decision: Archive.Decision,
      source: Archive.Source,
    ): Effect.fn.Return<Option.Option<Outcome>> {
      if (decision._tag === "Archive") {
        return Option.some(
          yield* archive(day, source, Option.none()).pipe(
            Effect.catch((error) => failedDay(day, error)),
          ),
        );
      }
      if (decision._tag === "Changed") {
        return Option.some(
          yield* changed(decision.manifest, source).pipe(
            Effect.catch((error) => failedDay(day, error)),
          ),
        );
      }
      if (decision._tag === "Unreadable") {
        yield* Effect.logWarning(
          `the archive cannot read the manifest of ${day}: ${decision.why}; the day is left as it is`,
        );
        return Option.some({ _tag: "Unreadable", why: decision.why });
      }
      if (decision._tag === "Missing") return Option.some({ _tag: "Missing" });
      return Option.none();
    });

    const stopped = (what: string, error: { readonly message: string }) =>
      Effect.gen(function* () {
        yield* Effect.logWarning(
          `the archive could not read ${what}; it will try again in an hour`,
          { error: error.message },
        );
        yield* Metric.update(failures, 1);
        return { _tag: "Stopped", detail: error.message } satisfies Run;
      });

    return ArchiveDays.of({
      execute: Effect.gen(function* () {
        const swept = yield* Effect.result(directory.sweep);
        if (Result.isFailure(swept)) {
          return yield* stopped("its directory", swept.failure);
        }
        const read = yield* Effect.result(
          Effect.all([log.summaries, log.source]),
        );
        if (Result.isFailure(read)) {
          return yield* stopped("the request log", read.failure);
        }
        const [summaries, source] = read.success;
        const manifests = yield* Effect.result(directory.manifests);
        if (Result.isFailure(manifests)) {
          return yield* stopped("its directory", manifests.failure);
        }
        const days: Array<readonly [Archive.Day, Outcome]> = [];
        for (const [day, decision] of yield* Archive.decide(
          summaries,
          manifests.success,
        )) {
          const outcome = yield* outcomeOf(day, decision, source);
          if (Option.isSome(outcome)) days.push([day, outcome.value]);
          if (Option.isSome(outcome) && outcome.value._tag === "Failed") {
            yield* Metric.update(failures, 1);
          }
        }
        const missing = days.flatMap(([day, { _tag }]) =>
          _tag === "Missing" ? [day] : [],
        );
        if (missing.length > 0) {
          yield* Effect.logWarning(
            `the request log holds no row of ${missing.length} archived days, ${missing[0]} to ${missing.at(-1)}; bun run archive:restore puts them back`,
          );
        }
        return { _tag: "Ran", days } satisfies Run;
      }).pipe(Effect.withSpan("ArchiveDays.execute")),
    });
  }),
);
