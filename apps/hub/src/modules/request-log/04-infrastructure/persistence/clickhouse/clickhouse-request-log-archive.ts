import { Duration, Effect, Layer, Schema, Stream } from "effect";
import {
  type ArchiveSession,
  type Built,
  RequestLogArchive,
  RequestLogArchiveFailed,
} from "#modules/request-log/02-application/interfaces/request-log-archive.ts";
import * as Archive from "#modules/request-log/03-domain/archive.ts";
import * as ClickHouse from "./client.ts";
import { Param } from "./client.ts";
import * as ItemMapper from "./mappers/item.mapper.ts";
import * as RequestMapper from "./mappers/request.mapper.ts";
import * as RequestItemsMapper from "./mappers/request-items.mapper.ts";
import { titleRowOf } from "./mappers/title.mapper.ts";
import * as Tables from "./schema.ts";

const timeOf: Readonly<Record<Archive.Table, string>> = {
  items: "first_seen",
  request_items: "started_at",
  requests: "started_at",
  session_titles: "reported_at",
};

const keyOf = (table: Archive.Table) => Archive.keys[table].join(", ");

const inDay = (table: Archive.Table) => `toDate(${timeOf[table]}) = {day:Date}`;

// `FINAL` gives each item once, as its earliest copy, and its `WHERE` is
// applied after it; the day's sessions let `items`' primary key skip the rest.
const rowsOf = (table: Archive.Table) =>
  table === "items"
    ? `SELECT * FROM items FINAL WHERE session IN (SELECT DISTINCT session FROM items WHERE ${inDay(table)}) AND ${inDay(table)}`
    : `SELECT * FROM ${table} WHERE ${inDay(table)}`;

const checksum =
  "toString(sum(cityHash64(formatRowNoNewline('RowBinary', *)))) AS checksum";

const fingerprintOf = (table: Archive.Table) =>
  `toString(sum(cityHash64(${keyOf(table)}))) AS fingerprint`;

/** Where a session reads the rows the log holds of a table: the table, or for a dry run, the table and what the dry run added. */
type Held = (table: Archive.Table) => string;

const inLog: Held = (table) => table;

const withDryRun: Held = (table) =>
  `(SELECT * FROM ${table} UNION ALL SELECT * FROM dry_run_${table})`;

// An archived row the log holds (`docs/specs/archive/spec.md`, Values).
const notHeldIn = (held: Held): Readonly<Record<Archive.Table, string>> => ({
  items: `(session, digest, first_seen, request_id) NOT IN (
      SELECT a.session, a.digest, a.first_seen, a.request_id
      FROM archive_items AS a
      INNER JOIN (
        SELECT session, digest, first_seen, request_id FROM ${held("items")}
        WHERE session IN (SELECT DISTINCT session FROM archive_items)
      ) AS l ON l.session = a.session AND l.digest = a.digest
      WHERE (l.first_seen, toUInt128(l.request_id)) <= (a.first_seen, toUInt128(a.request_id)))`,
  request_items: `request_id NOT IN (
      SELECT request_id FROM ${held("request_items")}
      WHERE request_id IN (SELECT request_id FROM archive_request_items))`,
  requests: `id NOT IN (
      SELECT id FROM ${held("requests")} WHERE id IN (SELECT id FROM archive_requests))`,
  session_titles: `(session, title, reported_at, machine, reported_by) NOT IN (
      SELECT session, title, reported_at, machine, reported_by FROM ${held("session_titles")}
      WHERE session IN (SELECT DISTINCT session FROM archive_session_titles))`,
});

const longestTransfer = Duration.minutes(11);
const sessionTimeout = Duration.seconds(60);
const importTimeout = Duration.minutes(10);
const longestCheck = Duration.minutes(10);

const exportSettings: ClickHouse.Settings = {
  enable_http_compression: "1",
  output_format_compression_level: "9",
  output_format_json_quote_64bit_integers: "1",
  output_format_json_quote_decimals: "1",
  output_format_decimal_trailing_zeros: "1",
  date_time_output_format: "iso",
  readonly: "1",
  max_execution_time: "600",
  cancel_http_readonly_queries_on_client_close: "1",
};

const loadSettings: ClickHouse.Settings = {
  async_insert: "0",
  date_time_input_format: "best_effort",
  input_format_skip_unknown_fields: "0",
  input_format_parallel_parsing: "0",
  max_execution_time: "600",
};

