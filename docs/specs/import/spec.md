---
status: active
scope: apps/hub
owner: limineol
last_verified: 2026-11-23
review_by: 2027-02-23
supersedes: []
code:
  - apps/hub/src/import.ts
  - apps/hub/src/config/config.ts
  - apps/hub/src/modules/request-log/02-application/commands/import-days.command.ts
  - apps/hub/src/modules/request-log/02-application/interfaces/import-source.ts
  - apps/hub/src/modules/request-log/02-application/interfaces/request-log-archive.ts
  - apps/hub/src/modules/request-log/03-domain/import.ts
  - apps/hub/src/modules/request-log/04-infrastructure/import-source
  - apps/hub/src/modules/request-log/04-infrastructure/persistence/clickhouse/clickhouse-request-log-archive.ts
  - apps/hub/src/modules/request-log/04-infrastructure/persistence/clickhouse/client.ts
  - apps/hub/src/shared/04-infrastructure/hub-store/hub-store.ts
---

# Import

An import adds to the request log, and to the display names, what an import source holds that they lack: the prototype's log, which is Bifrost's request table and the prototype's conversation tables in its ClickHouse, and its dashboard's titles and names files. This spec covers the command, what is read, how each row is built, the order and the checks of a day, what is not carried, the report, and its laws. ADR-0025 gives the reasons, and the facts read from a real source on 2026-11-19 that the rules below rest on (its "Facts").

It belongs to the request-log module, the only module that knows the request log's tables, as the archive does (`docs/specs/archive/spec.md`); its display names go through the display-names module's commands.

## The command

```sh
COTA_CONFIG=<the hub's configuration> bun run import <import file> [--dry-run] [--from <YYYY-MM-DD>] [--to <YYYY-MM-DD>]
```

From the hub image (`docker compose run --rm hub bun run import …`) or a checkout. It reads, from the hub's configuration, `[clickhouse]` and its password, `[store] path`, and the pools' ids, protocols, providers and prices, and no other secret; and the import file:

| Table | Key | Holds |
| --- | --- | --- |
| `[source.clickhouse]` | `url`, `user`, `password` | The source's ClickHouse as this machine reaches it, and a user of it that can only select; `password` is a secret by reference (ADR-0009) |
| `[source.clickhouse]` | `bifrost_database`, `hub_database` | Optional: the databases of Bifrost's log and of the prototype's tables, `bifrost` and `hub` unless named |
| `[source.files]` | `titles`, `names` | Optional: the copies of the prototype dashboard's titles database and settings file, read against the import file's directory |
| `[pools]` | `<source pool> = "<pool>"` | The pool map: every source pool, to a pool of the hub's configuration |
| `[machines]` | `<source machine> = "<machine>"` | Optional: a machine tag the source wrote that is not the name the machine has now |

**Start.** Read the arguments, both files and the secrets; read the source's `system.columns` for the tables below and refuse a missing table or column, or one of another type; read the source's pools (`metadata.account`, else `provider`, over every request in the range) and refuse any the pool map does not name; refuse a target pool the configuration does not have, and one that is an observed pool, which only reported requests bill (ADR-0029); when the import file names a names file, open the hub store without migrating it, and refuse it unless it exists and its steps are exactly this hub's (`docs/specs/hub-store/spec.md`); run the request log repository's `prepare`. Any failure here is exit 2, before any day is read.

**Exit codes.** 0 when every day was added or already held and every name set or already named; 1 when a day failed; 2 when it could not start. A dry run exits 1 instead of 2 for source pools the map does not name, after listing them with their counts, so that the map can be written from it.

One import runs at a time, and not beside a restore. The hub may be running.

## What is read

Every statement sent to the source is a `SELECT`, with `max_execution_time = 30` and `http_wait_end_of_query = 1`, each answering within the source user's limit (30 seconds on the prototype): a day is read in pages of sessions, and a page's items in chunks. It sends no `readonly` setting: the source's user is read-only by its profile (`readonly = 2`), and such a user refuses any query that sets `readonly`, even to what it already is.

**No parameter grows with a day.** A statement's parameters travel in its URL, and ClickHouse refuses a field longer than its server's `http_max_field_value_size` (128 KiB unless the server says otherwise), counted as sent, percent-encoded: about 2,900 request ids. It reads the URL with the server's own settings before any setting the URL carries, so no statement can raise the limit (read in ClickHouse 26.3's and 26.8's source, and tried on 26.8). So a page is sent as its day and its first and last session key, and the source finds the page again from those: its sessions are the day's sessions from the first key to the last, and its requests the day's requests whose session key is between them (a request of the day is of one of the day's sessions). The two lists the import sends, the items whose first request it asks for and the sessions of the titles file, are sent in lists of at most 32 KiB as sent, as many statements as that takes. A session key is the client's, and is sent whole: a day with a key that alone passes the limit fails.

