---
status: active
scope: apps/hub
owner: limineol
last_verified: 2026-11-23
review_by: 2027-02-23
supersedes: []
code:
  - apps/hub/src/shared/03-domain/request.entity.ts
  - apps/hub/src/shared/03-domain/record-form.ts
  - apps/hub/src/shared/03-domain/pool.entity.ts
  - apps/hub/src/shared/03-domain/client.ts
  - apps/hub/src/config/config.ts
  - apps/hub/src/modules/admission/03-domain/admission.ts
  - apps/hub/src/modules/request-log/03-domain/report.ts
  - apps/hub/src/modules/request-log/03-domain/stamped-id.ts
  - apps/hub/src/modules/request-log/03-domain/antigravity-steps.ts
  - apps/hub/src/modules/request-log/03-domain/stored-items.ts
  - apps/hub/src/modules/request-log/02-application/commands/report-requests.command.ts
  - apps/hub/src/modules/request-log/02-application/interfaces/reported-through.ts
  - apps/hub/src/modules/request-log/02-application/interfaces/requests.repository.ts
  - apps/hub/src/modules/request-log/04-infrastructure/persistence/sqlite/sqlite-reported-through.ts
  - apps/hub/src/modules/request-log/04-infrastructure/persistence/clickhouse/clickhouse-requests.repository.ts
  - apps/hub/src/modules/request-log/04-infrastructure/transcripts/antigravity-steps.ts
  - apps/hub/src/modules/request-log/01-presentation/reports.api.ts
  - apps/hub/src/modules/request-log/01-presentation/reports.handlers.ts
  - apps/hub/src/shared/01-presentation/json-body.middleware.ts
---

# Reported requests

The hub's side of reported requests: the endpoint a machine reports model calls to, who may call it, what a report holds and its limits, how it is checked, the id the hub makes, what the log already holds, how a report is stored and answered, reported through, the record form the items are kept in, the observed pools reported requests bill, and what never happens to a reported request. ADR-0029 gives the reasons. The machine's side, the request reporter and the Antigravity reader, is `docs/specs/request-reporter/spec.md`; the request log's tables are `docs/specs/request-log/spec.md`.

**Status.** Active but for reading reported through. Milestone 6b built the `origin` of a request (`request.entity.ts`: a request is forwarded or reported, and `RecordRequest` takes a forwarded one only) with the record form `antigravity-steps` (`record-form.ts`), observed pools (Observed pools, below, all of it), the second half of L15, and the rule that a forwarded request never claims a reported client (`client.ts`, `docs/specs/relay/spec.md`, R7). Milestone 6c built the endpoint and everything a report does: its checks, the id, what the log already holds, storing, the answer and its problems, keeping reported through, and the request log's reading of the record form; every law below is held. `GET /api/reported-through` and the dashboard's reading of reported requests are 6e's. The table of fields changes with what 6d confirms of Antigravity's record (ADR-0029, Facts to confirm when built). It belongs to the request-log module, the only module that knows the request log's tables, as the import does; an observed pool's configuration and what each module does with one are the configuration's, admission's, routes', quota's and fallback's.

## The endpoint

```
POST /api/reported-requests
x-cota-key: <a hub key>
x-cota-machine: <the machine's name>
content-type: application/json
```

- **Who may call it**: any known hub key, of any scope (`subscription`, `keyed` or `reader`), or the owner: the title endpoint's rule (`docs/specs/sign-in/spec.md`). A reporter is **its caller**: the hub key's name, or the owner. Nothing in the body names a reporter or a machine.
- **The machine** is the `x-cota-machine` header, well-formed, trimmed and cut to 200 characters, as a title's machine is kept. A report without one, or with one that is empty once trimmed, is refused (`report-refused`). It is a tag the caller states, as a forwarded request's and a title's machine are, and no hub key is bound to a machine: a hub key can report as any machine's name, so reported through says what the holders of the hub keys reported, and is no proof of which computer sent it.
- **The group** is the request-log module's `reports` group (`01-presentation/reports.api.ts`), declared with `mayCall("any-hub-key")`; `GET /api/reported-through` (Reported through) joins it in 6e.
- **The body** is JSON of at most **64 MiB**, the group's own limit; every other endpoint keeps its 1 MiB (`docs/specs/api/spec.md`, Limits). Over it is 413 `body-too-large`.

