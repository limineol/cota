import { BunHttpClient } from "@effect/platform-bun";
import { expect, layer } from "@effect/vitest";
import {
  Arbitrary,
  Clock,
  Context,
  Duration,
  Effect,
  Fiber,
  Layer,
  Redacted,
  Schema,
} from "effect";
import { TestClock } from "effect/testing";
import { SqlConsole } from "#modules/request-log/02-application/interfaces/sql-console.ts";
import * as Sql from "#modules/request-log/03-domain/sql.ts";
import * as Scratch from "#modules/request-log/05-tests/scratch.ts";
import * as Harness from "#shared/05-tests/harness.ts";
import * as ClickHouseSqlConsole from "./clickhouse-sql-console.ts";
import * as ClickHouse from "./client.ts";
import { Param } from "./client.ts";
import * as Tables from "./schema.ts";

const reader = { "x-cota-key": Harness.secrets.readerHubKey };

const Row = Schema.Record(Schema.String, Schema.Json);

/** Runs a query as the hub's own ClickHouse user, over the scratch database. */
const asHub = (sql: string, params: ClickHouse.Params = {}) =>
  Effect.gen(function* () {
    const clickHouse = yield* ClickHouse.ClickHouse;
    return yield* clickHouse.select(sql, Row, params);
  }).pipe(Effect.orDie);

const tryAsHub = (sql: string) =>
  Effect.gen(function* () {
    const clickHouse = yield* ClickHouse.ClickHouse;
    yield* clickHouse.command(sql);
  });

const commandAsHub = (sql: string) => tryAsHub(sql).pipe(Effect.orDie);

/**
 * The scratch database with the request log's tables and a title in them,
 * another database beside it with a table, a Join table, a dictionary and a
 * time series, and, once the test is done, the SQL user and profile dropped.
 */
const scratch = Layer.effectDiscard(
  Effect.gen(function* () {
    const { database } = yield* Scratch.Scratch;
    const other = `${database}_other`;
    const sqlUser = ClickHouseSqlConsole.sqlUserOf(database);
    // Not the scratch client: a mutant that runs X1 as the hub's own user
    // drops the scratch database, and the scratch client can then run nothing.
    const admin = yield* Layer.build(
      ClickHouse.layer(Scratch.connectionTo("default")).pipe(
        Layer.provide(BunHttpClient.layer),
      ),
    ).pipe(
      Effect.map((context) => Context.get(context, ClickHouse.ClickHouse)),
    );
    yield* Effect.addFinalizer(() =>
      Effect.forEach(
        [
          `DROP USER IF EXISTS ${sqlUser}, ${database}_intruder`,
          `DROP ROLE IF EXISTS ${database}_intruder`,
          `DROP SETTINGS PROFILE IF EXISTS ${sqlUser}, ${database}_intruder`,
          `DROP FUNCTION IF EXISTS ${database}_f`,
          `DROP DATABASE IF EXISTS ${other} SYNC`,
          `DROP DATABASE IF EXISTS ${database}_new SYNC`,
          ...[
            "MERGES",
            "TTL MERGES",
            "MOVES",
            "FETCHES",
            "DISTRIBUTED SENDS",
            "REPLICATION QUEUES",
            "VIEWS",
          ].map((kind) => `SYSTEM START ${kind}`),
        ],
        (sql) => Effect.ignore(admin.command(sql)),
      ),
    );
    yield* Tables.prepare().pipe(Effect.orDie);
    for (const sql of [
      "INSERT INTO session_titles VALUES ('s1', 'Fix the relay', now64(3), 'laptop', 'fleet')",
      `CREATE DATABASE ${other}`,
      `CREATE TABLE ${other}.p (a UInt64, b UInt64, PROJECTION by_b (SELECT a, b ORDER BY b)) ENGINE = MergeTree ORDER BY a`,
      `INSERT INTO ${other}.p VALUES (1, 42)`,
      `CREATE TABLE ${other}.j (k UInt64, v String) ENGINE = Join(ANY, LEFT, k)`,
      `INSERT INTO ${other}.j VALUES (1, 'not the request log')`,
      `CREATE DICTIONARY ${other}.d (k UInt64, v String) PRIMARY KEY k SOURCE(CLICKHOUSE(TABLE 'j' DB '${other}' USER '${Scratch.server.user}' PASSWORD '${Scratch.server.password}')) LAYOUT(FLAT()) LIFETIME(0)`,
      `CREATE TABLE ${other}.ts ENGINE = TimeSeries SETTINGS allow_experimental_time_series_table = 1`,
    ]) {
      yield* commandAsHub(sql);
    }
  }),
);

/** The SQL console with the limits given, over the scratch database, on the live clock. */
const consoleWith = (limits: Sql.Limits) =>
  Effect.gen(function* () {
    const clickHouse = yield* ClickHouse.ClickHouse;
    const live = yield* TestClock.withLive(Clock.clockWith(Effect.succeed));
    return ClickHouseSqlConsole.layer(limits).pipe(
      Layer.provide([
        Layer.succeed(ClickHouse.ClickHouse, clickHouse),
        Layer.succeed(Clock.Clock, live),
      ]),
    );
  });

/** A whole hub whose `sql` group runs on the ClickHouse console, with the limits given, over the scratch database. */
const hubWith = (limits: Sql.Limits) =>
  Layer.unwrap(
    Effect.map(consoleWith(limits), Harness.layerWithSqlConsole),
  ).pipe(
    Layer.provideMerge(scratch),
    Layer.provideMerge(Layer.fresh(Scratch.layer)),
  );

const hub = hubWith(Sql.defaults);

interface Answered {
  readonly status: number;
  readonly type: string;
  readonly detail: string;
  readonly body: unknown;
}

const post = (sql: string, path = "/api/sql") =>
  Effect.gen(function* () {
    const response = yield* Harness.send(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...reader },
      body: JSON.stringify({ sql }),
    });
    const body: unknown = JSON.parse(yield* Harness.textOf(response));
    const field = (name: string) =>
      typeof body === "object" && body !== null && name in body
        ? String(Reflect.get(body, name))
        : "";
    return {
      status: response.status,
      type: field("type") || "answer",
      detail: field("detail"),
      body,
    } satisfies Answered;
  });

const answerOf = (answered: Answered) =>
  Schema.decodeUnknownSync(
    Schema.Struct({
      columns: Schema.Array(
        Schema.Struct({ name: Schema.String, type: Schema.String }),
      ),
      rows: Schema.Array(Schema.Array(Schema.Json)),
      truncated: Schema.Boolean,
      elapsedMs: Schema.Finite,
    }),
  )(answered.body);

