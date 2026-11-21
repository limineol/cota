---
status: accepted
scope: apps/hub
owner: limineol
last_verified: 2026-11-19
review_by: 2027-02-18
supersedes: []
code: []
---

# ADR-0025: An import reads the prototype's log day by day, only with `SELECT`, and adds to the request log what it lacks, keeping each conversation in the form the prototype logged it

## Context

Cota replaces the prototype on the machine it runs on (ADR-0024's Context). The prototype's log holds every request and conversation the owner made through it since it started; the roadmap's milestone 5 has "an importer for the prototype's data", so that the request log, and the agents that will search it (the memory skill, later in milestone 5), start with that history rather than at the day of the change.

What the prototype holds, as its own files show it (its `compose.yaml`, its `clickhouse/hub.sql`, its dashboard's queries and server, and its `archive/archive.sh`; never its environment or its running server), and as its database answered on 2026-11-19 to read-only queries of counts, types, key names and enumerated values, on the owner's go (Facts, below):

- **Bifrost's request table, `bifrost.logs`**, in the prototype's ClickHouse: one row per request, written by the gateway (Bifrost) and written again as the request goes on, so its views read it with `FINAL` and the latest write wins. The prototype's tags (account, project, machine, and the account a diverted request came from) are a JSON `metadata` column, from the `x-bf-lh-*` headers its clients sent; its views also read a `client` key there, which no request carries. Usage is in OpenAI's terms (`prompt_tokens`, `completion_tokens`, `cached_read_tokens`, and a `token_usage` JSON with the cache writes, split by lifetime where the provider split them, and the reasoning tokens), and the cost is Bifrost's own number.
- **The conversation, in Bifrost's form.** Bifrost logs the conversation in OpenAI Responses items for every client that is not a Chat Completions one (Claude Code's Anthropic Messages included, converted by Bifrost, with ids Bifrost makes up on each conversion), and in Chat Completions messages for OpenCode and Pi; and it logs a request's whole history again with every request. Neither is what the client sent.
- **The prototype's conversation store, the `hub` database**: `hub.messages`, each item once per session (its first copy as logged, its `cityHash64` after Bifrost's ids and Claude Code's cache markers are taken out, when it was first seen and by which request, where, its type, role and text), and `hub.request_items`, each request's items as those hashes, by part (`input`, `output`, `tools`). Refreshable views fill both every five minutes from what Bifrost wrote in the last hour.
- **Emptied days.** Once a day is archived, the prototype's archiver empties `bifrost.logs`' copy of that day's input histories (and drops the tool definitions from `params`), keeping tags, usage, cost, status, errors and output: `responses_output` is filled on every day, and `output_message` on some. So for every day but the last, a request's whole conversation is only in the `hub` tables, and in the prototype's archive files.
- **Titles and names outside ClickHouse**, in its dashboard's data volume: reported session titles in a SQLite file (`titles (session_id, title)`, no time, no machine), and renames in `settings.json` (`{ "renames": { "pool", "model", "client", "host", "project" } }`). The same volume holds the prototype's Claude and ChatGPT logins.
- **A read-only user.** The prototype's ClickHouse (26.3, its server's time zone UTC) has a user that can only select, from those two databases, whose settings profile is `readonly = 2` with a 30-second limit on each query and `max_result_rows = 100000` with `result_overflow_mode = 'break'`: an answer of more rows ends early, with no error, as if the rows ran out. The profile constrains only the execution time and memory, so the user's queries may set any other setting but `readonly`.

How large it is was read from the source on 2026-11-19 (below): a few hundred thousand requests over four weeks, the busiest day near 20,000; about a million items in a few thousand sessions, several GiB on disk; and one day's items up to 2.8 GiB of content uncompressed, three days above 1 GiB.

The archive (ADR-0018) has the honesty the import needs: a restore adds only what the log does not hold, never changes or removes a row, checks before it adds, and running it twice adds nothing.

## Decision

### What is read

Only these, each only with `SELECT` (and `system.columns` for their shapes):

