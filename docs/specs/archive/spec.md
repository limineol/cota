---
status: active
scope: apps/hub
owner: limineol
last_verified: 2026-11-19
review_by: 2027-02-18
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

# Archive

The archive is a copy of the request log in a directory of files, one **archived day** at a time, written by the hub itself: what gets the request log back after its ClickHouse volume is lost, and what lets the owner read an old day without ClickHouse. This spec covers what a day is, the directory and its manifests, the archiver that archives each day and archives again a day that changed, how a file is verified, the restore command, and what every failure leaves. ADR-0018 gives the reasons and the measurements.

It belongs to the request-log module (`apps/hub/src/modules/request-log`), the only module that knows the tables, which are the request log spec's (`docs/specs/request-log/spec.md`).

## Values

**A day** is a calendar day in UTC, written `YYYY-MM-DD`: the instants from its midnight, included, to the next, excluded. A row's day is the day of its own time, since no table records when a row was written:

| Table | Its time | Its key |
| --- | --- | --- |
| `items` | `first_seen` | `session`, `digest`, `first_seen`, `request_id` |
| `request_items` | `started_at` | `request_id` |
| `requests` | `started_at` | `id` |
| `session_titles` | `reported_at` | `session`, `title`, `reported_at`, `machine`, `reported_by` |

This order, `items` first, is the **load order**: a table's rows of a day are restored before the next table's, so no request is seen before its items. `words` is not archived: `words_writer` writes the words of every block written to `items`, the restore's included.

**A table's rows of a day** are its rows whose time falls in the day, every column that `SELECT *` gives (not `items.version` or `requests.prompt_tokens`, which are computed). For `items` they are the rows `FINAL` gives, so each item once, as its earliest copy: `items FINAL WHERE session IN (SELECT DISTINCT session FROM items WHERE <first_seen in the day>) AND <first_seen in the day>`. Finding the day's sessions first lets `items`' primary key, which begins with `session`, skip the rest; the `WHERE` is applied after `FINAL` (`optimize_move_to_prewhere_if_final` is 0), so a day holds an item exactly when its earliest copy is in it.

**The checksum** of rows is the sum, modulo 2^64, of `cityHash64(formatRowNoNewline('RowBinary', *))` over them: a hash of every value of each row, in the table's column order. **The fingerprint** of rows is the sum, modulo 2^64, of `cityHash64` of each row's key columns, in the order above. Both are `UInt64`, written as decimal strings; the checksum and fingerprint of no rows are `0`.

**A day's summary** is, for each table, the count and fingerprint of its rows of the day. The log's summaries of every day come from one query a table: `SELECT toDate(<time>) AS day, count(), sum(cityHash64(<key>)) FROM <table> GROUP BY day`, with `FINAL` for `items`.

**Held.** An archived row is held by the log when the log has:

- for `requests`, a row with its `id`;
- for `request_items`, a row with its `request_id`;
- for `items`, a row with its `session` and `digest` whose `(first_seen, toUInt128(request_id))` is at most the archived row's: a copy of the item at least as early, by the order of `items`' version, which a merge keeps over a later one;
- for `session_titles`, a row equal in all five columns.

The archiver and the restore use this one rule.

## The archive directory

The configuration's `[archive] directory` (The archiver), or the restore's argument. In it, one directory per archived day:

```text
<directory>/
  2026-11-10/
    manifest.json
    items.3f2a9c0d4e5b6a71.jsonl.zst
    request_items.0b5e8d7c6a4f3e21.jsonl.zst
    requests.9c1d2e3f4a5b6c7d.jsonl.zst
    session_titles.5d4c3b2a1f0e9d8c.jsonl.zst
  2026-11-11/
    …
```

