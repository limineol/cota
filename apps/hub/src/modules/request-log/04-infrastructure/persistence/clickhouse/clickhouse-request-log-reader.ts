import {
  DateTime,
  Effect,
  Layer,
  Option,
  Ref,
  Schema,
  SchemaTransformation,
} from "effect";
import {
  type FoundItem,
  type FoundRequest,
  type ItemKey,
  type LatestQuotaHeaders,
  type QuotaHeaderAsked,
  RequestLogReader,
  type Wanted,
} from "#modules/request-log/02-application/interfaces/request-log-reader.ts";
import * as Search from "#modules/request-log/03-domain/search.ts";
import type * as Session from "#modules/request-log/03-domain/session.ts";
import { StoredProtocol } from "#modules/request-log/03-domain/stored-protocol.ts";
import * as Traffic from "#modules/request-log/03-domain/traffic.ts";
import * as Conversation from "#shared/03-domain/conversation.ts";
import { HubKeyName, LoginFingerprint, PoolId } from "#shared/03-domain/ids.ts";
import * as Request from "#shared/03-domain/request.entity.ts";
import { RequestLogUnavailable } from "#shared/03-domain/request-log.ts";
import * as ClickHouse from "./client.ts";
import { Param } from "./client.ts";
import { digestOf, UInt128, uint128Of } from "./mappers/columns.ts";
import * as RequestMapper from "./mappers/request.mapper.ts";
import * as Tables from "./schema.ts";

const column: Readonly<Record<Traffic.Dimension, string>> = {
  pool: "toString(pool)",
  model: "toString(model)",
  client: "toString(client)",
  machine: "toString(machine)",
  project: "toString(project)",
  provider: "toString(provider)",
  hub_key: "toString(hub_key)",
  outcome: "toString(outcome)",
};

const filterOf = (dimension: Traffic.Dimension) =>
  `(empty({f_${dimension}:Array(String)}) OR ${column[dimension]} IN {f_${dimension}:Array(String)})`;

/** Every filter but `except`'s. */
const filtered = (except?: Traffic.Dimension) =>
  Traffic.dimensions
    .filter((dimension) => dimension !== except)
    .map(filterOf)
    .join(" AND ");

const instant = (name: string) =>
  `fromUnixTimestamp64Milli({${name}:Int64}, 'UTC')`;

const traffic = "operation != 'models'";

/** The selection over the window whose bounds `window` names, but for its filter of `except`. */
const selected = (except?: Traffic.Dimension, window = "window") =>
  `started_at >= ${instant(`${window}_from`)} AND started_at < ${instant(`${window}_to`)} AND ${traffic} AND ${filtered(except)}`;

const windowParams = (window: Traffic.Window, name = "window") => ({
  [`${name}_from`]: Param.integer(DateTime.toEpochMillis(window.from)),
  [`${name}_to`]: Param.integer(DateTime.toEpochMillis(window.to)),
});

const paramsOf = (selection: Traffic.Selection): ClickHouse.Params => ({
  ...windowParams(selection.window),
  ...Object.fromEntries(
    Traffic.dimensions.map((dimension) => [
      `f_${dimension}`,
      Param.strings(selection.filters[dimension]),
    ]),
  ),
});

const sums = `count() AS requests,
  sum(input_tokens) AS input,
  sum(cache_read_tokens) AS cache_read,
  sum(cache_write_short_tokens) AS cache_write_short,
  sum(cache_write_long_tokens) AS cache_write_long,
  sum(output_tokens) AS output,
  sum(reasoning_tokens) AS reasoning,
  sum(cost_usd) AS cost,
  countIf(usage_reported AND cost_usd IS NULL) AS unpriced`;

const errors = "countIf(outcome = 'error') AS errors";

const totals = `${sums},
  uniqExact(session) AS sessions,
  countIf(outcome = 'ok') AS ok,
  ${errors},
  countIf(outcome = 'refused') AS refused,
  countIf(outcome = 'cancelled') AS cancelled,
  countIf(NOT usage_reported) AS usage_unreported,
  quantilesExactIf(0.5, 0.95)(duration_ms, outcome = 'ok') AS duration,
  quantilesExactIf(0.5, 0.95)(assumeNotNull(first_byte_ms), first_byte_ms IS NOT NULL) AS first_byte,
  countIf(first_byte_ms IS NOT NULL) AS first_bytes`;

const bucketOf: Readonly<Record<Traffic.Bucket, string>> = {
  "5m": "toStartOfInterval(started_at, INTERVAL 5 MINUTE, {zone:String})",
  "15m": "toStartOfInterval(started_at, INTERVAL 15 MINUTE, {zone:String})",
  "30m": "toStartOfInterval(started_at, INTERVAL 30 MINUTE, {zone:String})",
  "1h": "toStartOfInterval(started_at, INTERVAL 1 HOUR, {zone:String})",
  "3h": "toStartOfInterval(started_at, INTERVAL 3 HOUR, {zone:String})",
  "6h": "toStartOfInterval(started_at, INTERVAL 6 HOUR, {zone:String})",
  "12h": "toStartOfInterval(started_at, INTERVAL 12 HOUR, {zone:String})",
  "1d": "toStartOfDay(started_at, {zone:String})",
  "7d": "toDateTime(toMonday(started_at, {zone:String}), {zone:String})",
};

const Count = Schema.NumberFromString.check(Schema.isInt());
const Time = Schema.DateTimeUtcFromString;

/** A sum of `Decimal(18, 12)` dollars, which ClickHouse writes with all 12 decimals, or null for no sum, as picodollars. */
const Picodollars = Schema.NullOr(
  Schema.String.check(Schema.isPattern(/^\d+\.\d{12}$/)),
).pipe(
  Schema.decodeTo(
    Schema.BigInt,
    SchemaTransformation.transform({
      decode: (dollars) =>
        dollars === null ? 0n : BigInt(dollars.replace(".", "")),
      encode: (picodollars) =>
        `${picodollars / 10n ** 12n}.${(picodollars % 10n ** 12n).toString().padStart(12, "0")}`,
    }),
  ),
);