/** What a refusal says, by its error's name: `query-failed ACCESS_DENIED`. */
const refusalOf = (answered: Answered) =>
  `${answered.status} ${answered.type.replace("urn:cota:", "")} ${/\(([A-Z_]+)\)$/.exec(answered.detail)?.[1] ?? answered.detail}`;

const databaseOf = Effect.map(Scratch.Scratch, ({ database }) => database);

/** Waits until ClickHouse runs nothing as the SQL user, and says whether it did. */
const nothingRunning = Effect.gen(function* () {
  const database = yield* databaseOf;
  for (let attempt = 0; attempt < 50; attempt++) {
    const [row] = yield* asHub(
      "SELECT count() AS running FROM system.processes WHERE user = {user:String}",
      { user: Param.string(ClickHouseSqlConsole.sqlUserOf(database)) },
    );
    if (row?.running === "0") return true;
    yield* Effect.promise(() => Bun.sleep(100));
  }
  return false;
});

const runningNow = Effect.gen(function* () {
  const database = yield* databaseOf;
  const [row] = yield* asHub(
    "SELECT count() AS running FROM system.processes WHERE user = {user:String}",
    { user: Param.string(ClickHouseSqlConsole.sqlUserOf(database)) },
  );
  return Number(row?.running);
});

/** Sends SQL as `post` does, and leaves before the answer if interrupted. */
const leavable = (sql: string) =>
  Effect.gen(function* () {
    const base = yield* Harness.hubUrl;
    return yield* Effect.promise((signal) =>
      fetch(`${base}/api/sql`, {
        method: "POST",
        headers: { "content-type": "application/json", ...reader },
        body: JSON.stringify({ sql }),
        signal,
      }).then(
        (response) => response.status,
        () => 0,
      ),
    );
  });

/**
 * Everything a query could change: the tables of both databases and their
 * rows, the users, roles, profiles, functions, named collections and
 * databases, and the SQL user's grants and profile.
 */
const everything = Effect.gen(function* () {
  const database = yield* databaseOf;
  const other = `${database}_other`;
  const sqlUser = ClickHouseSqlConsole.sqlUserOf(database);
  const read: Record<string, unknown> = {};
  for (const sql of [
    `SELECT database, name, create_table_query FROM system.tables WHERE database IN ('${database}', '${other}') ORDER BY database, name`,
    ...[
      "databases",
      "users",
      "roles",
      "settings_profiles",
      "functions",
      "named_collections",
    ].map(
      (table) =>
        `SELECT name FROM system.${table} WHERE startsWith(name, '${database}') ORDER BY name`,
    ),
    `SELECT * FROM system.settings_profile_elements WHERE startsWith(profile_name, '${database}') OR startsWith(user_name, '${database}') ORDER BY ALL`,
    `SELECT * FROM system.grants WHERE startsWith(user_name, '${database}') OR startsWith(role_name, '${database}') ORDER BY ALL`,
    `SELECT * FROM system.role_grants WHERE startsWith(user_name, '${database}') OR startsWith(role_name, '${database}') ORDER BY ALL`,
    `SELECT count() AS mutations FROM system.mutations WHERE database IN ('${database}', '${other}')`,
    `SHOW CREATE USER ${sqlUser}`,
    ...["requests", "items", "request_items", "session_titles", "words"].map(
      (table) =>
        `SELECT '${table}' AS t, count() AS rows, sum(cityHash64(*)) AS hash FROM ${database}.${table}`,
    ),
    `SELECT count() AS rows, sum(cityHash64(*)) AS hash FROM ${other}.p`,
  ]) {
    read[sql] = yield* asHub(sql);
  }
  return read;
});

const pick = <A>(
  values: ReadonlyArray<A>,
  fallback: A,
): Arbitrary.Arbitrary<A> =>
  Arbitrary.schema(
    Schema.Int.check(
      Schema.isBetween({ minimum: 0, maximum: values.length - 1 }),
    ),
  ).pipe(Arbitrary.map((index) => values[index] ?? fallback));

const booleans = (length: number) =>
  Arbitrary.array(Arbitrary.schema(Schema.Boolean), {
    minLength: length,
    maxLength: length,
  });

const separators = [
  " ",
  "\t",
  "\n",
  " /* ; DROP TABLE x */ ",
  "/**/",
  " -- ;\n",
];

/**
 * Statements that would change something, each word in any case and each gap
 * any space or comment. What they would make is named after the scratch
 * database and dropped with it, and they stop or kill nothing outside it but
 * the global SYSTEM STOPs, which the scratch layer undoes: a mutant that runs
 * them as the hub's own user must leave the server as it found it.
 */