## A report

| Field | Type | Holds |
| --- | --- | --- |
| `client` | `"antigravity"` | The reported client. Only a reported client is a value: never one the relay forwards. |
| `pool` | string | The observed pool every call of the report bills. |
| `through` | time or `null` | When the run that sends it began reading the data folder these calls come from, given only in the report that ends that reading: every model call the folder held at that time has been reported. `null` in a report the run will follow with another. |
| `calls` | `Call[]` | 0 to 500 model calls, in the order of their conversations. A report with no calls and a `through` says only that the machine is current. |

`Call`:

| Field | Type | Holds |
| --- | --- | --- |
| `call` | string, 1 to 255 characters | The call key: the record's own id for the model call. |
| `after` | `{ call, startedAt }` or `null` | The model call before it in its conversation, by its call key and its start, the two the hub makes its id from (The id); `null` for its conversation's first. |
| `session` | string, 1 to 255 characters | The conversation's id. |
| `project` | string, 0 to 200 characters | The project, where the record names one. |
| `clientVersion` | string, 0 to 200 characters | The client's version, where the record names one. |
| `model` | string, 0 to 200 characters | The model, as the record names it; empty where it names none. |
| `startedAt`, `finishedAt` | time | When the call started and finished, as the record has them. |
| `outcome` | `"ok"`, `"error"` or `"cancelled"` | How it ended. Never `"refused"`. |
| `errorType`, `errorMessage` | string | Empty for an `ok` call; else what the record says, or the reporter's (`cota_reported_…`). The type is cut to 200 characters, the message to 64 KiB. |
| `stopReason`, `providerRequestId` | string, 0 to 200 and 0 to 255 characters | Where the record names them. |
| `usage` | `Usage` or `null` | The call's usage, `null` when the record gives none. |
| `input` | JSON objects | The conversation items new since the call before, in order, before this call's output. |
| `output` | JSON objects | The call's own items: for `antigravity-steps`, the one step that carries its usage. |

`Usage` is `{ input, cacheRead, cacheWriteShort, cacheWriteLong, output, reasoning, reported }`, the request log's classes (input never includes cached tokens; reasoning is part of output), each a whole number from 0 to 4,294,967,295, and `reported`, the record's own usage as a JSON object of at most 64 KiB written out, kept verbatim as a forwarded request keeps its provider's usage object.

## Checks

The whole report is checked before anything is stored. A body that does not decode is the API's 400; a report that decodes but breaks one of these is `report-refused`, whose `detail` names the first call that breaks it, by its place and its call key, and why:

- the pool is not an observed pool (`no-such-pool` when the hub has no pool by that id, `pool-not-observed` when it has one of another kind);
- the machine is missing;
- two calls have one call key;
- `finishedAt` is before `startedAt`, or the call lasted more than 4,294,967,295 milliseconds;
- `startedAt` or `through` is more than 5 minutes after the hub's clock, or before 2020;
- `reasoning` is more than `output`;
- an item is not one of the client's record form (below), or is nested deeper than 512 levels (a step's shape is never that deep, so the form's check is the depth's too);
- an item's place in its conversation is not after the call before's output: for `antigravity-steps`, its `idx` is not greater than every `idx` of the call before's parts, or a call's items are not in increasing `idx`, or its `output` is not one step after all of its `input`;
- a call's call before, where the report holds it, is of another session, or the `startedAt` its `after` gives is not that call's;
- a call has no `output`.

Then the call before of each call is found: earlier in the report, else held in the log under the id made for `after`'s call key and start (The id), in the call's own session, started at that start, with both its `requests` row and its `request_items` row and an `output` whose item is a step (`RequestsRepository.partsOf`): a request held under that id in another session is not its call before, and neither is one stored only in part, which the report sent again completes before any call after it is stored. A call whose `after` is neither is `report-out-of-order` (409), naming it: the log does not hold its call before. A machine whose cursor moved only on stored answers reaches this only when its state is ahead of the log: the state came from a machine of another hub, or the log was put back to an earlier time. Reporting the folder again from its first call is then right (`docs/specs/request-reporter/spec.md`, `cota requests report`): what is held is left out, and nothing is stored twice.

