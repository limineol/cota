import { Effect, Schema } from "effect";
import * as ClickHouse from "./client.ts";

// A batch tried again carries the token of its first try. ClickHouse skips an
// insert whose token is among a table's last 1,000 inserts, but remembers
// none for a table that is not replicated unless told to.
const remembersInserts = "SETTINGS non_replicated_deduplication_window = 1000";

const promptTokens =
  "prompt_tokens UInt64 ALIAS input_tokens + cache_read_tokens + cache_write_short_tokens + cache_write_long_tokens";

export const requests = `CREATE TABLE IF NOT EXISTS requests
(
    id UUID,
    started_at DateTime64(3, 'UTC'),
    first_byte_ms Nullable(UInt32),
    duration_ms UInt32,
    session String,
    session_source LowCardinality(String),
    machine LowCardinality(String),
    project LowCardinality(String),
    client LowCardinality(String),
    client_version LowCardinality(String),
    user_agent String,
    hub_key LowCardinality(String),
    pool LowCardinality(String),
    diverted_from LowCardinality(String),
    follows Nullable(UUID),
    login_fingerprint String,
    refusal_reset Nullable(DateTime64(3, 'UTC')),
    provider LowCardinality(String),
    protocol LowCardinality(String),
    operation LowCardinality(String),
    purpose LowCardinality(String),
    model LowCardinality(String),
    served_model LowCardinality(String),
    stream Bool,
    outcome Enum8('ok' = 1, 'error' = 2, 'refused' = 3, 'cancelled' = 4),
    upstream_status UInt16,
    error_type LowCardinality(String),
    error_message String CODEC(ZSTD(3)),
    stop_reason LowCardinality(String),
    usage_reported Bool,
    input_tokens UInt32,
    cache_read_tokens UInt32,
    cache_write_short_tokens UInt32,
    cache_write_long_tokens UInt32,
    output_tokens UInt32,
    reasoning_tokens UInt32,
    service_tier LowCardinality(String),
    cost_usd Nullable(Decimal(18, 12)),
    provider_request_id String,
    rate_limits Map(LowCardinality(String), String),
    client_headers Map(LowCardinality(String), String),
    usage String CODEC(ZSTD(3)),
    error_body String CODEC(ZSTD(3)),
    request_bytes UInt32,
    response_bytes UInt32,
    reading_complete Bool,
    ${promptTokens},
    INDEX session_bloom session TYPE bloom_filter GRANULARITY 4,
    INDEX id_bloom id TYPE bloom_filter GRANULARITY 4
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(started_at)
ORDER BY (started_at, id)
${remembersInserts}`;

export const requestItems = `CREATE TABLE IF NOT EXISTS request_items
(
    request_id UUID,
    session String,
    started_at DateTime64(3, 'UTC'),
    system Array(UInt128),
    tools Array(UInt128),
    input Array(UInt128),
    output Array(UInt128),
    layout String CODEC(ZSTD(3)),
    overlay String CODEC(ZSTD(3)),
    params String CODEC(ZSTD(3))
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(started_at)
ORDER BY (session, started_at, request_id)
${remembersInserts}`;

// Lowercased after splitting, not before (as a preprocessor would), so that
// ClickHouse lowercases the text and the search query alike whether it reads
// the index or scans the text: a preprocessor is applied only where the
// index is read (ADR-0015).
const textWords =
  "text_words text TYPE text(tokenizer = splitByNonAlpha, postprocessor = lowerUTF8(text))";

// A merge keeps the copy of an item with the greatest version: this one is
// greatest for the earliest (first_seen, request_id), the copy every reader
// answers, as the complement of the two side by side (request_id compared as
// the number its text spells, which is its order as text).
const version =
  "version UInt256 MATERIALIZED bitNot(bitShiftLeft(toUInt256(toUnixTimestamp64Milli(first_seen)), 128) + toUInt128(request_id))";

const itemsEngine = "ReplacingMergeTree(version)";

export const items = `CREATE TABLE IF NOT EXISTS items
(
    session String,
    digest UInt128,
    protocol LowCardinality(String),
    first_seen DateTime64(3, 'UTC'),
    request_id UUID,
    part Enum8('system' = 1, 'tools' = 2, 'input' = 3, 'output' = 4),
    position UInt32,
    type LowCardinality(String),
    role LowCardinality(String),
    content String CODEC(ZSTD(3)),
    text String CODEC(ZSTD(3)),
    ${version},
    INDEX ${textWords}
)
ENGINE = ${itemsEngine}
ORDER BY (session, digest)
${remembersInserts}`;

/**
 * The characters of a word (code points), each hashed to one of 64 bits: an
 * edit changes at most two of them, so two words whose bits differ in more
 * than twice the edits allowed are not within them.
 */
export const characterBitsOf = (word: string) =>
  `arrayFold((bits, character) -> bitOr(bits, bitShiftLeft(toUInt64(1), cityHash64(character) % 64)), ngrams(${word}, 1), toUInt64(0))`;

/** The log's words: every word of every item's text, as the text index splits and lowercases them, kept once by a merge. */
export const words = `CREATE TABLE IF NOT EXISTS words
(
    word String,
    characters UInt32 MATERIALIZED lengthUTF8(word),
    character_bits UInt64 MATERIALIZED ${characterBitsOf("word")}
)
ENGINE = ReplacingMergeTree
ORDER BY word`;