- A day's directory is named for the day and made, mode 0700, when the day is first archived.
- A day's directory is a real directory, judged without following a symbolic link (`lstat`). An entry named as a day that is anything else (a symbolic link, a file) is a day whose manifest cannot be read (`it is not a directory`): the archiver leaves it and says so, the restore refuses it, and nothing is ever written, renamed or removed through it.
- A **table's file** is named `<table>.<the first 16 hexadecimal digits of its SHA-256>.jsonl.zst`. A table with no rows of the day has no file. Naming files by their content means a new archive of a day never writes over the files of the one its manifest still names.
- **`manifest.json`** is the day's record (below), written last. A day is **archived** exactly when its directory holds a `manifest.json`; only the files it names belong to the archive.
- A name ending `.partial` is a file being written: a table's file before it is verified (`<table>.jsonl.zst.partial`), or a manifest before it is renamed (`manifest.json.partial`). Nothing reads one. A partial file never has a final name.
- Files are made with mode 0600. Each file is flushed to the disk (`fsync`) before it is renamed, and the day's directory after its renames, so a crash or a power loss never leaves a final name on bytes that are not on the disk.
- Nothing else in the directory is read, written or removed. The archiver removes only regular files ending `.partial`, and the table files of an archive it has just replaced (Archiving a day, step 6).

### The manifest

A JSON object, written with two-space indentation:

| Field | Holds |
| --- | --- |
| `archive` | `1`: the version of this layout. A restore refuses any other. |
| `day` | The day, `"2026-11-10"`: its directory's name. |
| `archived_at` | When the manifest was written, by the clock: an ISO 8601 instant in UTC with milliseconds. |
| `clickhouse` | The version of the server that wrote and verified the files (`SELECT version()`), `"26.8.36.3"`. |
| `database` | The request log's database, `"cota"`. |
| `format` | `"JSONEachRow"`. |
| `compression` | `"zstd"`. |
| `level` | `9`. |
| `checksum` | `"sum of cityHash64(formatRowNoNewline('RowBinary', *)) over the rows, modulo 2^64"`: how each table's `checksum` is computed. |
| `fingerprint` | `"sum of cityHash64(key) over the rows, modulo 2^64"`: how each table's `fingerprint` is computed. |
| `tables` | One entry per table, in the load order, all four always. |

Each entry of `tables`:

| Field | Holds |
| --- | --- |
| `table` | `"items"`, `"request_items"`, `"requests"` or `"session_titles"`. |
| `file` | The table's file's name, or `null` when the table has no rows of the day. |
| `bytes` | The file's size in bytes; `0` without a file. |
| `sha256` | The file's SHA-256, 64 lowercase hexadecimal digits; `null` without a file. |
| `rows` | How many rows the file holds. |
| `checksum` | Their checksum, a decimal string. |
| `key` | The key's columns, as in Values. |
| `fingerprint` | Their fingerprint, a decimal string. |
| `columns` | The table's columns as `SELECT *` gives them, in order, each `{ "name": …, "type": … }` as `system.columns` writes them (`"DateTime64(3, 'UTC')"`). |
| `create` | The table's `create_table_query` from `system.tables`, for a reader: what the file's rows were. |

An entry agrees with itself: a table with a file has its SHA-256 and at least one byte, and its file is named for its table and SHA-256 as above; a table without one has no SHA-256, 0 bytes, 0 rows, and a checksum and fingerprint of `0`. A manifest whose entry does not is not of the shape above, so a manifest never makes the archiver read or remove a file of another name.

## The files

A table's file holds its rows of the day as ClickHouse's `JSONEachRow`, one JSON object per line, compressed with zstd at level 9 by ClickHouse. Without ClickHouse, `zstd -dc requests.9c1d2e3f4a5b6c7d.jsonl.zst | jq` reads it. In a line:

- integers of 64 bits and wider are strings (`output_format_json_quote_64bit_integers = 1`): a digest is the decimal number of its 128 bits, `"244581858078060080177194746938455530"`, where the API writes it in 32 hexadecimal digits;
- a decimal is a string with its 12 places (`output_format_json_quote_decimals = 1`, `output_format_decimal_trailing_zeros = 1`), so no reader turns a cost into a double;
- a time is ISO 8601 in UTC with milliseconds, `"2026-11-10T00:00:09.945Z"` (`date_time_output_format = 'iso'`);
- a null is `null`, an enum its name, a map an object in its stored order, a `Bool` `true` or `false`, a UUID its text, and a string as ClickHouse escapes it (a NUL is `\u0000`, `/` is `\/`).

The rows of a file are in no particular order.

## The archiver

**Configuration.** An `[archive]` table in the configuration (ADR-0009) turns the archiver on; without it, nothing below runs:

```toml
[archive]
directory = "/var/lib/cota/archive"
```

`directory` is required in the table and read against the configuration file's directory, as the hub store's path is. When `[archive]` is present, the hub checks the directory at start, before the server listens: if it does not exist, is not a directory, or the hub cannot write it, the hub prints `The archive directory <path> <does not exist | is not a directory | cannot be written by the hub>.` and exits 1, as it does for the hub store.