// An add inserts a whole day: in blocks of at most 16 MiB, one at a time, so
// that what the search index's view keeps of a block (its distinct words)
// is bounded by the block, not by the day.
const addSettings: ClickHouse.Settings = {
  max_execution_time: "600",
  min_insert_block_size_rows: "65536",
  min_insert_block_size_bytes: String(16 * 1024 * 1024),
  max_insert_threads: "1",
};

const Count = Schema.NumberFromString.check(Schema.isInt());

const SummaryRow = Schema.Struct({
  day: Archive.Day,
  rows: Count,
  fingerprint: Archive.Uint64,
});

const LoggedRow = Schema.Struct({ rows: Count, checksum: Archive.Uint64 });

const MeasureRow = Schema.Struct({
  rows: Count,
  checksum: Archive.Uint64,
  fingerprint: Archive.Uint64,
});

const VersionRow = Schema.Struct({ version: Schema.String });

const ColumnRow = Schema.Struct({
  table: Archive.Table,
  name: Schema.String,
  type: Schema.String,
});

const CreateRow = Schema.Struct({
  table: Archive.Table,
  create: Schema.String,
});

const CountRow = Schema.Struct({ rows: Count });

const NameRow = Schema.Struct({ name: Schema.String });

const failed = (error: { readonly message: string }) =>
  new RequestLogArchiveFailed({ detail: error.message });

const tableList = Param.strings(Archive.tables);

/** The request log's side of the archive over ClickHouse (`docs/specs/archive/spec.md`). */
export const layer: Layer.Layer<
  RequestLogArchive,
  never,
  ClickHouse.ClickHouse