const wordsOfItems =
  "SELECT DISTINCT arrayJoin(arrayMap(word -> lowerUTF8(word), tokens(text, 'splitByNonAlpha'))) AS word FROM items";

export const wordsWriter = `CREATE MATERIALIZED VIEW IF NOT EXISTS words_writer TO words AS ${wordsOfItems}`;

/** The comment `words` has once it holds the words of every item written before it was made. */
export const wordsGathered = "the words of every item";

export const sessionTitles = `CREATE TABLE IF NOT EXISTS session_titles
(
    session String,
    title String,
    reported_at DateTime64(3, 'UTC'),
    machine LowCardinality(String),
    reported_by LowCardinality(String)
)
ENGINE = MergeTree
ORDER BY (session, reported_at)
${remembersInserts}`;

const IndexRow = Schema.Struct({ name: Schema.String });

const CommentRow = Schema.Struct({ comment: Schema.String });

const SessionItemsRow = Schema.Struct({
  session: Schema.String,
  items: Schema.FiniteFromString,
});

/** The most items one statement gathers the words of, so each answers well within the client's wait. */
const gatheredAtOnce = 200_000;

/** Consecutive sessions, in runs of at most `gatheredAtOnce` items, or one session that has more. */
const runsOf = (
  sessions: ReadonlyArray<typeof SessionItemsRow.Type>,
): ReadonlyArray<ReadonlyArray<string>> => {
  const runs: Array<Array<string>> = [];
  let run: Array<string> = [];
  let items = 0;
  for (const session of sessions) {
    if (run.length > 0 && items + session.items > gatheredAtOnce) {
      runs.push(run);
      run = [];
      items = 0;
    }
    run.push(session.session);
    items += session.items;
  }
  if (run.length > 0) runs.push(run);
  return runs;
};

/** The comment of the table `words`: `wordsGathered` once its words are gathered. */
export const wordsCommentSql = `SELECT comment FROM system.tables
  WHERE database = currentDatabase() AND name = 'words'`;

/**
 * Gathers the words of every item into `words`, unless its comment says they
 * are: the view `words_writer` already adds those of every item written
 * since it was made, and a word written twice is kept once by a merge, so
 * gathering again after a stop gathers nothing wrong. Each run writes again
 * the words the runs before it wrote, so the table is merged at once: a
 * word's widening reads every copy of the words its length allows.
 */
const gatherWords = Effect.fn("ClickHouseSchema.gatherWords")(function* () {
  const clickHouse = yield* ClickHouse.ClickHouse;
  const [table] = yield* clickHouse.select(wordsCommentSql, CommentRow);
  if (table?.comment === wordsGathered) return;
  const sessions = yield* clickHouse.select(
    "SELECT session, toString(count()) AS items FROM items GROUP BY session ORDER BY session",
    SessionItemsRow,
  );
  for (const run of runsOf(sessions)) {
    for (const list of ClickHouse.listsOf(run, (session) => session)) {
      yield* clickHouse.command(
        `INSERT INTO words ${wordsOfItems} WHERE session IN {sessions:Array(String)}`,
        { sessions: ClickHouse.Param.strings(list) },
      );
    }
  }
  yield* clickHouse.command("OPTIMIZE TABLE words FINAL");
  yield* clickHouse.command(
    `ALTER TABLE words MODIFY COMMENT '${wordsGathered}'`,
  );
});

const EngineRow = Schema.Struct({ engine_full: Schema.String });

/** The one line `prepare` logs for an `items` table made before it had a version. */
export const unversionedItems =
  "the request log's items table keeps the latest copy of an item a merge finds twice, not the earliest, so a search hit can move to a later request: rebuild it as docs/specs/request-log/spec.md (items) says";

/**
 * Creates the request log's tables that are missing, and the columns and
 * indexes a table made before lacks. An index added to `items` is built for
 * its rows by a mutation ClickHouse runs after `prepare` returns, once: until
 * it reaches a part, that part is searched by scanning its text. The log's
 * words are gathered from the items written before `words` was made, before
 * `prepare` returns. An `items` table made without its version is left as it
 * is, and said so in a log line.
 */
export const prepare = Effect.fn("ClickHouseSchema.prepare")(function* () {
  const clickHouse = yield* ClickHouse.ClickHouse;
  for (const table of [
    items,
    requestItems,
    requests,
    sessionTitles,
    words,
    wordsWriter,
  ]) {
    yield* clickHouse.command(table);
  }
  yield* clickHouse.command(
    `ALTER TABLE requests ADD COLUMN IF NOT EXISTS ${promptTokens}`,
  );
  const indexed = yield* clickHouse.select(
    `SELECT name FROM system.data_skipping_indices
     WHERE database = currentDatabase() AND table = 'items' AND name = 'text_words'`,
    IndexRow,
  );
  const [table] = yield* clickHouse.select(
    `SELECT engine_full FROM system.tables
     WHERE database = currentDatabase() AND name = 'items'`,
    EngineRow,
  );
  if (table !== undefined && !table.engine_full.startsWith(itemsEngine)) {
    yield* Effect.logWarning(unversionedItems);
  }
  if (indexed.length === 0) {
    yield* clickHouse.command(
      `ALTER TABLE items ADD INDEX IF NOT EXISTS ${textWords}`,
    );
    yield* clickHouse.command("ALTER TABLE items MATERIALIZE INDEX text_words");
  }
  yield* gatherWords();
});
