---
status: active
scope: apps/hub
owner: limineol
last_verified: 2026-11-13
review_by: 2027-02-13
supersedes: []
code:
  - apps/hub/src/modules/request-log/03-domain/search.ts
  - apps/hub/src/modules/request-log/02-application/queries/search-items.query.ts
  - apps/hub/src/modules/request-log/02-application/queries/list-sessions.query.ts
  - apps/hub/src/modules/request-log/02-application/interfaces/request-log-reader.ts
  - apps/hub/src/modules/request-log/04-infrastructure/persistence/clickhouse/schema.ts
  - apps/hub/src/modules/request-log/04-infrastructure/persistence/clickhouse/clickhouse-request-log-reader.ts
  - apps/hub/src/modules/request-log/05-tests/fakes/in-memory-request-log-reader.ts
  - apps/hub/src/modules/request-log/05-tests/search.ts
  - apps/hub/src/modules/request-log/01-presentation/search.api.ts
  - apps/hub/src/modules/request-log/01-presentation/filters.ts
---

# Search

Search finds the conversation items whose text holds every word of a search query, or, with a tolerance, a word near each. ADR-0015 gives the reasons and the first measurements behind the index. It is the `SearchItems` query of the request-log module (`02-application/queries/search-items.query.ts`) over the reading port, the text index on `items.text` in the ClickHouse repository (`docs/specs/request-log/spec.md`), and `GET /api/search` and the `q` of `GET /api/sessions` (`docs/specs/api/spec.md`).

## Words

A **word** is a longest run of characters none of which is an ASCII space, ASCII punctuation or an ASCII control character (DEL included), lowercased as a whole once it is split off, as ClickHouse's `lowerUTF8` lowercases it. So:

| Text | Words |
| --- | --- |
| `fetch_user_id failed: ECONNRESET` | `fetch`, `user`, `id`, `failed`, `econnreset` |
| `x-cota-key at 10:42` | `x`, `cota`, `key`, `at`, `10`, `42` |
| `Résumé of the CAFÉ order` | `résumé`, `of`, `the`, `café`, `order` |
| `日本語 テキスト` | `日本語`, `テキスト` |
| `foo—bar` (an em dash) | `foo—bar` |
| `ΑΣ'Β ΣΟΦΟΣ` | `ας`, `β`, `σοφος` |
| `İstanbul` | `i̇stanbul` (`lowerUTF8` lowercases `İ` to an `i` and a combining dot, as JavaScript does) |

