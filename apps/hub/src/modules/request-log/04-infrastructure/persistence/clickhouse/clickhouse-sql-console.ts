import {
  Clock,
  Deferred,
  Duration,
  Effect,
  Layer,
  Option,
  Redacted,
  Ref,
  Schema,
} from "effect";
import {
  FormatNotAllowed,
  QueryFailed,
  SqlConsole,
  SqlUnavailable,
} from "#modules/request-log/02-application/interfaces/sql-console.ts";
import type * as Sql from "#modules/request-log/03-domain/sql.ts";
import * as ClickHouse from "./client.ts";
import { Param } from "./client.ts";
import * as SqlAnswer from "./sql-answer.ts";

// More than the hub reads of an answer: two header lines and the rows, each
// at most the row cap. ClickHouse sends nothing until it has this much or the
// query ends, so a query that fails while the hub could still be reading it
// is an HTTP error, not an exception framed after rows, whose last bytes
// Bun's fetch can drop when ClickHouse closes the connection after them.
const answerBufferOf = (limits: Sql.Limits) =>
  3 * limits.rowBytes + 1024 * 1024;

/**
 * The SQL user's settings profile for the limits given, as ClickHouse reports
 * each setting's value in `system.settings` (`docs/specs/sql/spec.md`, The
 * SQL user).
 */
export const profileOf = (
  limits: Sql.Limits,
): ReadonlyArray<readonly [string, string]> => [
  ["readonly", "1"],
  ["max_execution_time", String(Duration.toSeconds(limits.queryTime))],
  ["max_memory_usage", String(limits.memoryBytes)],
  ["max_threads", String(limits.threads)],
  ["max_concurrent_queries_for_user", String(limits.concurrentQueries)],
  ["max_result_rows", String(limits.rows + 1)],
  ["result_overflow_mode", "break"],
  ["cancel_http_readonly_queries_on_client_close", "1"],
  ["http_response_buffer_size", String(answerBufferOf(limits))],
  ["output_format_json_quote_64bit_integers", "1"],
  ["output_format_json_quote_decimals", "1"],
  ["output_format_decimal_trailing_zeros", "1"],
  ["date_time_output_format", "iso"],
];

/** The SQL user of a database, and its settings profile: `cota_sql` for `cota`. */
export const sqlUserOf = (database: string): string => `${database}_sql`;

/** How long the hub waits for an answer: five seconds past the query's time, when ClickHouse stops it. */
export const longestAnswerOf = (limits: Sql.Limits): Duration.Duration =>
  Duration.sum(limits.queryTime, Duration.seconds(5));

const backquoted = (name: string) =>
  `\`${name.replaceAll("\\", "\\\\").replaceAll("`", "\\`")}\``;

// ClickHouse writes an identifier in SHOW GRANTS with backquotes only when it
// needs them.
const shownAs = (name: string) =>
  /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : backquoted(name);

const settingsListOf = (profile: ReadonlyArray<readonly [string, string]>) =>
  profile
    .map(
      ([name, value]) =>
        `${name} = ${/^\d+$/.test(value) ? value : `'${value}'`}`,
    )
    .join(", ");

/** What made SQL unavailable: ClickHouse could not be reached, or it refused. */
export interface Failure {
  readonly reachable: boolean;
  readonly detail: string;
  /** What ClickHouse said, for the log only. */
  readonly said: string;
}

const failedAt =
  (what: string) =>
  (error: ClickHouse.ClickHouseError): Failure =>
    error.status === 0
      ? {
          reachable: false,
          detail: "ClickHouse could not be reached.",
          said: error.message,
        }
      : {
          reachable: true,
          detail: `${what} (ClickHouse error ${error.code === "" ? "with no code" : error.code}).`,
          said: error.message,
        };

const SettingRow = Schema.Struct({ name: Schema.String, value: Schema.String });
// ClickHouse names SHOW GRANTS' one column after the query's whole text.
const GrantRow = Schema.Record(Schema.String, Schema.String);

/**
 * Makes the SQL user and its profile as the hub's own ClickHouse user, then,
 * as the SQL user, checks the settings and the grants it ends up with.
 */