| Source | Columns read | For |
| --- | --- | --- |
| `bifrost.logs FINAL` | `id`, `timestamp`, `session_id`, `metadata` (`account`, `project`, `host`, `fallback-from`), `user_agent`, `provider`, `model`, `object_type`, `params`, `status`, `stream`, `stop_reason`, `prompt_tokens`, `completion_tokens`, `cached_read_tokens`, `token_usage`, `cost`, `latency`, `error_details` | the requests |
| `hub.messages` | `session_key`, `hash`, `first_seen`, `request_id`, `source`, `position`, `content` | the conversation items |
| `hub.request_items FINAL` | `request_id`, `session_key`, `timestamp`, `input`, `output`, `tools` | which items each request carried |
| the titles file (SQLite, opened read-only) | `session_id`, `title` | reported titles |
| the names file (JSON) | `renames` | display names |

`is_passthrough` is not read: a passthrough is the `object_type` `passthrough`, which says it already. No statement sets `readonly`: the source's user is read-only by its profile (`readonly = 2`), and ClickHouse refuses a query that sets `readonly` from such a user, even to what it already is.

**A source answer is whole, or the import fails.** A profile can cap an answer (`max_result_rows`, `max_result_bytes`) or what a query reads, sorts, groups, joins or sends, and an overflow mode of `break` (or `any`, for grouping) ends the answer there with no error, so the rows past the cap would be counted not carried, or never seen. Every statement the import sends its source therefore lifts the caps on an answer's own size (`max_result_rows = 0`, `max_result_bytes = 0`) and makes every other overflow an error (each `*_overflow_mode = 'throw'`). The answer caps are lifted rather than made to throw because the import bounds its own answers by pages and chunks and the prototype's reader caps them at 100,000 rows, which a page's items can pass: throwing there would stop the import at the first large page for a limit meant for people's queries. The other limits are left to the owner and made loud: they guard the source's server, the prototype sets none of them, and one that is reached fails the import, naming the limit, rather than cut it short. A profile that forbids changing these settings fails the import's first statement, before any day.

An item's `type` and `role` are read from its `content`, as the request log reads every item's (`docs/specs/protocols/spec.md`), not from the `type`, `role` and `text` columns `hub.messages` also has, which the prototype's views extracted from the same content by a rule of their own. `metadata.client` is not read: no request carries it, and a request's client is the request log's rule over `user_agent`.

Bifrost's conversation columns (`responses_input_history`, `responses_output`, `input_history`, `output_message`, `tools`, `content_summary`, the passthrough bodies) are not read. They are not empty: `responses_output` is filled on every day and `output_message` on some, but the input histories are emptied once a day is archived, and the `hub` tables hold every request's items, inputs and outputs, once per session, for every day (fact 10). Reading Bifrost's copy beside them would read each conversation twice, once whole and once in part, for nothing the `hub` tables lack. The prototype's views (`hub.requests`, `hub.sessions`) are not read: the import keeps its own rules, and takes from `hub.requests` only its rule for a request's pool (the account, else the provider) and for a passthrough model listing. Nothing else of the prototype is read: not its environment, not its gateway's own database, and never the logins in its dashboard's volume. The owner copies the titles and the names files out of that volume, and nothing else of it.

At start the import reads the source's columns from `system.columns` and refuses to go on (exit 2) when a table or a column above is missing or of another type than the one the import reads, naming each, so that a source unlike the one it was built for is never half read.

### Facts, read from the source on 2026-11-19

Read on the owner's go, as the source's select-only user, counts, types, key names and enumerated values only, never an item's content. Each was inferred when this was first decided, from the prototype's queries and code; what the source answered, and what it changed:

1. **Types and time.** The server's time zone is UTC. `timestamp` and `hub.messages.first_seen` are `DateTime64(3)`, UTC instants; `latency` and `cost` are `Nullable(Float64)`; `metadata`, `session_id` and `user_agent` `Nullable(String)`; the token columns `Int64`; `status`, `error_details`, `params` and `token_usage` `String`; `stream` and `is_passthrough` `Bool`; `hash` `UInt64` and `input`, `output`, `tools` `Array(UInt64)`. The columns check holds these.
2. **A request's id and time never change**: as many ids as rows, none with two timestamps, no unmerged copy. The ids are UUIDs version 4. So the id made from it never changes either.
3. **Three statuses**, not two: `success`, `error` (about 3 rows in 1,000) and `cancelled` (about 2 in 1,000), nearly all of them a status 499 `request_cancelled` (the client went away) and a few a 504 `request_timed_out`. No row was written at a request's start and left so. A cancelled request is the request log's `cancelled`, not an unfinished one.
4. **`prompt_tokens` holds the cache reads and writes** in every row with usage (never less than their sum); the usage object's counts equal the columns, and its `cached_tokens` the reads. **The cache writes are split by lifetime** for the Anthropic provider: `prompt_tokens_details.cached_write_token_details` holds `cached_write_tokens_5m` and `cached_write_tokens_1h` in most of that provider's rows, always adding up to the cache writes, and most of those have writes of an hour. Reasoning is `completion_tokens_details.reasoning_tokens`.
5. **`latency` is milliseconds**, a float with fractions, null in a few rows. No time to the first byte is recorded.
6. **`error_details`** holds `error` (`message`, `type`, sometimes `code` or an `error` inside), `status_code` (absent in some rows), `is_bifrost_error` and `extra_fields` (routing, and a `retry_after_ms` in some rows; no response header). Some errors have an empty `error_details`. Nearly half of the errors are 429s.
7. **Object types**: by size, `responses_stream` (five rows in six), `passthrough` (one in nine), `chat_completion_stream`, `count_tokens`, `list_models`, `responses`, `chat_completion` and `image_generation`. The passthrough rows are, by `params.method` and `params.path`, Codex's `GET /backend-api/codex/models` (nearly all), its `POST /backend-api/codex/alpha/search` (a few dozen) and a `GET /models` (two). Codex's own requests are `responses_stream` with `is_passthrough` true. A model listing is `list_models`, or a passthrough whose path ends `/models`: about 12% of the log.
8. **Tags.** `metadata.client` is never set. The user agents' families are Claude Code's `claude-cli`, Codex's `codex-tui`, `codex_exec` and `codex_cli_rs`, `pi`, `opencode`, one more on the Codex pool (a sixth of the log), the prototype's own configure script's, `curl` and `Python-urllib`. `account`, `project` and `host` are on nearly every row; `host` and `project` without an account on the rows of the Chat Completions providers, whose pool is their provider; none of them on a few hundred rows. Several account names; and providers on rows with no account: some that never carry one, and a handful of rows of providers that normally do. So the pool map names accounts and providers both. A few rows with an account are of another provider than the rest of that account's rows, and bill the account's pool by the rule below. Dozens of projects, a few hosts. About one request in nine has no session, nearly all of them model listings.
9. **Item types.** In the Responses form: `message` (roles `user`, `assistant`, `system`, `developer`), `function_call`, `function_call_output`, `reasoning`, `custom_tool_call`, `custom_tool_call_output`, `additional_tools`, `configuration_update`, `compaction`, `compaction_trigger`, `web_search_call`, and the tools `function` and `web_search`. In the chat form: no type, roles `user`, `assistant`, `system` and `tool`. No item's content is empty. Every one of Codex's own requests has items; the passthrough listings and searches have none.
10. **Every hash is held**: none of the tens of millions of hashes `hub.request_items` names is missing from its session's `hub.messages`. No past day lacks its items: every request that can carry a conversation has one, but those of the last minutes before the read, which the prototype's views had not filled yet.
11. **Request ids** in `hub.messages` and `hub.request_items` are `bifrost.logs.id` as text, for all but a few dozen of the `hub.request_items` rows; **those few dozen name a request the log does not have**, and some thousands of items were first seen by them. A session key is the `session_id`, or `request:<id>` for a few rows.

Also read: `cost` is null for the model listings and 0 for some rows of one provider; some requests carry `fallback-from` (source pools diverted to another); `bifrost.logs` is a few GiB on disk and `hub.request_items` names tens of millions of hashes, the longest input over a thousand items.

