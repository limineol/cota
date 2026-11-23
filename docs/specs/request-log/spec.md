---
status: active
scope: apps/hub
owner: limineol
last_verified: 2026-11-23
review_by: 2027-02-23
supersedes: []
code:
  - apps/hub/src/modules/request-log/02-application
  - apps/hub/src/modules/request-log/03-domain/stored-items.ts
  - apps/hub/src/modules/request-log/03-domain/traffic.ts
  - apps/hub/src/modules/request-log/03-domain/stored-protocol.ts
  - apps/hub/src/shared/03-domain/conversation.ts
  - apps/hub/src/shared/03-domain/request.entity.ts
  - apps/hub/src/modules/request-log/04-infrastructure/persistence
---

# Request log

The request log is the record of every request the hub forwarded and of every conversation. This spec covers what it keeps of a request, how a conversation is stored once and rebuilt, and how requests reach storage, which is ClickHouse today. ADR-0007 gives the reasons. The code is `apps/hub/src/modules/request-log`, and paths below are under it. What each protocol contributes to a request is in `docs/specs/protocols`.

## A request

The relay gives each **request** to the request log's `RecordRequest` command once, when it is finished (`docs/specs/relay/spec.md`). In the hub a request is the `Request` entity (`shared/03-domain/request.entity.ts`), whose fields every request has sit beside its **origin**: `forwarded`, with what only a hub in the path can know (the protocol, the hub key that admitted it, the time to the first byte, the session's source, the user agent, a divert, a refusal's reset, the purpose, the served model, the provider's status, the service tier, the quota headers, the kept headers, the error body and the bytes), or `reported`, with its record form and the hub key that reported it (ADR-0029, `docs/specs/reported-requests/spec.md`). `RecordRequest` takes a forwarded request only. Its columns are the request's fields with its origin's beside them, each in the column of its name (`StoredItems.storedOf`, `03-domain/stored-items.ts`). The ClickHouse repository writes it as a row of `requests` and, when it carried a conversation, its items. The tables below are that repository's (`04-infrastructure/persistence/clickhouse/schema.ts`); the module's command and query know only the repository port (see The repository).

### `requests`

One row per request. Text columns are empty, not null, when there is nothing to say, and every text is well-formed (see Well-formed text).