const SumsRow = Schema.Struct({
  requests: Count,
  input: Count,
  cache_read: Count,
  cache_write_short: Count,
  cache_write_long: Count,
  output: Count,
  reasoning: Count,
  cost: Picodollars,
  unpriced: Count,
});

const sumsOf = (row: typeof SumsRow.Type): Traffic.Sums => ({
  requests: row.requests,
  usage: {
    input: row.input,
    cacheRead: row.cache_read,
    cacheWriteShort: row.cache_write_short,
    cacheWriteLong: row.cache_write_long,
    output: row.output,
    reasoning: row.reasoning,
  },
  cost: row.cost,
  unpricedRequests: row.unpriced,
});

const Quantiles = Schema.Tuple([Schema.Int, Schema.Int]);

const TotalsRow = Schema.Struct({
  ...SumsRow.fields,
  which: Schema.Literals(["window", "previous"]),
  sessions: Count,
  ok: Count,
  errors: Count,
  refused: Count,
  cancelled: Count,
  usage_unreported: Count,
  duration: Quantiles,
  first_byte: Quantiles,
  first_bytes: Count,
  first_request_at: Schema.NullOr(Time),
});

const percentilesOf = (
  count: number,
  [p50, p95]: readonly [number, number],
): Option.Option<Traffic.Percentiles> =>
  count === 0 ? Option.none() : Option.some({ p50, p95 });

const totalsOf = (row: typeof TotalsRow.Type): Traffic.Totals => ({
  ...sumsOf(row),
  sessions: row.sessions,
  outcomes: {
    ok: row.ok,
    error: row.errors,
    refused: row.refused,
    cancelled: row.cancelled,
  },
  usageUnreported: row.usage_unreported,
  durationMs: percentilesOf(row.ok, row.duration),
  firstByteMs: percentilesOf(row.first_bytes, row.first_byte),
});

const noTotals: Traffic.Totals = {
  requests: 0,
  usage: {
    input: 0,
    cacheRead: 0,
    cacheWriteShort: 0,
    cacheWriteLong: 0,
    output: 0,
    reasoning: 0,
  },
  cost: 0n,
  unpricedRequests: 0,
  sessions: 0,
  outcomes: { ok: 0, error: 0, refused: 0, cancelled: 0 },
  usageUnreported: 0,
  durationMs: Option.none(),
  firstByteMs: Option.none(),
};

const firstRequest = `(SELECT toNullable(started_at) FROM requests WHERE ${traffic} ORDER BY started_at LIMIT 1)`;

const overviewSql = ["window", "previous"]
  .map(
    (which) =>
      `SELECT '${which}' AS which, ${totals}, ${firstRequest} AS first_request_at
       FROM requests WHERE ${selected(undefined, which)}`,
  )
  .join("\nUNION ALL\n");

const PointRow = Schema.Struct({
  ...SumsRow.fields,
  at: Time,
  key: Schema.NullOr(Schema.String),
  errors: Count,
});

const pointsSql = (bucket: Traffic.Bucket, by: Traffic.Dimension) =>
  `SELECT ${bucketOf[bucket]} AS at,
     if(${column[by]} IN (
       SELECT ${column[by]} AS value FROM requests WHERE ${selected()}
       GROUP BY value ORDER BY count() DESC, value LIMIT {keys:UInt32}
     ), toNullable(${column[by]}), NULL) AS key,
     ${sums}, ${errors}
   FROM requests WHERE ${selected()}
   GROUP BY at, key`;

const BreakdownRow = Schema.Struct({
  ...SumsRow.fields,
  key: Schema.String,
  sessions: Count,
  errors: Count,
  last_at: Time,
  distinct_keys: Count,
});

const breakdownSql = (by: Traffic.Dimension) =>
  `SELECT ${column[by]} AS key, ${sums}, uniqExact(session) AS sessions, ${errors},
     max(started_at) AS last_at, count() OVER () AS distinct_keys
   FROM requests WHERE ${selected()}
   GROUP BY key ORDER BY requests DESC, key LIMIT {limit:UInt32}`;

const FacetRow = Schema.Struct({
  dimension: Traffic.Dimension,
  value: Schema.String,
  requests: Count,
});

const facetsSql = `SELECT facet.1 AS dimension, facet.2 AS value, count() AS requests
  FROM requests
  ARRAY JOIN arrayFilter(each -> each.3, [${Traffic.dimensions
    .map(
      (dimension) =>
        `('${dimension}', ${column[dimension]}, ${filtered(dimension)})`,
    )
    .join(", ")}]) AS facet
  WHERE started_at >= ${instant("window_from")} AND started_at < ${instant("window_to")} AND ${traffic}
  GROUP BY dimension, value HAVING value != ''
  ORDER BY dimension, requests DESC, value LIMIT {limit:UInt32} BY dimension`;

const ErrorGroupRow = Schema.Struct({
  provider: Schema.String,
  model: Schema.String,
  outcome_name: Request.Outcome,
  upstream_status: Schema.Int,
  error_type: Schema.String,
  message: Schema.String,
  requests: Count,
  first_at: Time,
  last_at: Time,
  pools: Schema.Array(Schema.String),
  clients: Schema.Array(Schema.String),
  latest_request: Request.RequestId,
  distinct_groups: Count,
  selected_requests: Count,
});

const errorGroupsSql = `SELECT provider, model, toString(outcome) AS outcome_name, upstream_status, error_type,
    substringUTF8(error_message, 1, ${Traffic.messageLength}) AS message,
    count() AS requests, min(started_at) AS first_at, max(started_at) AS last_at,
    arraySort(groupUniqArray(toString(pool))) AS pools,
    arraySort(groupUniqArray(toString(client))) AS clients,
    toString(argMax(id, (started_at, toString(id)))) AS latest_request,
    count() OVER () AS distinct_groups, sum(count()) OVER () AS selected_requests
  FROM requests WHERE ${selected()}
  GROUP BY provider, model, outcome, upstream_status, error_type, message
  ORDER BY last_at DESC, latest_request DESC LIMIT {limit:UInt32}`;

