import { DateTime, Effect, Option, Result, Schema } from "effect";

const dayPattern = /^\d{4}-\d{2}-\d{2}$/;

const isDay = (text: string): boolean =>
  dayPattern.test(text) &&
  Option.match(DateTime.make(`${text}T00:00:00Z`), {
    onNone: () => false,
    onSome: (start) => DateTime.formatIsoDateUtc(start) === text,
  });

/** A calendar day in UTC, `YYYY-MM-DD`: the instants from its midnight, included, to the next, excluded. */
export const Day = Schema.String.check(
  Schema.makeFilter((text) => isDay(text) || "a day, written YYYY-MM-DD"),
).pipe(Schema.brand("Day"));
export type Day = typeof Day.Type;

export const startOf = (day: Day): DateTime.Utc =>
  DateTime.makeUnsafe(`${day}T00:00:00Z`);

export const endOf = (day: Day): DateTime.Utc =>
  DateTime.add(startOf(day), { days: 1 });

/** A day is due once an hour has passed since it ended (B10). */
export const isDue = (day: Day, now: DateTime.Utc): boolean =>
  !DateTime.isLessThan(now, DateTime.add(endOf(day), { hours: 1 }));

/** The archived tables, in the load order: a table's rows are restored before the next table's. */
export const tables = [
  "items",
  "request_items",
  "requests",
  "session_titles",
] as const;
export const Table = Schema.Literals(tables);
export type Table = typeof Table.Type;

/** Runs `f` for each table, one after another in the load order. */
export const eachTable = <A, E, R>(
  f: (table: Table) => Effect.Effect<A, E, R>,
): Effect.Effect<Readonly<Record<Table, A>>, E, R> =>
  Effect.gen(function* () {
    const items = yield* f("items");
    const request_items = yield* f("request_items");
    const requests = yield* f("requests");
    const session_titles = yield* f("session_titles");
    return { items, request_items, requests, session_titles };
  });

/** Each table's key, whose hashes a fingerprint sums. */
export const keys: Readonly<Record<Table, ReadonlyArray<string>>> = {
  items: ["session", "digest", "first_seen", "request_id"],
  request_items: ["request_id"],
  requests: ["id"],
  session_titles: ["session", "title", "reported_at", "machine", "reported_by"],
};

const isUint64 = (text: string): boolean =>
  /^(0|[1-9]\d{0,19})$/.test(text) && BigInt(text) < 2n ** 64n;

/** A sum modulo 2^64, written as a decimal string: a checksum or a fingerprint. */
export const Uint64 = Schema.String.check(
  Schema.makeFilter(
    (text) => isUint64(text) || "a decimal number from 0 to 2^64 - 1",
  ),
);

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const Sha256 = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));

/** A table's rows of a day as the log's summary gives them: their count and fingerprint. */
export interface Tally {
  readonly rows: number;
  readonly fingerprint: string;
}

/** A day's summary: each table's count and fingerprint of its rows of the day. */
export type Summary = Readonly<Record<Table, Tally>>;

const none: Tally = { rows: 0, fingerprint: "0" };

/** The summary of a day the log holds no row of. */
export const emptySummary: Summary = {
  items: none,
  request_items: none,
  requests: none,
  session_titles: none,
};

/** The count and checksum of the log's rows of a table and day. */
export interface Logged {
  readonly rows: number;
  readonly checksum: string;
}

/** The count, checksum and fingerprint of the rows ClickHouse loaded from a table's file. */
export interface Measure extends Logged {
  readonly fingerprint: string;
}

/** A table's file as it was written: its size and SHA-256. */
export interface Written {
  readonly bytes: number;
  readonly sha256: string;
}

export const Column = Schema.Struct({
  name: Schema.String,
  type: Schema.String,
});
export type Column = typeof Column.Type;

/** What a manifest says of the request log its files came from. */
export interface Source {
  readonly version: string;
  readonly database: string;
  readonly tables: Readonly<
    Record<
      Table,
      { readonly columns: ReadonlyArray<Column>; readonly create: string }
    >
  >;
}

export const manifestName = "manifest.json";
export const manifestPartialName = "manifest.json.partial";

/** The name a table's file has before it is verified. */
export const partialName = (table: Table): string =>
  `${table}.jsonl.zst.partial`;