const changes = (database: string) => {
  const statements = [
    "INSERT INTO session_titles VALUES ('s2', 'x', now64(3), 'm', 'k')",
    "INSERT INTO session_titles SELECT * FROM session_titles",
    // One file's name for every run: a mutant that runs this as the hub's
    // user leaves the file behind, in ClickHouse's user_files.
    "INSERT INTO FUNCTION file('cota-sql-x1.csv', 'CSV') SELECT 1",
    "ALTER TABLE requests DELETE WHERE 1",
    "ALTER TABLE session_titles UPDATE title = 'x' WHERE 1",
    "ALTER TABLE requests ADD COLUMN z UInt8",
    "ALTER TABLE requests DROP COLUMN pool",
    "DELETE FROM session_titles WHERE 1",
    "UPDATE session_titles SET title = 'x' WHERE 1",
    "CREATE TABLE t2 (a UInt8) ENGINE = Memory",
    "CREATE TEMPORARY TABLE t3 (a UInt8)",
    "CREATE VIEW v AS SELECT 1",
    `CREATE DATABASE ${database}_new`,
    `CREATE FUNCTION ${database}_f AS x -> x`,
    `CREATE USER ${database}_intruder IDENTIFIED BY 'x'`,
    `CREATE ROLE ${database}_intruder`,
    `CREATE SETTINGS PROFILE ${database}_intruder SETTINGS readonly = 0`,
    `CREATE NAMED COLLECTION ${database}_intruder AS a = 1`,
    "DROP TABLE session_titles",
    `DROP DATABASE ${database}`,
    `DROP USER ${ClickHouseSqlConsole.sqlUserOf(database)}`,
    "TRUNCATE TABLE session_titles",
    "OPTIMIZE TABLE items FINAL",
    "RENAME TABLE session_titles TO gone",
    "EXCHANGE TABLES session_titles AND requests",
    "DETACH TABLE session_titles",
    "ATTACH TABLE session_titles",
    "UNDROP TABLE gone",
    "SYSTEM FLUSH LOGS",
    "SYSTEM DROP DNS CACHE",
    "SYSTEM STOP MERGES",
    "SYSTEM STOP TTL MERGES",
    "SYSTEM STOP MOVES",
    "SYSTEM STOP FETCHES",
    "SYSTEM STOP DISTRIBUTED SENDS",
    "SYSTEM STOP REPLICATION QUEUES",
    "SYSTEM STOP VIEWS",
    "SET ROLE ALL",
    `KILL QUERY WHERE current_database = '${database}'`,
    `KILL MUTATION WHERE database = '${database}'`,
    `GRANT SELECT ON *.* TO ${ClickHouseSqlConsole.sqlUserOf(database)}`,
    `REVOKE SELECT ON ${database}.* FROM ${ClickHouseSqlConsole.sqlUserOf(database)}`,
    `ALTER USER ${ClickHouseSqlConsole.sqlUserOf(database)} IDENTIFIED BY 'known'`,
    "ALTER USER CURRENT_USER SETTINGS PROFILE default",
    `ALTER SETTINGS PROFILE ${ClickHouseSqlConsole.sqlUserOf(database)} SETTINGS readonly = 0`,
    "SET readonly = 0",
    "SET max_result_rows = 1000000",
    `BACKUP TABLE session_titles TO File('${database}.zip')`,
    `RESTORE TABLE session_titles FROM File('${database}.zip')`,
    "SELECT 1; DROP TABLE session_titles",
    "SELECT 1; INSERT INTO session_titles SELECT * FROM session_titles",
  ];
  return Arbitrary.all({
    words: pick(statements, "SELECT 1").pipe(
      Arbitrary.map((statement) => statement.split(" ")),
    ),
    gaps: Arbitrary.array(pick(separators, " "), {
      minLength: 40,
      maxLength: 40,
    }),
    cases: booleans(400),
    end: pick(["", ";", " ;", ";\n"], ""),
  }).pipe(
    Arbitrary.map(({ words, gaps, cases, end }) => {
      let at = 0;
      const recased = words.map((word) =>
        /^[A-Z]+$/.test(word)
          ? [...word]
              .map((letter) =>
                cases[at++ % cases.length] ? letter : letter.toLowerCase(),
              )
              .join("")
          : word,
      );
      return (
        recased.reduce(
          (text, word, index) =>
            index === 0 ? word : `${text}${gaps[index % gaps.length]}${word}`,
          "",
        ) + end
      );
    }),
  );
};