const distinctValues = (name: string) =>
  `arraySort(groupUniqArrayIf(toString(${name}), ${name} != ''))`;

const sessionOrderOf: Readonly<Record<Session.SessionOrder, string>> = {
  recent: "last_at",
  requests: "requests",
  tokens: "input + cache_read + cache_write_short + cache_write_long + output",
  cost: "ifNull(cost, 0)",
};

const sessionColumns = `session, min(started_at) AS first_at, max(started_at) AS last_at,
  ${sums}, ${errors}, countIf(NOT usage_reported) AS usage_unreported,
  ${distinctValues("pool")} AS pools, ${distinctValues("project")} AS projects,
  ${distinctValues("machine")} AS machines, ${distinctValues("client")} AS clients,
  ${distinctValues("provider")} AS providers, ${distinctValues("model")} AS models,
  arraySort(groupUniqArray(toString(protocol))) AS protocols`;

const selectedSessions = `SELECT session FROM requests WHERE ${selected()}`;

/**
 * The text index answers this from `items`' index alone, without reading
 * `text`: the search query is one bound string that ClickHouse splits and
 * lowercases as it did the text (ADR-0015).
 */
const exactMatching = "hasAllTokens(text, {query:String})";

/** The completions of the query's word `at` among the log's words: the shortest first, then by text. */
const completionsOf = (at: number) =>
  `(SELECT word FROM words WHERE startsWith(word, {w${at}:String}) AND word != {w${at}:String}
     GROUP BY word ORDER BY lengthUTF8(word), word LIMIT {completions:UInt32})`;

/**
 * The neighbours of the query's word `at` among the log's words, the fewest
 * edits first, then by text: only words whose length and characters allow
 * the edits are measured.
 */
const neighboursOf = (at: number) =>
  `(SELECT word FROM (
       SELECT DISTINCT word FROM words
       WHERE characters BETWEEN toInt64(lengthUTF8({w${at}:String})) - {k${at}:UInt8} AND lengthUTF8({w${at}:String}) + {k${at}:UInt8}
         AND bitCount(bitXor(character_bits, (SELECT ${Tables.characterBitsOf(`{w${at}:String}`)}))) <= 2 * {k${at}:UInt8})
     WHERE editDistanceUTF8(word, {w${at}:String}) BETWEEN 1 AND {k${at}:UInt8}
     ORDER BY editDistanceUTF8(word, {w${at}:String}), word LIMIT {neighbours:UInt32})`;

/**
 * The query's word `at` widened among the log's words, as the in-memory
 * reader widens it: the text index answers each word's condition from its
 * index alone, the words being a constant once ClickHouse has read them.
 */
const widenedMatching = (at: number, prefix: boolean, edits: number) => {
  const lists = [
    `SELECT {w${at}:String} AS word`,
    ...(prefix ? [completionsOf(at)] : []),
    ...(edits > 0 ? [neighboursOf(at)] : []),
  ];
  return `hasAnyTokens(text, (SELECT groupArray(word) FROM (${lists.join(" UNION ALL ")})))`;
};

/** The condition an item of a search meets, and its parameters: every word a bound parameter, never part of the text. */
const matchingOf = (search: Search.Asked, bounds: Search.Bounds) => {
  if (!Search.widens(search.query, search.tolerance)) {
    return {
      matching: exactMatching,
      params: { query: Param.string(search.query) },
    };
  }
  const words = Search.wordsOf(search.query);
  const edits = words.map((word) =>
    Search.editsFor(word, search.tolerance.fuzzy),
  );
  return {
    matching: words
      .map((_, at) =>
        widenedMatching(at, search.tolerance.prefix, edits[at] ?? 0),
      )
      .join(" AND "),
    params: {
      completions: Param.integer(bounds.completions),
      neighbours: Param.integer(bounds.neighbours),
      ...Object.fromEntries(
        words.flatMap((word, at) => [
          [`w${at}`, Param.string(word)],
          [`k${at}`, Param.integer(edits[at] ?? 0)],
        ]),
      ),
    },
  };
};

/** The sessions selected, or, searching, those of them with an item that matches. */
const sessionsIn = (matching: Option.Option<string>) =>
  Option.match(matching, {
    onNone: () => selectedSessions,
    onSome: (matching) =>
      `SELECT DISTINCT session FROM items WHERE session IN (${selectedSessions}) AND ${matching}`,
  });

/** The matching items of the sessions `where` gives, each once, as the request that first carried it has it. */
const hitsIn = (where: string) => (matching: string) =>
  `SELECT session, toString(digest) AS item, min(first_seen) AS at,
     argMin(toString(request_id), (first_seen, toString(request_id))) AS request,
     argMin(toString(part), (first_seen, toString(request_id))) AS part,
     any(toString(role)) AS item_role,
     toUnixTimestamp64Milli(at) AS at_millis
   FROM items
   WHERE ${where} AND ${matching}
   GROUP BY session, digest`;

const hitOrder = "ORDER BY at DESC, session, toUInt128(item)";

const hitsSql = (
  matching: string,
) => `SELECT * FROM (${hitsIn(`session IN (${selectedSessions})`)(matching)})
  WHERE {after:UInt8} = 0
    OR (-at_millis, session, toUInt128(item)) > (-{after_at:Int64}, {after_session:String}, {after_item:UInt128})
  ${hitOrder}
  LIMIT {limit:UInt32}`;

const newestHitsSql = (
  matching: string,
) => `${hitsIn("session IN {sessions:Array(String)}")(matching)}
  ${hitOrder}
  LIMIT 1 BY session`;