Text is made well-formed as every text the request log writes is (`docs/specs/request-log/spec.md`, Well-formed text): each lone surrogate in a string field becomes U+FFFD; an item's content keeps it as its escape.

## The id

A reported request's id is a UUID version 7 (as every id of the request log, stamped with `started_at`): its 48-bit time is `startedAt` in milliseconds, its version and variant bits those of version 7, and its 74 other bits the first 74 bits of the SHA-256 of the UTF-8 of

```
cota-report:["<client>","<call key>"]
```

that is `cota-report:` followed by the JSON of the list of the client and the call key, written without spaces, so that no client and call key give the text of another pair. So the same call, reported again with the same start, always has the same id, whoever reports it: the reporter is not part of it. A call is one request, and its row says who reported it first (`hub_key`, `machine`); the same call reported by another hub key, renamed, replaced or of a machine its data folder was copied to, is held. A call's start is part of what it is: the reader takes it from the step's own times, which a record that only grows never changes, and a call key reported with another start would be another request, which the request reporter never sends (`docs/specs/request-reporter/spec.md`, A model call, in the record). An id made by an import (`cota-import:…`, `docs/specs/import/spec.md`) never equals one, and no report can choose its ids, so none names a forwarded request's. A hub key that knew another machine's call key and start could report that call first, and the first report is kept: any hub key may report, for now (ADR-0029, Trust).

## What the log already holds

A report is delivered at least once: a machine whose answer was lost sends the same calls again, maybe with others. Before it stores, the hub asks the log which of the report's rows it already **holds**, by the archive's rule (`docs/specs/archive/spec.md`, Held): a request by its `id`, read within the report's span of `started_at` so that `requests`' order finds it; a request's `request_items` row by its `request_id`, within its session; an item by its session and digest, as the writer asks (`known`). It stores only what is not held. A report whose every row is held stores nothing and is answered as stored.

**Why the insert's token is not enough** (ADR-0029): a table remembers its last 1,000 inserts, and the relay's writer inserts every batch, so a delivery repeated after hours is out of that window; a second delivery is a new report, which a run reading on from a cursor that did not move may make of more calls or fewer, so its token differs; and a report stored in part comes back with other contents. The repository's `store` is still given the writer's token, made from the requests' ids, which does no harm: a table whose insert was stored has its rows held, and is left out.

**One report at a time.** The command takes a lock for the whole of a report, from asking what is held to storing it and keeping its reported through, so that two deliveries of the same calls never both find them not held. A report waits for the one before it.

## Storing

`ReportRequests` (`02-application/commands/report-requests.command.ts`) does, for a report that passed its checks:

1. **Build each call's request.** Its columns are the table below; its conversation's `input` part is its call before's `input` and `output` followed by its own `input` items, and its `output` part its `output` items; it has no `system` or `tools` part; its layout is `steps`, a list, in the `input` part, with no overlay and empty params. The call before's parts come from this report, or from the log (its `request_items` row, by the id made for `after`).
2. **Price it**: its pool's price for its model (`Prices`), then `Cost.of`, as the writer prices a request (`docs/specs/request-log/spec.md`, Writing). A model the price list does not know, and an empty model, give no price: no cost, never zero (`docs/specs/cost/spec.md`, C1).
3. **Leave out what is held** (above), and a request whose values the repository cannot hold (`holds`), which refuses the report (`report-refused`, naming it) rather than store the rest without it.
4. **Store** the new items, the requests' items and the requests through `RequestsRepository.store`, in that order, synchronously (`async_insert = 0`), so that no request is seen before its items. Its failures are the repository's: `RequestsRepositoryFailed` is `request-log-unavailable` (503, as ClickHouse not reached) and the machine sends the report again; `RequestsRepositoryDeclined` is `request-log-unavailable` too, naming ClickHouse's error code and never its message, and is never split: a report that ClickHouse will not keep as it is fails until the reporter's next run, and the reporter says so.
5. **Keep reported through** when the report has a `through` (below).
6. **Answer** `200 { "stored": <calls stored>, "held": <calls already held> }`, each call counted by its `requests` row: a call whose items were held and whose request was not is stored.

It never goes through `RecordRequest`'s queue, and a stored answer means the rows are in ClickHouse.