/** Every table function of this ClickHouse that reaches outside the database, called as an attacker would. */
const outside = (database: string): Readonly<Record<string, string>> => {
  const other = `${database}_other`;
  return {
    url: "SELECT * FROM url('http://127.0.0.1:8123/?query=SELECT+1', 'CSV', 'a String')",
    urlCluster:
      "SELECT * FROM urlCluster('default', 'http://127.0.0.1:8123/?query=SELECT+1', 'CSV', 'a String')",
    file: "SELECT * FROM file('data.csv', 'LineAsString')",
    fileCluster:
      "SELECT * FROM fileCluster('default', '/etc/passwd', 'LineAsString')",
    filesystem: "SELECT * FROM filesystem('/')",
    remote: "SELECT * FROM remote('127.0.0.1:9000', 'system.users')",
    remoteSecure:
      "SELECT * FROM remoteSecure('127.0.0.1:9440', 'system.users')",
    cluster: "SELECT * FROM cluster('default', 'system.users')",
    clusterAllReplicas:
      "SELECT * FROM clusterAllReplicas('default', 'system.users')",
    s3: "SELECT * FROM s3('http://127.0.0.1:9/bucket/k.csv', 'CSV', 'a String')",
    s3Cluster:
      "SELECT * FROM s3Cluster('default', 'http://127.0.0.1:9/bucket/k.csv', 'CSV', 'a String')",
    gcs: "SELECT * FROM gcs('http://127.0.0.1:9/bucket/k.csv', 'CSV', 'a String')",
    oss: "SELECT * FROM oss('http://127.0.0.1:9/bucket/k.csv', 'CSV', 'a String')",
    cosn: "SELECT * FROM cosn('http://127.0.0.1:9/bucket/k.csv', 'CSV', 'a String')",
    hdfs: "SELECT * FROM hdfs('hdfs://127.0.0.1:9/k.csv', 'CSV', 'a String')",
    hdfsCluster:
      "SELECT * FROM hdfsCluster('default', 'hdfs://127.0.0.1:9/k.csv', 'CSV', 'a String')",
    mysql: "SELECT * FROM mysql('127.0.0.1:9', 'db', 't', 'u', 'p')",
    postgresql: "SELECT * FROM postgresql('127.0.0.1:9', 'db', 't', 'u', 'p')",
    mongodb:
      "SELECT * FROM mongodb('127.0.0.1:9', 'db', 't', 'u', 'p', 'a String')",
    redis: "SELECT * FROM redis('127.0.0.1:9', 'k', 'k String, v String')",
    sqlite: "SELECT * FROM sqlite('data.db', 't')",
    jdbc: "SELECT * FROM jdbc('jdbc:mysql://127.0.0.1:9/', 'db', 't')",
    odbc: "SELECT * FROM odbc('DSN=x', 'db', 't')",
    executable:
      "SELECT * FROM executable('cat /etc/passwd', 'LineAsString', 'a String')",
    input: "SELECT * FROM input('a String')",
    azureBlobStorage:
      "SELECT * FROM azureBlobStorage('http://127.0.0.1:9/', 'c', 'k.csv', 'CSV', 'a String')",
    azureBlobStorageCluster:
      "SELECT * FROM azureBlobStorageCluster('default', 'http://127.0.0.1:9/', 'c', 'k.csv', 'CSV', 'a String')",
    deltaLake: "SELECT * FROM deltaLake('http://127.0.0.1:9/bucket/t/')",
    deltaLakeS3: "SELECT * FROM deltaLakeS3('http://127.0.0.1:9/bucket/t/')",
    deltaLakeAzure:
      "SELECT * FROM deltaLakeAzure('http://127.0.0.1:9/', 'c', 'p')",
    deltaLakeLocal: "SELECT * FROM deltaLakeLocal('/var/lib/clickhouse/')",
    deltaLakeCluster:
      "SELECT * FROM deltaLakeCluster('default', 'http://127.0.0.1:9/bucket/t/')",
    deltaLakeS3Cluster:
      "SELECT * FROM deltaLakeS3Cluster('default', 'http://127.0.0.1:9/bucket/t/')",
    deltaLakeAzureCluster:
      "SELECT * FROM deltaLakeAzureCluster('default', 'http://127.0.0.1:9/', 'c', 'p')",
    iceberg: "SELECT * FROM iceberg('http://127.0.0.1:9/bucket/t/')",
    icebergS3: "SELECT * FROM icebergS3('http://127.0.0.1:9/bucket/t/')",
    icebergAzure: "SELECT * FROM icebergAzure('http://127.0.0.1:9/', 'c', 'p')",
    icebergHDFS: "SELECT * FROM icebergHDFS('hdfs://127.0.0.1:9/t/')",
    icebergLocal: "SELECT * FROM icebergLocal('/var/lib/clickhouse/')",
    icebergCluster:
      "SELECT * FROM icebergCluster('default', 'http://127.0.0.1:9/bucket/t/')",
    icebergS3Cluster:
      "SELECT * FROM icebergS3Cluster('default', 'http://127.0.0.1:9/bucket/t/')",
    icebergAzureCluster:
      "SELECT * FROM icebergAzureCluster('default', 'http://127.0.0.1:9/', 'c', 'p')",
    icebergHDFSCluster:
      "SELECT * FROM icebergHDFSCluster('default', 'hdfs://127.0.0.1:9/t/')",
    icebergLocalCluster:
      "SELECT * FROM icebergLocalCluster('default', '/var/lib/clickhouse/')",
    hudi: "SELECT * FROM hudi('http://127.0.0.1:9/bucket/t/')",
    hudiCluster:
      "SELECT * FROM hudiCluster('default', 'http://127.0.0.1:9/bucket/t/')",
    paimon: "SELECT * FROM paimon('http://127.0.0.1:9/bucket/t/')",
    paimonS3: "SELECT * FROM paimonS3('http://127.0.0.1:9/bucket/t/')",
    paimonAzure: "SELECT * FROM paimonAzure('http://127.0.0.1:9/', 'c', 'p')",
    paimonHDFS: "SELECT * FROM paimonHDFS('hdfs://127.0.0.1:9/t/')",
    paimonLocal: "SELECT * FROM paimonLocal('/var/lib/clickhouse/')",
    paimonCluster:
      "SELECT * FROM paimonCluster('default', 'http://127.0.0.1:9/bucket/t/')",
    paimonS3Cluster:
      "SELECT * FROM paimonS3Cluster('default', 'http://127.0.0.1:9/bucket/t/')",
    paimonAzureCluster:
      "SELECT * FROM paimonAzureCluster('default', 'http://127.0.0.1:9/', 'c', 'p')",
    paimonHDFSCluster:
      "SELECT * FROM paimonHDFSCluster('default', 'hdfs://127.0.0.1:9/t/')",
    hive: "SELECT * FROM hive('thrift://127.0.0.1:9', 'db', 't', 'a String', 'a')",
    bigquery: "SELECT * FROM bigquery('p', 'd', 't', 'token')",
    arrowFlight: "SELECT * FROM arrowFlight('127.0.0.1:9', 'd')",
    arrowflight: "SELECT * FROM arrowflight('127.0.0.1:9', 'd')",
    ytsaurus:
      "SELECT * FROM ytsaurus('http://127.0.0.1:9', '//t', 'token', 'JSONEachRow')",
    dictionary: `SELECT * FROM dictionary('${other}.d')`,
    merge: `SELECT * FROM merge('${other}', '.*')`,
    view: "SELECT * FROM view(SELECT * FROM system.users)",
    viewExplain: `SELECT * FROM viewExplain('EXPLAIN', '', (SELECT * FROM ${other}.p))`,
    loop: `SELECT * FROM loop(${other}.p) LIMIT 1`,
    mergeTreeIndex: `SELECT * FROM mergeTreeIndex('${other}', 'p')`,
    mergeTreeProjection: `SELECT * FROM mergeTreeProjection('${other}', 'p', 'by_b')`,
    mergeTreeTextIndex: `SELECT * FROM mergeTreeTextIndex('${other}', 'p', 'i')`,
    mergeTreeAnalyzeIndexes: `SELECT * FROM mergeTreeAnalyzeIndexes('${other}', 'p')`,
    mergeTreeCodecBlockCounts: `SELECT * FROM mergeTreeCodecBlockCounts('${other}', 'p')`,
    timeSeriesData: `SELECT * FROM timeSeriesData('${other}', 'ts')`,
    timeSeriesTags: `SELECT * FROM timeSeriesTags('${other}', 'ts')`,
    timeSeriesMetrics: `SELECT * FROM timeSeriesMetrics('${other}', 'ts')`,
    timeSeriesSamples: `SELECT * FROM timeSeriesSamples('${other}', 'ts')`,
    timeSeriesSelector: `SELECT * FROM timeSeriesSelector('${other}', 'ts', 'up', now() - 100, now())`,
    prometheusQuery: `SELECT * FROM prometheusQuery('${other}', 'ts', 'up', now())`,
    prometheusQueryRange: `SELECT * FROM prometheusQueryRange('${other}', 'ts', 'up', now() - 100, now(), 10)`,
    eval: "SELECT * FROM eval('SELECT * FROM system.users')",
  };
};

/** The table functions that read nothing outside the query: they make their rows from their arguments. */
const local = [
  "SQLStandardValues",
  "format",
  "fuzzJSON",
  "fuzzQuery",
  "generateRandom",
  "generateSeries",
  "generate_series",
  "mergeTreeAnalyzeIndexesUUID",
  "null",
  "numbers",
  "numbers_mt",
  "primes",
  "values",
  "viewIfPermitted",
  "zeros",
  "zeros_mt",
];

/**
 * The `system` tables ClickHouse lets every user read, and what they hold:
 * the server's catalogues of functions, formats, engines, settings and the
 * like, and the user's own settings, roles, quota and queries; and the
 * databases, tables and columns it may read.
 */
const readableSystemTables = [
  "aggregate_function_combinators",
  "collations",
  "columns",
  "completions",
  "contributors",
  "current_roles",
  "data_type_families",
  "database_engines",
  "databases",
  "dictionary_layouts",
  "disk_types",
  "enabled_roles",
  "formats",
  "functions",
  "licenses",
  "one",
  "privileges",
  "quota_usage",
  "settings",
  "table_engines",
  "table_functions",
  "tables",
  "time_zones",
  "user_query_log",
];

/**
 * Answers around both caps: row counts around 5,000 and far past it, rows of
 * generated lengths around 16 MiB, one row of 100 MB and a cross join, each
 * with what the caps keep of it.
 */