const contentsSql = `SELECT session, toString(digest) AS item, any(toString(protocol)) AS protocol, any(content) AS content
  FROM items
  WHERE session IN {sessions:Array(String)} AND digest IN {items:Array(UInt128)}
    AND has(arrayZip({sessions:Array(String)}, {items:Array(UInt128)}), (session, digest))
  GROUP BY session, digest
  ORDER BY session, digest`;

const HitRow = Schema.Struct({
  session: Schema.String,
  item: UInt128,
  at: Time,
  request: Request.RequestId,
  part: Conversation.Part,
  item_role: Schema.String,
});

const hitOf = (row: typeof HitRow.Type): Search.Hit => ({
  session: row.session,
  item: digestOf(row.item),
  request: row.request,
  part: row.part,
  role: row.item_role,
  at: row.at,
});

const ContentRow = Schema.Struct({
  session: Schema.String,
  item: UInt128,
  protocol: StoredProtocol,
  content: Schema.String,
});

const sessionsSql = (
  order: Session.SessionOrder,
  matching: Option.Option<string>,
) =>
  `SELECT ${sessionColumns}, count() OVER () AS total
   FROM requests
   WHERE ${traffic} AND session IN (${sessionsIn(matching)})
   GROUP BY session
   ORDER BY ${sessionOrderOf[order]} DESC, session
   LIMIT {limit:UInt32} OFFSET {offset:UInt32}`;

const sessionSql = `SELECT ${sessionColumns}, toUInt64(1) AS total
  FROM requests WHERE session = {session:String} AND ${traffic}
  GROUP BY session`;

const sessionsCountSql = (matching: Option.Option<string>) =>
  `SELECT uniqExact(session) AS total FROM (${sessionsIn(matching)})`;

const SessionRow = Schema.Struct({
  ...SumsRow.fields,
  session: Schema.String,
  first_at: Time,
  last_at: Time,
  errors: Count,
  usage_unreported: Count,
  pools: Schema.Array(Schema.String),
  projects: Schema.Array(Schema.String),
  machines: Schema.Array(Schema.String),
  clients: Schema.Array(Schema.String),
  providers: Schema.Array(Schema.String),
  models: Schema.Array(Schema.String),
  protocols: Schema.Array(StoredProtocol),
  total: Count,
});

const sessionRowOf = (row: typeof SessionRow.Type): Session.SessionRow => ({
  ...sumsOf(row),
  id: row.session,
  startedAt: row.first_at,
  endedAt: row.last_at,
  errors: row.errors,
  usageUnreported: row.usage_unreported,
  pools: row.pools,
  projects: row.projects,
  machines: row.machines,
  clients: row.clients,
  providers: row.providers,
  models: row.models,
  protocols: row.protocols,
});

const Dollars = Schema.NullOr(
  Schema.String.check(Schema.isPattern(/^\d+\.\d{12}$/)),
);

/** Dollars with 12 decimals as picodollars; none for no cost. */
const costOf = (dollars: string | null): Option.Option<bigint> =>
  Option.map(Option.fromNullOr(dollars), (each) =>
    BigInt(each.replace(".", "")),
  );

const summariesSql = `SELECT toString(id) AS id, started_at, toString(protocol) AS protocol,
     toString(operation) AS operation,
     toString(purpose) AS purpose, toString(model) AS model, toString(served_model) AS served_model,
     toString(stop_reason) AS stop_reason, toString(outcome) AS outcome, upstream_status,
     toString(error_type) AS error_type,
     if(usage_reported, toNullable(prompt_tokens), NULL) AS prompt_size,
     if(usage_reported, toNullable(output_tokens), NULL) AS output_tokens,
     cost_usd AS cost, duration_ms, first_byte_ms, toString(diverted_from) AS diverted_from,
     if(follows IS NULL, NULL, toString(follows)) AS follows,
     count() OVER () AS session_requests
   FROM requests WHERE session = {session:String} AND ${traffic}
   ORDER BY started_at DESC, toString(id) DESC
   LIMIT {limit:UInt32}`;

const SummaryRow = Schema.Struct({
  id: Request.RequestId,
  started_at: Time,
  protocol: StoredProtocol,
  operation: Schema.String,
  purpose: Schema.String,
  model: Schema.String,
  served_model: Schema.String,
  stop_reason: Schema.String,
  outcome: Request.Outcome,
  upstream_status: Schema.Int,
  error_type: Schema.String,
  prompt_size: Schema.NullOr(Count),
  output_tokens: Schema.NullOr(Schema.Int),
  cost: Dollars,
  duration_ms: Schema.Int,
  first_byte_ms: Schema.NullOr(Schema.Int),
  diverted_from: Schema.Union([Schema.Literal(""), PoolId]),
  follows: Schema.NullOr(Request.RequestId),
  session_requests: Count,
});

const summaryOf = (row: typeof SummaryRow.Type): Session.RequestSummary => ({
  id: row.id,
  startedAt: row.started_at,
  protocol: row.protocol,
  operation: row.operation,
  purpose: row.purpose,
  model: row.model,
  servedModel: row.served_model,
  stopReason: row.stop_reason,
  outcome: row.outcome,
  upstreamStatus: row.upstream_status,
  errorType: row.error_type,
  promptSize: Option.fromNullOr(row.prompt_size),
  outputTokens: Option.fromNullOr(row.output_tokens),
  cost: costOf(row.cost),
  durationMs: row.duration_ms,
  firstByteMs: Option.fromNullOr(row.first_byte_ms),
  divertedFrom:
    row.diverted_from === "" ? Option.none() : Option.some(row.diverted_from),
  follows: Option.fromNullOr(row.follows),
});

/**
 * A request by id. Its session is read first, through the bloom filter on
 * `requests.id`, so that `request_items` and the other requests are read by
 * the session they are ordered or indexed by.
 */