**An answer is whole, or the import fails.** A profile may cap an answer and end it early with no error (`max_result_rows` or `max_result_bytes` with `result_overflow_mode = 'break'`, as the prototype's reader has at 100,000 rows), or do the same to what a query reads, sorts, groups, joins or sends. So every statement also sends `max_result_rows = 0` and `max_result_bytes = 0`, which lift the caps on an answer's own size (the import bounds its answers by pages and chunks), and `throw` for each other overflow mode (`read_overflow_mode`, `read_overflow_mode_leaf`, `timeout_overflow_mode`, `timeout_overflow_mode_leaf`, `sort_overflow_mode`, `group_by_overflow_mode`, `distinct_overflow_mode`, `set_overflow_mode`, `join_overflow_mode`, `transfer_overflow_mode`), which leave the owner's other limits in place and make reaching one an error: the import fails, naming it (exit 2 at the start, else the day fails), and never counts the rows past it not carried. A profile that forbids changing one of these settings fails the first statement.

- `bifrost.logs FINAL`: `id`, `timestamp`, `session_id`, `metadata` (`account`, `project`, `host`, `fallback-from`), `user_agent`, `provider`, `model`, `object_type`, `params`, `status`, `stream`, `stop_reason`, `prompt_tokens`, `completion_tokens`, `cached_read_tokens`, `token_usage`, `cost`, `latency`, `error_details`.
- `hub.messages`, grouped by `(session_key, hash)` taking the earliest copy by `first_seen` (it is a `ReplacingMergeTree` with no version): `session_key`, `hash`, `first_seen`, `request_id`, `source`, `position`, `content`.
- `hub.request_items FINAL`: `request_id`, `session_key`, `timestamp`, `input`, `output`, `tools`.
- The titles file, opened read-only: `SELECT session_id, title FROM titles`.
- The names file: its `renames` object.

Nothing else: not `metadata.client` (no request carries it), not `hub.messages`' `type`, `role` and `text` (an item's own are read from its content), not Bifrost's conversation columns, not the prototype's views, not its environment, and not its dashboard's logins.

**The columns check** wants, as `system.columns` writes them: `timestamp` and `first_seen` `DateTime64(3)` (or `DateTime64(3, 'UTC')`); `session_id`, `metadata` and `user_agent` `Nullable(String)`; `params`, `status`, `token_usage` and `error_details` `String`; `stream` `Bool`; the three token columns `Int64`; `cost` and `latency` `Nullable(Float64)`; `id` a `UUID` or a text; `provider`, `model`, `object_type` and `stop_reason` a text (`String`, `LowCardinality(String)`, either `Nullable`); and `hub.sql`'s types for the `hub` tables (`session_key`, `request_id` and `content` `String`, `hash` `UInt64`, `source` `LowCardinality(String)`, `position` `UInt32`, `input`, `output` and `tools` `Array(UInt64)`).

## Building rows

**A source request's day** is the UTC day of its `timestamp`; **an item's**, of its first request (below); **a title's**, of its `reported_at` below. Both source times are UTC instants (ADR-0025, fact 1). **A source request item's day** is its request's, or its own `timestamp`'s when its request is not in `bifrost.logs`. **A day's sessions** are those of its requests, of its request items, and of the items first seen on it.

**Its id.** A UUID version 7: bits 0 to 47 the `timestamp` in Unix milliseconds; the version 7; the variant `10`; and the remaining 74 bits the first 74 bits of the SHA-256 of the UTF-8 bytes of `cota-import:bifrost:<id>`. The id is read as text, so an id that is not well-formed (a lone surrogate) is written with U+FFFD in its place, and two ids that differ only there give one; Bifrost's ids are UUIDs.

**Its pool.** `metadata.account` when not empty, else `provider`, through the pool map. So the pool map names a provider whenever any of its requests has no account, even a provider whose other requests all carry one; and a request with an account bills that account's pool whatever its provider, which a dry run counts (The report). `diverted_from` is `metadata.fallback-from` through the pool map, when not empty. `provider` is the configuration's provider of the pool.