const aroundTheCaps = Effect.gen(function* () {
  const counts = yield* Arbitrary.sampleEffect(
    Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ minimum: 4990, maximum: 5010 })),
    ),
    { count: 6 },
  ).pipe(Effect.orDie);
  const cases: Array<{
    readonly query: string;
    readonly rows: number;
    readonly truncated: boolean;
    readonly inOrder: boolean;
    readonly fit: number;
    readonly more: boolean;
  }> = [];
  for (const count of [0, 1, 4999, 5000, 5001, 1_000_000, ...counts]) {
    const query = `SELECT number FROM numbers(${count})`;
    const answer = answerOf(yield* post(query));
    const fit = Math.min(count, Sql.defaults.rows);
    const numbers = answer.rows.map(([number]) => number);
    cases.push({
      query,
      rows: answer.rows.length,
      truncated: answer.truncated,
      inOrder:
        JSON.stringify(numbers) ===
        JSON.stringify(Array.from({ length: fit }, (_, at) => String(at))),
      fit,
      more: count > fit,
    });
  }

  // Each row of k x's is a line of k + 4 bytes: ["x…x"].
  const lengths = yield* Arbitrary.sampleEffect(
    Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ minimum: 1000, maximum: 200_000 })),
    ),
    { count: 6 },
  ).pipe(Effect.orDie);
  for (const [length, count] of [
    [4092, 4096],
    [4092, 4097],
    [3000, 5000],
    ...lengths.map((length) => [length, 5000] as const),
  ] as const) {
    const query = `SELECT repeat('x', ${length}) FROM numbers(${count})`;
    const answer = answerOf(yield* post(query));
    const fit = Math.min(
      count,
      Sql.defaults.rows,
      Math.floor(Sql.defaults.rowBytes / (length + 4)),
    );
    cases.push({
      query,
      rows: answer.rows.length,
      truncated: answer.truncated,
      inOrder: true,
      fit,
      more: count > fit,
    });
  }

  // One row of 100 MB: ClickHouse repeats a string at most a million times.
  for (const [query, fit] of [
    ["SELECT repeat(repeat('x', 1000), 100000) AS x", 0],
    [
      "SELECT a.number, b.number FROM numbers(1000000) AS a, numbers(1000000) AS b",
      Sql.defaults.rows,
    ],
  ] as const) {
    const answer = answerOf(yield* post(query));
    cases.push({
      query,
      rows: answer.rows.length,
      truncated: answer.truncated,
      inOrder: true,
      fit,
      more: true,
    });
  }
  return cases;
});