What the facts changed, each a rule below: `cancelled` is an outcome of its own (fact 3); cache writes are split by lifetime where the usage object has the split, and the split is no longer among what is not carried (fact 4); `metadata.client` is not read, the pool map names a provider whenever any of its rows has no account, and a dry run counts the requests of another provider than most of their pool's (fact 8); a null `latency`, an absent or zero `status_code` and an empty `error_details` each have a rule (facts 5, 6); a model listing is a passthrough's path as well as `list_models`, and every object type becomes one of the request log's operations (fact 7); an item is carried by the imported requests that name it, which covers the `request_items` rows without a request (fact 11); and a day is read, built and loaded page by page, since a day's items do not fit in memory (the sizes in the Context).

### How it is run

```sh
COTA_CONFIG=/etc/cota/cota.toml bun run import <import file> [--dry-run] [--from <YYYY-MM-DD>] [--to <YYYY-MM-DD>]
```

From the hub image (`docker compose run --rm hub bun run import …`, the import file and the copied files mounted read-only) or from a checkout. It reads the hub's configuration as the restore does, but more of it and no other secret: its `[clickhouse]` for the request log, its `[store] path` for the display names, and its pools' ids, protocols, providers and prices for the pool map's targets and the cost; and the import file:

```toml
[source.clickhouse]
url = "http://<the source's ClickHouse, as this machine reaches it>:8123"
user = "<a user of the source that can only select>"
password = { file = "/etc/cota/import/source-password" }

[source.files]
titles = "/etc/cota/import/titles.sqlite"   # optional
names = "/etc/cota/import/settings.json"    # optional

# The pool map: each pool of the source, by the source's name for it, to a pool of the hub's configuration.
[pools]
acme = "work"
personal = "personal"
chatgpt = "chatgpt"
zai = "zai"

# Optional: a machine the source tagged by another name than the one cota joined it as.
[machines]
old-name = "studio"
```

The source's login is a secret by reference (ADR-0009), in a file the owner writes. How this machine reaches the source's ClickHouse (a port on loopback, the source's Compose network) is the owner's network, and the private runbook's.

**One import at a time**, and not beside a restore: two that overlap can each find the same rows not held, as two restores can. The hub may be running.

**A dry run** (`--dry-run`) reads everything a real import reads, builds every row, loads it into the temporary tables, and adds and verifies each day as a real import does, but into temporary tables of its own session (`dry_run_<table>`) that the held rule reads beside the log's, so nothing is added anywhere (no `INSERT` into a table of the request log, no write to the hub store) and its counts are those a real import would add, day after day. A dry run that only counted what the log lacks would count again, on each day, the items an earlier day of the same run adds, and miss the earlier days' copies of an item. It prints, day by day, what an import would add and what it would not carry, and why; the source's pools, machines, clients, statuses and object types with their counts, and which pools the pool map does not name; the requests whose source provider is not the one most of the requests of their pool carry (a request with an account bills its account's pool whatever its provider), so that the owner sees them; and how long each day took to read, build and load, so that the owner can tell how long a real import of the whole will take. It is how the pool map is checked, and the facts above read again, before anything is written.

**Exit codes**: 0 when every day was added or already held, 1 when one failed (or, for a dry run, a pool is not mapped), 2 when it could not start (its arguments, either configuration, the source's columns, a source pool the pool map does not name or a target pool the configuration does not have, the source or the request log unreachable, a hub store this image's migrations do not match exactly).

### Day by day, page by page, and only what is lacking