This is ClickHouse's `splitByNonAlpha` tokenizer with `lowerUTF8` applied to each token, stated here so a test can hold the hub to it (K6). The order matters for one letter: a capital sigma that ends a word is lowercased to `ς` when the word is lowercased alone, but to `σ` when the whole text is lowercased first and punctuation follows it (`ΑΣ'Β`), because `lowerUTF8` looks at the characters after it. Text is taken as written: nothing is normalized, so `é` and an `e` followed by a combining accent are different words.

An item **matches** a search query when every word of the query is among the words of the item's `text` (the readable text the protocol gave it, `docs/specs/protocols/spec.md`), in any order and any number of times. With a tolerance (below), each word of the query need only be matched by one of the item's words under it.

## Tolerance

A search's **tolerance** is two optional parameters of `GET /api/search` and of the `q` of `GET /api/sessions`, as the MiniSearch library takes them (`{ prefix: true, fuzzy: 0.2 }`). Without them, search is exactly the search above: the same reads, the same SQL, the same answers and cursors.

| Parameter | Values | Default | A word of the query also matches |
| --- | --- | --- | --- |
| `prefix` | `true`, `false` | `false` | a word that starts with it, its characters first (a **completion**) |
| `fuzzy` | a number from 0 to 1 | 0 | a word within its **edits** (a **neighbour**) |

A word of `n` characters (code points) is allowed `min(2, round(n × fuzzy))` edits, rounded to the nearest whole number with halves up (`Search.editsFor`): at 0.2 a word of 1 or 2 characters is matched exactly, 3 to 7 with one edit, 8 or more with two; at 0.5, 3 characters allow two (1.5 rounds up). The **edits between** two words are their Levenshtein distance over code points (`Search.editsBetween`): the fewest characters inserted, removed or replaced that make one the other, so `relau` is one edit from `relay` and `kitten` three from `sitting`. The two parameters are independent: with both, a query word matches a word equal to it, or starting with it, or within its edits. Fuzziness is never applied to a prefix: `relauing` does not match `relay` with both on, since it neither starts with `relay` nor is within one edit of it (`Search.isMatch`).

The rest is unchanged: an item matches when **every** word of the query is matched (still AND); hits keep their order and their paging. There is no ranking: a client that wants the best answer first asks the exact search first and the tolerant one when it finds nothing.

**The bound.** A query word is not matched against every word an item could hold: it is first **widened** to a bounded list of **the log's words** (the distinct words of every item in `items`, kept in the table `words`, `docs/specs/request-log/spec.md`), and an item matches the word when one of its words is in that list. The list is, in this order (`Search.widened`, `Search.bounds`):

1. the word itself, always;
2. with `prefix`, its first 100 completions among the log's words, the shortest first (in characters), then by text (the bytes of their UTF-8);
3. with edits allowed, its first 100 neighbours among the log's words (within its edits, itself apart), the fewest edits first, then by text.

Each list has its own bound, so a word with many completions does not crowd out its neighbours. The order is nearest first and needs no count of anything, so both readers give the same list. Widening is **nested**: turning `prefix` on adds a list and changes no other; a larger `fuzzy` allows as many edits or more, and the first 100 neighbours within more edits begin with every neighbour within fewer that was among the first 100 (the fewest edits come first). So a hit of a search query is a hit of the same query with `prefix` on, or with a larger fuzziness (K9). A word past a bound is not found: a prefix of one or two characters seldom finds a word that is not among its 100 shortest completions, and a client that wants it gives more of the word. The log's words are those of every item ever written: the hub never deletes an item, and `words` is not pruned, so were items removed by hand their words would stay and take their places among the nearest 100.

**While the log's words are gathered.** A database made before `words` gets them from `prepare` once (the request log spec's `words`). Until then a search with a tolerance that can widen a word is the 503 `urn:cota:request-log-unavailable`, its `detail` saying the words are still being gathered; a search without one answers as always. A tolerant search never answers a wrong "no hits" from words not yet gathered.

## A search query

`q` is 1 to 200 characters holding 1 to 20 words. A `q` with no word (only punctuation or spaces) or more than 20 is the 400 of a parameter that does not decode. The query is given to ClickHouse as one bound string, `hasAllTokens(text, {query:String})`, which splits and lowercases it as it did the text; the hub splits it only to check the limits, and the in-memory reader to search. A person's query never reaches SQL as text.

## What is searched

The filters (`docs/specs/api/spec.md`, Filters) select **sessions**: those with at least one traffic request in the window that matches them. Search looks at the items of those sessions only, whenever each item was first seen. An item first seen before the window is found when its session also has a request inside it, as the session's page would show it.

## Hits

`GET /api/search` answers `{ hits, next }`:

| Field of a hit | Type | Holds |
| --- | --- | --- |
| `session` | string | The item's session. |
| `item` | digest | The item's digest. |
| `request` | id | The request that first carried it (`items.request_id`). |
| `part` | `system`, `tools`, `input`, `output` | Where it was first seen. |
| `role` | string | The item's own `role` (`user`, `assistant`, …), as an entry's message has it, or empty. |
| `at` | time | When it was first seen (`first_seen`). |
| `snippet` | `Snippet` | Below. |

Hits are ordered by `at`, newest first, then by `session`, then by `item` (its digest as hex text, which is its order as a number). An item written twice to `items` (the request log spec's "Writing") is one hit: its `at` is the earliest `first_seen`, and its `request` and `part` are those of the row with the earliest `(first_seen, request_id)`, before and after ClickHouse merges the copies, since the merge keeps that row (the request log spec's `items`, K8).

**Paging.** `limit` hits a page (1 to 100, default 20). `next` is an opaque cursor for the next page, or `null` on the last one; giving it as `cursor`, with the same `q`, tolerance and filters, continues after the last hit of the page. The cursor carries the window its first page read, so a window with an open end (`to` left out is now) does not move between pages, and an item recorded meanwhile, after that window, is not found. It also carries a digest of what was asked: `q` as written, `from` and `to` as given (an end left out stays left out), each filter's values in any order, and, when it is not the exact search, `prefix` and `fuzzy` (so an exact search's digest is the one it was before tolerances, and its cursors still continue). A cursor given with another `q`, another tolerance, another window or other filters, or anything that is not a cursor (one whose instants are not whole milliseconds within the ±8.64 × 10¹⁵ a time can hold included), is the 400 `urn:cota:stale-cursor`. A cursor is at most 2,264 characters (`Search.longestCursor`), the longest the hub makes; it is base64url, so its characters are ASCII and each is one byte and one UTF-16 unit. It is base64url of JSON whose instants are at most 17 digits and sign each, and whose session id, at most 255 characters (code points), takes at most six bytes of JSON a character (a control character or a lone surrogate is written `\u0001`; any other character takes at most four bytes of UTF-8); a longer one is the 400 of a parameter that does not decode.

**The snippet** is `{ text, start }`: up to 280 characters (code points, not UTF-16 units) of what a transcript shows of the item, starting 100 characters before the first of its words that matches the query's first word under the search's tolerance (or at the start, when that is nearer or none does), with `start` the offset, in characters, where it begins. What a transcript shows (`Transcripts.shownOf`) is the texts of the entries the protocol's renderer reads in the item (`docs/specs/sessions/spec.md`), joined by a blank line: a message's text and its other parts' JSON, reasoning where a transcript shows it, a tool call's input, a tool result's output and other items' JSON. Those are already without image bytes, data URLs, fields named `data` and encrypted reasoning, and an image part shows nothing. A tool definition, which no transcript shows, is its JSON as `Transcript.jsonOf` gives it, with the same withheld. An item can therefore match through text its snippet does not show; its snippet then starts at 0. The snippet is placed by the tolerance itself (`Search.isMatch`), not by the bounded list, so it can start at a word past the bound when the item matched through another word of the list later in its text. Snippets are read for the page's hits only.

**In the sessions list**, `q` selects the sessions with at least one matching item, `total` counts them, and each row's `snippet` is the snippet of its newest hit (the first in the order above). Without `q`, every row's `snippet` is `null`.

## How it runs

A page of search is two reads; a page of the sessions list with `q` is the list's own reads and two more:

1. The hits: `(session, digest, first_seen, part, role, request_id)` from `items` where `hasAllTokens(text, {query:String})` and the session is selected, grouped by `(session, digest)`, ordered as above, after the cursor's hit, `limit + 1` of them (the one past the page says whether there is a `next`). ClickHouse answers the condition from the text index alone (`EXPLAIN` shows it as a virtual column, `__text_index_text_words_hasAllTokens_…`) and reads no text.
2. The snippets: the content of the page's items only, by primary key `(session, digest)`.

For the sessions list with `q`, the selected sessions are narrowed to those with a matching item (`SELECT DISTINCT session … AND hasAllTokens(…)`) before they are counted and ordered; then come the newest hit of each session on the page (`LIMIT 1 BY session`) and their snippets.

**With a tolerance**, the condition `hasAllTokens(text, {query:String})` becomes one condition a query word, ANDed: `hasAnyTokens(text, (SELECT groupArray(word) FROM (…)))`, where the subquery is the word's widened list read from `words` in the order and bounds above, a `UNION ALL` of the word itself, its completions (`startsWith(word, {w0:String})`, `ORDER BY lengthUTF8(word), word LIMIT {completions:UInt32}`) and its neighbours (`editDistanceUTF8(word, {w0:String}) BETWEEN 1 AND {k0:UInt8}`, `ORDER BY` the edits, then `word`, `LIMIT {neighbours:UInt32}`). Every word of the query, its edits and the bounds are bound parameters; the hub splits the query into words with this spec's definition, which is ClickHouse's (K6). ClickHouse runs each subquery once, as a constant, and still answers the page from the text index alone (K7 checks `system.query_log` for `hasAnyTokens` index reads). A neighbour is measured only among the words whose length is within the edits (the column `characters`) and whose 64-bit character signature (`character_bits`, one bit set per distinct character, by `cityHash64(character) % 64`) differs from the query word's in at most twice the edits: an edit adds at most one character and removes at most one, so each changes at most two bits, and the filter never drops a neighbour. The hub checks once, then remembers, that the table's comment says the log's words are gathered.

ClickHouse 26.8 offers no cheaper way, measured: the text index answers no prefix or pattern condition through its dictionary when it has a postprocessor (which K7 needs), and `mergeTreeTextIndex(database, table, index)`, a table function that reads an index's dictionary of tokens, pushes a prefix down (2 to 3 ms on 5.4 million words) but reads every token for an edit distance (713 ms, 132 ms just to count them). So the log's words are a table of their own, filled as `items` is written.

**The index** is `INDEX text_words text TYPE text(tokenizer = splitByNonAlpha, postprocessor = lowerUTF8(text))`. ADR-0015 names a `preprocessor`. Measured on 26.8.36.3, a preprocessor is applied only where the index is read: with `use_skip_indexes = 0`, or in a part the index has not reached yet, `hasAllTokens` scans the text without it, case-sensitively, and did not find `HELLO`, `café` or `école` in text holding `hello`, `CAFÉ` and `École`, which the index found. That breaks K7, and would make a search wrong while `prepare`'s mutation runs. A postprocessor is applied to the text's tokens and the query's alike on both paths, so the index and a scan agree (K7, in ClickHouse); it lowercases each token alone, which is why a word is split first and lowercased second.

**Cost of exact search**, measured on `compose.dev.yaml`'s ClickHouse (26.8.36.3, Docker with 6 CPUs, 12 GB) in a scratch database created from the hub's own DDL and dropped afterwards, with the query condition cache off, the median of five warm runs after a first. The data: 1,200,000 items in 2,400 sessions of 500, first seen over 90 days, and 48,000 requests, 20 a session at random times over the same 90 days. The text is pseudo-words drawn with a skewed frequency from a vocabulary of 6,000, with a camel-case identifier every 17th word and a file path every 29th; 60% of items are 10 to 60 words, 30% 60 to 600 and 10% 600 to 4,000 (median 308 characters, 2.40 GiB, 925 MiB compressed). The common word is in 1,051,955 items, the rare one in 87. Each table was merged to one part.

| What | With the index | Without (`use_skip_indexes = 0`) |
| --- | --- | --- |
| The index's size against the `text` column's, compressed | 523 MiB, 57% of 925 MiB | |
| Writing 1.2 M items, then merging them to one part | 15.2 s, 26.4 s | 13.1 s, 10.8 s |
| A page of hits for the common word, last 90 days / last 7 days | 97 / 75 ms | 1,149 / 1,151 ms |
| A page of hits for the rare word, last 90 days / last 7 days | 10 / 9 ms | 1,284 / 1,291 ms |
| The snippets of a page of 20 hits | 14 ms | |
| Counting the sessions a search query selects, common / rare word | 9 / 5 ms | |
| `prepare` on a table of 1.2 M items without the index: `ADD INDEX`, then `MATERIALIZE INDEX` | 59 ms and 18 ms to return; the mutation finished 17.7 s later, and a search during it found every hit | |

The index and the scan returned the same pages. A rare word costs what ADR-0015 measured. A common word costs more, because a page is the newest hits, so every match is grouped and ordered by time before the page is cut: the cost grows with the number of matches, about 100 ms for a million, still an order of magnitude under a scan. Seven days prune little here because the synthetic sessions have requests spread over all 90 days. The index is larger against its column than ADR-0015's 53%; synthetic identifiers make this an upper estimate.

**Cost of a tolerance**, measured the same way through the hub's own `prepare` and reader, on two logs of 1.2 million items: the one above, whose log has 59,004 distinct words, and one whose text adds generated hex ids, numbers and identifiers such as `fetch706710Record` and `Get10702Handler` until it has 5,413,215 (text 1.06 GiB compressed, its index 646 MiB). `prepare` gathered each log's words, with `words` merged to one part. A page is 21 hits over 90 days; `w1` is a common word (in 854,388 of the first 200,000 items' words), `file` another, and the long words are rare.

| What | 59 thousand words | 5.4 million words |
| --- | --- | --- |
| `words`' size, compressed, against `text`'s | 413 KiB, against 925 MiB | 79.9 MiB (8% of 1.06 GiB) |
| `prepare` gathering the words of 1.2 M items | 2.2 s | 7.7 s |
| Writing 1.2 M items with `words_writer` | about 6 s more CPU than without (35.7–37.9 s to 41.6–42.6 s user) | |
| Widening one word: a prefix | 2–3 ms | 2–3 ms |
| Widening one word: `w1`, both at fuzzy 1 (201 words) | 10 ms | 7 ms |
| Widening one word of 9 to 16 characters, two edits (`conection`, `get10702handlr`, `fetch706710recrd`, a 16-digit hex id) | 11–12 ms | 9–37 ms |
| A page, exact, common word (`w1` / `file`) | 73 / 97 ms | 86 / 89 ms |
| A page, `prefix`, common word (`w1`, 101 words / `file`) | 115 / 88 ms | 131 / 107 ms |
| A page, `fuzzy` 0.2, common word (`w1` / `file`) | 76 / 110 ms | 70 / 97 ms |
| A page, both, common word (`w1` / `file`) | 110 / 97 ms | 110 / 115 ms |
| A page, both, a long rare word | 17–29 ms | 17–47 ms |
| A page, three words, both at 0.5 | 43 ms | 55 ms |

The exact search runs the same SQL as before and costs what it did. A tolerant page of a common word costs what an exact one does, up to about 40 ms more for a hundred completions; widening a word is under 40 ms, most of it measuring the neighbours of a long word among the words of its length. `words` is a ReplacingMergeTree: a word written again (by every batch of items that holds it) is kept once only after a merge, and until then each copy is read. Unmerged, with 2.3 copies of each word, widening a 16-character word took 54 to 67 ms; this is why `prepare` merges `words` once it has gathered them (0.7 s for 5.4 million words), and why the words of recent items, which merges have not reached, cost a little more.

## Laws

| Id | Law | Held by |
| --- | --- | --- |
| K1 | **Only matches.** Every hit is an item that matches the search query. | property, clickhouse |
| K2 | **Every match.** Every item of a selected session that matches the search query is a hit on some page. | property, clickhouse |
| K3 | **The window holds.** Every hit's session has a traffic request in the window that matches the filters. | property, clickhouse |
| K4 | **Pages partition.** Reading every page from the first, by `next`, gives every hit once, in order. | property |
| K5 | **Case does not matter.** Two search queries that lowercase to the same text have the same hits. | property, clickhouse |
| K6 | **The hub's words are ClickHouse's.** For every string `s`, the words this spec defines are ClickHouse's `arrayMap(word -> lowerUTF8(word), tokens(s, 'splitByNonAlpha'))`. | clickhouse |
| K7 | **The index is a scan.** For every search query and log, the hits, and the sessions a search query selects, are the same with the index as without it. | clickhouse |
| K8 | **The earliest copy.** An item written to `items` twice is one hit, whose `at`, `request` and `part` are those of its earliest copy by `(first_seen, request_id)`, before and after ClickHouse merges the copies. | clickhouse |
| K9 | **Tolerance only widens.** A hit of a search is a hit of the same search query with `prefix` on, or with a larger fuzziness. | property |
| K10 | **The bound.** A word of the search query is widened to itself, its first completions by length and then text, and its first neighbours by edits and then text, up to the bounds. | property, clickhouse |
| K11 | **The hub's edits are ClickHouse's.** For every two strings that are not empty, the hub's edits between them are ClickHouse's `editDistanceUTF8`. | clickhouse |

K1 to K5, K7 and K8 hold for every tolerance: K1 is that every word of the query is matched under the tolerance by a word of the hit, K2 that every item matching so (through the log's words widened as above) is a hit.

The in-memory reader searches by splitting each item's text into words as defined above. The property tests (`search.laws.test.ts`) run K1 to K5 against it over generated logs and search queries, each drawn with a tolerance half the time (`prefix` either way, `fuzzy` among 0, 0.1, 0.2, 0.25, 0.34, 0.5 and 1, or any thousandth), and with queries that are prefixes and one- or two-edit neighbours of the generated texts' words (`rel`, `relau`, `relya hang`, `econnrest`, `promt`, `istanbu`, `résum ordr` and others, `05-tests/sessions.ts`), with pages of 1 to 5 hits; K1 and K2 restate the widening in the test (`05-tests/search.ts`) rather than call the reader's, K2 also with `fetch` against `fetch_user_id`, and with `relau` at 0.2 and `rel` as a prefix, and K5 with `RELAY hang` against `relay hang`, each over one fixed generated log, since a generated search query seldom reaches a word joined by an underscore and a generated recasing seldom reaches a word before punctuation, and H4 (`docs/specs/api/spec.md`) over search too. The generated texts and search queries hold punctuation, mixed case, accents, a final sigma, `İ`, `ß`, a tab and a backslash, Chinese and Japanese (`05-tests/sessions.ts`). K9 runs over generated logs and searches, each widened by `prefix` or by more fuzziness, and over the fixed log with `relau` at 0.2, at 0.5 and with `prefix`. K10 gives each reader bounds of two over a fixed log whose word `relay` has four completions and five neighbours within one edit (`relays` is both), and checks the words found with `prefix`, with `fuzzy` 0.2 and with both: `relay`, `relayed`, `relays`; `delay`, `relax`, `relay`; and all five. K11 compares `Search.editsBetween` with ClickHouse's `editDistanceUTF8` over more than 1,500 generated pairs from every plane, near ones among them; ClickHouse gives the length in bytes of the other string when one is empty, which is no word, so the law is over strings that are not. K6 holds the definition to ClickHouse's tokenizer over more than 2,000 generated strings, ASCII and not, drawn from every plane, so the fake searches as the store does. K7 asks two readers, one with `use_skip_indexes = 0`, over exact and tolerant searches, and checks in `system.query_log` that the first read the text index (`hasAllTokens`, and `hasAnyTokens` for a tolerance) and the second did not, so a ClickHouse upgrade that changed the index's answers fails the tier. K8 writes a session's items, then, with the writer's question about the session's items failing, writes them again in later requests (one copy later by a minute and in another part, one at the same instant under a smaller request id, so it is the earliest though written last), with merges stopped; both readers' hits and newest hits, exact and with `rela` as a prefix and `condit` at fuzzy 0.2, are compared before and after `OPTIMIZE TABLE items FINAL`, which must leave one row per item. H9 also writes half of each generated log again in this way and compares the readers before and after the merge. K1, K2, K3 and K5 also run in ClickHouse (`clickhouse-search.clickhouse.test.ts`) with tolerances drawn as above, and H9 compares both readers' hits, pages and searched sessions over generated logs and tolerances, and the newest hits of every session exact, with `prefix`, at 0.2 and with both at 0.5. Together they make the property tests' results the real hub's.

## Not built, on purpose

- **Part of a word.** `placingmerge` does not find `ReplacingMergeTree`; `merge` finds `merged` only with `prefix`, and nothing finds a word by its end or middle. The prototype searched substrings by scanning; ADR-0015 measured why Cota does not.
- **Phrases and order.** `"rate limit"` finds items with both words anywhere. `hasPhrase` reads the text of every candidate (ADR-0015).
- **Ranking.** Newest first is the only order, with a tolerance too: a hit through an exact word is not put before one through a neighbour.
- **Marking the words in a snippet.** A snippet is plain text and its offset; a client marks the words if it wants to.
- **Searching requests' columns** (error messages, models). The errors and facets endpoints, and SQL, do that.
- **Stemming, synonyms, Unicode normalization.** `relaying` is found by `relay` only as a completion, never `relayed` by `relaying`.