/** A verified table file's name, from its content. */
export const fileName = (table: Table, sha256: string): string =>
  `${table}.${sha256.slice(0, 16)}.jsonl.zst`;

const withoutFile = (entry: {
  readonly bytes: number;
  readonly rows: number;
  readonly checksum: string;
  readonly fingerprint: string;
}): boolean =>
  entry.bytes === 0 &&
  entry.rows === 0 &&
  entry.checksum === "0" &&
  entry.fingerprint === "0";

const Entry = Schema.Struct({
  table: Table,
  file: Schema.NullOr(Schema.String),
  bytes: Count,
  sha256: Schema.NullOr(Sha256),
  rows: Count,
  checksum: Uint64,
  key: Schema.Array(Schema.String),
  fingerprint: Uint64,
  columns: Schema.Array(Column),
  create: Schema.String,
}).check(
  Schema.makeFilter((entry) => {
    if (entry.file === null || entry.sha256 === null) {
      return (
        (entry.file === entry.sha256 && withoutFile(entry)) ||
        "a table without a file has no SHA-256, no bytes and no rows, and its checksum and fingerprint are 0"
      );
    }
    return (
      (entry.file === fileName(entry.table, entry.sha256) && entry.bytes > 0) ||
      "a table's file is named <table>.<the first 16 digits of its SHA-256>.jsonl.zst, and has bytes"
    );
  }),
);
export type Entry = typeof Entry.Type;

export const checksumRule =
  "sum of cityHash64(formatRowNoNewline('RowBinary', *)) over the rows, modulo 2^64";
export const fingerprintRule =
  "sum of cityHash64(key) over the rows, modulo 2^64";

/** An archived day's record, `manifest.json`: written last, it is what makes the day archived. */
export const Manifest = Schema.Struct({
  archive: Schema.Literal(1),
  day: Day,
  archivedAt: Schema.DateTimeUtcFromString,
  clickhouse: Schema.String,
  database: Schema.String,
  format: Schema.Literal("JSONEachRow"),
  compression: Schema.Literal("zstd"),
  level: Schema.Literal(9),
  checksum: Schema.Literal(checksumRule),
  fingerprint: Schema.Literal(fingerprintRule),
  tables: Schema.Array(Entry).check(
    Schema.makeFilter(
      (entries) =>
        (entries.length === tables.length &&
          entries.every(({ table }, index) => table === tables[index])) ||
        `one entry per table, in the load order: ${tables.join(", ")}`,
    ),
  ),
}).pipe(Schema.encodeKeys({ archivedAt: "archived_at" }));
export type Manifest = typeof Manifest.Type;

/** A manifest as it is written: JSON with two-space indentation. */
export const textOf = (manifest: Manifest): string =>
  `${Schema.encodeSync(Schema.fromJsonString(Manifest, { space: 2 }))(manifest)}\n`;

export interface Archived {
  readonly file: Option.Option<Written>;
  readonly measure: Measure;
}

/** The manifest of a day's verified files, made from what ClickHouse loaded of each and what the run read of the log. */
export const manifestOf = (
  day: Day,
  archivedAt: DateTime.Utc,
  source: Source,
  archived: Readonly<Record<Table, Archived>>,
): Manifest => ({
  archive: 1,
  day,
  archivedAt,
  clickhouse: source.version,
  database: source.database,
  format: "JSONEachRow",
  compression: "zstd",
  level: 9,
  checksum: checksumRule,
  fingerprint: fingerprintRule,
  tables: tables.map((table) => {
    const { file, measure } = archived[table];
    return {
      table,
      file: Option.match(file, {
        onNone: () => null,
        onSome: ({ sha256 }) => fileName(table, sha256),
      }),
      bytes: Option.match(file, {
        onNone: () => 0,
        onSome: (written) => written.bytes,
      }),
      sha256: Option.match(file, {
        onNone: () => null,
        onSome: (written) => written.sha256,
      }),
      rows: measure.rows,
      checksum: measure.checksum,
      key: keys[table],
      fingerprint: measure.fingerprint,
      columns: source.tables[table].columns,
      create: source.tables[table].create,
    };
  }),
});

/** A day's manifest as the run reads it. */
export type Reading =
  | { readonly _tag: "Readable"; readonly manifest: Manifest }
  | { readonly _tag: "Unreadable"; readonly why: string };