export const prepare = Effect.fn("ClickHouseSqlConsole.prepare")(function* (
  hub: ClickHouse.Client,
  password: Redacted.Redacted<string>,
  limits: Sql.Limits,
): Effect.fn.Return<ClickHouse.Client, Failure> {
  const name = sqlUserOf(hub.database);
  const profile = profileOf(limits);
  const settingsList = settingsListOf(profile);
  const user = backquoted(name);
  const identified = `IDENTIFIED WITH sha256_password BY '${Redacted.value(password)}' SETTINGS PROFILE ${user}`;
  const steps: ReadonlyArray<readonly [string, string]> = [
    [
      `CREATE SETTINGS PROFILE IF NOT EXISTS ${user} SETTINGS ${settingsList}`,
      `The hub's ClickHouse user could not create the settings profile ${name}; it needs access management`,
    ],
    [
      `ALTER SETTINGS PROFILE ${user} SETTINGS ${settingsList}`,
      `The hub's ClickHouse user could not set the settings profile ${name}; it needs access management`,
    ],
    [
      `CREATE USER IF NOT EXISTS ${user} ${identified}`,
      `The hub's ClickHouse user could not create the user ${name}; it needs access management`,
    ],
    [
      `ALTER USER ${user} ${identified}`,
      `The hub's ClickHouse user could not set the user ${name}'s password and profile; it needs access management`,
    ],
    [
      `GRANT SELECT ON ${backquoted(hub.database)}.* TO ${user} WITH REPLACE OPTION`,
      `The hub's ClickHouse user could not grant ${name} SELECT on ${hub.database}; it needs that grant with grant option`,
    ],
  ];
  for (const [statement, what] of steps) {
    yield* hub
      .command(statement)
      .pipe(Effect.mapError((error) => failedAt(what)(error)));
  }
  const sql = hub.as(name, password);
  const settings = yield* sql
    .select(
      "SELECT name, value FROM system.settings WHERE name IN {names:Array(String)}",
      SettingRow,
      { names: Param.strings(profile.map(([setting]) => setting)) },
    )
    .pipe(
      Effect.mapError(
        failedAt(`The SQL user ${name} could not read its settings`),
      ),
    );
  const differing = profile.flatMap(([setting, wanted]) => {
    const found = settings.find((row) => row.name === setting)?.value;
    return found === wanted
      ? []
      : [`${setting} is ${found ?? "missing"}, not ${wanted}`];
  });
  if (differing.length > 0) {
    const detail = `The SQL user ${name} does not have its profile's settings: ${differing.join("; ")}.`;
    return yield* Effect.fail({ reachable: true, detail, said: detail });
  }
  const grants = yield* sql
    .select("SHOW GRANTS", GrantRow)
    .pipe(
      Effect.mapError(
        failedAt(`The SQL user ${name} could not read its grants`),
      ),
    );
  const granted = grants.flatMap((row) => Object.values(row));
  const only = `GRANT SELECT ON ${shownAs(hub.database)}.* TO ${shownAs(name)}`;
  if (granted.length !== 1 || granted[0] !== only) {
    const detail = `The SQL user ${name} has grants other than SELECT on ${hub.database}: ${granted.join("; ")}.`;
    return yield* Effect.fail({ reachable: true, detail, said: detail });
  }
  return sql;
});

const randomPassword = () =>
  Redacted.make(
    Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join(""),
  );

type State =
  | { readonly _tag: "Ready"; readonly sql: ClickHouse.Client }
  | { readonly _tag: "Unavailable"; readonly detail: string };

const TableRow = Schema.Struct({
  name: Schema.String,
  engine: Schema.String,
  total_rows: Schema.NullOr(Schema.String),
  total_bytes: Schema.NullOr(Schema.String),
  comment: Schema.String,
});

const ColumnRow = Schema.Struct({
  table: Schema.String,
  name: Schema.String,
  type: Schema.String,
  comment: Schema.String,
});

const countOf = (total: string | null) =>
  Option.map(Option.fromNullOr(total), Number);

/**
 * The SQL console over ClickHouse: at start, and again while ClickHouse
 * cannot be reached, it makes the SQL user with a new password it keeps in
 * memory only, and checks it; until that succeeds, SQL is unavailable.
 */