A **day** is the archive's: a calendar day in UTC, and each row's own time (a request's start, an item's first time seen, a title's report). The import takes the days of the source from its first to its last, or `--from` to `--to`, in ascending order, and stops at the first day that fails. **A day does not fit in memory**: its items are up to 2.8 GiB of content. So only the summaries are a day's; reading, building and loading go page by page. For a day:

1. **Read the source's summary** of the day: the count and the fingerprint (the sum of `cityHash64` of each id as text) of its requests, the count of its items, and of its `hub.request_items` rows.
2. **Read, build and load, a page at a time.** Make the temporary tables of the import's ClickHouse session (one for the run, ended once idle for ten minutes rather than the restore's one, since a day's source is read between its writes), `archive_<table>`, made `EMPTY AS SELECT * FROM <table>` as the restore makes them. Cut the day's sessions into **pages**, each at most 2,000 requests and 500,000 hashes named by its request items (a session that alone is more is a page of its own). For each page read its requests and request items, then its items in **chunks** of at most 16 MiB of content (an item that alone is more is a chunk of its own), each query well within the source user's 30 seconds; build the request log's rows from them (below); and add them to the temporary tables. A row that cannot be built is not carried, and counted with its reason.
3. **Read the summary again.** The day fails unless it is the same as in step 1 and the rows read add up to it: the source changed under the import, or a page was lost.
4. **Check** that each temporary table holds as many rows as were built.
5. **Add**, table by table in the archive's load order (`items`, `request_items`, `requests`, `session_titles`), the loaded rows the log does not **hold**, by the archive's rule (ADR-0018, `docs/specs/archive/spec.md`, Held), with `async_insert = 0`. A request whose items are neither held nor among the day's is not added, and the day fails, naming the earliest day it must be imported from.
6. **Verify**: every loaded row is now held; the log's `requests` and `request_items` rows of the loaded ids gained exactly the count and checksum of the loaded rows the log did not hold (the archive's checksum, the sum of `cityHash64` of each row's `RowBinary`, taken before and after the add); and the day's source requests are its built requests. Only then is the day reported added.

The import's memory is bounded by one page and one chunk at a time, and the digests of the page's items, never by a day: on a constructed day of 2.81 GiB of item content its process's peak footprint stayed between 512 and 624 MiB (the import spec, Memory). ClickHouse's is bounded by a block: each table's add is one statement over the day, but it is made, as the restore's is, in blocks of at most 16 MiB or 65,536 rows by one thread, so the search index's view, which keeps the distinct words of each block it is given, holds one block's at a time. Made in one block per day, the add of a day of random text (whose words are nearly all distinct, as screenshots, hashes and paths are) ran ClickHouse out of memory at 9.31 GiB; made in blocks, it peaked at 725 MiB for that day of 2.80 GiB and at 718 MiB for one of half that, and the add of a day of ordinary words went from 1.63 GiB to 361 MiB, taking 74.5 seconds instead of 57.0 (the whole import 124.8 instead of 104.8). This is the restore's second half, fed by the source instead of a file: `RequestLogArchive`'s session, its temporary tables, its count of what is not held and its add, which the import reuses rather than writes again, with an add of rows to a temporary table page by page and the measures its verification needs.

A day all of whose built rows are held is `already held`. An interrupted import leaves only rows that the log did not hold, each table of a day before the next, and every day before it whole; running it again adds the rest, and `--from` the day it last printed spares reading the days before.

### Identity: what a second import finds held

- **A request's id** is a UUID version 7 made from the source: its 48-bit time is the source request's `timestamp` in milliseconds, and its 74 other bits the first bits of the SHA-256 of `cota-import:bifrost:<the source's id>`. So the same source request always gives the same id, stamped with its start as every id of the request log is, and an import again finds it held by its id. Its session, when the source has none, is `request:<that id>`, as the hub makes one.
- **A request's items** are held by their request's id, **an item** by its session and digest with a copy at least as early, **a title** by all five of its columns: the archive's rule.
- **A display name** is set only for a kind and key the owner has not named.

So a source that does not change, imported twice, whole or in parts, gives the request log the same rows as once. A request's cost is priced at each import (below), so a request held from an earlier import is left as it is, even when the price lists changed since: the verification compares what an add gained, not the log's rows with what was built.

### What each becomes

**Requests.** One row of `requests` per row of `bifrost.logs FINAL`:

| Column | From the source |
| --- | --- |
| `id` | made as above |
| `started_at` | `timestamp` |
| `duration_ms` | `latency`, rounded to whole milliseconds; 0 when it is null, as the hub has no other number for a duration it never measured |
| `first_byte_ms` | null: not recorded |
| `session` | `session_id`, else `request:<id>` |
| `machine`, `project` | `metadata.host` (through `[machines]` when it names it), `metadata.project` |
| `client`, `client_version` | the request log's rule over `user_agent` (`docs/specs/request-log/spec.md`, `client`), and the version by the same rule; `user_agent` as recorded |
| `pool` | the pool map's pool for `metadata.account`, else for `provider` |
| `diverted_from` | the pool map's pool for `metadata.fallback-from`, when set |
| `provider` | the provider the configuration gives that pool, as for every request |
| `protocol` | the request's source form: `bifrost-chat` for the Chat Completions requests (whose items the source logged as chat messages), `bifrost-responses` for every other |
| `operation` | by `object_type`, in the request log's own words (below) |
| `model`, `stream`, `stop_reason` | as recorded |
| `outcome` | `success` is `ok`; `error` is `error`; `cancelled` is `cancelled`; any other status is `error` with `error_type` `cota_import_unfinished` |
| `upstream_status`, `error_type`, `error_message`, `error_body` | `error_details`' `status_code`, its error's type (else its code) and message; `error_body` is `error_details` as recorded, cut to 64 KiB. A success is 200. A `status_code` that is absent or 0 is 0, the hub's "never answered"; an empty `error_details` gives empty texts, as the hub writes when it has nothing to say |
| the usage | below |
| `cost_usd` | below |
| `usage` | `token_usage`, as recorded, when its usage is carried: the source's usage object, not the provider's |
| `hub_key`, `login_fingerprint`, `session_source`, `purpose`, `served_model`, `service_tier`, `provider_request_id` | empty: not recorded |
| `follows`, `refusal_reset` | null |
| `rate_limits`, `client_headers` | empty maps |
| `request_bytes`, `response_bytes` | 0; `reading_complete` true |

Every text is made well-formed, as the writer makes it (`docs/specs/request-log/spec.md`, Well-formed text).

**Operations**, by the request log's own words, which the protocols give (`docs/specs/protocols/spec.md`): `responses_stream` and `responses` are `responses`; `chat_completion_stream` and `chat_completion` are `chat`; `count_tokens` is `count_tokens`, Anthropic Messages' word; a model listing (`list_models`, or a passthrough whose `params.path` ends `/models`) is `models`, which traffic leaves out; a passthrough whose path ends `/alpha/search` is `search` and `image_generation` is `image`, the Codex backend's words; any other passthrough, and any other object type, is `other`. The dry run lists the source's object types with their counts, so one this list does not know is seen before it is imported as `other`.

**The client.** The request log's rule names `claude-code` for `claude-cli`, `codex` for every user agent that begins `codex` (`codex-tui`, `codex_exec`, `codex_cli_rs`), and `opencode` and `pi` for theirs; it does not name the one more family on the Codex pool, the prototype's configure script's, `curl` or `Python-urllib`, which become their first product's name in lower case, as for any client the hub does not know.

**Usage, kept as recorded; cost, priced again.** The token counts are the source's, put in the request log's classes: with the cache writes `prompt_tokens_details.cached_write_tokens` of `token_usage`, input is `prompt_tokens` less the cache reads (`cached_read_tokens`) and writes; the cache writes are split by lifetime where the usage object has the split (`cached_write_token_details`: `cached_write_tokens_5m` is `cache_write_short_tokens`, `cached_write_tokens_1h` `cache_write_long_tokens`), and all short-lived where it does not, as the request log reads a provider that does not split them; output is `completion_tokens`, reasoning `completion_tokens_details.reasoning_tokens`. A usage that does not add up (input below zero, a split that is not the writes, a count below zero or past what the request log holds) is not carried, and the request is imported with `usage_reported` false. A request with no usage object has `usage_reported` false. The **cost** is what the price lists give that usage for the pool and model at the time of the import, exactly as the writer computes one (`docs/specs/cost`), and never Bifrost's `cost`: one rule for every row of the request log, so that a chart across the day of the change does not move because two programs priced the same tokens two ways, and so that a correction of a price list's number is the same for the old requests as for the new. The day lines say the source's recorded cost of the day beside the cost the import gave it, so the owner sees the difference. Requests the source priced while Cota cannot (a model with no price) have no cost, never zero.

**Conversations: kept in their source form, never converted.** An item's content is its `hub.messages.content`, written in the request log's canonical form; its digest is the request log's (SHA-256 of that content), so two copies the source kept apart in one session that are the same JSON are one item, as in any session. **An item is carried when an imported request names it**: its **first request** is the source's (`hub.messages.request_id`) when that request is imported, else the earliest imported request whose `hub.request_items` row names it; its first time seen is that request's start, its part (`input`, `output` or `tools`) and position where that request has it (the source's `source` and `position`, from 0, for the source's request). An item that no imported request names is not carried, and counted. A day holds an item when its first request is of the day, and a request of an earlier day that names it holds an earlier copy too, so that no request is added before its items (the first copy wins, as in any session). Its `type` and `role` are its own, its `text` by the source form's rule. A request's `request_items` row has its items' digests in order, resolved from the source's hashes through its session's items; no `system` part (the source form carries a system prompt as an input item); the layout of a body in its source form, `tools` and `input` as lists; no overlay; and as params the source's `params` without `tools`. A `hub.request_items` row whose request the log lacks (fact 11's 45) is not carried, and counted. A request without a `hub.request_items` row, or whose hashes do not all resolve, has no conversation: it is imported without one, and counted. Rebuilding an imported request's body gives the conversation as the source logged it, which is said wherever the inspector shows it: it is not what the client sent.