| Column | Type | Holds |
| --- | --- | --- |
| `id` | `UUID` | The request's id, a UUID version 7 stamped with `started_at`. The client gets it as `x-cota-request`. An imported request's is made from its source's id (`docs/specs/import/spec.md`). |
| `started_at` | `DateTime64(3, 'UTC')` | When the hub received the request; for a request sent again after a refusal, when it was sent again. |
| `first_byte_ms` | `Nullable(UInt32)` | Time until the provider's first body byte. Null when none came. |
| `duration_ms` | `UInt32` | Time until the request was finished. |
| `session` | `String` | The client's session id, or `request:<id>` when it sent none. |
| `session_source` | `LowCardinality(String)` | Where the session id was read from (a header's name, or `body`); empty when the hub made the key. |
| `machine`, `project` | `LowCardinality(String)` | The tags. |
| `client` | `LowCardinality(String)` | The `x-cota-client` tag, else read from the user agent: `claude-code`, `codex`, `opencode`, `pi`, else the agent's first product name in lower case, else `unknown`. A forwarded request never claims a reported client: a tag naming one is passed over, and a user agent naming one gives `unknown` (`docs/specs/relay/spec.md`, R7). |
| `client_version` | `LowCardinality(String)` | The version in the user agent's first product. |
| `user_agent` | `String` | As sent. |
| `hub_key` | `LowCardinality(String)` | The name of the hub key that admitted the request. |
| `pool` | `LowCardinality(String)` | The pool billed: the fallback pool for a diverted request. |
| `diverted_from` | `LowCardinality(String)` | For a diverted request, the pool it named. |
| `follows` | `Nullable(UUID)` | For a request sent again after a refusal, the refused request's id. |
| `login_fingerprint` | `String` | The fingerprint of the login the client sent. Empty for a keyed pool and for a request without a login. |
| `refusal_reset` | `Nullable(DateTime64(3, 'UTC'))` | For a refused request, the reset the provider gave. |
| `provider` | `LowCardinality(String)` | The pool's provider, from the configuration. |
| `protocol` | `LowCardinality(String)` | `anthropic-messages`, `chatgpt-codex` or `openai-chat`, the protocol the hub forwarded it in; for an imported request, its source form, `bifrost-responses` or `bifrost-chat`, which no pool speaks (`docs/specs/sessions/spec.md`, Source forms). Says how to read the items. |
| `operation` | `LowCardinality(String)` | What was asked, in the protocol's words; `other` when the protocol does not know the path. |
| `purpose` | `LowCardinality(String)` | What the client itself says the request is for, where it says so. Never guessed. |
| `model` | `LowCardinality(String)` | The model asked for. |
| `served_model` | `LowCardinality(String)` | The model the provider says answered, when it says so and it differs. |
| `stream` | `Bool` | Whether the answer was an event stream (`docs/specs/relay/spec.md`, "When a request is finished"). When no answer came, whether the request asked for one. |
| `outcome` | `Enum8('ok' = 1, 'error' = 2, 'refused' = 3, 'cancelled' = 4)` | How it ended. |
| `upstream_status` | `UInt16` | The provider's HTTP status; 0 when it never answered. |
| `error_type` | `LowCardinality(String)` | The provider's error type or code, or the hub's (`cota_…`). |
| `error_message` | `String` | The provider's message, or the hub's. |
| `stop_reason` | `LowCardinality(String)` | Why the model stopped, in the provider's word. |
| `usage_reported` | `Bool` | Whether the provider gave usage. When false the six token columns are 0 and mean "unknown". |
| `input_tokens` | `UInt32` | Input that was not cached. |
| `cache_read_tokens` | `UInt32` | Read from cache. |
| `cache_write_short_tokens` | `UInt32` | Written to cache at the provider's default lifetime. |
| `cache_write_long_tokens` | `UInt32` | Written to cache at a longer lifetime. |
| `output_tokens` | `UInt32` | Output, reasoning included. |
| `reasoning_tokens` | `UInt32` | The part of output that was reasoning, where reported. |
| `service_tier` | `LowCardinality(String)` | The tier or speed the provider reports, else the one the request asked for where the protocol reads it (`chatgpt-codex`), when it changes the price. |
| `cost_usd` | `Nullable(Decimal(18, 12))` | The cost, in dollars, computed once when the request is written (`docs/specs/cost`). Null when the model has no price, usage was not reported, or the cost is a million dollars or more. |
| `provider_request_id` | `String` | The provider's id for the request. |
| `rate_limits` | `Map(LowCardinality(String), String)` | The response's quota headers, by name. |
| `client_headers` | `Map(LowCardinality(String), String)` | The request's headers on the protocol's allow-list. Never a credential. |
| `usage` | `String` | The provider's usage object, as JSON, verbatim. |
| `error_body` | `String` | The provider's error body, cut to 64 KiB. |
| `request_bytes`, `response_bytes` | `UInt32` | Body sizes as they crossed the hub. A refusal dropped for a divert never crosses: its `response_bytes` is 0. |
| `reading_complete` | `Bool` | False when the copy of the response could not be read to the end, so usage and output may be short. |
| `prompt_tokens` | `UInt64` | The prompt size, `input_tokens + cache_read_tokens + cache_write_short_tokens + cache_write_long_tokens`: an `ALIAS`, computed when read and never stored. 0 when usage was not reported, so a reader also checks `usage_reported`. `SELECT *` leaves an alias out; name it. |

`MergeTree`, partitioned by month of `started_at`, ordered by `(started_at, id)`, with bloom filter indexes on `session` and `id`. The token columns are 32-bit: a request with a count past 4,294,967,295, or a size past 4 GiB, is not written; the hub logs it and counts it as dropped. `prepare` adds `prompt_tokens` to a `requests` table made before it (`ADD COLUMN IF NOT EXISTS`).

### `request_items`

One row per request that carried a conversation.

| Column | Type | Holds |
| --- | --- | --- |
| `request_id` | `UUID` | The request. |
| `session` | `String` | Its session, as in `requests`. |
| `started_at` | `DateTime64(3, 'UTC')` | As in `requests`. |
| `system`, `tools`, `input`, `output` | `Array(UInt128)` | The digests of the request's items, in order, by part. |
| `layout` | `String` | JSON: for each part of the body, the field that holds it and whether it was absent, a list or a single value: `[{"part":"input","field":"messages","layout":"list"}, …]`. |
| `overlay` | `String` | JSON: what was taken out of items before they were stored, and where it goes back: `[{"part":"input","position":3,"path":["content",0,"cache_control"],"value":{"type":"ephemeral"}}, …]`. |
| `params` | `String` | JSON: the request body without its parts. |

`MergeTree`, partitioned by month, ordered by `(session, started_at, request_id)`.

### `items`

One row per conversation item per session.

| Column | Type | Holds |
| --- | --- | --- |
| `session` | `String` | The session. |
| `digest` | `UInt128` | The item's digest. |
| `protocol` | `LowCardinality(String)` | How to read `content`: as `requests.protocol`. |
| `first_seen` | `DateTime64(3, 'UTC')` | `started_at` of the first request that carried it. |
| `request_id` | `UUID` | That request. |
| `part` | `Enum8('system' = 1, 'tools' = 2, 'input' = 3, 'output' = 4)` | The part it was first seen in. |
| `position` | `UInt32` | Its place in that part of that request. |
| `type`, `role` | `LowCardinality(String)` | The item's own `type` and `role`, where it is an object that has them as strings. |
| `content` | `String` | The item's JSON in its canonical form, after the overlay was taken out. |
| `text` | `String` | The item's readable text, for search: what a person would read, without JSON, well-formed (see Well-formed text). |
| `version` | `UInt256` | `MATERIALIZED`, never written: the engine's version, `bitNot(bitShiftLeft(toUInt256(toUnixTimestamp64Milli(first_seen)), 128) + toUInt128(request_id))`, greatest for the earliest `(first_seen, request_id)`, with `request_id` read as the number its text spells (its order as text). `SELECT *` leaves it out. |

It has a text index on `text`, which search reads (`docs/specs/search/spec.md`, which says why it lowercases after splitting and what it costs):

```sql
INDEX text_words text TYPE text(tokenizer = splitByNonAlpha, postprocessor = lowerUTF8(text))
```

`ReplacingMergeTree(version)`, ordered by `(session, digest)`, not partitioned. When an item was written twice (see Writing), the copies are merged away in time, and the one kept is the one whose `version` is greatest: the earliest `(first_seen, request_id)`, the copy every reader answers (a search hit's `at`, `request` and `part`, `docs/specs/search/spec.md`, K8), whichever copy was written first. Two copies with one version are of one request, so they are the same row. Until a merge a query that needs one row per item says `FINAL` or groups by `digest`, taking the earliest copy as the merge would. Measured on 26.8.36.3 in a scratch database: `FINAL` and `OPTIMIZE TABLE items FINAL` keep the earliest copy whatever the order the copies were written in, a later `first_seen` or a greater `request_id` at the same `first_seen` losing; the text index is rebuilt for the merged part, and `hasAllTokens` still reads it alone. The engine without a version, which `items` had before, keeps the copy written last, so a hit could move to a later request after a merge, and across a cursor. A `version` before 1970 would not order (`toUInt256` of a negative number wraps), and no request id is.

**An `items` table made before it had `version`.** `prepare` does not change an existing table's engine: it creates `items` only when it is missing. When the `items` it finds is not `ReplacingMergeTree(version)` (in `system.tables.engine_full`), it logs one warning, every time it prepares, and carries on: `the request log's items table keeps the latest copy of an item a merge finds twice, not the earliest, so a search hit can move to a later request: rebuild it as docs/specs/request-log/spec.md (items) says`. To rebuild it, stop the hub (so nothing writes meanwhile), and, in the request log's database (`cota` here):

```sql
RENAME TABLE cota.items TO cota.items_unversioned;
-- The CREATE TABLE of items in schema.ts (04-infrastructure/persistence/clickhouse), with the database named:
CREATE TABLE cota.items
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
    version UInt256 MATERIALIZED bitNot(bitShiftLeft(toUInt256(toUnixTimestamp64Milli(first_seen)), 128) + toUInt128(request_id)),
    INDEX text_words text TYPE text(tokenizer = splitByNonAlpha, postprocessor = lowerUTF8(text))
)
ENGINE = ReplacingMergeTree(version)
ORDER BY (session, digest)
SETTINGS non_replicated_deduplication_window = 1000;
INSERT INTO cota.items (session, digest, protocol, first_seen, request_id, part, position, type, role, content, text)
    SELECT session, digest, protocol, first_seen, request_id, part, position, type, role, content, text FROM cota.items_unversioned;
-- Both must be equal before the old table goes (the insert already merges the copies within it, so rows may be fewer):
SELECT (SELECT uniqExact(session, digest) FROM cota.items), (SELECT uniqExact(session, digest) FROM cota.items_unversioned);
DROP TABLE cota.items_unversioned SYNC;
```

The copies the old table still held come over, merged to the earliest as they are inserted or later; ones it had already merged to a later copy stay as they were, since the earliest copy is gone. Then start the hub: `prepare` finds the version and logs nothing.

### `session_titles`

One row per title a machine reported (`docs/specs/sessions/spec.md`, Titles).

| Column | Type | Holds |
| --- | --- | --- |
| `session` | `String` | The session, as in `requests`: well-formed, as the report gave it. |
| `title` | `String` | Well-formed, trimmed and cut to 200 characters; empty when the report cleared the title. |
| `reported_at` | `DateTime64(3, 'UTC')` | When the hub received the report. |
| `machine` | `LowCardinality(String)` | The report's `x-cota-machine` tag, well-formed, trimmed and cut to 200 characters. |
| `reported_by` | `LowCardinality(String)` | The name of the hub key that reported it, or `owner`. |

`MergeTree`, ordered by `(session, reported_at)`, not partitioned. Rows are never changed; the latest report wins when read. The `SessionTitles` port (`02-application/interfaces/session-titles.ts`) stores reports and gives each session's latest; its ClickHouse adapter is `04-infrastructure/persistence/clickhouse/clickhouse-session-titles.ts`, and the in-memory one `05-tests/fakes/in-memory-session-titles.ts`.

### `words`

The log's words, which a search with a tolerance widens its words among (`docs/specs/search/spec.md`, Tolerance): every word of every item's `text`, as the text index splits and lowercases it.

| Column | Type | Holds |
| --- | --- | --- |
| `word` | `String` | A word: a token of `splitByNonAlpha` through `lowerUTF8`, as the text index stores it (`docs/specs/search/spec.md`, K6). |
| `characters` | `UInt32` | `MATERIALIZED`, never written: `lengthUTF8(word)`, its length in characters. |
| `character_bits` | `UInt64` | `MATERIALIZED`, never written: each of its characters (`ngrams(word, 1)`) hashed by `cityHash64` to one of 64 bits, all of them set. An edit changes at most two of them, so a word whose bits differ from a query word's in more than twice the edits it allows is not within them, and is never measured. |

`ReplacingMergeTree` with no version, ordered by `word`, not partitioned: a word written twice is one row after a merge, and a read groups by `word` until then. The materialized view `words_writer` writes the distinct words of every block written to `items` into it, as the block is written:

```sql
CREATE MATERIALIZED VIEW words_writer TO words AS
SELECT DISTINCT arrayJoin(arrayMap(word -> lowerUTF8(word), tokens(text, 'splitByNonAlpha'))) AS word FROM items
```

Nothing is deleted from `items` (Retention), so a word once written stays a word of the log.

**A database made before `words`.** `prepare` creates `words` and `words_writer` when they are missing, then gathers the words of the items written before: unless the comment of `words` is `the words of every item`, it reads each session's number of items (`GROUP BY session`), and for runs of consecutive sessions holding at most 200,000 items (or one session holding more) runs `INSERT INTO words SELECT DISTINCT … FROM items WHERE session IN {sessions:Array(String)}`, the view's query, so each statement answers well within the client's 35 seconds, with a run's sessions sent in lists of at most 32 KiB as a URL carries them (ClickHouse refuses a URL field past 128 KiB, `docs/specs/import/spec.md`, What is read); then it merges `words` (`OPTIMIZE TABLE words FINAL`), since each run writes again the words the runs before it wrote and a widening reads every copy until a merge, and sets the comment. `prepare` returns only after that. The view exists before the first of these runs, so an item written meanwhile is gathered by it; a word gathered twice is kept once, so a `prepare` stopped halfway gathers everything again at the next start and nothing is wrong. Until the comment is set, a search with a tolerance that widens answers 503 `urn:cota:request-log-unavailable` saying the words are still being gathered (`docs/specs/search/spec.md`, Tolerance); an exact search is unaffected. Measured on 26.8.36.3 through `prepare` itself (the search spec's Cost): 2.2 s for 1.2 million items whose words are 59,004, 7.7 s for 1.2 million items whose words are 5.4 million (the merge 0.7 s of it); in one statement, without runs, they took 1.8 s and 4.1 s.

Large text columns (`error_message`, `usage`, `error_body`, `layout`, `overlay`, `params`, `content`, `text`) are compressed with `ZSTD(3)`. Every table but `words` keeps `non_replicated_deduplication_window = 1000`, which a batch tried again needs (see Writing); `words` needs none, since a word written twice is one.

### Well-formed text

A request body is JSON, and JSON can write half of a surrogate pair alone, as an escape (`"\ud800"`), which `JSON.parse` reads as a string holding a **lone surrogate**. So can a provider's answer, a title reported to the API, and a header whose value is JSON (Codex's `x-codex-turn-metadata`, which gives `purpose`); the value of any other header cannot, since the hub reads a header's bytes as Latin-1. No UTF-8 holds a lone surrogate. ClickHouse takes rows as `JSONEachRow`, in which `JSON.stringify` writes one as its escape, and, measured on 26.8.36.3 in a scratch database, refuses the whole insert for a high one with no low one after it (code 25, `Cannot parse escape sequence: missing second part of surrogate pair`) and writes a low one alone as the three bytes `ED B0 80`, which are not UTF-8 and read back as three U+FFFD. A batch declined for its content is declined on every try. The writer splits a declined batch and, in the end, drops the one request the repository will not keep (Writing); making the text well-formed first keeps that request.

So a text the request log writes is **well-formed**: each lone surrogate in it becomes U+FFFD, and a text without one is written as it is. The writer makes every text of a request well-formed before it makes a batch (`StoredItems.wellFormed`, `03-domain/stored-items.ts`): every text column of `requests` (`rate_limits` and `client_headers` keys and values included), the `session` of every table, and an item's `type`, `role` and `text`. Two session ids that differ only in their lone surrogates are then one session. An item's `content` and a request's `layout`, `overlay` and `params` are left as they are: they are JSON written by `JSON.stringify` (`content` in the canonical form below), in which a lone surrogate is its six-character escape, so ClickHouse takes them and a body holding one comes back as it was sent (L1). The command `ReportSessionTitles` makes a report's session, title and machine well-formed the same way (`Title.keptOf`), so a reported title names the session the request log wrote.

## Splitting a body and putting it back

Each protocol names the **parts** of its request body: the top-level fields that hold the conversation, and which of the request log's parts (`system`, `tools`, `input`) each is (`docs/specs/protocols`). Only the operations a protocol names carry a conversation. Splitting a body gives:

- **params**: the body without those fields;
- for each part, its **layout**: the field, and whether it was `absent`, a `list` or a `single` value; and its **items**: the elements of a list (none for an empty list), or the one value, `null` included;
- the **overlay**: every value the protocol takes out of an item before it is stored, with the part, the item's position and the path inside the item where it was. A key that is taken out is taken out wherever it appears in the item, and what it held is kept whole.

Joining params, layout, items and overlay gives the body back: each value of the overlay is put back where it was, and each part is set in params as its layout says.

A request has a conversation when its operation carries one and its body can be read: the decoded body is JSON, is an object, holds only numbers a double can hold (a number such as `1e400` is not read), and is nested no deeper than 512 levels. A body that cannot be read, or is over the decoded body limit (`docs/specs/relay/spec.md`), has no conversation. The request is forwarded all the same.

The response's output is turned into items by the protocol too, at the position it came in, in the `output` part. They have no overlay. For `anthropic-messages` the output item is the assistant turn as the client sends it back in its next request, so that turn is the same item, stored once. For `chatgpt-codex` each output item is an item as Codex sends it back, under the conditions its protocol states.

### The canonical form and the digest

An item's **content** is its JSON written in the canonical form of RFC 8785:

- object keys sorted by their UTF-16 code units (so `"Z"` before `"a"` before `"é"`, and `"😀"` before `"ｚ"`), with no whitespace anywhere;
- strings as `JSON.stringify` writes them: `"` and `\` escaped, control characters as `\b`, `\t`, `\n`, `\f`, `\r` or `\u00xx`, a lone surrogate as `\udxxx`, every other character as itself;
- numbers as ECMAScript writes the double they parse to: `1.0` and `1e0` are `1`, `-0` is `0`, `1e21` is `1e+21`, and `12345678901234567890` is `12345678901234567000`.

An item's **digest** is the first 128 bits of the SHA-256 of the UTF-8 bytes of its content, read as a big-endian unsigned integer, and written in hex as 32 digits. For example, `{"role": "user", "content": [{"type": "text", "text": "What is 27 * 453?"}]}` has the content `{"content":[{"text":"What is 27 * 453?","type":"text"}],"role":"user"}` and the digest `c0971472ec3c4e4978e861fcac2fe310`.

**The same JSON value** means equal once each body is parsed as `JSON.parse` parses it: an object is the same whatever the order of its keys (and when a key is repeated, the last one counts), whitespace does not count, and two numbers are the same when they parse to the same double, `-0` and `0` included. A number JavaScript cannot hold exactly, such as an integer past 2^53, is therefore stored as the nearest double, and a rebuilt body gives that double back, not the digits that were sent. Two items that are the same JSON value once the overlay is out have the same content, and so the same digest.

### Once per session

Given the digests a session already has, a request's **new items** are those whose digest the session does not have, each once, at the part and position where the request first has it, in the order system, tools, input, output. Only they are written to `items`.

### Rebuilding a body

A request's body is rebuilt from its `request_items` row: for each part its layout says, the content of each digest, from the session's `items`, in order; the overlay put back; and the result set in params. A digest the session does not have gives no body.

## Laws

| Id | Law | Held by |
| --- | --- | --- |
| L1 | **A body comes back.** For every JSON object a protocol can split, joining what it was split into gives the same JSON value. | property, replay, clickhouse |
| L2 | **Once per session.** Two items of one session that are the same JSON value once the overlay is out have the same digest, and are stored once. | property, clickhouse |
| L3 | **Nothing invented.** Every item stored is an element of a body the hub forwarded or was built from a response it relayed, or an item an import copied from its source in its source form; a request whose body could not be read has no items, and says so by having no `request_items` row. | property, replay |
| L4 | **Text is well-formed.** The rows written for a request are its rows as sent with each lone surrogate in a text made U+FFFD, so that every text is well-formed; an item's content and a request's layout, overlay and params, which write one as its escape, are as sent. | property, clickhouse |
| L5 | **One request cannot stop the writer.** When the repository declines every batch that holds certain requests and stores every other batch, each other request is stored once, with a body that comes back, and, once one of them is stored, each of those requests is dropped and counted once. | property, clickhouse |
| L6 | **Nothing is dropped while nothing is stored.** While the repository declines every batch, the writer drops no request for it, and once the repository stores batches again every request is stored once. | property |

"The same JSON value" means equal as JSON: key order and whitespace are not kept, so a rebuilt body is not promised to be the same bytes.

L1 is tested with generated JSON bodies shaped like each protocol's, rebuilt by `RebuildConversation` from the in-memory repository (`05-tests/fakes`), and with every exchange's request body; the generated strings hold a lone surrogate now and then (about one body in ten). L2 is tested over generated sessions given to the fake of `RecordRequest`, which stores items in the in-memory repository as `RecordRequest` does. L3 is tested through the hub on real sockets, and over the request every exchange logs. L4 is tested with generated requests whose every text and whose body's strings and keys hold halves of surrogate pairs, high and low, alone and beside their other half, given to the fake of `RecordRequest`, which makes them well-formed as the writer does: the rows the ClickHouse mappers make of what was stored are compared with the rows of the request as sent, with each lone surrogate made U+FFFD, and the body is rebuilt.

L5 and L6 are tested with `RecordRequest` itself, pausing for milliseconds, over the in-memory repository, which declines a batch as a test tells it, with generated requests over a few sessions written in a generated batch size, a batch of one among them. For L5 a generated part of the requests is bad and the repository declines every batch that holds one: when any request is good, each good request is stored once and its body is rebuilt, and each bad one is dropped once. For L6 the repository declines every batch for a generated number of tries and then stores every batch: no request is dropped and each is stored once.

The clickhouse tier runs against a real ClickHouse (`bun run test:clickhouse`, which fails, and never skips, when it cannot reach one). For L1, `RecordRequest` over the ClickHouse repository writes the request of every exchange and a request of odd text, a lone high and a lone low surrogate among it, to the three tables, and each body is rebuilt from them. For L2, a session's turns are written across batches and across a `RecordRequest` started again, and each item is in `items` once. For L4, a request whose body holds a lone surrogate, and a request after it, are both written, the item's `text` with U+FFFD in its place, and the body is rebuilt as it was sent; the request of odd text is read back column by column, its session and a rate limit well-formed. For L5, the scratch database's `items` is given a constraint that an item's content does not hold a marker, so that ClickHouse declines, with its code, every insert that holds the item; `RecordRequest` over the ClickHouse repository writes requests of two sessions in one batch, one of them marked and followed in its session by a request of that batch and one of a later batch: every other request is in `requests` once and its body is rebuilt, and the marked one is not in `requests` and was dropped and counted once.

## Imported requests

An import (`docs/specs/import/spec.md`) adds requests the hub never forwarded, from the prototype's log, beside the ones it did. They are rows of these same tables, held to the same columns: an id that is a UUID version 7 stamped with `started_at`, made from the source's id; a `protocol` that names a source form; items in that source form, never converted into a protocol, so that L3 holds of them as copies of the source and not as bodies a client sent; and a cost priced by the price lists as the writer prices one. They are added through the archive's session and Held (`docs/specs/archive/spec.md`), never through the writer, and the archiver archives their days as any other.

## Writing

- `RecordRequest.execute(request)` (`02-application/commands/record-request.command.ts`) puts the request on a queue and returns. It never waits for the repository and never fails.
- Its writer takes requests off the queue in batches, makes each request's text well-formed (see Well-formed text), and gives each batch to the repository's `store`: the new items, the requests' items and the requests. The ClickHouse repository inserts them in that order, into `items`, then `request_items`, then `requests`, so a request row is never visible before its items.
- Before making a batch, the writer needs to know which digests each session already has. It remembers them for the last 512 sessions it has written, and asks the repository (`known`) once for a session it has not seen since it started. If that question fails, it stores every item of the session's requests in the batch, does not remember the session, and asks again with its next batch; in ClickHouse, `ReplacingMergeTree(version)` removes the copies in time, keeping each item's earliest (see `items`).
- A request's cost is computed once, as the batch is made: its pool's price for the model (the `Prices` port; `docs/specs/protocols`, Prices), then `Cost.of`. The ClickHouse repository writes it as the exact decimal of its picodollars.
- A request whose values cannot be made, because the code that makes them (its cost, its new items, its items) failed on it, is dropped, logged with its request id and counted (`cota_requests_dropped`). The writer carries on with the requests around it.
- The repository's `store` ends in one of three ways: the batch is stored; it **failed**, when the repository could not be reached or its answer was lost; or the repository **declined** it, answering that it will not keep the batch as it is (ClickHouse: any answer that is an exception with a code, be it a text it cannot parse, a batch past its memory limit, a full disk or a table that does not match the hub's rows).
- A batch that is declined is split into two halves. Each half is made again as a batch of its own, from the items the request log really has by then, and stored the same way, down to a request alone. A request declined alone is **set aside**, and the writer carries on with the rest. So a batch that was only too large is stored in parts, and nothing of it is lost.
- As soon as the writer has stored any other request, it tries each request set aside again, alone. One that is declined again is dropped, logged with its request id and the repository's reason, and counted (`cota_requests_dropped`). A request is therefore dropped only when the repository declined it alone, stored another request, and declined it alone again: a repository that declines everything, as with a full disk or tables that do not match the hub, has nothing dropped this way, and its requests wait as they do for a repository that cannot be reached. At the edge of a limit of the repository's own (a disk with room for a small insert and not a large one) a large request can still be dropped while small ones are stored; the log line carries the repository's reason.
- While requests are set aside and nothing has been stored since, the writer pauses, a second that doubles up to a minute, and then takes what the queue holds, without waiting: no more than fills a batch together with the requests set aside, but at least one, so that a request the repository would store is always reached. It stores what it took as above. If that stored nothing, it tries the requests set aside together, as one batch: stored, they are no longer set aside. While the repository declines everything, the requests set aside so grow past a batch by one with each pause, at most one a minute; the others wait on the queue, which drops its oldest when it is full.
- A request stored after one of its session that was set aside carries the items that one would have brought, since every batch is made from what the request log has; the request set aside, tried again, then brings none.
- A batch that fails is tried again, with a pause of a second that doubles up to a minute. A batch tried again is not stored twice: it is made once, and given to `store` with the same token on every try, derived from the batch's request ids. The ClickHouse repository gives each table's insert that token and the table's name as its `insert_deduplication_token`, and ClickHouse skips an insert whose token is among the table's last 1,000, so an insert that was stored before its answer was lost is not stored again.
- The queue holds 10,000 requests. When it is full, the oldest request is dropped, and the hub logs it and counts it (`cota_requests_dropped`).
- On shutdown the writer is given 10 seconds to empty the queue. What it has not written by then is dropped, logged and counted; a request given after `RecordRequest` closed is too, and so is a request still set aside when the queue is empty.
- At start the writer asks the repository to `prepare`, trying again as it does a batch, so the hub starts while ClickHouse is down. The ClickHouse repository creates the database's tables if they are missing; the database itself must exist. When `items` lacks the text index (in `system.data_skipping_indices`), it adds it (`ALTER TABLE items ADD INDEX IF NOT EXISTS …`) and builds it for the rows already there (`MATERIALIZE INDEX`), which returns at once and runs as a mutation: until the mutation reaches a part, a search scans that part's text, and finds what the index would. Run again, it finds the index and does nothing. It then gathers the log's words into `words` when its comment says they are not (see `words`), which it does before it returns.
- The ClickHouse repository's inserts are synchronous (`async_insert = 0`): ClickHouse has written a batch when it answers.

