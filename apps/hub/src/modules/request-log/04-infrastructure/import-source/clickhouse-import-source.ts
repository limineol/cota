import { DateTime, Effect, Layer, Option, Schema } from "effect";
import { HttpClient } from "effect/http";
import {
  type Counted,
  ImportSource,
  ImportSourceFailed,
  type PageKeys,
  type Range,
} from "#modules/request-log/02-application/interfaces/import-source.ts";
import * as Archive from "#modules/request-log/03-domain/archive.ts";
import type * as Import from "#modules/request-log/03-domain/import.ts";
import * as ClickHouse from "#modules/request-log/04-infrastructure/persistence/clickhouse/client.ts";
import { Param } from "#modules/request-log/04-infrastructure/persistence/clickhouse/client.ts";

/** The source's ClickHouse, and the databases of Bifrost's log and of the prototype's tables. */
export interface SourceConnection extends ClickHouse.Connection {
  readonly bifrostDatabase: string;
  readonly hubDatabase: string;
}

const text = new Set([
  "String",
  "LowCardinality(String)",
  "Nullable(String)",
  "LowCardinality(Nullable(String))",
]);
const time = new Set(["DateTime64(3)", "DateTime64(3, 'UTC')"]);
const exactly = (type: string) => new Set([type]);

// `docs/specs/import/spec.md`, the columns check.
const wanted: Readonly<
  Record<
    "logs" | "messages" | "request_items",
    Readonly<Record<string, ReadonlySet<string>>>
  >
> = {
  logs: {
    id: new Set([...text, "UUID"]),
    timestamp: time,
    session_id: exactly("Nullable(String)"),
    metadata: exactly("Nullable(String)"),
    user_agent: exactly("Nullable(String)"),
    provider: text,
    model: text,
    object_type: text,
    params: exactly("String"),
    status: exactly("String"),
    stream: exactly("Bool"),
    stop_reason: text,
    prompt_tokens: exactly("Int64"),
    completion_tokens: exactly("Int64"),
    cached_read_tokens: exactly("Int64"),
    token_usage: exactly("String"),
    cost: exactly("Nullable(Float64)"),
    latency: exactly("Nullable(Float64)"),
    error_details: exactly("String"),
  },
  messages: {
    session_key: exactly("String"),
    hash: exactly("UInt64"),
    first_seen: time,
    request_id: exactly("String"),
    source: exactly("LowCardinality(String)"),
    position: exactly("UInt32"),
    content: exactly("String"),
  },
  request_items: {
    request_id: exactly("String"),
    session_key: exactly("String"),
    timestamp: time,
    input: exactly("Array(UInt64)"),
    output: exactly("Array(UInt64)"),
    tools: exactly("Array(UInt64)"),
  },
};

const Count = Schema.FiniteFromString.check(Schema.isInt());
const Millis = Schema.FiniteFromString.check(Schema.isInt());
const Hashes = Schema.Array(Schema.String);

