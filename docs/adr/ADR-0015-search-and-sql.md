---
status: accepted
scope: apps/hub
owner: limineol
last_verified: 2026-11-13
review_by: 2027-02-13
supersedes: []
code:
  - apps/hub/src/modules/request-log/04-infrastructure/persistence/clickhouse
  - compose.dev.yaml
---

# ADR-0015: Search finds words through a text index, and SQL runs as a read-only user with fixed limits

## Context

The prototype searched by scanning: `positionCaseInsensitiveUTF8` over every stored item's text, whatever time range the page showed, plus the log's summaries. That is a substring search, and its cost grows with everything ever stored. The request log's `items` table is ordered by `(session, digest)` and not partitioned, so nothing but an index can skip text.

The prototype's SQL console ran as a ClickHouse user with `readonly = 2`, which lets a query change settings: only time and memory had constraints, so `SETTINGS max_result_rows = …` lifted its 5,000-row cap, and with `result_overflow_mode = 'break'` ClickHouse could return more rows than the cap anyway.

The hub pins ClickHouse 26.8.36.3 (`compose.dev.yaml`). In it the text index (`TYPE text`) is generally available: `enable_full_text_index` is 1 by default and its tier is `Production`.

## Measurements

Made on `compose.dev.yaml`'s ClickHouse (26.8.36.3, Docker with 6 CPUs, 12 GB), in a scratch database created and dropped for the purpose, never the `cota` database.

**Data.** An `items`-shaped table (`session`, `digest`, `first_seen`, `part`, `role`, `text` with `ZSTD(3)`, `ORDER BY (session, digest)`): 1,200,000 items in 2,400 sessions of 500 items each, spread over 90 days. The text is made of pseudo-words drawn with a skewed frequency from a vocabulary of 6,000, with a camel-case identifier every 17th word and a file path every 29th; 60% of items are 10 to 60 words, 30% 60 to 600 and 10% 600 to 4,000 (median 447 characters, 3.46 GiB in all, 1.22 GiB compressed). Three needles were planted: a rare word in 86 items, a three-word phrase in 7,932, and an identifier (`ReplacingMergeTree`) in 1,235, searched for by a substring from inside it (`placingmerge`). One table per candidate index, each merged to one part. A range is applied as the search applies it: sessions with a request in the range, from a `requests`-shaped table ordered by time.