### The columns of a reported request

| Column | Holds |
| --- | --- |
| `id` | The id above |
| `started_at` | `startedAt` |
| `first_byte_ms`, `follows`, `refusal_reset` | null |
| `duration_ms` | `finishedAt` less `startedAt`, in milliseconds |
| `session`, `project`, `client_version`, `model`, `stop_reason`, `provider_request_id` | As reported |
| `session_source`, `user_agent`, `diverted_from`, `login_fingerprint`, `purpose`, `served_model`, `service_tier`, `error_body` | empty |
| `machine` | The caller's `x-cota-machine` |
| `client` | The report's `client` |
| `hub_key` | The reporting hub key's name; empty for the owner |
| `pool` | The report's pool |
| `provider` | That pool's provider, from the configuration, as for every request |
| `protocol` | The client's record form: `antigravity-steps` for `antigravity` |
| `operation` | `generate` |
| `stream` | false |
| `outcome`, `error_type`, `error_message` | As reported |
| `upstream_status` | 0 |
| `usage_reported` and the token columns | From `usage`: false and zeros when it is `null` |
| `usage` | `usage.reported`, as JSON; empty when `usage` is `null` |
| `cost_usd` | Step 2 |
| `rate_limits`, `client_headers` | empty maps |
| `request_bytes`, `response_bytes` | 0 |
| `reading_complete` | true |

In the `Request` entity it is a request whose `origin` is `reported`, with its record form and its reporter (`reportedBy`, none for the owner); the fields of a `forwarded` origin are what the table writes as empty (ADR-0029, One record, two ways in). The reader's record of a stored request has an origin read from its `protocol`: `forwarded` for a protocol, `imported` for a source form, `reported` for a record form.

## The answer and its problems

| `type` | Status | Title |
| --- | --- | --- |
| `urn:cota:report-refused` | 400 | The report was not stored. |
| `urn:cota:pool-not-observed` | 400 | That pool is not an observed pool. |
| `urn:cota:report-out-of-order` | 409 | A call's call before was never stored. |

