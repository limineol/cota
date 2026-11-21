---
status: active
scope: apps/hub
owner: limineol
last_verified: 2026-11-13
review_by: 2027-02-13
supersedes: []
code:
  - apps/hub/src/modules/request-log/03-domain/sql.ts
  - apps/hub/src/modules/request-log/02-application/interfaces/sql-console.ts
  - apps/hub/src/modules/request-log/02-application/queries/run-sql.query.ts
  - apps/hub/src/modules/request-log/02-application/queries/read-schema.query.ts
  - apps/hub/src/modules/request-log/04-infrastructure/persistence/clickhouse/clickhouse-sql-console.ts
  - apps/hub/src/modules/request-log/04-infrastructure/persistence/clickhouse/sql-answer.ts
  - apps/hub/src/modules/request-log/04-infrastructure/persistence/clickhouse/client.ts
  - apps/hub/src/modules/request-log/01-presentation/sql.api.ts
  - apps/hub/src/modules/request-log/01-presentation/sql.handlers.ts
  - apps/hub/src/modules/request-log/05-tests/fakes/scripted-sql-console.ts
  - apps/hub/src/config/config.ts
---

# SQL

The owner and their agents can ask the request log anything in ClickHouse's SQL, read-only, within limits the owner sets and no caller can change. ADR-0015 gives the reasons and what was measured. It is a port of the request-log module, the SQL console (`02-application/interfaces/sql-console.ts`), with its ClickHouse adapter beside the repository (`clickhouse-sql-console.ts`, reading answers with `sql-answer.ts`) and a scripted fake for the contract tests, and two endpoints, `POST /api/sql` and `GET /api/schema` (`docs/specs/api/spec.md`), which a reader key or the owner may call.

## The limits

Six limits bound a caller's SQL. The owner sets them in the configuration file's `[sql]` section (ADR-0009), every key optional, and the hub reads them once, at start; a caller cannot change any of them (X2). A value outside its bounds is a problem of the configuration, reported with its path, and the hub does not start.

| Limit | Key | Default | Bounds | Where it acts |
| --- | --- | --- | --- | --- |
| How long a query runs | `max_query_time` | `"30 seconds"` | a whole number of seconds, 1 second to 10 minutes | `max_execution_time`; the hub waits 5 seconds longer |
| Memory a query uses | `max_memory_bytes` | `4_000_000_000` (4 GB) | at least 100,000,000 | `max_memory_usage` |
| Threads a query uses | `max_threads` | `4` | 1 to 256 | `max_threads` |
| Queries at once | `max_concurrent_queries` | `4` | 1 to 64 | `max_concurrent_queries_for_user` |
| Rows in an answer | `max_answer_rows` | `5000` | 1 to 1,000,000 | the hub's cap; `max_result_rows` is one more |
| Size of an answer | `max_answer_mib` | `16` (MiB) | 1 to 256 | the hub's cap; `http_response_buffer_size` is three times it and 1 MiB |

Why the bounds:

- **No 0.** ClickHouse reads 0 as no limit for the time, the memory and the queries at once, and as one thread per core for the threads, so every limit is at least 1 of its unit.
- **Time.** `max_execution_time` is whole seconds here, so the profile's value reads back as written. Ten minutes is the longest the hub waits for anything by default (a provider's first byte, `docs/specs/relay/spec.md`); a caller waits for its answer that long and 5 seconds more.
- **Memory.** Under a few megabytes ClickHouse fails ordinary queries (a count over a million numbers needs more than 1 MB), so the least is 100 MB. There is no most: ClickHouse's own server limit holds above it.
- **Threads and queries at once.** 256 threads is more than the machines the hub runs on have. Each query at once may have ClickHouse hold up to `http_response_buffer_size` of its answer and the hub the answer itself, so 64 bounds what the SQL user can make both hold.
- **Rows and size.** The hub holds a whole answer, as rows and again as the JSON it sends, so the size is at most 256 MiB. That keeps `http_response_buffer_size`, at most 769 MiB, below 2^32, a number ClickHouse reports as a number. A million rows is more than a person or an agent reads of one answer; the size bounds the memory either way.

## The SQL user

At every start the SQL console, as the hub's own ClickHouse user, makes sure ClickHouse has:

- a settings profile `<database>_sql` with exactly these settings, six of them from the limits:

  | Setting | Value | By default |
  | --- | --- | --- |
  | `readonly` | `1` (no query can change any setting) | |
  | `max_execution_time` | `max_query_time`, in seconds | `30` |
  | `max_memory_usage` | `max_memory_bytes` | `4000000000` |
  | `max_threads` | `max_threads` | `4` |
  | `max_concurrent_queries_for_user` | `max_concurrent_queries` | `4` |
  | `max_result_rows` | `max_answer_rows` and one | `5001` |
  | `result_overflow_mode` | `break` | |
  | `cancel_http_readonly_queries_on_client_close` | `1` | |
  | `http_response_buffer_size` | three times `max_answer_mib`, and 1 MiB, in bytes: more than the hub reads of an answer, its two header lines and its rows each at most the size | `51380224` (49 MiB) |
  | `output_format_json_quote_64bit_integers`, `output_format_json_quote_decimals`, `output_format_decimal_trailing_zeros` | `1` | |
  | `date_time_output_format` | `iso` | |

- a user `<database>_sql` with that profile, `SELECT` on `<database>.*` and no other grant, identified by a password of 32 random bytes the hub makes at this start and keeps in memory only, as a `Redacted`.

It runs `CREATE SETTINGS PROFILE IF NOT EXISTS`, then `ALTER SETTINGS PROFILE … SETTINGS` with the whole list (which replaces the profile's settings, so a hub started with other limits gives the SQL user them over the profile an earlier start made), `CREATE USER IF NOT EXISTS` and `ALTER USER` with the password and the profile, and `GRANT SELECT ON <database>.* … WITH REPLACE OPTION`, which takes away any other privilege. It never uses `OR REPLACE`, which gives a profile a new identity its users lose. Then, as the SQL user, it reads every setting of the table from `system.settings` and checks each against it, and reads `SHOW GRANTS`, which must be the one grant and nothing else: no other privilege and no role, since `SET ROLE ALL` is allowed under `readonly = 1` and would enable a granted role.

If a step failed or anything differs, SQL is **unavailable**: both endpoints answer 503 `urn:cota:sql-unavailable` with what was wrong in `detail`, and the hub logs it once. `detail` names the step and ClickHouse's error code, never ClickHouse's message, which names the hub's own user. While ClickHouse cannot be reached the hub tries again, waiting from one second up to a minute between tries; when ClickHouse answered and refused, it does not, and a restart tries again. Everything else in the hub works as before.

The database's name is the request log's (`[clickhouse] database`), so the user for `cota` is `cota_sql`. The hub's ClickHouse user needs access management for this (ADR-0015); `compose.dev.yaml`'s has it.

**The password.** It is made with `crypto.getRandomValues`, held as a `Redacted`, and appears only in the text of `CREATE USER` and `ALTER USER`, which ClickHouse writes to `system.query_log` without it and to its own log not at all. A failed step's ClickHouse message goes to the hub's log only, with the password cut out of it, and never into a problem, a span or an answer. Two hubs sharing one ClickHouse database would reset each other's password; that is not supported.

## `POST /api/sql`

Body: `{ sql }`, 1 to 100,000 characters (else 400 `urn:cota:query-too-long`, or the 400 of a body that does not decode when empty). One statement.

The hub sends the text unchanged to ClickHouse as the SQL user, with `default_format=JSONCompactEachRowWithNamesAndTypes` and the request log's database and nothing else in the URL, and reads the answer line by line as it arrives:

- the first line is the column names and the second their types;
- each line after is a row, kept until `max_answer_rows` rows or `max_answer_mib` MiB of rows are kept, by default 5,000 rows or 16 MiB (a row's bytes are its line's, as ClickHouse wrote it); at the first row past either, the hub stops reading, which closes the connection, and ClickHouse cancels the query (`cancel_http_readonly_queries_on_client_close`). A row longer than the room left is known not to fit before it ends, so the hub never holds more than the caps and the line it is reading.
- A statement ClickHouse answers with no format and no body (`SET ROLE ALL`, a `SYSTEM STOP MERGES` with no table, which stops nothing for a user with no grant on any table) is an answer with no columns and no rows.

Whatever the caller sends, the URL of `POST /api/sql` reaches no further than the hub: its query string is not passed to ClickHouse.

| Field | Type | Holds |
| --- | --- | --- |
| `columns` | `{ name, type }[]` | ClickHouse's names and types. |
| `rows` | `Json[][]` | The rows as ClickHouse wrote them in JSON: 64-bit integers and decimals as strings, times as ISO 8601. |
| `truncated` | boolean | Whether rows were left out. |
| `elapsedMs` | integer | From sending to the last row read, by the hub's clock. |

The hub waits for a whole answer at most 5 seconds past `max_query_time`, when ClickHouse stops the query: 35 seconds by default. Past that it answers 503 `sql-unavailable`, saying how long it waited.

At most `max_concurrent_queries` of the SQL user's queries run at once, four by default, which ClickHouse holds (`max_concurrent_queries_for_user`): one more is refused with `TOO_MANY_SIMULTANEOUS_QUERIES`, as `query-failed`. The hub keeps no queue of its own.

**Errors.**

| `type` | Status | When |
| --- | --- | --- |
| `urn:cota:query-failed` | 400 | ClickHouse refused or stopped the query: its syntax, a missing grant, a setting it may not change, its time or memory limit. `detail` is ClickHouse's message without its version suffix. |
| `urn:cota:format-not-allowed` | 400 | The answer was not the format the hub asked for, because the query names its own `FORMAT`. |
| `urn:cota:sql-unavailable` | 503 | As above, or ClickHouse could not be reached. |

A query that fails after its first rows is `query-failed`, and its rows are dropped. ClickHouse holds back up to `http_response_buffer_size` of an answer before it sends any, so a query that fails while the hub could still be reading it is answered with an HTTP error and ClickHouse's message. Without that, ClickHouse sends the rows as it makes them and, on a failure, frames its message after them and closes the connection; Bun's `fetch` can drop those last bytes, which left the hub answering 503 for a query that failed. The hub still reads a framed message, should one come, and `detail` is ClickHouse's message without the length and tag it frames it with. A query cut short by the caps is not a failure: if ClickHouse would have failed later, the answer is the rows kept, `truncated`.

## What the SQL user can read

Its own database's tables, and these `system` tables, which ClickHouse lets every user read (`clickhouse` tier, X3):

| Tables | What they hold |
| --- | --- |
| `aggregate_function_combinators`, `collations`, `contributors`, `data_type_families`, `database_engines`, `dictionary_layouts`, `disk_types`, `formats`, `functions`, `licenses`, `one`, `privileges`, `table_engines`, `table_functions`, `time_zones` | The server's catalogues, the same for every user. `functions` lists no user-defined function to a user with no grant to see one. |
| `databases`, `tables`, `columns`, `completions` | Only the databases, tables and columns the user may read: its own database. |
| `settings`, `current_roles`, `enabled_roles`, `quota_usage` | The user's own session: its settings, its roles (none) and its quota. |
| `user_query_log` | The user's own queries only. |

Every other `system` table is refused (`ACCESS_DENIED`): users, grants, roles, profiles, the query and text logs, processes, parts, mutations, clusters, disks, dictionaries and the rest. So is every table function that reads outside the query (`url`, `remote`, `file`, `s3`, `executable`, `mysql`, `dictionary`, `merge` and the others the tier lists), `INTO OUTFILE`, a `dictGet` or `joinGet` on another database, and `SHOW` of users, grants, profiles, quotas, processes or clusters. Table functions that make their rows from their arguments (`numbers`, `values`, `generateRandom`, `format` and the like) work.

What it learns beyond its database, all of it read-only and none of it a value from another database:

- the server's host name, version, UUID, TCP port, kernel version and free disk space, from `hostName()`, `version()`, `serverUUID()`, `tcpPort()`, `getOSKernelVersion()` and `filesystemAvailable()`;
- that a table exists in another database, with its UUID and engine, from the error of a `timeSeries…` table function called on it, and whether a `MergeTree` table there has a projection of a given name, from `mergeTreeProjection`'s error.

One thing it can change outside the database, which X1 does not cover: `sqlite('<name>', …)` opens its file, creating it empty, before ClickHouse refuses the query for want of `READ ON SQLITE`, so the SQL user can leave empty files in ClickHouse's `user_files` directory. The path must be inside that directory, and nothing is written to the file. The hub cannot refuse it without parsing SQL; the clickhouse tier's X3 leaves one such file, `data.db`.

A dictionary created inside the request log's database, which the hub never does, would be readable with its source's settings, its password shown as `[HIDDEN]`.

## `GET /api/schema`

What the SQL user can read, as it sees it: `system.tables` and `system.columns` for the request log's database, read as the SQL user at each call. It is never written by hand, so it cannot drift from the tables: a table or column `prepare` adds appears in it at once.

| Field | Type | Holds |
| --- | --- | --- |
| `database` | string | |
| `tables` | `{ name, engine, rows, bytes, comment, columns }[]` | By name. `rows` and `bytes` are ClickHouse's totals (`total_rows`, `total_bytes`), `null` for a view. |
| `columns` of a table | `{ name, type, comment }[]` | In the table's order. |

## Laws

| Id | Law | Held by |
| --- | --- | --- |
| X1 | **Nothing changes.** No text sent to `POST /api/sql` changes any table, user, setting or grant: every statement that would is refused or, as a `SYSTEM STOP` with no table, does nothing, and the database reads the same before and after. | clickhouse |
| X2 | **The limits are the owner's.** A query cannot change a setting, by `SETTINGS`, by `SET` or in the URL, which callers cannot reach: it is refused, and the profile's values, from the configured limits, hold for it. | clickhouse |
| X3 | **Only the request log.** A query that reads another database, a `system` table beyond those listed above, or calls a table function that reads outside the query, is refused. | clickhouse |
| X4 | **The cap is hard.** An answer has at most `max_answer_rows` rows and at most `max_answer_mib` MiB of them (5,000 and 16 by default), whatever the query. | property, clickhouse |
| X5 | **Truncated means more.** `truncated` is true exactly when the query had more rows than the answer holds. | property, clickhouse |
| X6 | **Unavailable, not unsafe.** When the SQL user's settings are not the profile's, or its grants are not the one, no query is sent, and both endpoints answer 503. | property, clickhouse |

X1 to X3 run against the clickhouse tier's real ClickHouse, with the user the SQL console makes over a scratch database, beside which is another database holding a table, a `Join` table, a dictionary and a time series to reach for (`clickhouse-sql-console.clickhouse.test.ts`). X1 sends generated `INSERT`, `ALTER`, `CREATE`, `DROP`, `TRUNCATE`, `OPTIMIZE`, `SYSTEM`, `KILL`, `GRANT`, `SET` and `BACKUP` statements and two-statement texts, in any case, with comments and any space between words, and checks, after the statements, that merges still run; X3 calls every table function the server has, so one a ClickHouse upgrade adds fails the test until it is listed, and reads every `system` table. X4 and X5 run over the line reader with generated answers of every size around both caps at their defaults, a 16 MiB one exactly among them, and with generated limits of a few rows and bytes and answers around them, arriving in chunks of any size (`sql-answer.laws.test.ts`), and against ClickHouse with generated row counts and row lengths, one row of 100 MB and a cross join, after which nothing of the SQL user's runs, and with limits of 10 rows and 1 MiB. X6 runs `prepare` over a fake ClickHouse reporting the profile's settings with one of them changed or missing, and grants with others or without its own (`clickhouse-sql-console.laws.test.ts`), and on the clickhouse tier with a hub user that may make profiles but not users, where both endpoints answer 503, the request log's tables are made, and the password is in no answer, log line, `system.query_log` or `system.text_log`. The tier also reads the answer buffer back as the SQL user, and runs a query past 30 seconds and one past 4 GB, five at once, one whose caller leaves, one that fails after its first rows, and queries naming their own format; with limits of the owner's, a query past 2 seconds; and it starts the console twice over one database, at the defaults and then with other limits, and reads the six settings back as the SQL user after each. The hub's wait of 5 seconds past the query's time is held over a ClickHouse that never answers (`clickhouse-sql-console.laws.test.ts`).

## Not built, on purpose

- **Rows and bytes read.** A format read row by row, and stopped early, carries no statistics (ADR-0015).
- **Saved queries, history, examples.** The dashboard's SQL console (Milestone 3) may keep them in the browser.
- **Query parameters.** The text is sent as written; there is no `{name:Type}` binding for callers.
- **Several statements in one call.**
- **Reading the hub store with SQL.** Sign-ins and display names are not in ClickHouse (ADR-0013).
- **A direct ClickHouse connection for agents.** They use this endpoint with a reader key; the SQL user's password never leaves the hub.
