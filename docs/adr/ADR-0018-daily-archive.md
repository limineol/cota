---
status: accepted
scope: apps/hub
owner: limineol
last_verified: 2026-11-14
review_by: 2027-02-13
supersedes: []
code:
  - apps/hub/src/main.ts
  - apps/hub/src/restore-archive.ts
  - apps/hub/src/config/config.ts
  - apps/hub/src/modules/request-log/module.ts
  - apps/hub/src/modules/request-log/02-application/commands/archive-days.command.ts
  - apps/hub/src/modules/request-log/02-application/commands/restore-archive.command.ts
  - apps/hub/src/modules/request-log/02-application/interfaces/archive-directory.ts
  - apps/hub/src/modules/request-log/02-application/interfaces/request-log-archive.ts
  - apps/hub/src/modules/request-log/03-domain/archive.ts
  - apps/hub/src/modules/request-log/04-infrastructure/archive
  - apps/hub/src/modules/request-log/04-infrastructure/persistence/clickhouse/clickhouse-request-log-archive.ts
  - apps/hub/src/modules/request-log/04-infrastructure/persistence/clickhouse/client.ts
  - apps/hub/src/modules/request-log/05-tests/fakes/in-memory-archive-directory.ts
  - apps/hub/src/modules/request-log/05-tests/fakes/scripted-request-log-archive.ts
---

# ADR-0018: The hub archives each day of the request log to verified files, and a command restores them

## Context

The owner runs one hub on one machine with ClickHouse beside it. If the ClickHouse volume is lost, the request log is lost with it: every request, every conversation, every title. The roadmap's milestone 2c is "the daily archive: a verified, compressed file per day, and a restore". The archive is what gets the request log back after such a loss, and what lets the owner read an old day without ClickHouse at all.

The prototype did it with a sidecar container (`archive/archive.sh`), which held `clickhouse-client` and `zstd`. Every hour it took each UTC day that had ended an hour before and had no file yet, wrote the day's rows of Bifrost's log as JSON lines through `zstd -9 --long=31`, compared the count and the sum of a hash of each line with the same sum over the server's rows (`formatRowNoNewline('JSONEachRow', *)`), wrote a manifest (rows, checksum, SHA-256, the table's `CREATE`, when), and only then gave the files their final names. A day that failed was tried again the next hour. It then emptied the log's copy of the archived days' conversations, because Bifrost repeated every conversation with every request. Cota's request log stores each conversation item once per session (ADR-0007), so there is nothing to empty, and this decision deletes nothing.

What Cota must archive is the request log as ClickHouse holds it (`docs/specs/request-log/spec.md`): `requests`, `request_items`, `items` and `session_titles`. The fifth table, `words`, is derived: the materialized view `words_writer` fills it from every block written to `items`, and `prepare` gathers it once for items written before it. A row of the log has no time it was written, only times of its own: `started_at` (requests and their request items), `first_seen` (items: when the first request that carried the item started) and `reported_at` (titles). And a day's rows go on changing after the day ends, in two ways:

- **Rows arrive late.** A request's row is written when the request finishes, and the relay sets no limit on how long an answer may stream (`docs/specs/relay/spec.md`, Limits). The writer then tries a failed batch again, every minute at most, for as long as it fails (the request log spec's Writing). Neither has a bound, so no wait after a day ends makes the day final.
- **`items` merges copies.** It is a `ReplacingMergeTree(version)`: when the writer could not ask which items a session has, it writes them again, and a merge, at a time of ClickHouse's choosing, keeps each item's earliest copy. A copy written later can be earlier than the one already kept, and so move the item to an earlier day.

## Measurements

Made on `compose.dev.yaml`'s ClickHouse (26.8.36.3, Docker with 6 CPUs, 12 GB), in scratch databases created for the purpose and dropped after it (`cota_archive_probe`, `_odd`, `_restore`), never the `cota` database. Every row was synthetic. Each time is the median of three warm runs.