> = Layer.effect(
  RequestLogArchive,
  Effect.gen(function* () {
    const clickHouse = yield* ClickHouse.ClickHouse;
    const sessionFor = (timeout: Duration.Duration) =>
      clickHouse.session(crypto.randomUUID(), timeout, longestCheck);

    const summaries = Effect.gen(function* () {
      const days = new Map<Archive.Day, Record<Archive.Table, Archive.Tally>>();
      yield* Archive.eachTable((table) =>
        Effect.gen(function* () {
          const rows = yield* clickHouse.select(
            `SELECT toString(toDate(${timeOf[table]})) AS day, toString(count()) AS rows, ${fingerprintOf(table)}
             FROM ${table}${table === "items" ? " FINAL" : ""} GROUP BY day`,
            SummaryRow,
          );
          for (const { day, rows: count, fingerprint } of rows) {
            const summary = days.get(day) ?? { ...Archive.emptySummary };
            summary[table] = { rows: count, fingerprint };
            days.set(day, summary);
          }
        }),
      );
      const summarised: ReadonlyMap<Archive.Day, Archive.Summary> = days;
      return summarised;
    }).pipe(
      Effect.mapError(failed),
      Effect.withSpan("ClickHouseRequestLogArchive.summaries"),
    );

    const source = Effect.gen(function* () {
      const [server] = yield* clickHouse.select(
        "SELECT version() AS version",
        VersionRow,
      );
      const columns = yield* clickHouse.select(
        `SELECT table, name, type FROM system.columns
         WHERE database = currentDatabase() AND table IN {tables:Array(String)}
           AND default_kind NOT IN ('MATERIALIZED', 'ALIAS', 'EPHEMERAL')
         ORDER BY table, position`,
        ColumnRow,
        { tables: tableList },
      );
      const creates = yield* clickHouse.select(
        `SELECT name AS table, create_table_query AS create FROM system.tables
         WHERE database = currentDatabase() AND name IN {tables:Array(String)}`,
        CreateRow,
        { tables: tableList },
      );
      const tables = yield* Archive.eachTable((table) =>
        Effect.succeed({
          columns: columns
            .filter((column) => column.table === table)
            .map(({ name, type }) => ({ name, type })),
          create: creates.find((row) => row.table === table)?.create ?? "",
        }),
      );
      return {
        version: server?.version ?? "",
        database: clickHouse.database,
        tables,
      } satisfies Archive.Source;
    }).pipe(
      Effect.mapError(failed),
      Effect.withSpan("ClickHouseRequestLogArchive.source"),
    );

    const sessionOf = (
      inSession: ClickHouse.Client,
      held: Held,
    ): ArchiveSession => {
      const notHeld = notHeldIn(held);
      const lackingOf = (table: Archive.Table) =>
        inSession
          .select(
            `SELECT toString(count()) AS rows FROM archive_${table} WHERE ${notHeld[table]}`,
            CountRow,
          )
          .pipe(Effect.map(([row]) => row?.rows ?? 0));
      // What a dry run adds goes to its own temporary tables, made with the
      // first `archive_<table>` and kept for the session, never to the log's.
      const addedTo = (table: Archive.Table) =>
        held === inLog ? table : `dry_run_${table}`;
      const make = (table: Archive.Table) =>
        held === inLog
          ? makeIn(inSession, table)
          : inSession
              .command(
                `CREATE TEMPORARY TABLE IF NOT EXISTS dry_run_${table} ENGINE = MergeTree ORDER BY tuple() EMPTY AS SELECT * FROM ${table}`,
              )
              .pipe(Effect.andThen(makeIn(inSession, table)));
      const load = Effect.fn("ClickHouseRequestLogArchive.load")(function* <E>(
        table: Archive.Table,
        file: Stream.Stream<Uint8Array, E>,
      ): Effect.fn.Return<Archive.Measure, RequestLogArchiveFailed | E> {
        yield* makeIn(inSession, table).pipe(Effect.mapError(failed));
        yield* inSession
          .upload(
            `INSERT INTO archive_${table} FORMAT JSONEachRow`,
            file,
            loadSettings,
            longestTransfer,
          )
          .pipe(
            Effect.catchIf(
              (error) => error instanceof ClickHouse.ClickHouseError,
              (error) => Effect.fail(failed(error)),
            ),
          );
        const [measure] = yield* inSession
          .select(
            `SELECT toString(count()) AS rows, ${checksum}, ${fingerprintOf(table)} FROM archive_${table}`,
            MeasureRow,
          )
          .pipe(Effect.mapError(failed));
        return measure ?? Archive.nothingLoaded;
      });

      const add = Effect.fn("ClickHouseRequestLogArchive.add")(function* (
        table: Archive.Table,
        columns: ReadonlyArray<string>,
      ) {
        const lacking = yield* lackingOf(table);
        if (lacking === 0) return 0;
        const own = yield* inSession.select(
          `SELECT name FROM system.columns
             WHERE database = currentDatabase() AND table = {table:String}`,
          NameRow,
          { table: Param.string(table) },
        );
        const names = new Set(own.map(({ name }) => name));
        const unknown = columns.find((column) => !names.has(column));
        if (unknown !== undefined) {
          return yield* failure(`${table} has no column ${unknown}`);
        }
        const named = columns.map((column) => `\`${column}\``).join(", ");
        const target = addedTo(table);
        yield* inSession.command(
          `INSERT INTO ${target} (${named})
             SETTINGS async_insert = 0, deduplicate_insert = 'disable'
             SELECT ${named} FROM archive_${table} WHERE ${notHeld[table]}`,
          {},
          { settings: addSettings, wait: longestTransfer },
        );
        return lacking;
      }, Effect.mapError(failed));

      return {
        export: (day, table) =>
          Stream.unwrap(
            Effect.gen(function* () {
              const answer = yield* inSession.stream(
                `${rowsOf(table)} FORMAT JSONEachRow`,
                { ...exportSettings, param_day: day },
                { zstd: true, wait: longestTransfer },
              );
              let some = false;
              return answer.body.pipe(
                Stream.tap(() =>
                  some || answer.encoding === "zstd"
                    ? Effect.sync(() => {
                        some = true;
                      })
                    : Effect.fail(
                        failure(
                          `the export of ${table} came without zstd (${answer.encoding ?? "no encoding"})`,
                        ),
                      ),
                ),
              );
            }),
          ).pipe(Stream.mapError(failed)),
        load,
        logged: (day, table) =>
          inSession
            .select(
              `SELECT toString(count()) AS rows, ${checksum} FROM (${rowsOf(table)})`,
              LoggedRow,
              { day: Param.string(day) },
            )
            .pipe(
              Effect.map(([logged]) => logged ?? { rows: 0, checksum: "0" }),
              Effect.mapError(failed),
              Effect.withSpan("ClickHouseRequestLogArchive.logged"),
            ),
        lacking: (table) => lackingOf(table).pipe(Effect.mapError(failed)),
        add,
        drop: (table) =>
          inSession
            .command(`DROP TEMPORARY TABLE IF EXISTS archive_${table}`)
            .pipe(Effect.mapError(failed)),
        make: (table) => make(table).pipe(Effect.mapError(failed)),
        append: (built) =>
          built.rows.length === 0
            ? Effect.void
            : inSession
                .insert(`archive_${built.table}`, rowsOfBuilt(built))
                .pipe(
                  Effect.mapError(failed),
                  Effect.withSpan("ClickHouseRequestLogArchive.append"),
                ),
        measure: (table) =>
          Effect.all({
            loaded: measured(inSession, `SELECT * FROM archive_${table}`),
            lacking: measured(
              inSession,
              `SELECT * FROM archive_${table} WHERE ${notHeld[table]}`,
            ),
          }).pipe(
            Effect.mapError(failed),
            Effect.withSpan("ClickHouseRequestLogArchive.measure"),
          ),
        ofLoaded: (table) =>
          measured(
            inSession,
            table === "requests"
              ? `SELECT * FROM ${held("requests")} WHERE id IN (SELECT id FROM archive_requests)`
              : `SELECT * FROM ${held("request_items")} WHERE request_id IN (SELECT request_id FROM archive_request_items)`,
          ).pipe(
            Effect.mapError(failed),
            Effect.withSpan("ClickHouseRequestLogArchive.ofLoaded"),
          ),
        unresolved: inSession.select(unresolvedSql(held), CountRow).pipe(
          Effect.map(([row]) => row?.rows ?? 0),
          Effect.mapError(failed),
          Effect.withSpan("ClickHouseRequestLogArchive.unresolved"),
        ),
      };
    };

    return RequestLogArchive.of({
      prepare: Tables.prepare().pipe(
        Effect.provideService(ClickHouse.ClickHouse, clickHouse),
        Effect.mapError(failed),
      ),
      summaries,
      source,
      session: Effect.sync(() => sessionOf(sessionFor(sessionTimeout), inLog)),
      importing: (dryRun) =>
        Effect.sync(() =>
          sessionOf(sessionFor(importTimeout), dryRun ? withDryRun : inLog),
        ),
    });
  }),
);