layer(hub, { timeout: "60 seconds" })("SQL in ClickHouse", (it) => {
  it.effect(
    "X1: no text sent to POST /api/sql changes any table, user, setting or grant: each is refused or does nothing, and the database reads the same",
    () =>
      Effect.gen(function* () {
        const database = yield* databaseOf;
        const other = `${database}_other`;
        // The hub makes the SQL user as it starts: wait until it has.
        expect((yield* post("SELECT 1")).status).toBe(200);
        const before = yield* everything;
        const texts = yield* Arbitrary.sampleEffect(changes(database), {
          count: 120,
        }).pipe(Effect.orDie);
        const answers: Array<string> = [];
        for (const text of texts) {
          const answered = yield* post(text);
          // A global SYSTEM STOP covers only the tables the user may stop,
          // none, and SET ROLE ALL enables no role, as the SQL user has none:
          // ClickHouse answers both with nothing.
          const nothing =
            answered.status === 200 &&
            JSON.stringify(answerOf(answered).columns) === "[]";
          if (
            !nothing &&
            (answered.status !== 400 ||
              answered.type !== "urn:cota:query-failed")
          ) {
            answers.push(
              `${text} => ${answered.status} ${answered.type} ${answered.detail}`,
            );
          }
        }

        expect(answers).toEqual([]);
        expect(yield* everything).toEqual(before);
        expect(
          answerOf(yield* post("SELECT title FROM session_titles")).rows,
        ).toEqual([["Fix the relay"]]);

        // Merges still run after every SYSTEM STOP the SQL user sent.
        for (const sql of [
          `CREATE TABLE ${other}.merged (a UInt8) ENGINE = MergeTree ORDER BY a`,
          `INSERT INTO ${other}.merged VALUES (1)`,
          `INSERT INTO ${other}.merged VALUES (2)`,
          `OPTIMIZE TABLE ${other}.merged FINAL`,
        ]) {
          yield* commandAsHub(sql);
        }
        expect(
          yield* asHub(
            `SELECT count() AS parts FROM system.parts WHERE database = {database:String} AND table = 'merged' AND active`,
            { database: Param.string(other) },
          ),
        ).toEqual([{ parts: "1" }]);
      }),
    120_000,
  );

  it.effect(
    "X2: a query cannot change a setting, by SETTINGS, by SET or in the URL it cannot reach, and the profile's values hold for it",
    () =>
      Effect.gen(function* () {
        const refusals: Array<string> = [];
        for (const [name, other] of [
          ["readonly", "0"],
          ["readonly", "2"],
          ["max_execution_time", "3600"],
          ["max_execution_time", "0"],
          ["max_memory_usage", "0"],
          ["max_threads", "64"],
          ["max_concurrent_queries_for_user", "0"],
          ["max_result_rows", "0"],
          ["max_result_rows", "1000000"],
          ["result_overflow_mode", "'throw'"],
          ["cancel_http_readonly_queries_on_client_close", "0"],
          ["output_format_json_quote_64bit_integers", "0"],
          ["output_format_json_quote_decimals", "0"],
          ["output_format_decimal_trailing_zeros", "0"],
          ["date_time_output_format", "'simple'"],
          ["max_result_bytes", "1"],
          ["max_block_size", "10"],
          ["timeout_overflow_mode", "'break'"],
          ["enable_http_compression", "0"],
          ["send_progress_in_http_headers", "1"],
          ["allow_experimental_eval_table_function", "1"],
          ["allow_get_client_http_header", "1"],
          ["allow_introspection_functions", "1"],
          ["allow_ddl", "0"],
        ] as const) {
          for (const text of [
            `SELECT 1 SETTINGS ${name} = ${other}`,
            `SELECT * FROM numbers(10) SETTINGS ${name} = ${other}`,
            `SET ${name} = ${other}`,
          ]) {
            refusals.push(refusalOf(yield* post(text)));
          }
        }
        expect(new Set(refusals)).toEqual(
          new Set(["400 query-failed READONLY"]),
        );

        const settings = yield* post(
          `SELECT name, value FROM system.settings WHERE name IN (${ClickHouseSqlConsole.profileOf(
            Sql.defaults,
          )
            .map(([name]) => `'${name}'`)
            .join(", ")}) ORDER BY name`,
        );
        expect(answerOf(settings).rows).toEqual(
          [...ClickHouseSqlConsole.profileOf(Sql.defaults)]
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([name, value]) => [name, value]),
        );

        const changed = yield* post(
          "SELECT name FROM system.settings WHERE changed ORDER BY name",
        );
        expect(answerOf(changed).rows.flat()).toEqual(
          [
            ...ClickHouseSqlConsole.profileOf(Sql.defaults).map(
              ([name]) => name,
            ),
            "database",
            "default_format",
          ].sort(),
        );

        const fromTheUrl = yield* post(
          "SELECT getSetting('readonly'), getSetting('max_result_rows'), number FROM numbers(100000)",
          "/api/sql?readonly=0&max_result_rows=1000000&default_format=CSV&param_x=1&enable_http_compression=1",
        );
        const answer = answerOf(fromTheUrl);
        expect([answer.rows.length, answer.truncated, answer.rows[0]]).toEqual([
          Sql.defaults.rows,
          true,
          // getSetting answers in the smallest type that holds the value.
          [1, 5001, "0"],
        ]);
        expect(refusalOf(yield* post("SELECT {x:String}"))).toBe(
          "400 query-failed UNKNOWN_QUERY_PARAMETER",
        );
      }),
    60_000,
  );

  it.effect(
    "X2: a query stops at 30 seconds and at 4 GB of memory, as ClickHouse says, without its version",
    () =>
      Effect.gen(function* () {
        const memory = yield* post(
          "SELECT length(groupArray(number)) FROM numbers(10000000000)",
        );
        expect(refusalOf(memory)).toBe(
          "400 query-failed MEMORY_LIMIT_EXCEEDED",
        );
        expect(memory.detail).toMatch(/maximum: 3\.73 GiB/);

        const spinning = yield* post(
          "SELECT count() FROM numbers(100000000000000)",
        );
        expect(refusalOf(spinning)).toBe("400 query-failed TIMEOUT_EXCEEDED");
        expect(spinning.detail).toMatch(
          /^Code: 159\. DB::Exception: Timeout exceeded: elapsed [\d.]+ ms, maximum: 30000(\.000)? ms(: While executing \w+)?\. \(TIMEOUT_EXCEEDED\)$/,
        );
        expect(yield* nothingRunning).toBe(true);
      }),
    90_000,
  );

  it.effect(
    "X3: a query that reads another database or a system table beyond the harmless ones, or reaches outside the database, is refused",
    () =>
      Effect.gen(function* () {
        const database = yield* databaseOf;
        const other = `${database}_other`;
        const calls = outside(database);
        const functions = (yield* asHub(
          "SELECT name FROM system.table_functions ORDER BY name",
        )).map(({ name }) => String(name));
        expect(
          functions.filter((name) => !(name in calls) && !local.includes(name)),
        ).toEqual([]);

        const reached: Array<string> = [];
        for (const [name, call] of Object.entries(calls)) {
          const answered = yield* post(call);
          if (
            answered.status !== 400 ||
            answered.type !== "urn:cota:query-failed"
          ) {
            reached.push(
              `${name}: ${answered.status} ${JSON.stringify(answered.body)}`,
            );
          }
        }
        for (const text of [
          `SELECT * FROM ${other}.p`,
          `SELECT * FROM ${other}.d`,
          `SELECT joinGet('${other}.j', 'v', toUInt64(1))`,
          `SELECT dictGet('${other}.d', 'v', toUInt64(1))`,
          `SELECT hasColumnInTable('${other}', 'p', 'a')`,
          `SHOW CREATE TABLE ${other}.p`,
          `DESCRIBE ${other}.p`,
          `EXISTS ${other}.p`,
          `USE ${other}`,
          "SELECT file('data.csv')",
          "SELECT getClientHTTPHeader('authorization')",
          "SELECT 1 INTO OUTFILE 'out.csv'",
          "SHOW USERS",
          `SHOW CREATE USER ${ClickHouseSqlConsole.sqlUserOf(database)}`,
          "SHOW ACCESS",
          "SHOW PROCESSLIST",
          "SHOW SETTINGS PROFILES",
          "SHOW QUOTAS",
          "SHOW CLUSTERS",
        ]) {
          const answered = yield* post(text);
          if (
            answered.status !== 400 ||
            answered.type !== "urn:cota:query-failed"
          ) {
            reached.push(
              `${text}: ${answered.status} ${JSON.stringify(answered.body)}`,
            );
          }
        }
        expect(reached).toEqual([]);

        const systemTables = (yield* asHub(
          "SELECT name FROM system.tables WHERE database = 'system' ORDER BY name",
        )).map(({ name }) => String(name));
        const readable: Array<string> = [];
        for (const table of systemTables) {
          if (
            (yield* post(`SELECT count() FROM system.\`${table}\``)).status ===
            200
          ) {
            readable.push(table);
          }
        }
        expect(readable).toEqual(readableSystemTables);

        // The queries above reach user_query_log once ClickHouse flushes it.
        yield* commandAsHub("SYSTEM FLUSH LOGS");
        const seen = yield* post(
          `SELECT
             (SELECT groupUniqArray(database) FROM system.tables),
             (SELECT groupUniqArray(database) FROM system.columns),
             (SELECT groupArray(name) FROM system.databases),
             (SELECT groupUniqArray(word) FROM system.completions WHERE context = 'database'),
             (SELECT groupUniqArray(user) FROM system.user_query_log),
             (SELECT count() FROM system.functions WHERE origin != 'System')`,
        );
        expect(seen.status, seen.detail).toBe(200);
        expect(answerOf(seen).rows).toEqual([
          [
            [database],
            [database],
            [database],
            [database],
            [ClickHouseSqlConsole.sqlUserOf(database)],
            "0",
          ],
        ]);
      }),
    120_000,
  );

  it.effect(
    "X4: an answer holds at most 5,000 rows and 16 MiB of them, the first rows of the query's",
    () =>
      Effect.gen(function* () {
        const cases = yield* aroundTheCaps;
        expect(
          cases.map(
            ({ query, rows, inOrder }) => `${query}: ${rows} ${inOrder}`,
          ),
        ).toEqual(cases.map(({ query, fit }) => `${query}: ${fit} true`));
        expect(yield* nothingRunning).toBe(true);
      }),
    120_000,
  );

  it.effect(
    "X5: an answer is truncated exactly when the query had more rows than it holds",
    () =>
      Effect.gen(function* () {
        const cases = yield* aroundTheCaps;
        expect(
          cases.map(({ query, truncated }) => `${query}: ${truncated}`),
        ).toEqual(cases.map(({ query, more }) => `${query}: ${more}`));
        expect(yield* nothingRunning).toBe(true);
      }),
    120_000,
  );

  it.effect(
    "has ClickHouse hold the SQL user's answer until it is longer than the hub reads, or the query ends",
    () =>
      Effect.gen(function* () {
        const answer = answerOf(
          yield* post("SELECT getSetting('http_response_buffer_size')"),
        );

        // 3 times 16 MiB and 1 MiB more, as a number: over 2^32 it would be a string.
        expect(answer.rows).toEqual([[51_380_224]]);
      }),
  );

  it.effect(
    "answers a query that fails after its first rows as query-failed, with ClickHouse's message alone",
    () =>
      Effect.gen(function* () {
        // 3,500 rows of 2 KB, under the caps, then a row a second later that
        // fails. The profile's buffer makes this an HTTP error; without it,
        // ClickHouse would have sent the rows by then and framed the failure.
        const failed = yield* post(
          "SELECT number, repeat('x', 2000), throwIf(number = 70000 AND sleep(1) = 0) FROM numbers(70001) WHERE number % 20 = 0",
        );
        expect([failed.status, failed.type], failed.detail).toEqual([
          400,
          "urn:cota:query-failed",
        ]);
        expect(failed.detail).toMatch(
          /^Code: 395\. DB::Exception: .* \(FUNCTION_THROW_IF_VALUE_IS_NON_ZERO\)$/s,
        );
      }),
  );

  it.effect(
    "answers a query that names its own format as format-not-allowed, and one that names the hub's own as any other",
    () =>
      Effect.gen(function* () {
        const refused: Array<string> = [];
        for (const format of [
          "CSV",
          "JSON",
          "Native",
          "Parquet",
          "JSONEachRow",
        ]) {
          const answered = yield* post(`SELECT 1 AS one FORMAT ${format}`);
          refused.push(
            `${answered.status} ${answered.type} ${answered.detail}`,
          );
        }
        expect(refused).toEqual(
          ["CSV", "JSON", "Native", "Parquet", "JSONEachRow"].map(
            (format) =>
              `400 urn:cota:format-not-allowed ClickHouse answered in ${format}; remove the query's FORMAT clause, and the hub reads the answer as JSON.`,
          ),
        );
        expect(
          answerOf(
            yield* post(
              "SELECT 1 AS one FORMAT JSONCompactEachRowWithNamesAndTypes",
            ),
          ),
        ).toMatchObject({
          columns: [{ name: "one", type: "UInt8" }],
          rows: [[1]],
        });
      }),
  );

  it.effect(
    "runs at most four of the SQL user's queries at once, refusing a fifth, and stops a query whose caller leaves",
    () =>
      Effect.gen(function* () {
        const spinning = "SELECT count() FROM numbers(100000000000000)";
        const callers = yield* Effect.forEach([1, 2, 3, 4], () =>
          Effect.forkChild(leavable(spinning)),
        );
        for (let attempt = 0; attempt < 50; attempt++) {
          if ((yield* runningNow) === 4) break;
          yield* Effect.promise(() => Bun.sleep(100));
        }
        expect(yield* runningNow).toBe(4);
        expect(refusalOf(yield* post(spinning))).toBe(
          "400 query-failed TOO_MANY_SIMULTANEOUS_QUERIES",
        );
        yield* Fiber.interruptAll(callers);
        expect(yield* nothingRunning).toBe(true);
        expect(answerOf(yield* post("SELECT 1 AS one")).rows).toEqual([[1]]);
      }),
    60_000,
  );

  it.effect(
    "answers the schema from what the SQL user reads in system.tables and system.columns",
    () =>
      Effect.gen(function* () {
        const database = yield* databaseOf;
        const tables = yield* asHub(
          "SELECT name, engine, total_rows, total_bytes, comment FROM system.tables WHERE database = {database:String} ORDER BY name",
          { database: Param.string(database) },
        );
        const columns = yield* asHub(
          "SELECT table, name, type, comment FROM system.columns WHERE database = {database:String} ORDER BY table, position",
          { database: Param.string(database) },
        );
        const response = yield* Harness.send("/api/schema", {
          headers: reader,
        });
        expect(response.status).toBe(200);

        expect(JSON.parse(yield* Harness.textOf(response))).toEqual({
          database,
          tables: tables.map((table) => ({
            name: table.name,
            engine: table.engine,
            rows: table.total_rows === null ? null : Number(table.total_rows),
            bytes:
              table.total_bytes === null ? null : Number(table.total_bytes),
            comment: table.comment,
            columns: columns
              .filter((column) => column.table === table.name)
              .map(({ name, type, comment }) => ({ name, type, comment })),
          })),
        });
        expect(tables.map(({ name }) => name)).toEqual([
          "items",
          "request_items",
          "requests",
          "session_titles",
          "words",
          "words_writer",
        ]);
      }),
  );
});