**Data.** A busy day, 2026-11-10: 10,000 requests in 100 Claude Code sessions, written by `RecordRequest` over the ClickHouse repository and handed to it in the order they finished. Each session is an `anthropic-messages` conversation that grows by two items a request: a user message or a tool result of 50 to 4,000 words, and an answer with a tool call, after a 15 KB system prompt and 20 tool definitions; a tenth of the sessions start two hours before midnight. 9,776 requests and 21,442 items fall on the day, and 50 titles reported through `SessionTitles`. The day is 251 MiB as ClickHouse reads it uncompressed (items 223 MiB, request items 23 MiB, requests 4 MiB) and about 53 MiB on its disk. Thirty earlier days were then copied from it under other session names, so the log held 31 such days: 685,100 items (6.93 GiB, 1.58 GiB on disk) and 310,000 requests. The text is pseudo-words drawn from 6,000 with a skewed frequency, identifiers and paths among them (as ADR-0015's), which compresses better than real conversations: real files will be larger than these.

A second log, for the round trip: 297 requests in 9 sessions whose strings carry tabs, CR LF, backslashes, quotes, NUL and other control characters, two-, three- and four-byte UTF-8, and empty and blank values, in session ids, machine tags, user agents, the keys and values of `rate_limits`, error messages and bodies, the usage JSON and the items' text; with every nullable column both null and set, decimal costs, `DateTime64`, `Enum8`, `Bool`, `LowCardinality`, maps, and arrays of `UInt128`.

**What ClickHouse's HTTP interface does with zstd.**

- With `enable_http_compression = 1` (the default on 26.8) and `Accept-Encoding: zstd`, an answer comes with `Content-Encoding: zstd` and streams: a 2 GB answer began after 0.14 s, compressed or not.
- The level is `output_format_compression_level` (default 3). `http_zlib_compression_level` sets only gzip and deflate: at 9 it gave the same 34.4 MB as level 3. `output_format_compression_zstd_window_log` (zstd's long mode) changed the size by under 1% at levels 1 to 9, and by 5% at 12.
- A body sent with `Content-Encoding: zstd` is decompressed by ClickHouse: an `INSERT … FORMAT JSONEachRow` of a compressed file stored its 100,000 rows. A truncated file failed with code 26 (`CANNOT_PARSE_QUOTED_STRING`); being smaller than one block, it stored nothing, but a larger file stores each block it parsed before the failure, so a file is never loaded straight into the log.
- A query that fails after its first rows: the status 200 has been sent, ClickHouse frames the exception inside the compressed stream and closes the connection, as it does uncompressed.
- On this server the hub's user has `async_insert = 1` and `input_format_skip_unknown_fields = 1` by default: a load sets both to 0, or a missing column would be filled silently and an unknown one dropped.

**The round trip.** Each table's rows of the day were exported over HTTP with zstd, loaded with `Content-Encoding: zstd` into a scratch table of the same columns (`ENGINE = MergeTree ORDER BY tuple() EMPTY AS SELECT * FROM <table>`), and compared with the log's rows of the day by count and by the sum of `cityHash64` of each row's `RowBinary` (`formatRowNoNewline('RowBinary', *)`, the checksum below). In all three formats, every table of both logs came back the same: the odd strings, the nulls, the decimals and the digests included. What the formats differ in:

| Format | The busy day, zstd level 3 | Read by |
| --- | --- | --- |
| `JSONEachRow` | 36.0 MB (items 34.8) | anything: `zstd -dc file \| jq` |
| `Native` | 42.1 MB (items 41.4) | ClickHouse only |
| `Parquet` | 42.5 MB (items 41.4) | Parquet readers, but a digest is `FIXED_LEN_BYTE_ARRAY(16)` with no logical type, little-endian, which ClickHouse itself reads back as `FixedString(16)` when it is not told the column; `LowCardinality` becomes `String` |

The four tables have no floating-point column, so the prototype's one-bit error in ClickHouse's JSON float parsing cannot arise; `precise_float_parsing` is 1 by default on 26.8 besides. The round trip covers every string the writer can store, and found one it cannot: a lone surrogate in an item's text (which `JSON.parse` accepts) is written as `\udxxx`, which ClickHouse's JSON input refuses with code 25, and the writer then tries that batch again for ever. That is a defect of the writer, outside this decision, and reported with it.

**Level and size**, the busy day's items (242.9 MB as JSON lines, written uncompressed in 0.30 s):

| Level | 1 | 3 | 6 | 9 | 12 | 19 |
| --- | --- | --- | --- | --- | --- | --- |
| Bytes | 47.3 MB | 34.6 MB | 27.5 MB | 18.4 MB | 16.4 MB | 8.1 MB |
| Time | 0.40 s | 0.48 s | 1.14 s | 1.28 s | 3.06 s | 47.3 s |

**Archiving the busy day at level 9**, table by table (export to a file, load into a scratch table, the two checksums):

| Table | Bytes | Export | Load | Checksums |
| --- | --- | --- | --- | --- |
| `requests` | 284 KB | 0.07 s | 0.07 s | 0.04 s |
| `request_items` | 788 KB | 0.07 s | 0.08 s | 0.05 s |
| `items` | 18.4 MB | 1.34 s | 0.62 s | 0.29 s |
| `session_titles` | 0.7 KB | 0.01 s | 0.03 s | 0.02 s |

19.4 MB and 2.7 s for the day. ClickHouse used 200 to 275 MiB for the items' export, and 568 MiB to load them into the scratch table with parallel parsing, 327 MiB without it, in the same time (0.63 s and 0.62 s). The scratch table can be `TEMPORARY` in an HTTP session (`session_id`): `CREATE TEMPORARY TABLE … ENGINE = MergeTree ORDER BY tuple() EMPTY AS SELECT * FROM items` loaded and summed the same, was invisible to another session, and goes with the session.

**The hub's side.** A Bun process doing what the hub would, `fetch` with `decompress: false`, each chunk written to a file and fed to a SHA-256 as it passed, peaked at 42 MiB of resident memory for the 19 MB file, 50 MiB for the 34 MB one, and 80 MiB for 1.13 GB (every item of the 31 days, in 13 s), from 12 MiB at rest. The file's SHA-256 matched `shasum`, and `zstd -t` found it whole. `@effect/platform-bun`'s `BunHttpClient.layerOptions` passes such fetch options to Effect's HTTP client.

**What a check costs**, on the 31-day log, with the query condition cache off:

| Query | Time | Memory | Read |
| --- | --- | --- | --- |
| Every day's count and fingerprint (the sum of `cityHash64` of each row's key), `items FINAL` | 5 ms | 8 MiB | 45 MiB |
| The same, `requests` / `request_items` | 4 ms / 2 ms | 6 / 8 MiB | 7 MiB each |
| Every day's count and checksum, `items FINAL` | 829 ms | 323 MiB | 7.07 GiB |
| The same, `requests` / `request_items` | 113 ms / 96 ms | 153 / 338 MiB | 121 / 704 MiB |
| One day's count and checksum, `items FINAL`, its sessions found first | 160 ms | 114 MiB | 1.25 GiB |
| The same without finding its sessions first | 624 ms | 122 MiB | 7.07 GiB |
| One day's, `requests` / `request_items` | 8 ms / 18 ms | 24 / 15 MiB | 5 / 159 MiB |

`items` is ordered by `(session, digest)` and not partitioned, so a day of it is found through its sessions (`session IN (SELECT DISTINCT session FROM items WHERE first_seen in the day)`), which uses the primary key; without them a day's checksum reads every item ever stored. `cityHash64(*)` cannot be the checksum: it is null for a row with any null column, which was every row of `requests`. `cityHash64(tuple(*))` cost the same as the `RowBinary` form (159 ms against 160).

**`FINAL` and a day.** With merges stopped, a later copy (on 11-11) of an item kept on 11-10, and an earlier copy (on 11-09) of another, were added to the round-trip log. Counted without `FINAL`, the three days held 66, 718 and 1 items; with it, 66, 717 and 0. `FINAL` puts an item on the day of its earliest copy, and the `WHERE` on `first_seen` is applied after it (`optimize_move_to_prewhere_if_final = 0`).

**The restore.** The busy day's four files were loaded into temporary tables of a session and their rows added to an empty log that `prepare` had made, each table taking only the rows it lacked: loading took 0.72 s; adding the items 1.47 s (692 MiB, building the text index and, through `words_writer`, 13,297 words, the day's distinct words), the request items 14 ms, the requests 9 ms and the titles 2 ms. The day's rows then had the source's counts and checksums. The same restore again added nothing, in 1 to 6 ms a table.