const requestSql = `WITH (SELECT any(session) FROM requests WHERE id = {id:UUID}) AS found_session
  SELECT *,
    (SELECT count() FROM request_items WHERE session = found_session AND request_id = {id:UUID}) AS items_found,
    (SELECT any(params) FROM request_items WHERE session = found_session AND request_id = {id:UUID}) AS items_params,
    (SELECT if(count() = 0, NULL, argMin(toString(id), (started_at, toString(id))))
       FROM requests WHERE session = found_session AND follows = {id:UUID}) AS followed_by
  FROM requests WHERE session = found_session AND id = {id:UUID}
  LIMIT 1`;

const RecordRow = Schema.Struct({
  ...RequestMapper.RequestRow.fields,
  id: Request.RequestId,
  hub_key: Schema.Union([Schema.Literal(""), HubKeyName]),
  pool: PoolId,
  diverted_from: Schema.Union([Schema.Literal(""), PoolId]),
  follows: Schema.NullOr(Request.RequestId),
  login_fingerprint: Schema.Union([Schema.Literal(""), LoginFingerprint]),
  protocol: StoredProtocol,
  items_found: Count,
  items_params: Schema.String,
  followed_by: Schema.NullOr(Request.RequestId),
});

const JsonObjectText = Schema.fromJsonString(Schema.JsonObject);

const foundOf = (row: typeof RecordRow.Type): FoundRequest => ({
  record: {
    request: {
      id: row.id,
      startedAt: DateTime.makeUnsafe(row.started_at),
      firstByteMs: Option.fromNullOr(row.first_byte_ms),
      durationMs: row.duration_ms,
      session: row.session,
      sessionSource: row.session_source,
      machine: row.machine,
      project: row.project,
      client: row.client,
      clientVersion: row.client_version,
      userAgent: row.user_agent,
      hubKey: row.hub_key,
      pool: row.pool,
      divertedFrom:
        row.diverted_from === ""
          ? Option.none()
          : Option.some(row.diverted_from),
      follows: Option.fromNullOr(row.follows),
      loginFingerprint:
        row.login_fingerprint === ""
          ? Option.none()
          : Option.some(row.login_fingerprint),
      refusalReset: Option.map(Option.fromNullOr(row.refusal_reset), (at) =>
        DateTime.makeUnsafe(at),
      ),
      provider: row.provider,
      protocol: row.protocol,
      operation: row.operation,
      purpose: row.purpose,
      model: row.model,
      servedModel: row.served_model,
      stream: row.stream,
      outcome: row.outcome,
      upstreamStatus: row.upstream_status,
      errorType: row.error_type,
      errorMessage: row.error_message,
      stopReason: row.stop_reason,
      usage: row.usage_reported
        ? Option.some({
            tokens: {
              input: row.input_tokens,
              cacheRead: row.cache_read_tokens,
              cacheWriteShort: row.cache_write_short_tokens,
              cacheWriteLong: row.cache_write_long_tokens,
              output: row.output_tokens,
            },
            reasoning: row.reasoning_tokens,
            reported: row.usage,
          })
        : Option.none(),
      serviceTier: row.service_tier,
      providerRequestId: row.provider_request_id,
      rateLimits: row.rate_limits,
      clientHeaders: row.client_headers,
      errorBody: row.error_body,
      requestBytes: row.request_bytes,
      responseBytes: row.response_bytes,
      readingComplete: row.reading_complete,
    },
    cost: costOf(row.cost_usd),
  },
  params:
    row.items_found === 0
      ? Option.none()
      : Schema.decodeOption(JsonObjectText)(row.items_params),
  followedBy: Option.fromNullOr(row.followed_by),
});

/**
 * A session's requests, as the role rules read them: its latest
 * `{limit:UInt32}` traffic requests, and the `request_items` rows of those
 * alone.
 */
const sessionRequestsSql = `WITH kept AS (
     SELECT session, id, started_at, protocol, purpose, outcome, usage_reported, prompt_tokens, client_headers
     FROM requests WHERE session IN {sessions:Array(String)} AND ${traffic}
     ORDER BY started_at DESC, toString(id) DESC
     LIMIT {limit:UInt32} BY session
   )
   SELECT r.session AS session, toString(r.id) AS id, r.started_at AS started_at,
     toString(r.protocol) AS protocol, toString(r.purpose) AS purpose, toString(r.outcome) AS outcome,
     if(r.usage_reported, toNullable(r.prompt_tokens), NULL) AS prompt_size,
     mapFilter((name, value) -> has({headers:Array(String)}, name), r.client_headers) AS headers,
     c.found AS found, c.system AS system, c.first_input AS first_input, c.tools AS tools,
     c.input_types AS input_types, c.params AS params
   FROM kept AS r
   LEFT JOIN (
     SELECT ri.request_id AS request_id, 1 AS found, ri.system AS system,
       arraySlice(ri.input, 1, 1) AS first_input, length(ri.tools) AS tools,
       arraySort(arrayMap(each -> each.1, arrayFilter(each -> hasAny(ri.input, each.2), t.typed))) AS input_types,
       arrayFilter(field -> has({params:Array(String)}, field.1), JSONExtractKeysAndValuesRaw(ri.params)) AS params
     FROM request_items AS ri
     LEFT JOIN (
       SELECT session, groupArray((type, digests)) AS typed FROM (
         SELECT session, toString(type) AS type, groupUniqArray(digest) AS digests FROM items
         WHERE session IN {sessions:Array(String)} AND type IN {types:Array(String)}
         GROUP BY session, type
       ) GROUP BY session
     ) AS t ON t.session = ri.session
     WHERE ri.session IN {sessions:Array(String)}
       AND (ri.session, ri.started_at, ri.request_id) IN (SELECT session, started_at, id FROM kept)
   ) AS c ON c.request_id = r.id
   ORDER BY session, started_at, toString(id)`;

const Raw = Schema.fromJsonString(Schema.Json);