export const layer = (
  limits: Sql.Limits,
): Layer.Layer<SqlConsole, never, ClickHouse.ClickHouse> =>
  Layer.effect(
    SqlConsole,
    Effect.gen(function* () {
      const hub = yield* ClickHouse.ClickHouse;
      const state = yield* Ref.make<State>({
        _tag: "Unavailable",
        detail: "The hub has not made the SQL user yet.",
      });
      const tried = yield* Deferred.make<void>();

      yield* Effect.gen(function* () {
        let pause = Duration.seconds(1);
        let logged = "";
        while (true) {
          const password = randomPassword();
          const prepared = yield* Effect.result(prepare(hub, password, limits));
          if (prepared._tag === "Success") {
            yield* Ref.set(state, { _tag: "Ready", sql: prepared.success });
            yield* Deferred.succeed(tried, undefined);
            yield* Effect.logInfo(
              `SQL runs as the ClickHouse user ${sqlUserOf(hub.database)}`,
            );
            return;
          }
          const { reachable, detail, said } = prepared.failure;
          yield* Ref.set(state, { _tag: "Unavailable", detail });
          yield* Deferred.succeed(tried, undefined);
          if (detail !== logged) {
            logged = detail;
            yield* Effect.logWarning(`SQL is unavailable: ${detail}`, {
              clickhouse: said.replaceAll(Redacted.value(password), "[HIDDEN]"),
            });
          }
          if (reachable) return;
          yield* Effect.sleep(pause);
          pause = Duration.min(Duration.times(pause, 2), Duration.minutes(1));
        }
      }).pipe(
        Effect.withSpan("ClickHouseSqlConsole.prepare"),
        Effect.forkScoped,
      );

      const ready = Effect.gen(function* () {
        yield* Deferred.await(tried);
        const now = yield* Ref.get(state);
        if (now._tag === "Unavailable") {
          return yield* new SqlUnavailable({ detail: now.detail });
        }
        return now.sql;
      });

      const longestAnswer = longestAnswerOf(limits);

      const unreachable = () =>
        new SqlUnavailable({ detail: "ClickHouse could not be reached." });

      const run = Effect.fn("ClickHouseSqlConsole.run")(function* (
        text: string,
      ): Effect.fn.Return<
        Sql.Answer,
        SqlUnavailable | QueryFailed | FormatNotAllowed
      > {
        const sql = yield* ready;
        const started = yield* Clock.currentTimeMillis;
        const answer = yield* Effect.scoped(
          Effect.gen(function* () {
            const streamed = yield* sql.stream(text, {
              default_format: SqlAnswer.format,
            });
            // ClickHouse names no format for a statement that answers no rows.
            if (
              streamed.format !== "" &&
              streamed.format !== SqlAnswer.format
            ) {
              return yield* new FormatNotAllowed({ format: streamed.format });
            }
            return yield* SqlAnswer.read(
              streamed.body,
              streamed.exceptionTag,
              limits,
            );
          }),
        ).pipe(
          Effect.catchTag("ClickHouseError", (error) =>
            Effect.fail(
              error.status === 0
                ? unreachable()
                : new QueryFailed({
                    detail: SqlAnswer.withoutVersion(error.detail),
                  }),
            ),
          ),
          Effect.timeoutOrElse({
            duration: longestAnswer,
            orElse: () =>
              Effect.fail(
                new SqlUnavailable({
                  detail: `ClickHouse did not finish answering within ${Duration.format(longestAnswer)}.`,
                }),
              ),
          }),
        );
        const finished = yield* Clock.currentTimeMillis;
        return { ...answer, elapsedMs: finished - started };
      });

      const schema = Effect.gen(function* () {
        const sql = yield* ready;
        const tables = yield* sql.select(
          `SELECT name, engine, total_rows, total_bytes, comment FROM system.tables
           WHERE database = currentDatabase() ORDER BY name`,
          TableRow,
        );
        const columns = yield* sql.select(
          `SELECT table, name, type, comment FROM system.columns
           WHERE database = currentDatabase() ORDER BY table, position`,
          ColumnRow,
        );
        return {
          database: sql.database,
          tables: tables.map(
            (table): Sql.Table => ({
              name: table.name,
              engine: table.engine,
              rows: countOf(table.total_rows),
              bytes: countOf(table.total_bytes),
              comment: table.comment,
              columns: columns
                .filter((column) => column.table === table.name)
                .map(({ name, type, comment }) => ({ name, type, comment })),
            }),
          ),
        };
      }).pipe(
        Effect.catchTag("ClickHouseError", (error) =>
          Effect.fail(
            error.status === 0
              ? unreachable()
              : new SqlUnavailable({
                  detail: `ClickHouse failed to read the SQL user's tables (ClickHouse error ${error.code}).`,
                }),
          ),
        ),
        Effect.withSpan("ClickHouseSqlConsole.schema"),
      );

      return SqlConsole.of({ run, schema });
    }),
  );