It can also give `no-such-pool` 404 (the pools group's), `body-too-large` 413, `request-log-unavailable` 503 and `hub-store-unavailable` 503 (reported through could not be kept: the calls are stored, and the machine sending the report again finds them held). Every problem stores nothing of the report but these two 503s, after which sending it again is always right. A problem's `detail` never holds an item's content.

## Reported through

A report with a `through` keeps, in the hub store, the request-log module's table `reported_through`, made by the step `request-log/0001-reported-through`:

| Column | Type | Holds |
| --- | --- | --- |
| `machine` | `TEXT NOT NULL` | The caller's `x-cota-machine`. |
| `client` | `TEXT NOT NULL` | The report's client. |
| `pool` | `TEXT NOT NULL` | The report's observed pool. |
| `through` | `TEXT NOT NULL` | The greatest `through` reported for these three, an ISO 8601 instant, UTC, with milliseconds. |
| `reported_at` | `TEXT NOT NULL` | When the hub received the report that last wrote the row. |
| `reported_by` | `TEXT NOT NULL` | The name of the hub key that reported it, or `owner`. |

`PRIMARY KEY (machine, client, pool)`. A report's `through` replaces the row's only when it is later; `reported_at` and `reported_by` are always the latest report's. A machine whose data folders bill one pool from two folders reports each folder's `through`, so the row says the later; a machine that reports nothing for longer than its schedule says has a `reported_at` that stops moving, which is what the dashboard shows. The port is `ReportedThrough` (`02-application/interfaces/reported-through.ts`), its SQLite adapter in `04-infrastructure/persistence/sqlite/`, its fake in `05-tests/fakes/`.

**`GET /api/reported-through`**, a reading endpoint (a reader key or the owner), answers `{ reporters: [{ machine, client, pool, through, reportedAt, reportedBy }] }`, in order of machine, client and pool. Errors: `hub-store-unavailable` 503. Built in 6e with the screens that show it.

**Open for the owner: late.** When the dashboard calls a machine's reported through late: more than 5 minutes behind the hub's clock (recommended: doctor's own measure of a reporter that stopped), or another threshold, or one the owner sets. Written here as recommended, and open.

## The record form `antigravity-steps`

Each conversation item of a reported Antigravity request is one **step** of its conversation's record, as JSON:

```json
{ "idx": 4, "step_type": 7, "status": 3,
  "metadata": [[1, 0, "1764151800000"], [4, 2, { "base64": "CgVoZWxsbw==" }]],
  "step_payload": [[2, 2, "Read the file"], [3, 0, "1"]] }
```

- `idx` is the step's index, a whole number from 0, which orders a conversation's steps; `step_type` and `status` are the step's columns as the table has them (a number, or a text).
- `metadata` and `step_payload` are the step's protocol buffers, **written out field by field without a schema**: a list of `[field number, wire type, value]`, in the order of the bytes, the field number from 1 to 2^29 − 1, for wire types 0 (a varint, its value its decimal digits as a string, at most 2^64 − 1), 1 and 5 (64 and 32 bits, their value their bytes in lowercase hex, as a string), and 2 (length-delimited: its bytes as a string when they are UTF-8, else `{ "base64": "<their bytes>" }`, standard base64 with its padding). Nothing is read into a field's bytes, so nothing is guessed and the bytes can be written back exactly. A step whose buffer is not one by these rules, or uses the deprecated groups, is not reported (`docs/specs/request-reporter/spec.md`).
- A step has these five keys and no other, and `{ "base64" }` that one: an item with another key, or a value not of these shapes, is not of the form (`AntigravitySteps.Step`, `03-domain/antigravity-steps.ts`).
- Its `type` and `role` columns in `items` are empty: the item has neither as a string field.

What the request log reads of the form, as it reads a source form's (`docs/specs/sessions/spec.md`, Source forms), from a **table of fields** read by trial (ADR-0029, fact 2) that the renderer keeps, and which can change without changing a stored item:

- **Its text**, for search: the text of the fields the table names as what a person would read (a user's message, the model's output, a tool call's arguments and result, a compaction's summary), joined by line breaks. A step of a kind the table does not know gives no text.
- **Its renderer** (`04-infrastructure/transcripts/antigravity-steps.ts`): a user's message is a `message` whose role is `user`; the model's output a `message` whose role is `assistant`, with `reasoning` before it where the table finds the model's thoughts; a tool call a `tool-call` and its `tool-result`; a compaction a `message` whose role is `assistant`, its summary. A length-delimited field the table names as a message is read as a protocol buffer by the same rules. A step, or a field, the table does not know is `other`, its JSON, under the transcript's rules for withholding and cutting.
- **Its request role**: a rule before the title rule, **a record's model call**: a request of a record form is `main`, since a record holds one conversation and the reader reports no sub-agent's. Its segments are cut by the size rule, which a compaction meets (ADR-0029, fact 4).
- **Its first prompt**: the text of the last user's message step in the first main request's `input`.
- **Its body**: `GET /api/requests/{id}/body` rebuilds `{ "steps": [ … ] }`, every step through the call's input as the client recorded it; the inspector says, as for an imported request, that it is not what the client sent.

### The table of fields

The table is `table` in `apps/hub/src/modules/request-log/03-domain/antigravity-steps.ts`, the one place that names a field: what the hub reads of a step, by its `step_type`. Each entry was read by trial on one throwaway conversation (ADR-0029, Context), so each is **seen in one conversation** and no more; 6d confirms it on another and may change it, and a change to it changes no stored item. A field it names is read as protocol buffers read a singular field, its last occurrence; a tool call's field 7 is repeated.

| `step_type` | Is | Read |
| --- | --- | --- |
| 14 | A user's message | `step_payload` 19, a message: its 2, the text |
| 15 | The model's output | `step_payload` 20, a message: its 1, the text; its 3, the thoughts; each 7, a tool call |
| 132 | A tool's run, seen only for `read_file` | `metadata` 4, the tool call; `step_payload` 140, a message whose 2 is a message whose 1 is the result's text |
| 23 | A compaction | `step_payload` 30, a message: its 5, the summary |

A tool call is a message: its 1 the call's id, 2 the tool's name, 3 its arguments as JSON text. Seen and not read by the hub, for the reader to confirm: every step's `step_payload` repeats its `step_type` (1), its `status` (4) and its `metadata` (5); in `metadata`, 1 is when the step was made (seconds and nanoseconds), 6, 7, 8 and 32 other times of a model's step, 9 a model call's usage (read as 2 input not from cache, 5 input from cache, 3 output, and 9 and 10 output's two parts, whose sum was 3; 1 held the same number on every step, and is read as the model's, not as tokens), and 20 the conversation's ids (1 its trajectory, 2 the step's index, 4 the conversation's id, its database's name); `status` was 3 on every step. The usage is the request reporter's to read: a report gives each call's usage in the request log's classes.

## Observed pools

An observed pool (`CONTEXT.md`) is declared in the hub's configuration (ADR-0009):

```toml
[pools.gemini]
observed = true
provider = "google"
```

| Key | For an observed pool |
| --- | --- |
| `observed` | `true`. Without it, or `false`, a pool is what its other keys make it (ADR-0009). |
| `provider` | Required. |
| `prices`, `model_prices` | As any pool. `prices` defaults to `google` for the provider `google`, a price list made from models.dev's `google` provider by `bun run prices:update`; otherwise to none. |
| `protocol`, `base_url`, `key`, `kept_login`, `fallback` | Refused, each naming the key: `an observed pool is never forwarded to, so it has no <key>`. |

No pool may name an observed pool as its `fallback` (`the fallback pool "<id>" is an observed pool; a fallback pool is a subscription pool`). The `Pool` entity is `KeyedPool | SubscriptionPool | ObservedPool`, the last `{ kind: "observed", id, provider, prices, ownPrices }`. What meets one:

- **Admission**: no scope is `observed`, so `decide` rejects every request to it by rule 4 (`WrongScope`, 403 `cota_hub_key_scope`), and A1 to A8 hold as they stand.
- **Routes**: a route or a default pool naming it is refused as one that does not speak the client's protocol; an override naming it is `pool-not-for-client`.
- **`GET /api/machine`**: `pools` lists it only to the owner (its kind `observed`, protocol `null`); every caller gets `observedPools`, `[{ id, provider, displayName }]` in order of id, so that a machine checks the pool it reports to.
- **`GET /api/pools`**: listed with `kind: "observed"`, `protocol: null`, no windows, no plan and no quota login.
- **Quota**: no quota reader is chosen for it, its requests carry no quota headers, and `PUT /api/pools/{pool}/quota-login` is `quota-login-not-taken` 400; `bun run quota:connect` refuses it.
- **Fallback**: none, either way.
- **Launches and configuring**: `cota` never launches to one and writes it into no client's file.

## What never happens to a reported request

- It is never forwarded, replayed, recorded as an exchange, or given to `RecordRequest`.
- It never decides admission, records a refusal, parks a login, diverts, or gives a quota window: its outcome is never `refused`, it has no login fingerprint, no `refusal_reset` and no quota headers, so the fallback and the quota sources, which read only those, never read one as theirs; and the intake calls no module but the request log's own ports.
- It never bills a pool that is not observed, and nothing else bills an observed pool.
- It is never changed or removed: a report adds rows, as the writer and the import do, and a call reported again is held.
- It is never read as forwarded: its `protocol` is a record form for ever, and every screen and the API say it is reported.

## Laws

| Id | Law | Held by |
| --- | --- | --- |
| L7 | **Only as itself.** For any report and any body, the stored requests' `hub_key` is the caller's hub key's name (empty for the owner) and their `machine` the caller's `x-cota-machine`, whatever the body holds. | property, contract |
| L8 | **One call, one id.** A reported request's id is a function of its client, call key and start alone: equal for equal inputs whoever reports them, a UUID version 7 stamped with the start, and different for two clients or two call keys whatever their texts. | property |
| L9 | **Delivered again, stored once.** For any sequence of reports, each delivered one or more times, by one reporter or several, in part, with others, or after a delivery stored in part, the log holds each call once, with the rows it would hold had each call been delivered once. | property, clickhouse |
| L10 | **Stored before answered.** A report answered 200 has every one of its calls held in the log at the moment of the answer. | property, clickhouse |
| L11 | **Refused is nothing stored.** A report answered with any problem but `request-log-unavailable` and `hub-store-unavailable` changes nothing in the log or the hub store. | property, contract |
| L12 | **The call before, and what is new.** For any conversation reported in any cut of reports, each call's `input` part is the digests of every item of the calls before it and its own `input`, in order, and its `output` its own; each item is stored once per session. | property, clickhouse |
| L13 | **A reported request is marked, and holds nothing forwarded.** Every stored reported request has a record form as its `protocol`, and every column the forwarded origin holds is its empty value of the columns table. | property |
| L14 | **A report decides nothing.** Storing any report changes no answer of admission, parks no login, diverts no request and changes no quota window the pools group answers. | property |
| L15 | **Observed pools are reported to, never forwarded to.** A report naming a pool that is not observed stores nothing, and no request admitted by the relay names an observed pool. | property, contract |
| L16 | **Reported through never goes back.** For any sequence of reports, a machine's, client's and pool's `through` is the greatest any of their reports gave. | property |
| L17 | **Priced as any request.** A reported request's cost is `Cost.of` of its usage at its pool's price for its model, and none where that has no price. | property |

Each law has a mutant in `tooling/mutants.table.ts`. The tests that hold them:

- **L8** is a property test of `Report.idOf` over generated call keys and starts, with one fixed example that holds the id's text, since a stored id is for ever (`03-domain/report.laws.test.ts`).
- **L7, L9 to L13, L16 and L17** are property tests of `ReportRequests` over generated conversations, interleaved and cut into reports (`05-tests/reports.ts`), stored in the in-memory repository, which fails, declines, loses its answer after storing, or stops between `request_items` and `requests` as a generated list of faults says (`02-application/commands/report-requests.laws.test.ts`). L9 delivers each report until it is stored, sends runs of the calls sent so far again, by a reporter that may be another, and compares the log with one delivery of each call; L10 checks, at each answer, that its calls are held; L11 sends, after the reports before it, a report with each of eighteen defects (every check above, a pool of another kind or none, no machine, a `through` ahead, and a request the repository cannot hold) and compares the log and reported through before and after; L12 compares each call's `request_items` row with the conversation's digests; L13 reads each stored request's columns; L16 keeps reported through in a SQLite hub store of its own; L17 compares each call's cost with what `RecordRequest` gives a forwarded request of its pool, model and usage, under generated price lists and pool prices.
- **L14** stores generated reports beside generated forwarded traffic and compares the quota sources' answers for every pool, the observed one among them, and every quota header name, with and without them (`02-application/commands/reports-decide-nothing.laws.test.ts`): admission decides from the policy alone, and the fallback and the pools group's windows read the request log only through the quota sources.
- **L7, L11 and L15's first half** are also contract tests through the whole hub of the harness (`01-presentation/reports.contract.test.ts`): bodies naming other machines and keys, refused reports of every kind with their log and hub store compared before and after, and a report to each pool of another kind from every hub key.
- **L9, L10 and L12** are also ClickHouse tests (`04-infrastructure/persistence/clickhouse/clickhouse-reported-requests.clickhouse.test.ts`): sampled reports sent to a scratch database, with a delivery interrupted between `request_items` and `requests` and one whose answer of `request_items` is lost, compared table by table with one delivery of each call into another.

Of L15, the second half was built in 6b: a property test runs admission's `decide` over generated policies whose pools are of every kind, observed among them, and requests presenting any hub key (`apps/hub/src/modules/admission/03-domain/admission.laws.test.ts`), and a contract test sends a request to the harness's observed pool on each protocol's paths with every hub key, in `x-cota-key`, as the bearer token and in `x-api-key` (`apps/hub/src/modules/relay/01-presentation/observed-pools.contract.test.ts`): each is refused 403 and nothing is forwarded or recorded. The relay is also given only the pools it forwards for (`Pool.forwarded`), so its types hold no observed pool.

## Not built, on purpose

- **Reports from machines the owner did not give a hub key.** A report is a hub key's or the owner's.
- **Splitting a declined report.** A report ClickHouse will not keep fails whole, and the reporter's run says so; the writer's splitting is for traffic the hub cannot ask again.
- **Changing a reported request.** A call reported again with other values, or by another reporter, its key and its start the same, is held, and keeps the first.
- **Reading Antigravity's quota**, and a quota login for an observed pool (ADR-0029, Left out).
- **A report in another form than the client's.** The hub never converts items into a protocol.