## The repository

`RecordRequest` and `RebuildConversation`, which rebuilds a body, reach storage only through the repository port, `RequestsRepository` (`02-application/interfaces/requests.repository.ts`), which speaks in requests, their costs and items, never in rows. The ClickHouse repository (`04-infrastructure/persistence/clickhouse/clickhouse-requests.repository.ts`) is one implementation of it, and its folder is the only place that knows the tables above, their column types and their tokens; `module.ts` chooses it in one line. Another implementation must honour the port's contract:

- `prepare` creates what is missing, and doing it again changes nothing.
- `holds` says whether it can keep every value of a request; `RecordRequest` drops, logs and counts a request it cannot hold, and never gives it to `store`.
- `store` keeps a batch so that no request is seen before its items. A batch given again with the token of a batch it stored, in whole or in part, is not stored twice. `RecordRequest` makes the token from the batch's request ids and gives a batch the same token on every try.
- `store` fails as `RequestsRepositoryFailed` when the repository could not be reached or did not answer, and as `RequestsRepositoryDeclined` when it answered that it will not keep the batch; the same batch given again is declined again unless the repository itself changed. A declined batch may have been kept in part, and its requests come again in smaller batches, under other tokens: a request's `request_items` row must not be kept twice then. The ClickHouse repository remembers the requests whose `request_items` row an insert wrote in a batch that then did not finish, and does not write that row again; it forgets a request once its `requests` row is written. An item may be written again, and a merge keeps one copy (see `items`). A request dropped after its items or its `request_items` row were written leaves them without a `requests` row, as a hub stopped between two inserts does.
- `known` gives the digests each session already has, and `conversationOf` a request's items with the content its session has for each, or nothing for a request without items. The ClickHouse repository reads the request's session from `requests` first (through the bloom filter on `id`), so that `request_items` and `items`, which are ordered by session, are read by it.