**Schedule.** The archiver runs a minute after the hub starts, and then an hour after each run ended, on the clock. Runs never overlap. It is the request-log module's: `module.ts` forks it in the module's scope when its options have an archive directory.

**A run**, in order:

1. **Sweep.** Remove the regular files ending `.partial` in every day's directory. A directory with such a name is left, and stops no run: a day whose file cannot then be written fails alone (Failures). Nothing else is removed here: a table file no manifest names (left by a crash between naming a day's files and renaming its manifest) may be the only copy of rows the log has lost since, so it is left for the owner. If the directory cannot be read, the run stops here (Failures).
2. **Read the log's summaries** of every day (Values), four queries, and the server's version and each table's columns and `create_table_query`, for the manifests. If ClickHouse cannot answer, the run stops here (Failures).
3. **Read the manifests** of every day's directory. A manifest whose day is not a directory, that the hub cannot read from the disk, is not JSON, is not of the shape above, has an `archive` other than 1, or whose `day` is not its directory's name, cannot be read.
4. **Decide each day** that the log's summaries or the directory's days name, in ascending order, by the first row that applies:

   | The day | The run |
   | --- | --- |
   | Has no manifest, the log holds rows of it, and an hour has passed since it ended | archives it |
   | Has no manifest, otherwise | does nothing |
   | Has a manifest that cannot be read | does nothing, and logs `the archive cannot read the manifest of <day>: <why>; the day is left as it is` |
   | Its manifest's rows and fingerprint equal the log's summary of the day, table by table | does nothing |
   | The log holds no row of it in any table | does nothing, and lists the day as missing (step 5) |
   | Otherwise (it changed) | checks each table's file in the load order against the manifest, whether it is missing, then its size, then its SHA-256, before the next table's; loads the files into temporary tables of a session (Archiving a day, step 2), and counts their rows the log does not hold. None: archives the day again. Some: does nothing, and logs `the request log lacks <n> rows of <day> that its archive holds (<table> <n>, …); bun run archive:restore puts them back`. A file missing or not matching: does nothing, and logs, for the first check that fails, `the archive of <day> does not match its manifest: <why>; the day is left as it is` |

5. **Say the missing days.** When some archived days have no row in the log, one warning: `the request log holds no row of <n> archived days, <first> to <last>; bun run archive:restore puts them back`.

**Archiving a day**, in order, in one ClickHouse HTTP session (a new random `session_id`, `session_timeout` 60 seconds) so that its temporary tables are seen by nothing else and go with it:

1. **Export.** For each table, in the load order, send `SELECT * FROM <table> WHERE <its time in the day> FORMAT JSONEachRow` (for `items`, its rows of the day as Values gives them) with `Accept-Encoding: zstd` and the settings `enable_http_compression = 1`, `output_format_compression_level = 9`, `output_format_json_quote_64bit_integers = 1`, `output_format_json_quote_decimals = 1`, `output_format_decimal_trailing_zeros = 1`, `date_time_output_format = 'iso'`, `readonly = 1`, `max_execution_time = 600` and `cancel_http_readonly_queries_on_client_close = 1`. Write the answer's bytes as they arrive, undecoded (the HTTP client is told not to decompress: Bun's `fetch` option `decompress: false`), to `<day>/<table>.jsonl.zst.partial`, counting them and feeding them to a SHA-256. An empty answer (no bytes) means no rows, and leaves no file. An answer with bytes but without `Content-Encoding: zstd`, an answer that is not 200, or one that ends before ClickHouse finished it, fails the day.
2. **Load.** For each table with a file: `DROP TEMPORARY TABLE IF EXISTS archive_<table>`, so that a table the session still holds from a statement it abandoned cannot fail the load, then `CREATE TEMPORARY TABLE archive_<table> ENGINE = MergeTree ORDER BY tuple() EMPTY AS SELECT * FROM <table>`, then post the file, read from the disk as a stream, to `INSERT INTO archive_<table> FORMAT JSONEachRow` with `Content-Encoding: zstd` and the settings `async_insert = 0`, `date_time_input_format = 'best_effort'`, `input_format_skip_unknown_fields = 0` and `input_format_parallel_parsing = 0`. Each `archive_<table>` is dropped once the run has what it loaded it for (its count, checksum and fingerprint here; the count of its rows the log does not hold, for a day that changed), whether that succeeded or failed.
3. **Verify.** For each table, the count, checksum and fingerprint of `archive_<table>` (none, `0` and `0` without a file) and the count and checksum of the log's rows of the table and day. The day is verified when, for every table, the counts are equal and the checksums are equal. Otherwise it fails.
4. **Name the files.** Rename each `.partial` file to its final name.
5. **Write the manifest** to `manifest.json.partial`, from the verified counts, checksums and fingerprints, the files' bytes and SHA-256, and what step 2 of the run read, and rename it to `manifest.json`, replacing the earlier manifest of the day if there was one. This rename is the step that archives the day.
6. **Remove** the table files the replaced manifest named that the new one does not: the earlier archive's, whose rows the log held when this run decided to archive the day again.
7. Log `the archive archived <day>: <rows> rows in <bytes> bytes`, or `… archived <day> again: …` when it replaced a manifest.