const small: Sql.Limits = {
  ...Sql.defaults,
  queryTime: Duration.seconds(2),
  rows: 10,
  rowBytes: 1024 * 1024,
};

layer(hubWith(small), { timeout: "60 seconds" })(
  "SQL in ClickHouse, with limits of the owner's",
  (it) => {
    it.effect(
      "with limits of 2 seconds, 10 rows and 1 MiB, stops a query at 2 seconds, and truncates an answer past 10 rows or past 1 MiB",
      () =>
        Effect.gen(function* () {
          const held: Array<string> = [];
          // Each row of 262,140 x's is a line of 256 KiB: four fill 1 MiB.
          for (const query of [
            "SELECT number FROM numbers(10)",
            "SELECT number FROM numbers(11)",
            "SELECT repeat('x', 262140) FROM numbers(4)",
            "SELECT repeat('x', 262140) FROM numbers(5)",
          ]) {
            const answer = answerOf(yield* post(query));
            held.push(`${query}: ${answer.rows.length} ${answer.truncated}`);
          }
          expect(held).toEqual([
            "SELECT number FROM numbers(10): 10 false",
            "SELECT number FROM numbers(11): 10 true",
            "SELECT repeat('x', 262140) FROM numbers(4): 4 false",
            "SELECT repeat('x', 262140) FROM numbers(5): 4 true",
          ]);

          const spinning = yield* post(
            "SELECT count() FROM numbers(100000000000000)",
          );
          expect(refusalOf(spinning)).toBe("400 query-failed TIMEOUT_EXCEEDED");
          expect(spinning.detail).toMatch(/maximum: 2000(\.000)? ms/);
          expect(yield* nothingRunning).toBe(true);
        }),
    );
  },
);

/** The profile's settings that follow the limits, as the SQL user reads them. */
const limitedSettings = (limits: Sql.Limits) =>
  Effect.gen(function* () {
    const console = yield* SqlConsole;
    const answer = yield* console.run(
      `SELECT name, value FROM system.settings WHERE name IN ('max_execution_time', 'max_memory_usage', 'max_threads', 'max_concurrent_queries_for_user', 'max_result_rows', 'http_response_buffer_size') ORDER BY name`,
    );
    return Object.fromEntries(
      answer.rows.map(([name, value]) => [name, value]),
    );
  }).pipe(Effect.provide(Layer.unwrap(consoleWith(limits))), Effect.orDie);