## Reading

The API's reading queries (`docs/specs/api/spec.md`, the traffic, sessions, requests and search groups) read through a second port, `RequestLogReader` (`02-application/interfaces/request-log-reader.ts`), in the module's terms: a selection (a window and filters, `03-domain/traffic.ts`) in, totals, series points, breakdown rows, facets and error groups out; and for sessions, a page of session rows (`03-domain/session.ts`), the latest requests of given sessions, at most a given number of each, with what the role rules read of each (`docs/specs/sessions/spec.md`), given parts of given requests with their items' content, one session's row and its latest requests' summaries, and one request's record by its id, with its params and the request sent after it was refused; and for search (`docs/specs/search/spec.md`), a page of hits after a given one, the selected sessions narrowed to those with a hit, the newest hit of given sessions, and given items' content; and for the quota sources (`docs/specs/quota-sources/spec.md`), for given pools and quota header names, the latest request of each pool since a given instant whose quota headers hold each name (by when it started, then by id, whatever its operation and outcome) with all its quota headers. `Transcripts.shownOf` gives what a transcript shows of an item, which a snippet is cut from. The queries in `02-application/queries/` hold the rules that are not storage (the default window, the previous window, the bucket, how many keys and rows, request roles, titles and first prompts) and ask the reader for the rest. Each traffic endpoint makes one ClickHouse query; the sessions list makes four, whatever the page's length: the page, its sessions' latest reports, their latest 10,000 requests each (`LIMIT 10000 BY session`, and only those requests' `request_items` rows), and the items of their first main requests' input and of their title requests' output. One session's detail makes five: its row, its latest report, its latest 10,000 requests as the role rules read them, its latest requests' summaries, and the items of its last segment's tip, its first main request's input and its title requests' output. The inspector makes three: the record, its session's latest 10,000 requests (for its role and segment), and its items. The quota sources' read makes one ClickHouse query for all the pools asked about, through `ARRAY JOIN` over `rate_limits`' names, grouped by pool and name. A page of search makes two: the hits and their items' content; `q` adds two to the sessions list: the newest hit of each session on the page and their content. A search with a tolerance widens its words inside the query that reads the hits (`docs/specs/search/spec.md`, How it runs), and the reader asks once, the first time, whether the log's words are gathered. A read by request id reads the request's session from `requests` first, through the bloom filter on `id`, and then only that session's rows of `request_items` and `requests`: `request_items` is ordered by session, and `requests` has a bloom filter on it. On a scratch request log of a million requests in 10,000 sessions, the detail took 26 to 35 ms, the inspector 25 to 30 ms and the body's two reads 9 to 11 ms; reading a request's `request_items` row through its session read 139 thousand rows where reading it by `request_id` alone read 491 thousand. A session of 200,000 requests (one `request_items` row and two new items each) beside 50 of 20, on a scratch database, before the role rules read a session's latest 10,000 alone and after (the median of three warm runs; the resident memory of the process running the hub's queries at its peak, one process running the four in turn, so its later peaks include what the earlier left):