**Its source form**, its `protocol`: `bifrost-chat` when its `object_type` is `chat_completion` or `chat_completion_stream`, whose items are Chat Completions messages; else `bifrost-responses`.

**Its operation**, by `object_type`: `responses_stream` and `responses` are `responses`; `chat_completion_stream` and `chat_completion` are `chat`; `count_tokens` is `count_tokens`; `list_models`, and a `passthrough` whose `params.path` ends `/models`, are `models`; a `passthrough` whose path ends `/alpha/search` is `search`; `image_generation` is `image`; anything else is `other`.

**Its outcome**: `ok` for `success`, `error` for `error`, `cancelled` for `cancelled`; otherwise `error` with `error_type` `cota_import_unfinished` and `error_message` `the prototype's log never recorded how this request ended`.

**Its error**, from `error_details` read as JSON: `upstream_status` its `status_code` when that is a number from 1 to 65,535, else 0 (and 200 for `ok`); `error_type` the `type` of its `error`, else that error's `code` (a number written as text), else the `type` or `code` of an `error` inside it; `error_message` that error's `message`, else the inner one's; `error_body` `error_details` as recorded, cut to 64 KiB. An empty or unreadable `error_details` gives empty texts and status 0.

**Its other columns.** `started_at` the `timestamp`; `duration_ms` the `latency` rounded to whole milliseconds, 0 when null or below 0, at most 4,294,967,295; `session` the `session_id` when not empty, or `request:<id>`; `machine` `metadata.host` through `[machines]`; `project` `metadata.project`; `client` and `client_version` the request log's rule over `user_agent`; `model`, `stream` and `stop_reason` as recorded; every column the source has no fact for, empty, 0, null or an empty map, and `reading_complete` true. Every text well-formed.

**Its usage.** When `token_usage` is not a JSON object with at least one key: `usage_reported` false, every class 0. Otherwise, with `read = cached_read_tokens`, `write` the usage's `prompt_tokens_details.cached_write_tokens` (0 when absent), and the split `cached_write_token_details.cached_write_tokens_5m` and `_1h` under `prompt_tokens_details`: `input_tokens = prompt_tokens − read − write`; `cache_read_tokens = read`; with the split, `cache_write_short_tokens` its 5-minute and `cache_write_long_tokens` its 1-hour writes, and without it `cache_write_short_tokens = write` and `cache_write_long_tokens = 0`; `output_tokens = completion_tokens`; `reasoning_tokens` the usage's `completion_tokens_details.reasoning_tokens` (0 when absent); `usage` the `token_usage` text. The usage **does not add up** when `prompt_tokens < read + write`, when the split's two do not add up to `write` (with `write` absent, they are `write`), or when a count is below zero or past what the request log holds (32 bits): it is not carried, and the request has `usage_reported` false.

**Its cost.** `Cost.of` over that usage and the pool's price for the model, the `Prices` port with the pool's protocol, as the writer computes it; none when the usage is not reported or the model has no price. Never the source's `cost`.

**Its items.** The items of a request's session are `hub.messages` of its `session_key`, `request:<source id>` read as `request:<id>`. An item's `content`, parsed as JSON and written in the canonical form, gives its `digest` (its SHA-256's first 128 bits), and its `type` and `role` are its own (`docs/specs/protocols/spec.md`); its `text` is by its source form's rule (`docs/specs/sessions/spec.md`, Source forms). An item whose `content` is not JSON is not carried, and counted.

**An item's first request** is the source's, its `request_id`, when that is a request of `bifrost.logs`; else the earliest request of `bifrost.logs` (by `timestamp`, then id) whose `hub.request_items` row names the item; else it has none, and is not carried, counted on the day it was first seen. The item is built on its first request's day, with `first_seen` that request's start and `request_id` its id; for the source's own request, `part` from `source` (`tools` for `tool`) and `position` the source's less 1, and otherwise the part and position where that request's row first names it, in the order tools, input, output. It is built again on each earlier day one of whose requests names it (a request that started before its first request and finished after it), with that day's earliest such request: no request is added before its items, and the earliest copy is the one the log keeps.

**Its `request_items` row**, when the source has one for the request: `system` empty; `input`, `output` and `tools` the source's hashes, each resolved to the digest of the session's item of that hash, in order; `layout` `[{"part":"tools","field":"tools","layout":"list"},{"part":"input","field":"input","layout":"list"}]`; `overlay` `[]`; `params` the source's `params` without its `tools` key (an empty object when `params` is not a JSON object). A request whose hashes do not all resolve to a carried item has no row, and its conversation is not carried. A `hub.request_items` row whose request is not in `bifrost.logs` is not carried, and counted.

**A title** of the titles file: `session` the `session_id`, `title` well-formed, trimmed and cut to 200 characters (empty ones are not carried), `reported_at` the latest `timestamp` of that session's source requests, `machine` empty, `reported_by` `import`. A title of a session with no source request is not carried.

**A display name** of the names file, of kind `pool`, `model`, `client`, `host` (as `machine`) or `project`: its key through the pool map for a pool and `[machines]` for a machine; its name trimmed. It is not carried when its kind is none of these, its pool is not in the map, its key is not 1 to 255 characters, its name is not 1 to 80 characters, or its name is its key (the dashboard shows the key when there is no name, so it would change nothing shown); of two that give one kind and key, the first in the file is set and the second not carried; it is **already named** when the owner has a name for that kind and key.

## A day

In ascending order of the days the source's requests and request items fall on, from `--from` (or the source's first) to `--to` (or its last), stopping at the first that fails:

1. Read the source's summary of the day: the count and the fingerprint (`sum(cityHash64(toString(id)))`) of its requests, the count of the items first seen in it, and the count of its `hub.request_items` rows.
2. In the import's ClickHouse session of the request log, one for the whole run, which the store ends once it has been idle for ten minutes (a day's source is read between its writes), and whose selects ClickHouse stops at ten minutes, as its add, rather than at the 30 seconds of the hub's other reads (the archive spec), for each table in the load order (`items`, `request_items`, `requests`, `session_titles`), make `archive_<table>` as the restore does (`DROP TEMPORARY TABLE IF EXISTS`, then `CREATE TEMPORARY TABLE archive_<table> ENGINE = MergeTree ORDER BY tuple() EMPTY AS SELECT * FROM <table>`). Read the day's sessions, with how many requests each has and how many hashes its request items name, and cut them, in order, into **pages** of at most 2,000 requests and 500,000 hashes, a session that alone is more a page of its own. For each page: read its requests and its request items; list its items, those first seen on the day and those its request items name, with their first copy's size; read their content in **chunks** of consecutive items of at most 16 MiB (an item that alone is more is a chunk of its own); build the rows; and insert them into the `archive_<table>` tables. Then the day's titles.
3. Read the summary again. Unless it is the same, and the rows read add up to it, the day fails: `the source changed while it was read`, or `the source gave <n> of its <m> requests`.
4. Check that each `archive_<table>` holds as many rows as were built, and count the rows the log does not hold.
5. Before any insert: a loaded request whose digests are neither held by its session nor loaded fails the day: `<n> requests carry items the log does not hold; import from <the earliest day such an item's first request is on>`. Then, for each table in the load order, insert into it the rows of `archive_<table>` the log does not hold, by the archive's Held, with `async_insert = 0` and `deduplicate_insert = 'disable'`, in blocks as the restore adds (Memory, below).
6. Verify: the count of rows of `archive_<table>` the log does not hold is 0 for every table; and the log's `requests` rows whose ids `archive_requests` holds gained, from before the inserts to after, exactly the count and checksum of the rows the log did not hold, and so did the `request_items` rows. Then drop the temporary tables.

**A dry run adds to tables of its own.** Its session also makes, for each table, a temporary `dry_run_<table>` of the table's columns, kept for the whole run, and its inserts of step 5 go there instead of the log's tables; in steps 4 to 6 a row is held when the log or `dry_run_<table>` holds it. So it reads, builds, checks, adds and verifies every day as a real import does, against the log as that import would leave it, and the counts it reports are a real import's of the same days: a day's items held by an earlier day of the run, and the earlier days' copies of an item, count as they would. It sends the log's tables no `INSERT`.

The display names are set after the last day, one at a time, for each not already named, reading the owner's names again just before. A dry run sets none.