Exports, loads and the restore's inserts are stopped by ClickHouse at 10 minutes (`max_execution_time = 600`) and abandoned by the hub 11 minutes after they were sent, however the answer arrives: an export whose answer stalls after its first bytes fails at 11 minutes, as one that never begins does. Every select of the session (its counts, checksums, fingerprints and the rows the log holds, for the archiver, a restore and an import alike) is given as long as an add, not the 30 seconds of the hub's other reads: ClickHouse stops it at 10 minutes and the hub abandons it 5 seconds after, so a machine busy with other work for half a minute does not fail a day (an import's check of a few hundred milliseconds once took 32 seconds on a busy machine). Every other statement is abandoned after 35 seconds, as the hub's other queries are. A busy synthetic day took 2.7 seconds in all (ADR-0018).

**An import's session.** An import (`docs/specs/import/spec.md`) uses the same session and its `archive_<table>` tables, made empty and filled with the rows it built rather than loaded from a file, and the same count of rows not held and the same add. Its session ends once it has been idle for ten minutes rather than one, since the import reads its source between the session's statements; a dry run's session also holds a `dry_run_<table>` for each table, which its add writes into instead of the log's table, and whose rows count as held beside the log's.

**Shutdown.** The archiver is interrupted wherever it is when the request log's layer is released; it does not wait to finish a file, and is not one of the shutdown's finishers (`Shutdown.Finishers`, which are requests still reaching the request log). An interrupted export closes its connection, which cancels the query; the `.partial` files it leaves are removed by the next run's sweep, and its temporary tables go when ClickHouse ends the session.

## Days that change

A day's rows can change after it is archived, and the archiver notices every change at its next run, whenever it comes:

- **Late rows.** A request's row and its items are written when the request finishes, and an answer may stream for any time (`docs/specs/relay/spec.md`); a batch that fails is tried again for as long as it fails (`docs/specs/request-log/spec.md`, Writing). No wait makes a day final, so none is relied on: the hour after a day ends only spares archiving most days twice.
- **Copies of an item.** A copy written later than the one the log keeps, and earlier than it, moves the item to the copy's day: one day gains it, the other loses it. A later copy is never in a day's rows, since `FINAL` gives the earliest.

Rows are never changed in place, and an item's copy is only ever replaced by an earlier one, so a day's summary (its count and fingerprint per table) changes exactly when its rows do. A day that gained rows, or lost an item to an earlier day, still has every archived row held, and is archived again. When an earlier copy moves an item from one day to an earlier one, both change, and a run archives the earlier day again with the item, then the later day without it; if the earlier day's archive fails in that run, or it cannot be archived again (its manifest cannot be read, its files do not match its manifest, or the log lacks rows of it), the later day is still archived again, and the item is in the log and in no archive until a run archives the earlier day. A day that the log lost rows of (its volume was lost, or rows were deleted by hand) does not, and its archive is kept as it is: the archiver never replaces an archive with less than it holds.

A day the log holds no row of is not loaded to be checked, however it came to have none, so that the hour after a lost volume costs nothing: it is listed as missing and its archive kept. That holds too for a day whose every archived row is an item that an earlier copy moved to an earlier day, though nothing of it is lost. The hub writes no such day while it holds the items' requests, which never move; it can only follow a request lost before its row was written (ADR-0007). Its archive is then kept, it is listed as missing at each run, and a restore adds nothing from it.

A change made outside the hub that keeps every key, such as an `ALTER TABLE … UPDATE` by hand, is not noticed.

## The restore

```sh
COTA_CONFIG=cota.toml bun run archive:restore <directory> [--from <YYYY-MM-DD>] [--to <YYYY-MM-DD>]
```

Run on the hub's machine, from the repository's root or the hub's image, with the hub's configuration; the hub may be running or stopped. It reads the configuration as the hub does (ADR-0009) and uses only its `[clickhouse]`. It never writes to the archive directory. One restore runs at a time: nothing stops a second from starting, and two that overlap can each find the same rows not held before the other adds them, so both add them and the log holds them twice. `--from` and `--to` restore only the days from and to those, both included; without them, every day.

**In order:**

1. **Start.** Read the arguments and the configuration; check the directory; list its days (directories named `YYYY-MM-DD` holding `manifest.json`, within `--from` and `--to`); run the request log repository's `prepare`, which makes the tables that are missing; read the log's summaries of every day and its tables' columns. Any failure here stops the command with exit code 2, before any day is looked at.
2. **Check each day**, in ascending order, by the first row that applies, adding nothing:

   | The day | The restore |
   | --- | --- |
   | Its manifest cannot be read (as for the archiver) | refuses it: `its manifest cannot be read: <why>` |
   | Its manifest's rows and fingerprint equal the log's summary, table by table | leaves it: `already held` |
   | A file it names is missing, or differs from the manifest's size or SHA-256: each table's file in the load order, checked for being missing, then its size, then its SHA-256, before the next table's | refuses it, for the first that fails: `<file> is missing`, or `<file> does not match its manifest (<size \| SHA-256>)` |
   | A table's columns in the log differ from the manifest's `columns` | refuses it: `the log's <table> has other columns than the archive's: column <n> is <name> <type> in the archive and <name> <type> in the log` (`none` for a column one side lacks) |
   | A file, loaded into `archive_<table>` as the archiver loads it (Archiving a day, step 2), gives another count or checksum than the manifest's; each `archive_<table>` is dropped once measured | refuses it: `<file> loads to other rows than its manifest says (<rows \| checksum>), on ClickHouse <version>; it was archived on <version>` |
   | Otherwise | accepts it |

3. **Add the rows**, one table at a time in the load order, and within each table one accepted day at a time in ascending order, in the same HTTP session: load the day's file into `archive_<table>` again; check that its count and checksum are still the manifest's, or fail the day with the message of step 2's row (the file changed since step 2); count the rows of `archive_<table>` the log does not hold; insert them into the table, naming the manifest's columns (each must be a column of the log's table, or the day fails), with `async_insert = 0` and `deduplicate_insert = 'disable'` (they are not held, so none is a copy), and in blocks of at most 16 MiB or 65,536 rows written by one thread (`min_insert_block_size_bytes = 16777216`, `min_insert_block_size_rows = 65536`, `max_insert_threads = 1`), so that the search index's view (`words_writer`, which keeps the distinct words of each block it is given) holds a block's words at a time, not a day's; count again, which must be 0, or the day fails; and drop `archive_<table>`. A day that fails in one table takes no part in the tables after it.

   **Two passes.** The checks of step 2 are done for every day before any row is added, so that a refused day adds nothing (B6), even when the file that loads wrong is of a table after the first; and the adds of step 3 go table by table across all the accepted days, so that every row the restore adds to a table is added before any row of the next table (B9), across days as within one: a request that started before midnight and finished after it may have its row on one day and its items on the next. So each file is loaded twice, once to check it and once to add from it, and only one `archive_<table>` exists at a time: a directory of years of days costs twice the time of its loads (a busy synthetic day took 2.7 seconds to export, load and check, ADR-0018), and the memory of one day's table. A restore interrupted halfway (the process killed, ClickHouse gone, the machine stopped) leaves the rows it added, all of them archived rows the log did not hold, every table before the one it was in complete for the accepted days, and no request before its items; running it again finds the days whose summaries now equal their manifests already held, and adds to the others only the rows the log still lacks (B7). Its temporary table goes when ClickHouse ends the session.
4. **Say what was done**, one line per day, in ascending order, then one line for all:

   ```text
   2026-11-09: added 1,204 items, 512 request items, 512 requests and 3 titles
   2026-11-10: already held
   2026-11-11: refused: items.3f2a9c0d4e5b6a71.jsonl.zst does not match its manifest (SHA-256)
   2026-11-12: failed: <ClickHouse's message>; the rows added before it stay, and running the restore again adds the rest
   4 days: 1 restored, 1 already held, 1 refused, 1 failed.
   ```

   A count of one is singular (`1 item`, `1 request item`, `1 request`, `1 title`, `1 day`). A day whose rows are all held, but whose summary differs because the log holds more rows of it than its archive, is restored with nothing added: `added 0 items, 0 request items, 0 requests and 0 titles`.

**Exit codes.** 0 when no day was refused or failed; 1 when one was; 2 when the command could not start: its arguments are not as above, or `--from` is after `--to` (`Usage: bun run archive:restore <directory> [--from <YYYY-MM-DD>] [--to <YYYY-MM-DD>]`, then `Run one restore at a time.` on a line of its own), the configuration has a problem (its problems, as the hub prints them), the directory cannot be read or holds no archived day in the range (`No archived day in <directory>`, then ` from <day>`, ` to <day>` or ` from <day> to <day>` for the range given, then, when it cannot be read, `: <why>`), or ClickHouse could not be reached or `prepare` failed (`ClickHouse could not be reached: <why>`).

**Restoring after a loss.** Start ClickHouse with an empty volume, and the hub (whose `prepare` makes the tables, and whose writer then writes new requests), then run the restore. Days the log holds none of are restored whole. A day the writer wrote some rows of since (a request that finished after the volume came back) gets the rest. The archiver, meanwhile, finds every archived day missing and says so each hour until the restore has run; it overwrites none of them.

## Failures

| What happens | Outcome |
| --- | --- |
| ClickHouse cannot be reached, or a summary fails (step 2 of a run) | The run stops before it touches a file; logged `the archive could not read the request log; it will try again in an hour`, with the error; counted. |
| A day's export, load or check fails, or its answer is cut | The day's `.partial` files are removed and its earlier archive, if any, is left as it was; logged `the archive could not archive <day>; it will try again in an hour`, with what failed; counted. The run goes on with the next day. |
| A day's file loads to other rows than the log's | As above, the log line giving both counts and checksums. A row written to the day between the export and the check does this; the next run archives the day with it. |
| The disk is full, the directory cannot be written, or a rename fails | As a day that fails. A manifest that could not be renamed leaves the earlier one in force; table files already given their final names for it are named by no manifest, and are left (The archiver, step 1). |
| The hub stops in the middle of a run | The run is interrupted (The archiver, Shutdown). Nothing is lost: the log still holds the day. |
| The hub's process is killed, or the machine stops | As above. A file that was not flushed still has a `.partial` name; a manifest is renamed only after it and every file it names are on the disk. |
| A `.partial` file from an earlier run | Removed by the next run's sweep. |
| A day's directory whose manifest cannot be read | Left as it is, and logged at each run. |
| An archived day the log holds no row of | Left as it is; listed in the run's one warning of missing days. |
| An archived day whose log lacks some of its rows and holds others | Left as it is; logged at each run with how many rows each table lacks. |
| The directory is missing or cannot be written at start | The hub does not start (The archiver, Configuration). |
| The directory goes away, or cannot be read, while the hub runs | The run stops before it writes a file; logged `the archive could not read its directory; it will try again in an hour`, with the error; counted. The hub keeps relaying and serving. |

The counter `cota_archive_failures` counts the days the archive could not archive and the runs that could not read the request log or the directory, as `cota_requests_dropped` counts the writer's losses. The archiver never stops the hub, and never fails a request.

## Where it lives

All under `apps/hub/src/modules/request-log`:

- `03-domain/archive.ts`: a day, when a day is due, a day's summary, the manifest (a Schema), and the decision of step 4 of a run, with no IO; its laws in `archive.laws.test.ts`.
- `02-application/interfaces/request-log-archive.ts`: the port `RequestLogArchive`, the request log's side, in the module's terms: the summaries of every day; the server's version, the database, and the tables' columns and `CREATE`; `prepare`; and a session, in which a day's table is exported as a stream of compressed bytes, a file is loaded into `archive_<table>` and measured (count, checksum, fingerprint), the log's rows of a table and day are counted and summed, and the loaded rows the log does not hold are counted and added; `archive_<table>` is dropped. A scripted fake of it is in `05-tests/fakes/`. Its ClickHouse adapter is `04-infrastructure/persistence/clickhouse/clickhouse-request-log-archive.ts`, the only place beside the repository that knows the tables. The client's other requests send `accept-encoding: identity` (`client.ts`); the archive's exports ask for zstd and are not decompressed.
- `02-application/interfaces/archive-directory.ts`: the port `ArchiveDirectory`: the days and their manifests; a table's file written from a stream to its `.partial` name, giving its bytes and SHA-256; a file's size and SHA-256, or that it is missing; a file read as a stream; a day committed (files named, manifest renamed, earlier files removed); a day's `.partial` files removed, and the sweep of every day's. Its adapter is `04-infrastructure/archive/file-system-archive-directory.ts`, which also checks the directory at start, and an in-memory fake is in `05-tests/fakes/`; `archive-directory.test.ts`, beside the adapter, holds both to the same behaviour.
- `02-application/commands/archive-days.command.ts` (`ArchiveDays`, one run) and `restore-archive.command.ts` (`RestoreArchive`).
- `apps/hub/src/restore-archive.ts`, beside `main.ts` and outside the module, since it assembles the command with the ClickHouse and file-system adapters and reads the configuration's `[clickhouse]` through `config/`: the restore's script, run by the root `package.json`'s `archive:restore`; its contract test is `restore-archive.contract.test.ts` beside it.
- `module.ts` runs `ArchiveDays` on the schedule when the module's options have an archive directory, `config/` decodes `[archive]`, and `main.ts` checks its directory at start with the adapter's `check`, before it opens the hub store.

## Laws

| Id | Law | Held by |
| --- | --- | --- |
| B1 | **A day comes back.** For every request log written by `RecordRequest`, with titles reported through `SessionTitles`, restoring an archived day into a log that holds none of its rows gives each of the four tables exactly its rows of that day when it was archived: the same count and checksum. | clickhouse |
| B2 | **Verified before named.** No table file in an archive directory has a final name, and no manifest names it, unless ClickHouse loaded it into a table of its table's columns and found the count and checksum of the log's rows of that table and day. | property, clickhouse |
| B3 | **Nothing changed, nothing written.** A run over a log whose archived days' summaries equal their manifests, with no other day due and no `.partial` file to sweep, writes, renames and removes no file. | property, clickhouse |
| B4 | **A changed day is archived again.** After a run in which nothing failed and nothing was written to the log, every archived day that the log holds rows of, and whose archived rows it all holds, has a manifest equal to the log's summary of it. | property, clickhouse |
| B5 | **No archived row is given up.** A run never replaces, renames or removes a file named by the manifest of a day whose archived rows the log does not all hold. | property |
| B6 | **A damaged day is refused.** A restore adds nothing from a day whose manifest cannot be read, one of whose files is missing or differs from the manifest in size or SHA-256, whose tables' columns differ from the log's, or whose files load to other counts or checksums than the manifest's. | clickhouse |
| B7 | **Nothing twice.** A restore that runs while no other does adds to each table exactly the archived rows of the days it accepts that the log does not hold; restoring the same directory again adds nothing. | clickhouse |
| B8 | **The log only grows.** Neither a run nor a restore removes or changes a row of the request log: apart from the repository's `prepare`, which the restore runs and which only makes what is missing, they send the log's tables nothing but `SELECT` and `INSERT`. Their own temporary tables are not the log's: each is made by `CREATE TEMPORARY TABLE archive_<table> … EMPTY AS SELECT * FROM <table>`, which reads only the table's columns, and dropped by `DROP TEMPORARY TABLE IF EXISTS archive_<table>`. | clickhouse |
| B9 | **Items before their requests.** A restore adds every row it adds to a table, of every day it accepts, before any row of the next table in the load order. | clickhouse |
| B10 | **Only an ended day.** No day is archived for the first time before an hour has passed since it ended. | property |

B2 to B5 and B10 are property tests at two levels. The decision of a run's step 4 (`archive.laws.test.ts`) is run over generated manifests (readable and not, of days with and without rows) and generated summaries of the log (equal to the manifests, with rows added, with an item moved to an earlier day, with rows lost, empty), at generated instants of the test clock around each day's end, each law checked against this spec's table written out again in the test. `ArchiveDays` (`archive-days.laws.test.ts`) is run over the in-memory archive directory and a scripted `RequestLogArchive` whose exports, loads and verifications succeed, fail, break off or disagree as generated, and whose directory's writes and renames fail as generated, checking after each run which files exist under which names, what every manifest says, and that no file a manifest named was touched when B5 forbids it.

The clickhouse tier (`clickhouse-request-log-archive.clickhouse.test.ts`) writes generated session logs (`05-tests/sessions.ts`) spread over several UTC days, with sessions across midnight, items written twice because `known` failed (the scratch layer's faults), and the request of odd text the request log's L1 test writes, by `RecordRequest` over the ClickHouse repository into a scratch database, and titles through `SessionTitles`. It runs `ArchiveDays` into a temporary directory over days that ended before the clock (8 to 10 November 2026, under the live clock, since the writer's pauses and the client's waits run on it), restores into a second scratch database made by `prepare`, and compares each table's rows of each day by count and checksum (B1); restores again and finds nothing added (B7); runs again and finds no file touched (B3), then writes a late request to an archived day and finds it archived again (B4); damages files and manifests (a byte flipped, a file cut short or removed, a count, a checksum or a SHA-256 edited, a column's type changed in the log) and finds each day refused and nothing added (B6); and reads every statement sent (the scratch layer's `faults.sent`) for anything but `SELECT` and `INSERT` on the log's tables (B8; for the restore, its statements less exactly those `prepare` sends to a log whose tables exist) and for the order of the inserts (B9); a restore into a log from which some requests of a day were deleted adds those requests only (B7). `apps/hub/src/restore-archive.contract.test.ts` holds the script's arguments, its exit code 2 and that it reads only the configuration's `[clickhouse]`; the clickhouse tier's test of `bun run archive:restore` holds its day lines, its summary line and its exit codes 0 and 1, running the script itself into a scratch database: a directory of one good day and one damaged day gives the day added, the day refused and exit 1; the good day alone, in another scratch database, gives it added and exit 0, and again gives it already held and exit 0. For B2 in this tier, an export whose answer is lost and a row written to the day between the export and the check each leave the day without a manifest and without a final name, and an export whose answer breaks off after its first bytes fails its stream. For B4 in this tier, an item's later copy, kept beside the earlier one with merges stopped, leaves every day's manifest equal to its summary. Every law gets a mutant in `tooling/mutants.table.ts`, among them a day's titles left out of the restore (B1), the files named before they are verified (B2), a day archived before its hour has passed (B10), an archive replaced whenever its day changed (B5), a file of another SHA-256 accepted, a file that loads to another checksum accepted, and the loads left unchecked before the adds (B6), the insert without the held rule (B7), a table merged by the restore (B8), and the requests restored before their items (B9), and, without a law, a day the log holds whole reported as restored instead of already held.

## Not built, on purpose

- **An API endpoint for the archive.** A run says what it did and what failed in log lines, and `cota_archive_failures` counts failures, as the writer's losses are counted. The dashboard (milestone 3) can ask for one if the owner wants to see it there.
- **Upload to object storage.** The directory can be any mount the hub can write; copying it elsewhere (rsync, restic, a bucket) is the owner's, and its files never change once named, which suits any of them.
- **Encryption of the files.** An archive file holds the conversations in the clear, as the ClickHouse volume it copies does. It is mode 0600, and the owner guards the directory as they guard that volume, or puts it on an encrypted disk.
- **Pruning old files, and retention.** Nothing is deleted from the request log, and the archive removes only its own superseded and partial files. Rows deleted from the log by hand make the archiver say, every hour, that the log lacks them.
- **Today.** A day is archived once it has ended; the rows of the current day are only in the log.
- **Archiving `words`, the hub store or the configuration.** `words` is written again from the items a restore adds; the hub store and the configuration are backed up apart (ADR-0013).
- **Restoring into other columns.** A day archived before a table changed is refused; the manifest's `create` says what its file holds. Moving rows across a change is a migration's work, after the first release.
- **Checking the files on a schedule.** The archiver reads a day's files only when its day changed; a file damaged on the disk is found by the restore, which refuses it, or by the archiver when that day changes.
- **A reader for the files.** `zstd` and `jq` read them.
- **Two hubs on one directory.** Not supported, as two hubs on one hub store are not.