const ColumnRow = Schema.Struct({
  table: Schema.String,
  name: Schema.String,
  type: Schema.String,
});
const CountedRow = Schema.Struct({ value: Schema.String, rows: Count });
const ProviderRow = Schema.Struct({
  pool: Schema.String,
  provider: Schema.String,
  rows: Count,
});
const DayRow = Schema.Struct({ day: Archive.Day });
const RequestsSummaryRow = Schema.Struct({
  rows: Count,
  fingerprint: Archive.Uint64,
});
const CountRow = Schema.Struct({ rows: Count });
const WeightRow = Schema.Struct({
  session_key: Schema.String,
  requests: Count,
  hashes: Count,
});
const RequestRow = Schema.Struct({
  id: Schema.String,
  started_ms: Millis,
  session: Schema.String,
  metadata: Schema.String,
  user_agent: Schema.String,
  provider: Schema.String,
  model: Schema.String,
  object_type: Schema.String,
  params: Schema.String,
  status: Schema.String,
  stream: Schema.Boolean,
  stop_reason: Schema.String,
  prompt_tokens: Count,
  completion_tokens: Count,
  cached_read_tokens: Count,
  token_usage: Schema.String,
  cost: Schema.NullOr(Schema.Number),
  latency: Schema.NullOr(Schema.Number),
  error_details: Schema.String,
});
const RequestItemsRow = Schema.Struct({
  request_id: Schema.String,
  session_key: Schema.String,
  started_ms: Millis,
  input: Hashes,
  output: Hashes,
  tools: Hashes,
});
const ListedRow = Schema.Struct({
  session_key: Schema.String,
  hash: Schema.String,
  seen_ms: Millis,
  request_id: Schema.String,
  source: Schema.String,
  position: Schema.Int,
  bytes: Count,
  logged: Schema.Boolean,
  sent_ms: Millis,
});
const NamingRow = Schema.Struct({
  session_key: Schema.String,
  hash: Schema.String,
  request_id: Schema.String,
  started_ms: Millis,
});
const ContentRow = Schema.Struct({
  session_key: Schema.String,
  hash: Schema.String,
  content: Schema.String,
});
const LatestRow = Schema.Struct({
  session: Schema.String,
  latest_ms: Millis,
});

const timeOf = (millis: number) => DateTime.makeUnsafe(millis);

const quoted = (name: string) => `\`${name}\``;

const pairOf = (item: { readonly sessionKey: string; readonly hash: string }) =>
  `${item.sessionKey}/${item.hash}`;

const failed = (error: { readonly message: string }) =>
  new ImportSourceFailed({ detail: error.message });