**Memory.** The import holds at once one page (its requests, at most 2,000, and its request items, at most 500,000 hashes, unless one session's day is more), the digests of the items the page lists, and one chunk of items' content (at most 16 MiB, unless one item is more), with what is built from them; never a whole day. ClickHouse's side of step 5 is one statement per table over the day's `archive_<table>`, made in blocks of at most 16 MiB or 65,536 rows by one thread, as the restore adds (the archive spec, The restore, step 3): the search index's view (`words_writer`), which keeps the distinct words of each block it is given, holds one block's at a time, so its memory is bounded by the block and not by the day.

**Measured** on 2026-11-19, on this repository's development machine (ClickHouse 26.8 in a VM of 11.7 GiB), against constructed days of the source's shapes: 18,000 requests in 40 sessions, 147,000 items, and 18,000 request items naming 1,777,680 hashes. The items' content is either text drawn from a vocabulary of 50,000 words, or random base64, whose words are nearly all distinct, as a day of screenshots, hashes and paths has many.

| Day | Run | Time | The import's process | ClickHouse's add into `items` |
| --- | --- | --- | --- | --- |
| 2.81 GiB, vocabulary | dry run | 60.0 s (read 22.9 s, built 3.1 s, loaded 26.7 s) | peak footprint 592 MiB, largest resident set 1.65 GiB | into `dry_run_items`: 238 MiB, 12.7 s |
| 2.81 GiB, vocabulary | import | 124.8 s | peak footprint 549 MiB, largest resident set 1.77 GiB | 361 MiB, 74.5 s |
| 2.80 GiB, random | import | 189.1 s | peak footprint 512 MiB, largest resident set 1.82 GiB | 725 MiB, 148.9 s, 82.3 million words |
| 1.40 GiB, random | import | 116.2 s | peak footprint 624 MiB, largest resident set 1.62 GiB | 718 MiB, 90.4 s, 41.6 million words |

Before the add was made in blocks, the vocabulary day's import took 104.8 s with an add of 1.63 GiB in 57.0 s, and the random day's add ran ClickHouse out of memory (9.31 GiB) in `words_writer` after adding 122,283 of its 147,000 items. The source answered every statement within 1.8 seconds and 126 MiB, well within its 30 seconds. The real source's own times are its dry run's. The bound is not a law of the test tiers: a test would either read the settings back, which shows only that they are sent, or need a day of gigabytes; the measurement above is what holds it.

## The report

One line per day, in ascending order, then the names (when the import file names a names file), then the titles not carried (when there are any), then the facts never recorded, then a line for all:

```text
2026-10-28: added 812 requests, 3,120 items, 790 request items and 40 titles; cost $41.20 (the source recorded $43.95); not carried: 12 conversations (their items are not in the source), 3 usages (they do not add up)
2026-10-29: already held
2026-10-30: failed: the source changed while it was read; the rows added before it stay, and running the import again adds the rest
names: set 14, already named 2; not carried: 1 (pool old-plan is not in the pool map)
titles not carried: 2 titles (their session has no request), 1 title (they are empty)
not in the source, for every imported request: the body the client sent, the login's fingerprint, the quota headers, the kept headers and the purpose, the time to the first byte, the body sizes, the service tier, refusals and what was diverted after them, a title's time and machine
3 days: 1 added, 1 already held, 1 failed.
```

The reasons not carried are `conversations (their items are not in the source)`, `usages (they do not add up)`, `request items (their request is not in the source's log)`, `items (no imported request names them)` and `items (their content is not JSON)`; a title's are `(their session has no request)` and `(they are empty)`, on the titles line. A name's are each said with its kind and key: `<kind> is not a kind of name`, `pool <key> is not in the pool map`, `the name of <kind> <key> is not 1 to 80 characters`, `the key <kind> <key> is not 1 to 255 characters`, `the name of <kind> <key> is its key`, `<kind> <key> is named twice`. A dry run says `would add` for `added`, `would set` for `set` and `would be added` in the last line, then lists the source's pools over the range with their counts; `requests not of their pool's provider: <n> (<pool>, mostly <provider>: <provider> <count>, …; …)`, or `none`, which counts, for each pool of the hub the pool map names, the requests whose source `provider` is not the one most of its requests carry; the source's machines, user agents, statuses and object types with their counts; and each day's time to read, build and load with their sum. A count of one is singular, as the restore's. A name that could not be set makes the exit code 1, with what refused it on standard error.

## Laws

| Id | Law | Held by |
| --- | --- | --- |
| Z1 | **The source is only read.** Every statement an import or a dry run sends its source is a `SELECT`, or a read of `system.columns`. | clickhouse |
| Z2 | **The log only grows.** An import sends the request log's tables nothing but `SELECT` and `INSERT`, apart from `prepare`; its temporary tables are its own. | clickhouse |
| Z3 | **Only what is lacking.** An import adds to each table exactly the built rows of the days it adds that the log does not hold. | clickhouse |
| Z4 | **Nothing twice.** Importing a source that has not changed again, whole or any of its days, adds no row and sets no name. | clickhouse |
| Z5 | **The same id, every time.** A source request always gives the same id, a UUID version 7 whose time is its start, and two source requests with different ids never give one. | property |
| Z6 | **Every row accounted for.** For every day, each source request is built once, and each source request item is built or counted under one reason not carried. | property, clickhouse |
| Z7 | **Items before their requests.** No request an import adds is held by the log before every item its `request_items` row names is held by its session. | clickhouse |
| Z8 | **A conversation as the source held it.** For every imported request with a conversation, its items in order, read from the request log, are the source's items for it, each the same JSON value as the source's content. | property, clickhouse |
| Z9 | **Usage kept, cost priced here.** An imported request's token classes add up to the source's `prompt_tokens` and `completion_tokens`, and its cost is the price lists' for them, never the source's. | property |
| Z10 | **A dry run writes nothing.** A dry run sends the request log's tables no `INSERT` and the hub store no write, and the counts it reports are those a real import of the same days adds. | clickhouse |
| Z11 | **Added only when verified.** A day is reported added only when every row built for it is held, and the log's requests and request items of its ids gained the count and checksum of the rows it lacked. | clickhouse |
| Z12 | **The owner's names stay.** An import sets a display name only for a kind and key the owner has not named, and changes or removes no name. | property |
| Z13 | **A later report wins.** An imported title is never the latest report of a session that a machine reported after the import's source ended. | property |

Z5, Z6, Z8's building half, Z9, Z12 and Z13 are property tests of the rules that build rows (`03-domain`), over generated source rows: requests of every status, with and without a session, an account, a diversion, a usage object with and without the split of cache writes, usages that do not add up and counts past 32 bits; items in both source forms, repeated, and not JSON; hashes that do not resolve, and request items without a request; titles with and without a session; renames of every kind, mapped and not, over owner names generated beside them; and reports made after the source's last request. Z5 compares the ids of each generated request built twice and of every pair. Z6 counts each day's built and not carried against the generated source.

Z1 to Z4, Z6's ClickHouse half, Z7, Z8, Z10 and Z11 are of the ClickHouse tier, against a **constructed source**: two scratch databases of the prototype's shapes, a `logs` with the columns and types read above and `messages` and `request_items` as `hub.sql` makes them, filled with synthetic rows of several UTC days (the three statuses, split and unsplit cache writes, the passthrough listings and searches, requests with no session, sessions across midnight, items first seen on an earlier day, a request item with no request, the chat form and the responses form, each item type), read through a scratch user that can only select (and, for Z6, through one whose profile caps an answer's rows, and one whose profile caps the rows a query reads, each with an overflow that breaks, in blocks of one row so that the small source overflows as a large day does); and a scratch request log made by `prepare`, never the dev database `cota`. They run the import, read every statement each side was sent (Z1, Z2) and the order of the inserts (Z7), compare each table's rows with the built ones (Z3) and each imported request's rebuilt items with the source's (Z8), import again and find nothing added (Z4), run a dry run first and compare its counts with the real run's (Z10), and import through the capped users and find every day whole, or the import failed naming the limit, and import a day of one session of 5,000 requests and a day whose session keys and titles together pass 128 KiB as sent, and find each whole and nothing added by a second import (Z6), change the source between a day's two summaries, and damage a loaded row, and find the day failed and not reported added (Z11). Every law has a mutant in `tooling/mutants.table.ts`: a statement other than a `SELECT` sent to the source, a table made that is not temporary, the held rule left out of items and of requests, a request's id from a random UUID, a request item not carried and not counted, a source answer taken though its user's profile cut it short at its row cap or its cap on rows read, a list sent to the source not cut by its size, the tables added in the reverse order, a request whose items are not held let through, a request's tools and input swapped, the source's cost kept, the split of cache writes dropped, a dry run that inserts, a day reported added though its source changed or though the log did not gain the checksum of what it lacked, an owner's name set again, and an imported title stamped with the time of the import.

## Not built, on purpose

- **Writing to the source**, or emptying it once imported. The prototype's data is the way back.
- **Converting conversations into a protocol.** They stay in their source form (ADR-0025).
- **Importing the prototype's archive files.** The database holds the conversation once per session, and no past day lacks it.
- **Quota logins, the gateway's keys, the prototype's configuration.** Never read: given again to the hub, or made new.
- **An endpoint or a screen for an import.** It is run once or twice, from a terminal, and says what it did in its report.
- **Another source.** Bifrost's log and the prototype's tables are the only source; a second would be a second adapter of the same port.