const Json = Schema.fromJsonString(Schema.Unknown);
const Versioned = Schema.Struct({ archive: Schema.Unknown });

/**
 * Reads the text of a day's `manifest.json`. It cannot be read when it is not
 * JSON, is not of a manifest's shape, has an `archive` other than 1, or is of
 * another day than its directory's.
 */
export const readManifest = (day: Day, text: string): Reading => {
  const unreadable = (why: string): Reading => ({ _tag: "Unreadable", why });
  const json = Schema.decodeResult(Json)(text);
  if (Result.isFailure(json)) return unreadable("it is not JSON");
  const versioned = Schema.decodeUnknownResult(Versioned)(json.success);
  if (Result.isSuccess(versioned) && versioned.success.archive !== 1) {
    return unreadable(
      `its archive is ${JSON.stringify(versioned.success.archive)}, not 1`,
    );
  }
  const decoded = Schema.decodeUnknownResult(Manifest)(json.success);
  if (Result.isFailure(decoded)) {
    return unreadable(
      `it is not a manifest: ${decoded.failure.message.replace(/\s*\n\s*/g, " ")}`,
    );
  }
  if (decoded.success.day !== day) {
    return unreadable(`it is the manifest of ${decoded.success.day}`);
  }
  return { _tag: "Readable", manifest: decoded.success };
};

/** Whether a manifest's rows and fingerprint equal the summary's, table by table. */
export const matches = (manifest: Manifest, summary: Summary): boolean =>
  manifest.tables.every(
    ({ table, rows, fingerprint }) =>
      rows === summary[table].rows &&
      fingerprint === summary[table].fingerprint,
  );

const holdsRows = (summary: Summary): boolean =>
  tables.some((table) => summary[table].rows > 0);

/** What a run does with a day (the archive spec's "A run", step 4). */
export type Decision =
  | { readonly _tag: "Archive" }
  | { readonly _tag: "Nothing" }
  | { readonly _tag: "Unreadable"; readonly why: string }
  | { readonly _tag: "Unchanged" }
  | { readonly _tag: "Missing" }
  | { readonly _tag: "Changed"; readonly manifest: Manifest };

const decisionOf = (
  day: Day,
  now: DateTime.Utc,
  summary: Summary,
  reading: Reading | undefined,
): Decision => {
  if (reading === undefined) {
    return holdsRows(summary) && isDue(day, now)
      ? { _tag: "Archive" }
      : { _tag: "Nothing" };
  }
  if (reading._tag === "Unreadable") {
    return { _tag: "Unreadable", why: reading.why };
  }
  if (matches(reading.manifest, summary)) return { _tag: "Unchanged" };
  if (!holdsRows(summary)) return { _tag: "Missing" };
  return { _tag: "Changed", manifest: reading.manifest };
};

/**
 * Decides, now, each day that the log's summaries or the directory's
 * manifests name, in ascending order, by the first row of the archive spec's
 * table that applies (B3, B4, B5 and B10).
 */
export const decide = Effect.fn("Archive.decide")(function* (
  summaries: ReadonlyMap<Day, Summary>,
  manifests: ReadonlyMap<Day, Reading>,
): Effect.fn.Return<ReadonlyArray<readonly [Day, Decision]>> {
  const now = yield* DateTime.now;
  return [...new Set([...summaries.keys(), ...manifests.keys()])]
    .sort()
    .map((day) => [
      day,
      decisionOf(
        day,
        now,
        summaries.get(day) ?? emptySummary,
        manifests.get(day),
      ),
    ]);
});

/** Each table whose loaded rows differ from the log's by count or checksum; a day is verified when there is none (B2). */
export const differences = (
  archived: Readonly<Record<Table, Archived>>,
  logged: Readonly<Record<Table, Logged>>,
): ReadonlyArray<string> =>
  tables.flatMap((table) => {
    const file = archived[table].measure;
    const log = logged[table];
    return file.rows === log.rows && file.checksum === log.checksum
      ? []
      : [
          `${table} loads to ${file.rows} rows with checksum ${file.checksum}, the log holds ${log.rows} with checksum ${log.checksum}`,
        ];
  });

/** The count, checksum and fingerprint of a table without a file. */
export const nothingLoaded: Measure = {
  rows: 0,
  checksum: "0",
  fingerprint: "0",
};