/** The import source over the prototype's ClickHouse (`docs/specs/import/spec.md`, What is read). */
export const layer = (
  connection: SourceConnection,
): Layer.Layer<ImportSource, never, HttpClient.HttpClient> =>
  Layer.effect(
    ImportSource,
    Effect.gen(function* () {
      const client = ClickHouse.connect(
        connection,
        yield* HttpClient.HttpClient,
      );
      const logs = `${quoted(connection.bifrostDatabase)}.logs`;
      const messages = `${quoted(connection.hubDatabase)}.messages`;
      const requestItems = `${quoted(connection.hubDatabase)}.request_items`;

      const sessionKey =
        "ifNull(nullIf(session_id, ''), concat('request:', toString(id)))";
      const metadataText = (key: string) =>
        `JSONExtractString(ifNull(metadata, ''), '${key}')`;
      const poolOf = `if(${metadataText("account")} = '', toString(ifNull(provider, '')), ${metadataText("account")})`;
      const dayOf = (column: string) => `toString(toDate(${column}, 'UTC'))`;
      const inRange = (column: string) =>
        `${dayOf(column)} >= {from:String} AND ${dayOf(column)} <= {to:String}`;
      const rangeParams = (range: Range) => ({
        from: Param.string(Option.getOrElse(range.from, () => "0000-00-00")),
        to: Param.string(Option.getOrElse(range.to, () => "9999-99-99")),
      });
      const requestsOfDay = `${dayOf("timestamp")} = {day:String}`;
      // A day's request items: those of its requests, and those of no request whose own time is on it.
      const requestItemsOfDay = `request_id IN (SELECT toString(id) FROM ${logs} FINAL WHERE ${requestsOfDay})
        OR (${requestsOfDay} AND request_id NOT IN (SELECT toString(id) FROM ${logs} FINAL))`;
      const itemsFirstSeenOnDay = `${dayOf("first_seen")} = {day:String}`;
      // ClickHouse refuses a parameter past its field limit (`ClickHouse.longestList`),
      // so a page is sent as its day and its first and last session key, and
      // the source finds the page's sessions and requests again from those.
      const inPage = (column: string) =>
        `${column} >= {firstSession:String} AND ${column} <= {lastSession:String}`;
      const pageSessions = `SELECT session_key FROM (
          SELECT ${sessionKey} AS session_key FROM ${logs} FINAL WHERE ${requestsOfDay}
          UNION ALL SELECT session_key FROM ${requestItems} FINAL WHERE ${requestItemsOfDay}
          UNION ALL SELECT session_key FROM ${messages} WHERE ${itemsFirstSeenOnDay}
        ) WHERE ${inPage("session_key")}`;
      // A request of the day is of one of the day's sessions.
      const requestsOfPage = `${requestsOfDay} AND ${inPage(sessionKey)}`;
      const pageRequestIds = `SELECT toString(id) FROM ${logs} FINAL WHERE ${requestsOfPage}`;
      // An item a page lists: first seen on its day, or named by its requests' rows.
      const listedOfPage = `toString(toDate(seen, 'UTC')) = {day:String}
        OR (session_key, hash) IN (
          SELECT session_key, arrayJoin(arrayConcat(tools, input, output))
          FROM ${requestItems} FINAL WHERE request_id IN (${pageRequestIds}))`;
      const pageParams = (page: PageKeys) => ({
        day: Param.string(page.day),
        firstSession: Param.string(page.first),
        lastSession: Param.string(page.last),
      });

      const counted = (sql: string, range: Range) =>
        client
          .select(sql, CountedRow, rangeParams(range))
          .pipe(
            Effect.map(
              (rows): Counted =>
                rows.map(({ value, rows: count }) => [value, count] as const),
            ),
          );

      const countedBy = (expression: string, range: Range) =>
        counted(
          `SELECT ${expression} AS value, toString(count()) AS rows FROM ${logs} FINAL
           WHERE ${inRange("timestamp")} GROUP BY value ORDER BY value`,
          range,
        );

      const pools = (range: Range) =>
        counted(
          `SELECT value, toString(count()) AS rows FROM (
             SELECT ${poolOf} AS value FROM ${logs} FINAL WHERE ${inRange("timestamp")}
             UNION ALL
             SELECT ${metadataText("fallback-from")} AS value FROM ${logs} FINAL
             WHERE ${inRange("timestamp")} AND ${metadataText("fallback-from")} != ''
           ) GROUP BY value ORDER BY value`,
          range,
        );

      return ImportSource.of({
        columnProblems: Effect.gen(function* () {
          const rows = yield* client.select(
            `SELECT table, name, type FROM system.columns
             WHERE (database = {bifrost:String} AND table = 'logs')
                OR (database = {hub:String} AND table IN ('messages', 'request_items'))`,
            ColumnRow,
            {
              bifrost: Param.string(connection.bifrostDatabase),
              hub: Param.string(connection.hubDatabase),
            },
          );
          const problems: Array<string> = [];
          for (const [table, columns] of Object.entries(wanted)) {
            const database =
              table === "logs"
                ? connection.bifrostDatabase
                : connection.hubDatabase;
            const own = rows.filter((row) => row.table === table);
            if (own.length === 0) {
              problems.push(`${database}.${table} is missing`);
              continue;
            }
            for (const [name, types] of Object.entries(columns)) {
              const found = own.find((row) => row.name === name);
              if (found === undefined) {
                problems.push(`${database}.${table} has no column ${name}`);
              } else if (!types.has(found.type)) {
                problems.push(
                  `${database}.${table}.${name} is ${found.type}, not ${[...types].join(" or ")}`,
                );
              }
            }
          }
          return problems;
        }).pipe(
          Effect.mapError(failed),
          Effect.withSpan("ClickHouseImportSource.columnProblems"),
        ),

        pools: (range) =>
          pools(range).pipe(
            Effect.mapError(failed),
            Effect.withSpan("ClickHouseImportSource.pools"),
          ),

        tallies: (range) =>
          Effect.all({
            pools: pools(range),
            providers: client
              .select(
                `SELECT ${poolOf} AS pool, toString(ifNull(provider, '')) AS provider, toString(count()) AS rows
                 FROM ${logs} FINAL WHERE ${inRange("timestamp")}
                 GROUP BY pool, provider ORDER BY pool, provider`,
                ProviderRow,
                rangeParams(range),
              )
              .pipe(
                Effect.map((rows) =>
                  rows.map(({ pool, provider, rows: requests }) => ({
                    sourcePool: pool,
                    provider,
                    requests,
                  })),
                ),
              ),
            machines: countedBy(metadataText("host"), range),
            userAgents: countedBy("ifNull(user_agent, '')", range),
            statuses: countedBy("status", range),
            objectTypes: countedBy("toString(ifNull(object_type, ''))", range),
          }).pipe(
            Effect.mapError(failed),
            Effect.withSpan("ClickHouseImportSource.tallies"),
          ),

        days: (range) =>
          client
            .select(
              `SELECT DISTINCT day FROM (
                 SELECT ${dayOf("timestamp")} AS day FROM ${logs} FINAL
                 UNION ALL
                 SELECT ${dayOf("timestamp")} AS day FROM ${requestItems} FINAL
               ) WHERE day >= {from:String} AND day <= {to:String} ORDER BY day`,
              DayRow,
              rangeParams(range),
            )
            .pipe(
              Effect.map((rows) => rows.map(({ day }) => day)),
              Effect.mapError(failed),
              Effect.withSpan("ClickHouseImportSource.days"),
            ),

        summary: (day) =>
          Effect.gen(function* () {
            const params = { day: Param.string(day) };
            const [requests] = yield* client.select(
              `SELECT toString(count()) AS rows, toString(sum(cityHash64(toString(id)))) AS fingerprint
               FROM ${logs} FINAL WHERE ${dayOf("timestamp")} = {day:String}`,
              RequestsSummaryRow,
              params,
            );
            const [items] = yield* client.select(
              `SELECT toString(count()) AS rows FROM (
                 SELECT min(first_seen) AS seen FROM ${messages}
                 WHERE session_key IN (SELECT DISTINCT session_key FROM ${messages} WHERE ${dayOf("first_seen")} = {day:String})
                 GROUP BY session_key, hash
                 HAVING toString(toDate(seen, 'UTC')) = {day:String})`,
              CountRow,
              params,
            );
            const [rows] = yield* client.select(
              `SELECT toString(count()) AS rows FROM ${requestItems} FINAL WHERE ${requestItemsOfDay}`,
              CountRow,
              params,
            );
            return {
              requests: requests?.rows ?? 0,
              fingerprint: requests?.fingerprint ?? "0",
              items: items?.rows ?? 0,
              requestItems: rows?.rows ?? 0,
            };
          }).pipe(
            Effect.mapError(failed),
            Effect.withSpan("ClickHouseImportSource.summary"),
          ),

        sessions: (day) =>
          client
            .select(
              `SELECT session_key, toString(sum(requests)) AS requests, toString(sum(hashes)) AS hashes FROM (
                 SELECT ${sessionKey} AS session_key, count() AS requests, toUInt64(0) AS hashes
                 FROM ${logs} FINAL WHERE ${requestsOfDay} GROUP BY session_key
                 UNION ALL
                 SELECT session_key, toUInt64(0) AS requests, sum(length(input) + length(output) + length(tools)) AS hashes
                 FROM ${requestItems} FINAL WHERE ${requestItemsOfDay} GROUP BY session_key
                 UNION ALL
                 SELECT DISTINCT session_key, toUInt64(0) AS requests, toUInt64(0) AS hashes
                 FROM ${messages} WHERE ${itemsFirstSeenOnDay}
               ) GROUP BY session_key ORDER BY session_key`,
              WeightRow,
              { day: Param.string(day) },
            )
            .pipe(
              Effect.map((rows) =>
                rows.map(({ session_key, requests, hashes }) => ({
                  sessionKey: session_key,
                  requests,
                  hashes,
                })),
              ),
              Effect.mapError(failed),
              Effect.withSpan("ClickHouseImportSource.sessions"),
            ),

        requests: (page) =>
          client
            .select(
              `SELECT toString(id) AS id, toString(toUnixTimestamp64Milli(timestamp)) AS started_ms,
                 ifNull(session_id, '') AS session, ifNull(metadata, '') AS metadata,
                 ifNull(user_agent, '') AS user_agent, toString(ifNull(provider, '')) AS provider,
                 toString(ifNull(model, '')) AS model, toString(ifNull(object_type, '')) AS object_type,
                 params, status, stream, toString(ifNull(stop_reason, '')) AS stop_reason,
                 toString(prompt_tokens) AS prompt_tokens, toString(completion_tokens) AS completion_tokens,
                 toString(cached_read_tokens) AS cached_read_tokens, token_usage, cost, latency, error_details
               FROM ${logs} FINAL WHERE ${requestsOfPage}
               ORDER BY timestamp, id`,
              RequestRow,
              pageParams(page),
            )
            .pipe(
              Effect.map((rows) =>
                rows.map(
                  (row): Import.SourceRequest => ({
                    id: row.id,
                    startedAt: timeOf(row.started_ms),
                    session: row.session,
                    metadata: row.metadata,
                    userAgent: row.user_agent,
                    provider: row.provider,
                    model: row.model,
                    objectType: row.object_type,
                    params: row.params,
                    status: row.status,
                    stream: row.stream,
                    stopReason: row.stop_reason,
                    promptTokens: row.prompt_tokens,
                    completionTokens: row.completion_tokens,
                    cachedReadTokens: row.cached_read_tokens,
                    tokenUsage: row.token_usage,
                    cost: Option.fromNullOr(row.cost),
                    latency: Option.fromNullOr(row.latency),
                    errorDetails: row.error_details,
                  }),
                ),
              ),
              Effect.mapError(failed),
              Effect.withSpan("ClickHouseImportSource.requests"),
            ),

        requestItems: (page) =>
          client
            .select(
              `SELECT request_id, session_key, toString(toUnixTimestamp64Milli(timestamp)) AS started_ms,
                 arrayMap(hash -> toString(hash), input) AS input,
                 arrayMap(hash -> toString(hash), output) AS output,
                 arrayMap(hash -> toString(hash), tools) AS tools
               FROM ${requestItems} FINAL
               WHERE request_id IN (${pageRequestIds})
                  OR (session_key IN (${pageSessions}) AND ${requestsOfDay}
                      AND request_id NOT IN (SELECT toString(id) FROM ${logs} FINAL))
               ORDER BY request_id`,
              RequestItemsRow,
              pageParams(page),
            )
            .pipe(
              Effect.map((rows) =>
                rows.map(
                  (row): Import.SourceRequestItems => ({
                    requestId: row.request_id,
                    sessionKey: row.session_key,
                    startedAt: timeOf(row.started_ms),
                    input: row.input,
                    output: row.output,
                    tools: row.tools,
                  }),
                ),
              ),
              Effect.mapError(failed),
              Effect.withSpan("ClickHouseImportSource.requestItems"),
            ),

        listed: (page) =>
          client
            .select(
              `SELECT m.session_key AS session_key, toString(m.hash) AS hash,
                 toString(toUnixTimestamp64Milli(m.seen)) AS seen_ms, m.first.1 AS request_id,
                 toString(m.first.2) AS source, m.first.3 AS position, toString(m.first.4) AS bytes,
                 toBool(l.logged_id != '') AS logged, toString(l.sent) AS sent_ms
               FROM (
                 SELECT session_key, hash, min(first_seen) AS seen,
                   argMin((request_id, source, position, length(content)), (first_seen, request_id)) AS first
                 FROM ${messages} WHERE session_key IN (${pageSessions})
                 GROUP BY session_key, hash
                 HAVING ${listedOfPage}
               ) AS m
               LEFT JOIN (
                 SELECT toString(id) AS logged_id, toUnixTimestamp64Milli(timestamp) AS sent
                 FROM ${logs} FINAL WHERE ${sessionKey} IN (${pageSessions})
               ) AS l ON l.logged_id = m.first.1
               ORDER BY session_key, m.hash`,
              ListedRow,
              pageParams(page),
            )
            .pipe(
              Effect.map((rows) =>
                rows.map((row) => ({
                  sessionKey: row.session_key,
                  hash: row.hash,
                  firstSeen: timeOf(row.seen_ms),
                  requestId: row.request_id,
                  source: row.source,
                  position: row.position,
                  sentAt: row.logged
                    ? Option.some(timeOf(row.sent_ms))
                    : Option.none(),
                  bytes: row.bytes,
                })),
              ),
              Effect.mapError(failed),
              Effect.withSpan("ClickHouseImportSource.listed"),
            ),

        firstNamings: (items) =>
          Effect.forEach(ClickHouse.listsOf(items, pairOf), (chunk) =>
            client.select(
              `SELECT r.session_key AS session_key, toString(r.named) AS hash,
                 argMin(r.request_id, (l.sent, r.request_id)) AS request_id,
                 toString(min(l.sent)) AS started_ms
               FROM (
                 SELECT session_key, request_id, arrayJoin(arrayConcat(tools, input, output)) AS named
                 FROM ${requestItems} FINAL WHERE session_key IN {keys:Array(String)}
               ) AS r
               INNER JOIN (
                 SELECT toString(id) AS logged_id, toUnixTimestamp64Milli(timestamp) AS sent
                 FROM ${logs} FINAL WHERE ${sessionKey} IN {keys:Array(String)}
               ) AS l ON l.logged_id = r.request_id
               WHERE concat(r.session_key, '/', toString(r.named)) IN {pairs:Array(String)}
               GROUP BY r.session_key, r.named`,
              NamingRow,
              {
                keys: Param.strings([
                  ...new Set(chunk.map(({ sessionKey }) => sessionKey)),
                ]),
                pairs: Param.strings(chunk.map(pairOf)),
              },
            ),
          ).pipe(
            Effect.map((chunks) =>
              chunks.flat().map(
                (row): Import.FirstNaming => ({
                  sessionKey: row.session_key,
                  hash: row.hash,
                  requestId: row.request_id,
                  startedAt: timeOf(row.started_ms),
                }),
              ),
            ),
            Effect.mapError(failed),
            Effect.withSpan("ClickHouseImportSource.firstNamings"),
          ),

        contents: (page, first, last) =>
          client
            .select(
              `SELECT session_key, toString(hash) AS hash, content FROM (
                 SELECT session_key, hash, min(first_seen) AS seen,
                   argMin(content, (first_seen, request_id)) AS content
                 FROM ${messages}
                 WHERE session_key IN (${pageSessions})
                   AND (session_key, hash) >= ({firstKey:String}, {firstHash:UInt64})
                   AND (session_key, hash) <= ({lastKey:String}, {lastHash:UInt64})
                 GROUP BY session_key, hash
                 HAVING ${listedOfPage}
               ) ORDER BY session_key, hash`,
              ContentRow,
              {
                ...pageParams(page),
                firstKey: Param.string(first.sessionKey),
                firstHash: Param.string(first.hash),
                lastKey: Param.string(last.sessionKey),
                lastHash: Param.string(last.hash),
              },
            )
            .pipe(
              Effect.map((rows) =>
                rows.map(
                  (row): Import.SourceContent => ({
                    sessionKey: row.session_key,
                    hash: row.hash,
                    content: row.content,
                  }),
                ),
              ),
              Effect.mapError(failed),
              Effect.withSpan("ClickHouseImportSource.contents"),
            ),

        latest: (sessions) =>
          Effect.forEach(
            ClickHouse.listsOf(sessions, (session) => session),
            (chunk) =>
              client.select(
                `SELECT session_id AS session, toString(toUnixTimestamp64Milli(max(timestamp))) AS latest_ms
               FROM ${logs} FINAL WHERE session_id IN {sessions:Array(String)} GROUP BY session`,
                LatestRow,
                { sessions: Param.strings(chunk) },
              ),
          ).pipe(
            Effect.map(
              (chunks): ReadonlyMap<string, DateTime.Utc> =>
                new Map(
                  chunks
                    .flat()
                    .map((row) => [row.session, timeOf(row.latest_ms)]),
                ),
            ),
            Effect.mapError(failed),
            Effect.withSpan("ClickHouseImportSource.latest"),
          ),
      });
    }),
  );