| What | Before | After |
| --- | --- | --- |
| A page of 50 sessions holding it | 645 ms; ClickHouse 250 MiB at most; the hub 1,090 MiB | 93 ms; 24 MiB; 194 MiB |
| Its detail | 710 ms; 248 MiB; 1,432 MiB | 128 ms; 55 MiB; 263 MiB |
| The inspector, of its oldest and of its newest request | 610 ms; 263 MiB; 1,988 to 2,186 MiB | 80 ms; 21 MiB; 285 to 295 MiB |

The rows ClickHouse reads hardly change (1.44 to 1.46 million for the list, 1.27 to 1.29 million for the inspector): `requests` is not ordered by session, so finding a session's latest requests still reads its rows' small columns, as did reading all of them. What the limit removes is the 190,000 requests, with their digests and params, that were joined, sent and decoded only to be read by rules that now read 10,000.

- The ClickHouse reader (`04-infrastructure/persistence/clickhouse/clickhouse-request-log-reader.ts`) reads with the hub's own ClickHouse user. Every value a caller gives (instants, filter values, the time zone, limits, a session id, a search query) is a bound query parameter, never text in the SQL. ClickHouse reads a parameter in its escaped text format, unquoted, so the client takes a parameter only as a `ClickHouse.Param`, whose constructors escape a backslash, a tab, a line feed and a carriage return in a string (`Param.string`) and quote every string in an array (`Param.strings`): unescaped, `\n` in a session id would be read as a line break, and a tab or a trailing backslash would fail the query. Every select of the hub's own user (the reader's, and the writer's `known` and `conversationOf`) is sent with `readonly = 1`, `max_execution_time = 30`, `cancel_http_readonly_queries_on_client_close = 1` and `http_wait_end_of_query = 1`. ClickHouse answers once the query has ended, so a query that fails is always an HTTP error with ClickHouse's message. Without it, ClickHouse begins the answer and writes a failure after the rows it has already sent, as the connection closes; Bun's `fetch` can drop those last bytes (measured on 26.8.36.3 for the SQL user: 27 of 32 lost with eight queries at once), which leaves an answer broken off part-way. ClickHouse stops a select at 30 seconds with error 159 (`TIMEOUT_EXCEEDED`), or at what its session gives (an archive's session gives 10 minutes, `docs/specs/archive/spec.md`), and cancels it when its connection closes, which on 26.8.36.3 it does only for a query whose `readonly` is not 0 (a POST is not read-only by itself, so without `readonly` a query the hub stopped waiting for ran on). The hub waits for a select's answer 5 seconds past that limit, and 35 seconds for any other statement's unless it says otherwise, so ClickHouse's limit comes first; a user made with `as`, such as the SQL user, is bound by its own settings profile instead, so the SQL console's check reads that profile's values and not these. A query that fails, that ClickHouse stopped at its time limit, or that does not answer within 35 seconds, fails as `RequestLogUnavailable`, which says whether ClickHouse could not be reached or did not answer in time (error 159 included), or failed the query, and with which error code; ClickHouse's message is logged, never answered.
- The in-memory reader (`05-tests/fakes/in-memory-request-log-reader.ts`) answers the same questions in plain code, over the requests, request items and items the repository stored. The laws of the reading queries are tested over it, and H9 (`docs/specs/api/spec.md`) holds that the ClickHouse reader answers as it does, for generated request logs written by `RecordRequest`.

## SQL

Another port, the SQL console (`SqlConsole`, `02-application/interfaces/sql-console.ts`), runs a caller's SQL as the SQL user and lists the schema that user sees (`docs/specs/sql/spec.md`). Its ClickHouse adapter (`04-infrastructure/persistence/clickhouse/clickhouse-sql-console.ts`) makes and checks the SQL user and its settings profile at every start, apart from the repository's `prepare`: when that fails, SQL is unavailable and the request log is written and read as before. The contract tests run a scripted fake of it (`05-tests/fakes/scripted-sql-console.ts`). The writer's path (`RecordRequest`, `RequestsRepository`, the batches and their tokens) never uses it.

## Not built, on purpose

- **A spool on disk.** A hub that crashes loses what is on its queue (ADR-0007).
- **Classifying at ingest.** Whether a request is the main conversation, a subagent or a title is not decided when it is written, except where the client says so itself (`purpose`). The request roles are read rules (`docs/specs/sessions/spec.md`).
- **Retention.** Nothing is deleted. The daily archive (ADR-0018, `docs/specs/archive/spec.md`) copies each day's rows to files, and deletes nothing.
- **Migrations.** Until the first release the tables may change without one.