## Decision

**The hub archives the request log itself.** The **archiver** is a job of the request-log module, the only module that knows the tables, and runs when the configuration has an `[archive]` table naming a directory; without it, nothing runs. There is no sidecar: ClickHouse compresses and decompresses (below), so the hub needs no `zstd` and no new dependency.

**What is archived.** For each **day**, a UTC calendar day, each of four tables' rows of it: the `requests` and `request_items` that started in it, the `items` first seen in it, as `FINAL` reads them (each item once, its earliest copy), and the `session_titles` reported in it. `words` is not archived: a restore writes items, and `words_writer` writes their words as it does for the writer's.

**One file per table per day, JSON lines compressed with zstd by ClickHouse.** Each file is ClickHouse's `JSONEachRow` with 64-bit and wider integers and decimals quoted, a decimal's trailing zeros kept and times in ISO 8601 UTC, compressed at level 9: anything can read it (`zstd -dc … | jq`), and the round trip is exact for every column type the tables use. The hub sends the query with `Accept-Encoding: zstd` and `output_format_compression_level = 9`, and writes the bytes it receives to the file as they arrive, taking their SHA-256 as they pass; it never decompresses, parses or holds a file. Level 9 is the prototype's, and cost 1.3 s against 0.5 s at level 3 for a file half the size, once a day.