const SessionRequestRow = Schema.Struct({
  session: Schema.String,
  id: Request.RequestId,
  started_at: Time,
  protocol: StoredProtocol,
  purpose: Schema.String,
  outcome: Request.Outcome,
  prompt_size: Schema.NullOr(Count),
  headers: Schema.Record(Schema.String, Schema.String),
  found: Schema.Int,
  system: Schema.Array(UInt128),
  first_input: Schema.Array(UInt128),
  tools: Count,
  input_types: Schema.Array(Schema.String),
  params: Schema.Array(Schema.Tuple([Schema.String, Raw])),
});

const sessionRequestOf = (
  row: typeof SessionRequestRow.Type,
): Session.SessionRequest => ({
  id: row.id,
  startedAt: row.started_at,
  protocol: row.protocol,
  purpose: row.purpose,
  outcome: row.outcome,
  promptSize: Option.fromNullOr(row.prompt_size),
  clientHeaders: row.headers,
  conversation:
    row.found === 1
      ? Option.some({
          system: row.system.map(digestOf),
          firstInput: Option.fromUndefinedOr(row.first_input[0]).pipe(
            Option.map(digestOf),
          ),
          tools: row.tools,
          inputTypes: row.input_types,
          params: Object.fromEntries(row.params),
        })
      : Option.none(),
});

const itemsSql = `WITH wanted AS (
     SELECT session, request_id, part, position, digest FROM (
       SELECT session, request_id, each.1 AS part, each.2 AS digests
       FROM request_items
       ARRAY JOIN [('system', system), ('tools', tools), ('input', input), ('output', output)] AS each
       WHERE session IN {sessions:Array(String)} AND request_id IN {ids:Array(UUID)}
         AND has(
           arrayZip({sessions:Array(String)}, {ids:Array(String)}, {parts:Array(String)}),
           (session, toString(request_id), each.1)
         )
     )
     ARRAY JOIN digests AS digest, arrayEnumerate(digests) AS position
   )
   SELECT toString(w.request_id) AS request, w.part AS part, w.digest AS digest,
     i.type AS type, i.role AS role, i.content AS content
   FROM wanted AS w
   INNER JOIN (
     SELECT session, digest, any(toString(type)) AS type, any(toString(role)) AS role, any(content) AS content
     FROM items
     WHERE session IN {sessions:Array(String)} AND (session, digest) IN (SELECT session, digest FROM wanted)
     GROUP BY session, digest
   ) AS i ON i.session = w.session AND i.digest = w.digest
   ORDER BY request, part, w.position`;

const ItemRow = Schema.Struct({
  request: Request.RequestId,
  part: Conversation.Part,
  digest: UInt128,
  type: Schema.String,
  role: Schema.String,
  content: Schema.String,
});

/**
 * The latest request of each pool asked whose quota headers hold each name
 * asked, by when it started and then by id, through `requests`' order by
 * `started_at`.
 */
const latestQuotaHeadersSql = `SELECT toString(pool) AS pool, toString(name) AS header,
     max(started_at) AS latest_at,
     argMax(rate_limits, (started_at, toString(id))) AS headers
   FROM requests
   ARRAY JOIN mapKeys(rate_limits) AS name
   WHERE started_at >= ${instant("since")}
     AND pool IN {pools:Array(String)}
     AND has(arrayZip({pools:Array(String)}, {names:Array(String)}), (toString(pool), toString(name)))
   GROUP BY pool, header
   ORDER BY pool, header`;

const LatestQuotaHeadersRow = Schema.Struct({
  pool: PoolId,
  header: Schema.String,
  latest_at: Time,
  headers: Schema.Record(Schema.String, Schema.String),
});

const timeoutExceeded = "159";

/**
 * Fails as the request log's store being unavailable, logging what ClickHouse
 * said but not saying it; a query ClickHouse stopped at its time limit did not
 * answer in time, as one the hub stopped waiting for.
 */
export const unavailable = (error: ClickHouse.ClickHouseError) =>
  Effect.logWarning("reading the request log failed", error.message).pipe(
    Effect.andThen(
      Effect.fail(
        new RequestLogUnavailable({
          reason:
            error.status === 0 || error.code === timeoutExceeded
              ? "unreachable"
              : "failed",
          code: error.code,
        }),
      ),
    ),
  );

const CommentRow = Schema.Struct({ comment: Schema.String });

/**
 * The reader over ClickHouse's `requests`, each answer one query whose values
 * are bound, never written into its text. A search widens each word of its
 * query up to `bounds`.
 */