Converting Bifrost's items back into Anthropic Messages or Codex's items would invent a body no client sent and no provider read: the conversion is Bifrost's, lossy, and not documented. So the request log learns two source forms, each with what the sessions spec gives a protocol: a renderer for transcripts (`bifrost-responses` reads Responses items, as `chatgpt-codex`'s renderer does and the prototype's own transcripts did; `bifrost-chat` reads chat messages, as `openai-chat`'s does), an item's text for search (the same rule as those protocols' items'), and a row in the first prompt's table. A type the renderer does not know (`compaction`, `compaction_trigger`, `additional_tools`, `configuration_update`) is shown as its JSON, never a failure. A source form is never a pool's protocol.

**Sessions.** An imported session is the source's session id, so a session the owner carries on after the change is one session in the request log, its older requests in their source form and its newer ones as the client sent them; their items differ, so its main thread may be read as two threads, the newer one winning once it is the larger. Request roles come from the sessions spec's rules: the client's word (a purpose, a kept header) is not in the source, so imported requests are placed by structure (rules 1 and 5); and no source form has a title shape, so an imported session's generated title is not carried, and its title is the reported one, below.

**Titles.** Each title of the titles file becomes a row of `session_titles`: its session and title (well-formed, trimmed, cut to 200 characters); `reported_at` the start of that session's latest request in the source, since the file kept no time; `machine` empty, since the file kept none; and `reported_by` `import`. A title reported by a machine after the change is later, and wins. A title of a session the source has no request of is not carried.