**A day's directory, and its manifest last.** The files of a day are in a directory named for it, `<directory>/2026-11-10/`, each named for its table and the first 16 hexadecimal digits of its SHA-256 (`items.3f2a9c0d4e5b6a71.jsonl.zst`), beside `manifest.json`: for each table, its file, bytes, SHA-256, rows, checksum and fingerprint, its columns and `CREATE`; the server's version, the level, and when it was archived. The manifest is written last, under a temporary name, and renamed into place: a day is archived exactly when it has a manifest, and the rename is the one step that makes it so, or that replaces an earlier archive of the day. A file has a temporary name (`….partial`) until it is verified. The files and manifests are the owner's alone (mode 0600), and flushed to the disk before they are renamed.

**Verified means it restores.** Before a file gets its final name, ClickHouse loads it into a temporary table of the same columns, and the count and the **checksum** of what it loaded (the sum, modulo 2^64, of `cityHash64` of each row's `RowBinary`) must equal those of the log's rows of the table and day. That is the restore's own path, so a file that verifies is one that restores to the same rows. A difference, a load that fails, or an answer broken off fails the day, which is tried again at the next run.

**When.** The archiver runs a minute after the hub starts and then an hour after each run ended. A day is due once an hour has passed since it ended. Each run:

1. asks ClickHouse, for each table, every day's count and **fingerprint** (the sum of `cityHash64` of each row's key: a request's id, a request item's request id, an item's session, digest, `first_seen` and request id, a title's every column), one cheap query a table (5 ms on 31 busy days);
2. archives every due day with rows and no manifest;
3. compares every archived day's manifest with the log's counts and fingerprints. Rows of the log are never changed, only added, and an item's copy is only ever replaced by an earlier one, so a day whose counts and fingerprints equal its manifest's holds exactly the archived rows. Equal: nothing is done. A day the log holds no row of: it is said, in one line for all such days, and left. Otherwise the archive is loaded into temporary tables and the archiver counts its rows the log does not **hold**; when there are none, the day is archived again and the new manifest replaces the old; when there are, the archive is left as it is and the archiver says how many rows the log lacks and that a restore puts them back.

So a late row is archived, however late, at the first run after it lands, and an item that moved is archived on its new day, without a window to tune. And a day that the log has lost rows of is never overwritten by what is left: after the volume is lost, every archived day is held by no row, and the archiver says so every hour and archives nothing over them.