export const layerWith = (
  bounds: Search.Bounds,
): Layer.Layer<RequestLogReader, never, ClickHouse.ClickHouse> =>
  Layer.effect(
    RequestLogReader,
    Effect.gen(function* () {
      const clickHouse = yield* ClickHouse.ClickHouse;
      const gathered = yield* Ref.make(false);

      /** Fails a search that widens until `prepare` has gathered the log's words, which it then remembers. */
      const wordsGathered = Effect.fn(
        "ClickHouseRequestLogReader.wordsGathered",
      )(function* () {
        if (yield* Ref.get(gathered)) return;
        const [table] = yield* clickHouse.select(
          Tables.wordsCommentSql,
          CommentRow,
        );
        if (table?.comment !== Tables.wordsGathered) {
          return yield* new RequestLogUnavailable({
            reason: "gathering",
            code: "",
          });
        }
        yield* Ref.set(gathered, true);
      });

      /** The condition and parameters of a search, once the words it widens to can be read. */
      const searchOf = Effect.fn("ClickHouseRequestLogReader.searchOf")(
        function* (search: Search.Asked) {
          if (Search.widens(search.query, search.tolerance)) {
            yield* wordsGathered();
          }
          return matchingOf(search, bounds);
        },
      );

      const overview = Effect.fn("ClickHouseRequestLogReader.overview")(
        function* (selection: Traffic.Selection, previous: Traffic.Window) {
          const rows = yield* clickHouse.select(overviewSql, TotalsRow, {
            ...paramsOf(selection),
            ...windowParams(previous, "previous"),
          });
          const of = (which: "window" | "previous") =>
            Option.match(
              Option.fromUndefinedOr(rows.find((row) => row.which === which)),
              { onNone: () => noTotals, onSome: totalsOf },
            );
          return {
            totals: of("window"),
            previousTotals: of("previous"),
            firstRequestAt: Option.fromNullOr(
              rows[0]?.first_request_at ?? null,
            ),
          };
        },
        Effect.catchTag("ClickHouseError", unavailable),
      );

      const points = Effect.fn("ClickHouseRequestLogReader.points")(
        function* (
          selection: Traffic.Selection,
          series: {
            readonly by: Traffic.Dimension;
            readonly bucket: Traffic.Bucket;
            readonly zone: DateTime.TimeZone.Named;
            readonly keys: number;
          },
        ) {
          const rows = yield* clickHouse.select(
            pointsSql(series.bucket, series.by),
            PointRow,
            {
              ...paramsOf(selection),
              zone: Param.string(series.zone.id),
              keys: Param.integer(series.keys),
            },
          );
          return rows.map(
            (row): Traffic.Point => ({
              ...sumsOf(row),
              at: row.at,
              key: Option.fromNullOr(row.key),
              errors: row.errors,
            }),
          );
        },
        Effect.catchTag("ClickHouseError", unavailable),
      );

      const breakdown = Effect.fn("ClickHouseRequestLogReader.breakdown")(
        function* (
          selection: Traffic.Selection,
          by: Traffic.Dimension,
          limit: number,
        ) {
          const rows = yield* clickHouse.select(
            breakdownSql(by),
            BreakdownRow,
            {
              ...paramsOf(selection),
              limit: Param.integer(limit),
            },
          );
          return {
            rows: rows.map(
              (row): Traffic.BreakdownRow => ({
                ...sumsOf(row),
                key: row.key,
                sessions: row.sessions,
                errors: row.errors,
                lastAt: row.last_at,
              }),
            ),
            distinctKeys: rows[0]?.distinct_keys ?? 0,
          };
        },
        Effect.catchTag("ClickHouseError", unavailable),
      );

      const facets = Effect.fn("ClickHouseRequestLogReader.facets")(
        function* (selection: Traffic.Selection, limit: number) {
          const rows = yield* clickHouse.select(facetsSql, FacetRow, {
            ...paramsOf(selection),
            limit: Param.integer(limit),
          });
          const facetOf = (dimension: Traffic.Dimension) =>
            rows
              .filter((row) => row.dimension === dimension)
              .map(({ value, requests }) => ({ value, requests }));
          return {
            pool: facetOf("pool"),
            model: facetOf("model"),
            client: facetOf("client"),
            machine: facetOf("machine"),
            project: facetOf("project"),
            provider: facetOf("provider"),
            hub_key: facetOf("hub_key"),
            outcome: facetOf("outcome"),
          };
        },
        Effect.catchTag("ClickHouseError", unavailable),
      );

      const errorGroups = Effect.fn("ClickHouseRequestLogReader.errorGroups")(
        function* (selection: Traffic.Selection, limit: number) {
          const rows = yield* clickHouse.select(errorGroupsSql, ErrorGroupRow, {
            ...paramsOf(selection),
            limit: Param.integer(limit),
          });
          return {
            groups: rows.map(
              (row): Traffic.ErrorGroup => ({
                provider: row.provider,
                model: row.model,
                outcome: row.outcome_name,
                upstreamStatus: row.upstream_status,
                errorType: row.error_type,
                message: row.message,
                requests: row.requests,
                firstAt: row.first_at,
                lastAt: row.last_at,
                pools: row.pools,
                clients: row.clients,
                latestRequest: row.latest_request,
              }),
            ),
            requests: rows[0]?.selected_requests ?? 0,
            distinctGroups: rows[0]?.distinct_groups ?? 0,
          };
        },
        Effect.catchTag("ClickHouseError", unavailable),
      );

      const sessions = Effect.fn("ClickHouseRequestLogReader.sessions")(
        function* (
          selection: Traffic.Selection,
          order: Session.SessionOrder,
          page: Session.Page,
          search: Option.Option<Search.Asked>,
        ) {
          const searched = Option.isSome(search)
            ? Option.some(yield* searchOf(search.value))
            : Option.none();
          const matching = Option.map(searched, ({ matching }) => matching);
          const params = {
            ...paramsOf(selection),
            ...Option.match(searched, {
              onNone: () => ({}),
              onSome: ({ params }) => params,
            }),
          };
          const rows = yield* clickHouse.select(
            sessionsSql(order, matching),
            SessionRow,
            {
              ...params,
              limit: Param.integer(page.limit),
              offset: Param.integer(page.offset),
            },
          );
          const [first] = rows;
          const total =
            first !== undefined
              ? first.total
              : page.offset === 0
                ? 0
                : ((yield* clickHouse.select(
                    sessionsCountSql(matching),
                    Schema.Struct({ total: Count }),
                    params,
                  ))[0]?.total ?? 0);
          return { rows: rows.map(sessionRowOf), total };
        },
        Effect.catchTag("ClickHouseError", unavailable),
      );

      const hits = Effect.fn("ClickHouseRequestLogReader.hits")(
        function* (
          selection: Traffic.Selection,
          search: Search.Asked,
          limit: number,
          after: Option.Option<Search.After>,
        ) {
          const { matching, params } = yield* searchOf(search);
          const rows = yield* clickHouse.select(hitsSql(matching), HitRow, {
            ...paramsOf(selection),
            ...params,
            limit: Param.integer(limit),
            ...Option.match(after, {
              onNone: () => ({
                after: Param.integer(0),
                after_at: Param.integer(0),
                after_session: Param.string(""),
                after_item: Param.integer(0),
              }),
              onSome: (last) => ({
                after: Param.integer(1),
                after_at: Param.integer(DateTime.toEpochMillis(last.at)),
                after_session: Param.string(last.session),
                after_item: Param.integer(BigInt(uint128Of(last.item))),
              }),
            }),
          });
          return rows.map(hitOf);
        },
        Effect.catchTag("ClickHouseError", unavailable),
      );

      const newestHits = Effect.fn("ClickHouseRequestLogReader.newestHits")(
        function* (sessions: ReadonlyArray<string>, search: Search.Asked) {
          const newest = new Map<string, Search.Hit>();
          if (sessions.length === 0) return newest;
          const { matching, params } = yield* searchOf(search);
          const rows = yield* clickHouse.select(
            newestHitsSql(matching),
            HitRow,
            { sessions: Param.strings(sessions), ...params },
          );
          for (const row of rows) newest.set(row.session, hitOf(row));
          return newest;
        },
        Effect.catchTag("ClickHouseError", unavailable),
      );

      const contents = Effect.fn("ClickHouseRequestLogReader.contents")(
        function* (wanted: ReadonlyArray<ItemKey>) {
          if (wanted.length === 0) return [];
          const rows = yield* clickHouse.select(contentsSql, ContentRow, {
            sessions: Param.strings(wanted.map(({ session }) => session)),
            items: Param.integers(
              wanted.map(({ item }) => BigInt(uint128Of(item))),
            ),
          });
          return rows.map(
            (row): FoundItem => ({
              session: row.session,
              item: digestOf(row.item),
              protocol: row.protocol,
              content: row.content,
            }),
          );
        },
        Effect.catchTag("ClickHouseError", unavailable),
      );

      const session = Effect.fn("ClickHouseRequestLogReader.session")(
        function* (id: string) {
          const [row] = yield* clickHouse.select(sessionSql, SessionRow, {
            session: Param.string(id),
          });
          return Option.map(Option.fromUndefinedOr(row), sessionRowOf);
        },
        Effect.catchTag("ClickHouseError", unavailable),
      );

      const summaries = Effect.fn("ClickHouseRequestLogReader.summaries")(
        function* (id: string, limit: number) {
          const rows = yield* clickHouse.select(summariesSql, SummaryRow, {
            session: Param.string(id),
            limit: Param.integer(limit),
          });
          return {
            summaries: rows.map(summaryOf).reverse(),
            cut: (rows[0]?.session_requests ?? 0) - rows.length,
          };
        },
        Effect.catchTag("ClickHouseError", unavailable),
      );

      const request = Effect.fn("ClickHouseRequestLogReader.request")(
        function* (id: Request.RequestId) {
          const [row] = yield* clickHouse.select(requestSql, RecordRow, {
            id: Param.uuid(id),
          });
          return Option.map(Option.fromUndefinedOr(row), foundOf);
        },
        Effect.catchTag("ClickHouseError", unavailable),
      );

      const sessionRequests = Effect.fn(
        "ClickHouseRequestLogReader.sessionRequests",
      )(
        function* (
          sessions: ReadonlyArray<string>,
          read: Session.Read,
          limit: number,
        ) {
          const found = new Map<string, Array<Session.SessionRequest>>();
          if (sessions.length === 0) return found;
          const rows = yield* clickHouse.select(
            sessionRequestsSql,
            SessionRequestRow,
            {
              sessions: Param.strings(sessions),
              headers: Param.strings(read.headers),
              params: Param.strings(read.params),
              types: Param.strings(read.inputTypes),
              limit: Param.integer(limit),
            },
          );
          for (const row of rows) {
            const each = found.get(row.session) ?? [];
            each.push(sessionRequestOf(row));
            found.set(row.session, each);
          }
          return found;
        },
        Effect.catchTag("ClickHouseError", unavailable),
      );

      const items = Effect.fn("ClickHouseRequestLogReader.items")(
        function* (wanted: ReadonlyArray<Wanted>) {
          const found = new Map<
            Request.RequestId,
            Record<Conversation.Part, Array<Session.StoredContent>>
          >();
          if (wanted.length === 0) return found;
          const asked = wanted.flatMap(({ session, id, parts }) =>
            parts.map((part) => ({ session, id, part })),
          );
          const rows = yield* clickHouse.select(itemsSql, ItemRow, {
            sessions: Param.strings(asked.map(({ session }) => session)),
            ids: Param.strings(asked.map(({ id }) => id)),
            parts: Param.strings(asked.map(({ part }) => part)),
          });
          for (const row of rows) {
            const parts = found.get(row.request) ?? {
              system: [],
              tools: [],
              input: [],
              output: [],
            };
            parts[row.part].push({
              digest: digestOf(row.digest),
              type: row.type,
              role: row.role,
              content: row.content,
            });
            found.set(row.request, parts);
          }
          return found;
        },
        Effect.catchTag("ClickHouseError", unavailable),
      );

      const latestQuotaHeaders = Effect.fn(
        "ClickHouseRequestLogReader.latestQuotaHeaders",
      )(
        function* (
          asked: ReadonlyArray<QuotaHeaderAsked>,
          since: DateTime.Utc,
        ) {
          if (asked.length === 0) return [];
          const rows = yield* clickHouse.select(
            latestQuotaHeadersSql,
            LatestQuotaHeadersRow,
            {
              since: Param.integer(DateTime.toEpochMillis(since)),
              pools: Param.strings(asked.map(({ pool }) => pool)),
              names: Param.strings(asked.map(({ name }) => name)),
            },
          );
          return rows.map(
            (row): LatestQuotaHeaders => ({
              pool: row.pool,
              name: row.header,
              startedAt: row.latest_at,
              headers: row.headers,
            }),
          );
        },
        Effect.catchTag("ClickHouseError", unavailable),
      );

      return RequestLogReader.of({
        latestQuotaHeaders,
        overview,
        points,
        breakdown,
        facets,
        errorGroups,
        sessions,
        hits,
        newestHits,
        contents,
        session,
        summaries,
        request,
        sessionRequests,
        items,
      });
    }),
  );

export const layer = layerWith(Search.bounds);