layer(scratch.pipe(Layer.provideMerge(Layer.fresh(Scratch.layer))), {
  timeout: "60 seconds",
})("SQL in ClickHouse, started again with other limits", (it) => {
  it.effect(
    "gives the SQL user the limits of the latest start, over a profile an earlier start made",
    () =>
      Effect.gen(function* () {
        const first = yield* limitedSettings(Sql.defaults);
        const second = yield* limitedSettings({
          queryTime: Duration.seconds(7),
          memoryBytes: 1_000_000_000,
          threads: 2,
          concurrentQueries: 3,
          rows: 100,
          rowBytes: 2 * 1024 * 1024,
        });
        expect([first, second]).toEqual([
          {
            http_response_buffer_size: "51380224",
            max_concurrent_queries_for_user: "4",
            max_execution_time: "30",
            max_memory_usage: "4000000000",
            max_result_rows: "5001",
            max_threads: "4",
          },
          {
            http_response_buffer_size: "7340032",
            max_concurrent_queries_for_user: "3",
            max_execution_time: "7",
            max_memory_usage: "1000000000",
            max_result_rows: "101",
            max_threads: "2",
          },
        ]);
      }),
  );
});

const halfUserOf = (database: string) => `${database}_half`;
const halfPasswordOf = (database: string) =>
  Redacted.make(`half-${database.slice(-12)}`);

/**
 * A hub whose ClickHouse user owns the scratch database and may make settings
 * profiles, but not users: the request log's tables are made, the SQL user
 * cannot be.
 */
const halfHub = Layer.unwrap(
  Effect.gen(function* () {
    const clickHouse = yield* ClickHouse.ClickHouse;
    const database = yield* databaseOf;
    const half = halfUserOf(database);
    const sqlUser = ClickHouseSqlConsole.sqlUserOf(database);
    yield* Effect.acquireRelease(
      Effect.forEach(
        [
          `CREATE USER ${half} IDENTIFIED BY '${Redacted.value(halfPasswordOf(database))}'`,
          `GRANT ALL ON ${database}.* TO ${half}`,
          `GRANT SELECT ON system.data_skipping_indices TO ${half}`,
          `GRANT CREATE SETTINGS PROFILE, ALTER SETTINGS PROFILE ON *.* TO ${half}`,
        ],
        commandAsHub,
      ),
      () =>
        Effect.forEach(
          [
            `DROP USER IF EXISTS ${half}`,
            `DROP USER IF EXISTS ${sqlUser}`,
            `DROP SETTINGS PROFILE IF EXISTS ${sqlUser}`,
          ],
          (sql) => Effect.ignore(tryAsHub(sql)),
        ),
    );
    const asHalf = clickHouse.as(half, halfPasswordOf(database));
    yield* Tables.prepare().pipe(
      Effect.provideService(ClickHouse.ClickHouse, asHalf),
      Effect.orDie,
    );
    const live = yield* TestClock.withLive(Clock.clockWith(Effect.succeed));
    return Harness.layerWithSqlConsole(
      ClickHouseSqlConsole.layer(Sql.defaults).pipe(
        Layer.provide([
          Layer.succeed(ClickHouse.ClickHouse, asHalf),
          Layer.succeed(Clock.Clock, live),
        ]),
      ),
    );
  }),
).pipe(Layer.provideMerge(Layer.fresh(Scratch.layer)));

layer(halfHub, { timeout: "60 seconds" })(
  "SQL in ClickHouse, when the hub's user may not make users",
  (it) => {
    it.effect(
      "X6: both endpoints answer 503 saying why, the request log's tables are made, and the password is in no answer, log or ClickHouse log",
      () =>
        Effect.gen(function* () {
          const database = yield* databaseOf;
          const sqlUser = ClickHouseSqlConsole.sqlUserOf(database);
          const detail = `The hub's ClickHouse user could not create the user ${sqlUser}; it needs access management (ClickHouse error 497).`;

          const posted = yield* post("SELECT 1");
          expect([posted.status, posted.type, posted.detail]).toEqual([
            503,
            "urn:cota:sql-unavailable",
            detail,
          ]);
          const schema = yield* Harness.send("/api/schema", {
            headers: reader,
          });
          expect([
            schema.status,
            JSON.parse(yield* Harness.textOf(schema)).detail,
          ]).toEqual([503, detail]);
          expect(
            (yield* asHub(
              "SELECT name FROM system.tables WHERE database = {database:String} ORDER BY name",
              { database: Param.string(database) },
            )).map(({ name }) => name),
          ).toEqual([
            "items",
            "request_items",
            "requests",
            "session_titles",
            "words",
            "words_writer",
          ]);
          expect(
            yield* asHub(
              "SELECT name FROM system.users WHERE name = {user:String}",
              {
                user: Param.string(sqlUser),
              },
            ),
          ).toEqual([]);

          const known = `known-${Bun.randomUUIDv7("hex")}`;
          const clickHouse = yield* ClickHouse.ClickHouse;
          const failure = yield* ClickHouseSqlConsole.prepare(
            clickHouse.as(halfUserOf(database), halfPasswordOf(database)),
            Redacted.make(known),
            Sql.defaults,
          ).pipe(Effect.flip);
          expect(failure).toMatchObject({ reachable: true, detail });
          expect(failure.said).toMatch(/ACCESS_DENIED/);
          expect(JSON.stringify(failure)).not.toContain(known);

          const lines = (yield* Harness.Logs).lines();
          expect(
            lines.filter((line) => line.includes("SQL is unavailable")),
          ).toHaveLength(1);
          expect(lines.filter((line) => /[0-9a-f]{64}/.test(line))).toEqual([]);

          yield* commandAsHub("SYSTEM FLUSH LOGS");
          const knownInHex = Buffer.from(known).toString("hex");
          expect(
            yield* asHub(
              `SELECT
                 (SELECT count() FROM system.query_log
                   WHERE user = {half:String}
                     AND (match(query, '[0-9a-f]{64}') OR position(query, unhex('${knownInHex}')) > 0
                       OR position(exception, unhex('${knownInHex}')) > 0)) AS queries,
                 (SELECT count() FROM system.query_log
                   WHERE user = {half:String} AND query LIKE 'CREATE USER%') AS creates,
                 (SELECT count() FROM system.text_log
                   WHERE position(message, unhex('${knownInHex}')) > 0) AS logged`,
              { half: Param.string(halfUserOf(database)) },
            ),
          ).toEqual([{ queries: "0", creates: "2", logged: "0" }]);
        }),
    );
  },
);