**Held** is one rule, used by the archiver and the restore: an archived row is held by the log when the log has a request with its id, a request item with its request id, a title equal in every column, or a copy of the item (its session and digest) at least as early (by `first_seen`, then request id, the order of `items`' version).

**The restore is a command**, `bun run archive:restore <directory>`, run on the hub's machine with the hub's configuration (`COTA_CONFIG`), which reads `[clickhouse]` and nothing else; the hub may be running or not. It makes the tables that are missing (the repository's `prepare`), then, for each day of the directory, checks each file's size and SHA-256 against the manifest, the tables' columns against the log's, and that the files load to the manifest's counts and checksums, and refuses a day for which any of these fails. Of the days it accepts, it adds the rows the log does not hold, table by table across all the days, `items` first, then `request_items`, `requests` and `session_titles`, so a request is never seen before its items. It says per day what it added, and exits 0, or 1 when a day was refused or failed.

The rule for a day the log already holds rows of is that it adds what is not held. One rule covers every case: an empty day gets every row, a day held whole gets none, so restoring twice stores nothing twice, and a day held in part (requests the writer wrote after the volume came back, a restore stopped halfway) gets the rest. Refusing a day the log holds part of would leave the owner nothing to do but delete rows by hand; loading only an empty day would leave the rest of such a day out for good.

**Nothing is deleted from the request log.** Neither the archiver nor the restore sends anything to the log's tables but `SELECT` and `INSERT`, apart from the repository's `prepare`, which the restore runs and which only makes what is missing. The only files the archiver removes are its own: a day's files a newer manifest no longer names, and `.partial` files.

**Failure.** The archiver never stops the hub, and a failure stops only its day, or its run when ClickHouse cannot answer: it is logged, counted (`cota_archive_failures`), and tried again at the next run. A full disk fails the day's file, which is removed, and leaves the earlier archive of the day as it was. A hub stopped in the middle of a file leaves a `.partial` file and a temporary table that goes with its session; the next run removes the file. Shutdown does not wait for the archive: it is interrupted like any scoped work, since nothing is lost by stopping it (the log still holds every row), and the shutdown finishers (`Shutdown.Finishers`) are for requests that must still reach the request log. The hub refuses to start when the configured directory does not exist or cannot be written, as it does for the hub store's.

**An archive file holds the conversations in the clear**, as the ClickHouse volume it copies does: every prompt, tool result and answer, and every title. It is not encrypted. The owner guards and backs up the directory as they do that volume.

## Alternatives weighed

- **A sidecar container, as the prototype.** It needs `clickhouse-client`, `zstd` and a shell, another image to pin and run, and a second place that knows the tables. ClickHouse's HTTP interface compresses and decompresses zstd itself, so the hub moves the bytes in constant memory (80 MiB of resident memory at most, for 1.13 GB).
- **Compressing in the hub with Bun's zstd.** It works without ClickHouse's compression, but spends the hub's CPU on what ClickHouse does as it writes the answer, and a stream through a compressor is more code than a stream to a file.
- **`Native`.** Exact and compact in memory, but 17% larger here and readable only by ClickHouse, while reading a day without ClickHouse is half of what the archive is for.
- **Parquet.** Typed, columnar and widely read, and it round-trips through ClickHouse. But its digests are 16 opaque little-endian bytes with no logical type, so an outside reader needs to know ClickHouse's layout to read the column the request log is built on, and it was 18% larger than JSON lines.
- **One file a day for all four tables**, as zstd frames one after another. One file to copy, but reading it needs the offsets from the manifest, and `zstd -dc | jq` would mix the tables.
- **Comparing the lines' hashes, as the prototype**, rather than loading the file. It checks the bytes ClickHouse wrote, not that they load back to the same values; a load proves the restore's path itself.
- **Checking every archived day's checksum every hour.** It reads every column of the whole log (829 ms and 7 GiB for `items` over 31 days, growing with the log), where the fingerprint reads keys (5 ms). Since rows are only added, and an item's copy only replaced by an earlier one, a key notices every change the hub makes.
- **Re-checking only the last few days, or archiving only after a wait.** The relay sets no limit on a stream and the writer retries for as long as ClickHouse fails, so no window holds every late row; any window either misses rows or archives days late for nothing.
- **Re-archiving any day that changed.** After the volume is lost, every day has changed to nothing, and the archive would be overwritten with empty days. The archiver replaces an archive only when the log holds every row of it.
- **Archiving every copy of an item, without `FINAL`.** A merge removes copies whenever it runs, so a day's count would fall without anything being lost, and the archiver could not tell that from a loss.
- **Scratch tables in the log's database.** They would be seen by the SQL user and `GET /api/schema`, and a crash would leave them behind. A temporary table in an HTTP session is seen by no one and goes with the session.
- **`INSERT … FORMAT JSONEachRow` straight into the log on restore.** A damaged file would store the blocks before the damage, with nothing to say which, and every row would be stored again by a second restore.
- **ClickHouse's own `BACKUP … TO Disk`.** Exact, incremental and fast, but its files are ClickHouse's parts, written on the ClickHouse server's file system to a disk its configuration must declare, and they cannot be read without ClickHouse.

## Consequences

- The request-log module gains the archiver, a job on a schedule, two ports (the request log's side of the archive, over ClickHouse, and the archive directory, over the file system), a restore command and a script, `bun run archive:restore`. The configuration gains `[archive]`. `docs/specs/archive/spec.md` holds the details.
- The archive costs a few seconds of ClickHouse a day, and a few milliseconds an hour. A busy synthetic day was 19.4 MB; real conversations compress less.
- An archive restores only into tables of the same columns. The tables change freely until the first release (ADR-0007): a day archived before a change is refused by the restore, which names what differs, and the manifest's `CREATE` says what the file holds. Restoring across a change is a migration's work, once there are migrations.
- The checksum is ClickHouse's `cityHash64` over its `RowBinary`, a fixed hash of a fixed binary format, so an upgrade should not change it; the restore checks it on the server it runs on all the same. A server that reads a file to other values than the one that wrote it is refused with both versions named, never restored differently.
- After a loss of the volume, the archiver says every hour which days the log holds none of, until they are restored. A day whose rows the owner deletes on purpose is said the same way: retention is not built.
- The archive covers the request log's ClickHouse tables only. The hub store and the configuration are backed up apart (ADR-0013).
- A row the log never received is not in the archive: a request lost on a crash (ADR-0007) is lost from both.
- A lone surrogate in an item's text stops the writer today (Measurements). It is the writer's defect, to be fixed apart: the archive's round trip holds for every row the writer can store.