const failure = (detail: string) =>
  new ClickHouse.ClickHouseError({ status: 200, code: "", detail });

const makeIn = (inSession: ClickHouse.Client, table: Archive.Table) =>
  inSession
    .command(`DROP TEMPORARY TABLE IF EXISTS archive_${table}`)
    .pipe(
      Effect.andThen(
        inSession.command(
          `CREATE TEMPORARY TABLE archive_${table} ENGINE = MergeTree ORDER BY tuple() EMPTY AS SELECT * FROM ${table}`,
        ),
      ),
    );

const rowsOfBuilt = (built: Built): ReadonlyArray<unknown> => {
  switch (built.table) {
    case "items":
      return built.rows.map(ItemMapper.itemRowOf);
    case "request_items":
      return built.rows.map(RequestItemsMapper.requestItemsRowOf);
    case "requests":
      return built.rows.map(RequestMapper.requestRowOf);
    case "session_titles":
      return built.rows.map(titleRowOf);
  }
};

const measured = (inSession: ClickHouse.Client, rows: string) =>
  inSession
    .select(
      `SELECT toString(count()) AS rows, ${checksum} FROM (${rows})`,
      LoggedRow,
    )
    .pipe(Effect.map(([logged]) => logged ?? { rows: 0, checksum: "0" }));

// A loaded request the log does not hold, one of whose digests is held
// neither by its session in the log nor among the loaded items.
const unresolvedSql = (
  held: Held,
) => `SELECT toString(uniqExact(request_id)) AS rows FROM (
    SELECT request_id, session, named
    FROM archive_request_items
    ARRAY JOIN arrayConcat(system, tools, input, output) AS named
    WHERE ${notHeldIn(held).request_items}
  )
  WHERE (session, named) NOT IN (
      SELECT session, digest FROM ${held("items")}
      WHERE session IN (SELECT DISTINCT session FROM archive_request_items))
    AND (session, named) NOT IN (SELECT session, digest FROM archive_items)`;
