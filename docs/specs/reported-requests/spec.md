---
status: draft
scope: apps/hub
owner: limineol
last_verified: 2026-11-22
review_by: 2027-02-22
supersedes: []
code: []
---

# Reported requests

The hub's side of reported requests: the endpoint a machine reports model calls to, who may call it, what a report holds and its limits, how it is checked, the id the hub makes, what the log already holds, how a report is stored and answered, reported through, the record form the items are kept in, the observed pools reported requests bill, and what never happens to a reported request. ADR-0029 gives the reasons. The machine's side, the request reporter and the Antigravity reader, is `docs/specs/request-reporter/spec.md`; the request log's tables are `docs/specs/request-log/spec.md`.

**Status.** Draft: nothing here is built. Milestone 6b builds the `origin` of a request and observed pools (Observed pools, below); 6c builds the rest; 6e the dashboard's reading of it. This spec becomes active as each is built, its laws held from then, and it changes with what 6d confirms of Antigravity's record (ADR-0029, Facts to confirm when built). It belongs to the request-log module, the only module that knows the request log's tables, as the import does; an observed pool's configuration and what each module does with one are the configuration's, admission's, routes', quota's and fallback's.

## The endpoint

```
POST /api/reported-requests
x-cota-key: <a hub key>
x-cota-machine: <the machine's name>
content-type: application/json
```

- **Who may call it**: any known hub key, of any scope (`subscription`, `keyed` or `reader`), or the owner: the title endpoint's rule (`docs/specs/sign-in/spec.md`). A reporter is **its caller**: the hub key's name, or the owner. Nothing in the body names a reporter or a machine.
- **The machine** is the `x-cota-machine` header, well-formed, trimmed and cut to 200 characters, as a title's machine is kept. A report without one, or with one that is empty once trimmed, is refused (`report-refused`). It is a tag the caller states, as a forwarded request's and a title's machine are, and no hub key is bound to a machine: a hub key can report as any machine's name, so reported through says what the holders of the hub keys reported, and is no proof of which computer sent it.
- **The group** is the request-log module's `reports` group, with `GET /api/reported-through` (Reported through), declared with `mayCall("any-hub-key")`.
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
- an item is not one of the client's record form (below), or is nested deeper than 512 levels;
- an item's place in its conversation is not after the call before's output: for `antigravity-steps`, its `idx` is not greater than every `idx` of the call before's parts, or a call's items are not in increasing `idx`, or its `output` is not one step after all of its `input`;
- a call's call before, where the report holds it, is of another session, or the `startedAt` its `after` gives is not that call's;
- a call has no `output`.

Then the call before of each call is found: earlier in the report, else held in the log under the id this reporter would have made for `after`'s call key and start (The id), in the call's own session: a request held under that id in another session is not its call before. A call whose `after` is neither is `report-out-of-order` (409), naming it: its call before was never stored, which a machine whose cursor moved only on stored answers can only reach with lost or copied state.

Text is made well-formed as every text the request log writes is (`docs/specs/request-log/spec.md`, Well-formed text): each lone surrogate in a string field becomes U+FFFD; an item's content keeps it as its escape.

## The id

A reported request's id is a UUID version 7 (as every id of the request log, stamped with `started_at`): its 48-bit time is `startedAt` in milliseconds, its version and variant bits those of version 7, and its 74 other bits the first 74 bits of the SHA-256 of

```
cota-report:<reporter>:<client>:<call key>
```

where `<reporter>` is `key:<the hub key's name>`, or `owner`. So the same call, reported again by the same reporter with the same start, always has the same id. A call's start is part of what it is: the reader takes it from the step's own times, which a record that only grows never changes, and a call key reported with another start would be another request, which the request reporter never sends (`docs/specs/request-reporter/spec.md`, A model call, in the record). Another reporter's calls, whatever their keys, never have an id this reporter's could; and an id made by an import (`cota-import:…`, `docs/specs/import/spec.md`) never equals one. A hub key renamed in the configuration reports under a new name, and its calls reported again would have new ids (ADR-0029, Consequences).