**Method.** Each query five times, the median taken, warm (the data fits in memory, so these are CPU costs; a cold disk makes scans slower and the index's advantage larger), with the query condition cache off (it otherwise remembers which granules missed and flatters repeated scans). The query returns the matching `(session, digest)` pairs, which is the search's first step; snippets are read afterwards for one page.

**Index sizes** (compressed; the data is 1.22 GiB):

| Index | Size | Building, 1.2 M rows (insert, then merge) |
| --- | --- | --- |
| none | 0 | 7 s, 21 s |
| `text(tokenizer = splitByNonAlpha, preprocessor = lower(text))` (words) | 645 MiB | 19 s, 28 s |
| `text(tokenizer = ngrams(3), preprocessor = lowerUTF8(text))` | 301 MiB | 34 s, 29 s |
| `tokenbf_v1(262144, 3, 0)` on `lower(text)` | 80 MiB | 11 s, 31 s |
| `ngrambf_v1(3, 262144, 3, 0)` on `lower(text)` | 11 MiB | 18 s, 54 s |

**Time to find the hits, in milliseconds** (all time / last 7 days / last day):

| Index and query | Rare word | Substring inside a word | Frequent three words |
| --- | --- | --- | --- |
| none, `positionCaseInsensitiveUTF8` | 459 / 286 / 189 | 497 / 298 / 200 | 492 / 304 / 205 |
| words, `hasAllTokens(text, q)` | **3 / 5 / 2** | not found (not a word) | **4 / 6 / 4** |
| words, `text ILIKE '%q%'` (the index's dictionary scan) | | 381 / 386 / 402 | |
| n-grams, `hasAllTokens(text, q)` then `positionCaseInsensitiveUTF8` to confirm | 97 / 80 / 39 | 447 / 289 / 163 | 460 / 291 / 177 |
| `tokenbf_v1`, `hasToken(lower(text), q)` | 156 / 106 / 57 | | |
| `ngrambf_v1`, `lower(text) LIKE '%q%'` | 132 / 94 / 47 | 502 / 308 / 174 | |

Reading the snippets of one page of 50 hits afterwards, by primary key: 23 ms.

**What they show.**

- The word index answers from the index alone (`query_plan_direct_read_from_text_index`): it reads no text, so a frequent word costs what a rare one does, and a range barely matters. It is two orders of magnitude faster than a scan and grows with the number of matches, not the size of the log.
- No index helps a substring search much. The n-gram text index finds candidates fast, but confirming them reads the text of every granule a common substring touches, so its gain is a rare substring's; the word index's `ILIKE` scans its dictionary and is slower than a plain scan here, because the identifiers make 5.5 million distinct words per 300,000 items.
- Bloom filters saturate on long text: a granule here holds about 3,300 items and 10 MB of text, so `ngrambf_v1` answers "maybe" for nearly every granule, and `tokenbf_v1` skips about four granules in five for a rare word only.
- The word index is large: 53% of the compressed data, driven by distinct words. Synthetic identifiers make this an upper estimate for real conversations, which repeat their identifiers.
- With a range, `session IN (sessions with a request in the range)` uses `items`' primary key and cuts the rows read (to 67% for 7 days, 23% for one day, at 500 items a session); real sessions are longer, which prunes better.

**The SQL user, tried on the same server** with a scratch user granted `SELECT` on the scratch database only, and a settings profile:

- With `readonly = 2` and constraints (`max_result_rows MAX`, `result_overflow_mode CONST`, `max_execution_time MAX`), a query could not raise any constrained setting, by `SETTINGS`, by `SET` or in the URL (error 452), and could not lower `readonly`. With `readonly = 1` and the limits set in the profile, no setting can be changed at all (error 164), while `default_format`, `param_<name>`, `query_id` and `database` in the URL still work.
- `result_overflow_mode = 'break'` is not a hard cap: with `max_result_rows = 5001` a 100,000-row query returned 65,409 rows (one block), 100,000 rows with a larger block size, and 23,353 rows from a table; a `max_result_bytes` of 32 MiB let 100 MB through. `'throw'` is exact but fails the whole query.
- The user could not `INSERT`, `CREATE`, `DROP`, create a temporary table, call `url()`, `remote()`, `file()` or `executable()`, read `system.users`, `system.query_log` or `system.processes`, `KILL` a query or run `SYSTEM`. `system.tables` showed only what it was granted. A query past its `max_execution_time` stopped with error 159; one past `max_memory_usage` with error 241.
- `CREATE SETTINGS PROFILE OR REPLACE` gives the profile a new identity, and a user that named the old one silently loses it: `readonly` read 0 for that user until it was attached again.

## Decision

**Search finds words.** A query is up to 20 words; an item matches when its text contains every one of them, as words, case-insensitively, in any order. A word is what ClickHouse's `splitByNonAlpha` tokenizer makes after `lowerUTF8`: a longest run of characters that are not ASCII whitespace, punctuation or control characters (so `fetch_user_id` is three words and `café` one). The definition, the API and the laws are `docs/specs/search/spec.md`.

**The index is a text index on `items.text`**: `INDEX text_words text TYPE text(tokenizer = splitByNonAlpha, preprocessor = lowerUTF8(text))`. The query is passed as one string to `hasAllTokens(text, q)`, so ClickHouse splits and lowercases it exactly as it did the text; the hub never builds the token list itself. The ClickHouse repository's `prepare` adds the index when it is missing (`ADD INDEX IF NOT EXISTS`) and materializes it; parts written before are searched by scanning until the mutation reaches them, so results are right from the start.

> Amended when search was built (`docs/specs/search/spec.md`, How it runs): the index lowercases with `postprocessor = lowerUTF8(text)`, not a preprocessor. On 26.8.36.3 a preprocessor is applied only where the index is read, so a scan, with `use_skip_indexes = 0` or in a part the mutation has not reached, compared case-sensitively and missed hits the index found. A postprocessor lowercases each token on both paths, so a word is split first and lowercased second: a capital sigma ending a word before punctuation becomes `ς`.

> Amended when search gained a tolerance (`docs/specs/search/spec.md`, Tolerance), on 26.8.36.3: a search may take `prefix` and `fuzzy`, as MiniSearch does, and a word of the query then also matches a word that starts with it, or one within `min(2, round(n × fuzzy))` edits of it. Without them search is the one above, byte for byte. The text index cannot widen a word itself: with a postprocessor it serves no prefix or pattern condition, and reading its dictionary with `mergeTreeTextIndex` serves a prefix in 2 to 3 ms but reads every token for an edit distance (713 ms for 5.4 million). So the log's distinct words are kept in a table of their own, `words`, which a materialized view fills as `items` is written and `prepare` gathers once for a database made before it. A word of the query is widened inside the hits query, among `words`, to itself, its first 100 completions by length and then text, and its first 100 neighbours by edits and then text, and each word's list is matched with `hasAnyTokens`, ANDed, so the page is still answered from the index alone. On 1.2 million items, widening a word took under 40 ms among 5.4 million words, a tolerant page of a common word 70 to 131 ms, and `words` was 80 MiB beside 1.06 GiB of text.

**Search runs in two steps.** First the hits, `(session, digest, first_seen, part, role, request_id)`, from the index alone, newest first, one page at a time. Then the snippets of that page, by primary key. Text is never read for an item that is not on the page.

**The time range is honoured by session.** With a range, a hit's session must have a request (other than a model listing) that started in it: `session IN (SELECT session FROM requests WHERE started_at in range)`. This is the sessions list's own selection, so a search inside a range and the sessions it shows agree.

**SQL runs as a ClickHouse user that can only read the request log's database, with every limit fixed.**

- The user is `<database>_sql` (`cota_sql` for the database `cota`), identified by a random password the hub makes at each start and never shows. The ClickHouse repository's `prepare` creates the user and its settings profile when they are missing, alters them to the values below when they differ (never `OR REPLACE`, which detaches a profile), grants `SELECT ON <database>.*` and nothing else, and sets the password. This needs the hub's own ClickHouse user to have access management, as `compose.dev.yaml`'s has.
- The profile: `readonly = 1`, so no query can change any setting; `max_execution_time = 30`; `max_memory_usage = 4000000000`; `max_threads = 4`; `max_concurrent_queries_for_user = 4`; `max_result_rows = 5001` with `result_overflow_mode = 'break'`, which bounds the server's work; `cancel_http_readonly_queries_on_client_close = 1`, so a query the hub stops reading is cancelled; and the JSON output settings the hub decodes with (`output_format_json_quote_64bit_integers`, `output_format_json_quote_decimals`, `date_time_output_format = 'iso'`).
- After `prepare`, and before answering any SQL, the hub asks ClickHouse, as that user, for its `readonly`, `max_execution_time`, `max_memory_usage` and `max_result_rows` from `system.settings`, and checks them against the profile. If they differ, or the user could not be made, `POST /api/sql` and `GET /api/schema` answer 503 `urn:cota:sql-unavailable` with what is wrong, and the rest of the hub runs.

> Amended when SQL was built (`docs/specs/sql/spec.md`), on 26.8.36.3:
>
> - The profile also sets `output_format_decimal_trailing_zeros = 1`, which the hub's other reads set too, so a decimal keeps its scale.
> - The check after `prepare` reads every setting of the profile, not four, and also `SHOW GRANTS`, which must be the one grant: `SET ROLE ALL` is allowed under `readonly = 1`, so a role granted to the SQL user by hand would otherwise widen what it reads. `prepare` does not compare and alter what differs: it runs `CREATE … IF NOT EXISTS`, then `ALTER` with every value, and `GRANT … WITH REPLACE OPTION`, which takes away any other privilege (not a granted role, which the check catches).
> - It is the SQL console's layer that makes the user, not the repository's `prepare`, and it tries again only while ClickHouse cannot be reached; a refusal stays until the next start.
> - `readonly = 1` refuses a setting only when its value changes: one sent with the value it already has is accepted. The hub passes no URL parameter from the caller, so only `SETTINGS` and `SET` are open to a query, and both are refused for every other value.
> - A global `SYSTEM STOP MERGES` (and `TTL MERGES`, `MOVES`, `FETCHES`, `DISTRIBUTED SENDS`, `REPLICATION QUEUES`, `VIEWS`) with no table is accepted from the SQL user and stops nothing, as it covers only tables the user holds the `SYSTEM` grant on; ClickHouse answers it, and `SET ROLE ALL`, with no format and no body, which the hub reads as an empty answer.
> - The SQL user can read 24 `system` tables, each holding catalogues or its own data, and a few facts about the server (its host name, version, ports) and about tables in other databases (that they exist, with their engine, from errors). The SQL spec lists them; none is a value from another database.
> - `sqlite('<name>', …)` creates its file, empty, inside `user_files` before the access check refuses the query: the one change the SQL user can make, and harmless.
> - The hub bounds concurrent SQL only through `max_concurrent_queries_for_user = 4`; the fifth query is a 400 `query-failed` (`TOO_MANY_SIMULTANEOUS_QUERIES`).
> - ClickHouse frames an exception that follows rows with its message, then the message's length and the tag; the hub's `detail` is the message alone, without the version.
> - ClickHouse closes the connection after such a framed exception, and Bun's `fetch` can drop the bytes that arrived just before the close: the hub then lost the message and answered 503, in three of three runs of the ClickHouse tier's test of it alone, and in 27 of 32 such answers fetched eight at a time. The profile sets `http_response_buffer_size` to 49 MiB, more than the hub reads of an answer, so ClickHouse holds an answer back until it has that much or the query ends, and a query that fails while the hub could still be reading it is an HTTP error with the message. This bounds what is held back, so the cap still holds: past 49 MiB ClickHouse sends as before and the hub stops at its caps. It costs ClickHouse up to 49 MiB of memory for each of the four queries the SQL user may run at once.

> Amended when the limits became configuration (`docs/specs/sql/spec.md`, The limits): the six limits above (the time, the memory, the threads, the queries at once, the rows and the size of an answer, with `http_response_buffer_size` following the size) are the owner's, set in the configuration's `[sql]`, with the values above as defaults and bounds the configuration checks at start. "Fixed" means fixed for a caller: no query can change them, and the hub makes the profile from them and checks it at every start, so a hub started with other limits gives the SQL user them.

**The row cap is the hub's, and hard.** The hub asks for `JSONCompactEachRowWithNamesAndTypes` and reads the answer line by line: it keeps at most 5,000 rows and at most 16 MiB of them, and stops reading (which cancels the query) at the first row past either. `truncated` is true exactly when there was more. The answer is `{ columns, rows, truncated, elapsedMs }` (`docs/specs/sql/spec.md`). The prototype also gave rows and bytes read, from the statistics at the end of a `JSONCompact` answer; a format that is read row by row, and stopped early, has none, and ClickHouse's summary header is final only when it holds the whole answer back, which would undo the cap. A query that names its own `FORMAT` gets 400 telling it to leave the format to the hub.

The hub's own reading queries for the API run as its usual ClickHouse user, with their parameters bound (`{name:Type}`); only text a caller wrote runs as the SQL user.

## Alternatives weighed

- **No index**, as the prototype. Every search reads every item's text; 0.5 s at 3.5 GiB, in proportion beyond.
- **Substring search with an n-gram text index.** It keeps the prototype's semantics, at half the word index's size, but a common substring is as slow as a scan (447 ms), and its tokens cannot express "these words anywhere in the item". Words are what people search a conversation for: a name, an error, an identifier.
- **Bloom filters (`ngrambf_v1`, `tokenbf_v1`).** They saturate on items this long; making granules small enough to fix that would make `items`' primary index large for every other read.
- **Partitioning `items` by month, so a range prunes parts.** `ReplacingMergeTree` merges duplicates only within a partition, and a duplicate written later (the request log spec's "Writing") can carry a later `first_seen`, so it would never be merged away.
- **The hub's own ClickHouse user with `readonly = 1` per query.** It has every grant the writer needs, so a query could call `url()` or `remote()` and make ClickHouse fetch what it can reach. A user with `SELECT` on one database cannot.
- **A user the owner provisions in ClickHouse's configuration, with its password in `cota.toml`.** One more secret to manage for a user only the hub ever connects as; and the hub would still have to check its limits, which is the part that matters.
- **`readonly = 2` with constraints.** It lets a query set harmless settings, but also every setting nobody thought to constrain; `readonly = 1` leaves nothing to forget.
- **`result_overflow_mode = 'throw'`.** Exact, but a query that would return 5,001 rows gives nothing at all, where the owner wants the first 5,000 and to be told there is more.

## Consequences

- `items` grows by roughly half again on disk, and its inserts take about three times the CPU (19 s against 7 s for 1.2 million items, in batches the writer already makes off the request path).
- Search does not find part of a word: `placingmerge` does not find `ReplacingMergeTree`. That is the departure from the prototype's search, and it is in the search spec's "Not built, on purpose". With `prefix` it finds a word by its start, among the first 100 completions of the query's word.
- A tolerance keeps a second copy of the log's words, `words`, beside the index (8% of the text's size with 5.4 million words), and costs each insert of items about 15% more CPU (6 s more for 1.2 million items).
- The hub's ClickHouse user needs access management. A deployment where it does not have it still relays and reads; only SQL is off, and says why. Two hubs sharing one ClickHouse database would reset each other's SQL password; they share nothing else, and are not supported.
- A ClickHouse upgrade can change the text index or the SQL user's behaviour. The clickhouse tier holds both: the index's answers against a scan, and the SQL user's refusals.