**Display names.** Each rename of the names file becomes a display name of the same kind (`host` is `machine`), its key through the pool map for a pool and through `[machines]` for a machine, set through the display-names module's `SetDisplayName` into the hub store, for a key the owner has not named. A rename whose pool the map does not name, or whose name is not 1 to 80 characters, is not carried.

**Diverted requests** are the source's requests with `fallback-from`: they bill the fallback pool, with `diverted_from` the pool they came from, as the hub records a diverted request. The refused request before each is in the source as an error; it is imported as an `error` with its status, not as a refusal, and not linked by `follows`, since the source records neither a refusal's reading nor the link (a `retry_after_ms` in `error_details` is the only trace of a reset, and it stays in `error_body`).

**Errors** are imported as the source recorded them, so the errors screen groups them with the hub's by provider, model, outcome, status, type and message.

### Not carried, and said so

Every day line and the import's last lines say what was not carried, with counts: requests whose conversation the source lacks; usages that do not add up; request items whose request the source's log lacks; items no imported request names, or whose content is not JSON; titles of sessions with no request; renames that do not map. And once, for every imported request, what the source never recorded: the body the client sent (only Bifrost's form of the conversation is), the login's fingerprint, the quota headers, the kept headers and the client's purpose, the time to the first byte, the body sizes, the service tier, a refusal as a refusal and the request it was diverted after, and a title's time and machine. The prototype's quota logins and its gateway's keys are never read: the owner gives the hub quota logins again with `bun run quota:connect`, and its hub keys are new.

### How long it may take

Unknown until a dry run of the real source measures it. On the constructed days of 2.8 GiB of item content, 18,000 requests and 147,000 items, a dry run took 60 seconds and an import 125 seconds for text of ordinary words, and an import 189 seconds for random text, of which ClickHouse's add of the items took 75 and 149 seconds; the source's slowest statement took 1.8 seconds. A day is read, built and loaded a page and a chunk at a time, so the import's memory is a page's and a chunk's, not a day's, and its time is the source's read of each day (its items' content, the bulk of it, read again for each day a long session spans, since each day's requests name its older items too), parsing and hashing it, loading it and the two summaries. The dry run prints each day's time, and its sum is the estimate. A real import may take minutes or hours; it is resumable by day, any day at a time, and can be run while the prototype still runs for the days that ended before, and once more after it stops for the rest (the last day's items lag its requests by the prototype's five minutes, fact 10, so the last day is imported once the prototype has stopped and filled them).

## Alternatives weighed

- **Importing from the prototype's daily archive files instead of its database.** They are verified, frozen and need no access to its server. But each line is a Bifrost row that repeats the request's whole history, so the import would do again what the prototype's `hub` views did (split every request's history into items, take out Bifrost's ids, keep each item once per session); the files hold neither titles nor names; the current day is not archived; and reading them needs ClickHouse anyway, for their size. The database has the conversation once per session already, and no past day lacks it (fact 10); what the last minutes before the prototype stops lack, the dry run counts.
- **Not importing, and keeping the old log beside.** No code. But two places to look, the old one only while the prototype's ClickHouse and dashboard keep running on the machine Cota replaces; the memory skill and the SQL console would search one log and not the other; and the owner decided Cota replaces the prototype. The prototype's data is kept untouched in any case, for the way back, until the owner removes it.
- **Converting the conversations into the client's protocol.** It would let the hub's renderers and role rules read imported requests as their own, but every converted item would be one no client sent, and L3 of the request log ("nothing invented") would not hold.
- **Keeping the source's cost.** It is what the prototype showed at the time. But the request log's cost is the hub's rule, applied once at write; two rules in one column would make a chart across the change compare Bifrost's prices with the price lists. The day lines keep the source's number visible.
- **A column marking imported requests.** `protocol` already marks every one (it names a source form), and a new column would change `requests`' columns, which every archived day's manifest records.
- **Display names and titles through the hub's API.** The API stamps a title with the time it receives it, so a second import would add every title again; and setting names through it needs the owner password. The hub store is reached through the module's own command instead, as the restore reaches ClickHouse through the request log's port.

## Consequences

- 5b builds the import: in the request-log module, the rules that build a request log's rows from a source's (`03-domain`, with the import spec's laws), the port that reads a source and its ClickHouse adapter for Bifrost's log and the prototype's tables, the source forms (their renderers, text and first prompt), and the reuse of the restore's session; the script beside `restore-archive.ts`, which assembles them with the display-names module's commands. Its ClickHouse-tier tests run against a source constructed in a scratch database with the prototype's schema, built from `hub.sql`'s tables and a `bifrost.logs` of the columns above, and synthetic rows; never against the prototype's database or the dev database `cota`.
- The request log spec gains imported requests: an id "stamped with `started_at`" made from the source's, L3 extended to items an import copied from its source in their source form, and `protocol`'s values; its readers, its API and its renderers read a source form wherever they read a protocol. The sessions spec gains the two source forms. `shared/03-domain/protocol-name.ts` keeps the three wire protocols a pool can speak, and the request log names the two source forms beside them, for what it stores.
- The archiver archives imported days as it archives any day the log holds rows of and has no manifest for: the history lands in Cota's archive at the next run after the import.
- The real import is a step of the change on the owner's machine, written in the private runbook and run on the owner's go, after a dry run whose report the owner has read.