## What the log already holds

A report is delivered at least once: a machine whose answer was lost sends the same calls again, maybe with others. Before it stores, the hub asks the log which of the report's rows it already **holds**, by the archive's rule (`docs/specs/archive/spec.md`, Held): a request by its `id`, read within the report's span of `started_at` so that `requests`' order finds it; a request's `request_items` row by its `request_id`, within its session; an item by its session and digest, as the writer asks (`known`). It stores only what is not held. A report whose every row is held stores nothing and is answered as stored.

**Why the insert's token is not enough** (ADR-0029): a table remembers its last 1,000 inserts, and the relay's writer inserts every batch, so a delivery repeated after hours is out of that window; a second delivery is a new report, which a run reading on from a cursor that did not move may make of more calls or fewer, so its token differs; and a report stored in part comes back with other contents. The repository's `store` is still given the writer's token, made from the requests' ids, which does no harm: a table whose insert was stored has its rows held, and is left out.

**One report at a time.** The command takes a lock for the whole of a report, from asking what is held to storing it, so that two deliveries of the same calls never both find them not held. A report waits for the one before it.

## Storing

`ReportRequests` (`02-application/commands/report-requests.command.ts`) does, for a report that passed its checks:

1. **Build each call's request.** Its columns are the table below; its conversation's `input` part is its call before's `input` and `output` followed by its own `input` items, and its `output` part its `output` items; it has no `system` or `tools` part; its layout is `steps`, a list, in the `input` part, with no overlay and empty params. The call before's parts come from this report, or from the log (its `request_items` row, by the id made for `after`).
2. **Price it**: its pool's price for its model (`Prices`), then `Cost.of`, as the writer prices a request (`docs/specs/request-log/spec.md`, Writing). A model the price list does not know, and an empty model, give no price: no cost, never zero (`docs/specs/cost/spec.md`, C1).
3. **Leave out what is held** (above), and a request whose values the repository cannot hold (`holds`), which refuses the report (`report-refused`, naming it) rather than store the rest without it.
4. **Store** the new items, the requests' items and the requests through `RequestsRepository.store`, in that order, synchronously (`async_insert = 0`), so that no request is seen before its items. Its failures are the repository's: `RequestsRepositoryFailed` is `request-log-unavailable` (503) and the machine sends the report again; `RequestsRepositoryDeclined` is `request-log-unavailable` too, naming the code, and is never split: a report that ClickHouse will not keep as it is fails until the reporter's next run, and the reporter says so.
5. **Keep reported through** when the report has a `through` (below).
6. **Answer** `200 { "stored": <calls stored>, "held": <calls already held> }`.

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

- `idx`, `step_type` and `status` are the step's columns as the table has them (a number, or a text).
- `metadata` and `step_payload` are the step's protocol buffers, **written out field by field without a schema**: a list of `[field number, wire type, value]`, in the order of the bytes, for wire types 0 (a varint, its value its decimal digits as a string), 1 and 5 (64 and 32 bits, their value their bytes in hex, as a string), and 2 (length-delimited: its bytes as a string when they are UTF-8, else `{ "base64": "<their bytes>" }`). Nothing is read into a field's bytes, so nothing is guessed and the bytes can be written back exactly. A step whose buffer is not one by these rules, or uses the deprecated groups, is not reported (`docs/specs/request-reporter/spec.md`).
- Its `type` and `role` columns in `items` are empty: the item has neither as a string field.

What the request log reads of the form, as it reads a source form's (`docs/specs/sessions/spec.md`, Source forms), from a **table of fields** read by trial (ADR-0029, fact 2) that the renderer keeps, and which can change without changing a stored item:

- **Its text**, for search: the text of the fields the table names as what a person would read (a user's message, the model's output, a tool call's arguments and result, a compaction's summary), joined by line breaks. A step of a kind the table does not know gives no text.
- **Its renderer** (`04-infrastructure/transcripts/antigravity-steps.ts`): a user's message is a `message` whose role is `user`; the model's output a `message` whose role is `assistant`, with `reasoning` before it where the table finds the model's thoughts; a tool call a `tool-call` and its `tool-result`; a compaction a `message` whose role is `assistant`, its summary. A length-delimited field the table names as a message is read as a protocol buffer by the same rules. A step, or a field, the table does not know is `other`, its JSON, under the transcript's rules for withholding and cutting.
- **Its request role**: a rule before the title rule, **a record's model call**: a request of a record form is `main`, since a record holds one conversation and the reader reports no sub-agent's. Its segments are cut by the size rule, which a compaction meets (ADR-0029, fact 4).
- **Its first prompt**: the text of the last user's message step in the first main request's `input`.
- **Its body**: `GET /api/requests/{id}/body` rebuilds `{ "steps": [ … ] }`, every step through the call's input as the client recorded it; the inspector says, as for an imported request, that it is not what the client sent.

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
| L8 | **One call, one id.** A reported request's id is a function of its reporter, client, call key and start alone: equal for equal inputs, a UUID version 7 stamped with the start, and different for two reporters whatever their call keys. | property |
| L9 | **Delivered again, stored once.** For any sequence of reports, each delivered one or more times, in part, with others, or after a delivery stored in part, the log holds each call once, with the rows it would hold had each call been delivered once. | property, clickhouse |
| L10 | **Stored before answered.** A report answered 200 has every one of its calls held in the log at the moment of the answer. | property, clickhouse |
| L11 | **Refused is nothing stored.** A report answered with any problem but `request-log-unavailable` and `hub-store-unavailable` changes nothing in the log or the hub store. | property, contract |
| L12 | **The call before, and what is new.** For any conversation reported in any cut of reports, each call's `input` part is the digests of every item of the calls before it and its own `input`, in order, and its `output` its own; each item is stored once per session. | property, clickhouse |
| L13 | **A reported request is marked, and holds nothing forwarded.** Every stored reported request has a record form as its `protocol`, and every column the forwarded origin holds is its empty value of the columns table. | property |
| L14 | **A report decides nothing.** Storing any report changes no answer of admission, parks no login, diverts no request and changes no quota window the pools group answers. | property |
| L15 | **Observed pools are reported to, never forwarded to.** A report naming a pool that is not observed stores nothing, and no request admitted by the relay names an observed pool. | property, contract |
| L16 | **Reported through never goes back.** For any sequence of reports, a machine's, client's and pool's `through` is the greatest any of their reports gave. | property |
| L17 | **Priced as any request.** A reported request's cost is `Cost.of` of its usage at its pool's price for its model, and none where that has no price. | property |

L8, L12, L13 and L16 are property tests of the rules in `03-domain` over generated reporters, call keys, starts, conversations and cuts into reports. L9 and L10 run `ReportRequests` over the in-memory repository, which fails or declines a generated part of its stores and loses a generated part of its answers after storing, over generated sequences of deliveries of generated reports, and compare the log after each with one delivery of each call; their ClickHouse half writes such sequences to a scratch database, a delivery interrupted between `items` and `requests` among them. L7, L11 and L15 are also contract tests through the whole hub of the harness, with bodies naming other machines, keys and pools. L14 runs generated reports beside generated forwarded traffic and compares admission's, the fallback's and the quota sources' answers with and without them. L17 compares with the writer's pricing over generated usages and pool prices. Each law gets a mutant.

## Not built, on purpose

- **Reports from machines the owner did not give a hub key.** A report is a hub key's or the owner's.
- **Splitting a declined report.** A report ClickHouse will not keep fails whole, and the reporter's run says so; the writer's splitting is for traffic the hub cannot ask again.
- **Changing a reported request.** A call reported again with other values, its key and its start the same, is held, and keeps the first.
- **Reading Antigravity's quota**, and a quota login for an observed pool (ADR-0029, Left out).
- **A report in another form than the client's.** The hub never converts items into a protocol.
