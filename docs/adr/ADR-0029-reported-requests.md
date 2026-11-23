---
status: accepted
scope: repository
owner: limineol
last_verified: 2026-11-23
review_by: 2027-02-22
supersedes: []
code: []
---

# ADR-0029: A machine reports what a client that cannot be pointed at the hub wrote down, and the request log keeps each model call as a reported request that bills an observed pool

## Context

Every request in the request log so far is one the hub forwarded, or one an import added from the prototype's log (ADR-0025). Both start from a request that passed through a gateway. Some clients cannot be sent through one, and Antigravity is the first.

**Why Antigravity is not relayed.** Antigravity is Google's coding client, a desktop app and a CLI (`agy`), signed in with a Google subscription. Clause 6 of the Google Antigravity Additional Terms of Service (`antigravity.google/terms`, read on 2026-11-22) counts "Using third party software, tools, or services to access the Service" as a breach, its example being another program used with Antigravity's own OAuth, and says it may be "grounds for suspension or termination" of the Antigravity and Gemini CLI accounts. A hub that forwarded Antigravity's requests with its sign-in would be such software. No setting was found that points Antigravity at another address; that is "not found", not "does not exist". So the hub never sees an Antigravity request. What a machine can do is read what Antigravity writes down about its own sessions, as the title reporter reads what Claude Code, Codex and T3 Code write down about theirs (ADR-0022).

**What Antigravity writes down.** A throwaway conversation was run through `agy acp` on Gemini 4 Neon on 2026-11-22, on one macOS machine: a file of 180 KB read in three tool calls, a second question, `/compact`, and a question after it. The conversation's database was copied four times along the way and every row of each copy fingerprinted. What was found:

1. **One SQLite database per conversation**, `<data folder>/conversations/<conversation id>.db`, with `-wal` and `-shm` beside it while it is written (its journal mode is WAL). `agy`'s data folder is `~/.gemini/antigravity-cli` by default and the desktop app's `~/.gemini/antigravity`; a program that runs `agy acp` can give it another (`--gemini-dir`, `--app-data-dir`), and T3 Code gives each of its Antigravity provider instances its own. **One data folder is one sign-in**: the folder also holds the sign-in's token file.
2. **Its tables** are `trajectory_meta`, `steps`, `gen_metadata`, `executor_metadata`, `parent_references`, `trajectory_metadata_blob` and `battle_mode_infos`. The blobs are protocol buffers, unencrypted, with no published schema: their field numbers were read by trial.
3. **`steps` only grows.** Across the four copies no existing row of `steps` changed. A user message, a model's output, each tool call with its arguments and its result, and the compaction are each one step, in order of `idx`.
4. **A compaction is a step.** `/compact` appended two steps, the user's `/compact` and a step of its own kind holding the summary. No earlier step changed or went: the text of the file read before the compaction is still in its step. After it the model's input fell from about 104,000 tokens to about 36,000.
5. **Usage is on the step a model call produced.** Its metadata holds the tokens (read as input not from cache, input from cache, and output, the output split in two parts whose sum is the output: a reading inferred from the numbers, to be checked against an independent parser before it is relied on), when the call was created, started and finished, a response id, the conversation's ids and the step's own index. The compaction's step carries the usage of its summarising call.
6. **`gen_metadata` has one row per model call but the compaction's**: the model (`gemini-4-neon`), the record's own id for the call (`<trajectory id>-<n>`, from 0), the index of the last step before the call, and the usage again. Only the newest row also holds the whole request (the system prompt, the messages and the tool declarations): the next call cuts the row before it down to about 1 KB. So the request body is on disk for the newest call only.
7. **Not tested**: sub-agents (the schema has `has_subtrajectory` and `parent_references`), automatic compaction, the desktop app's conversations, whether a very long conversation ever drops old steps, and other versions of Antigravity.
8. **Opening the file.** Opened read only on the live database, SQLite answered "unable to open database file" at a moment when the database had no `-wal` or `-shm` beside it; a plain copy of the files, opened afterwards, read.

What follows from them: a machine reading behind a compaction finds the same rows, so a cursor on the step index is safe; a reported session is its steps, as the client wrote them, and each model call's usage, not the exact requests, so nothing depends on the request body; and the record has a stable id for each model call and step, so a second delivery of one can be recognised.

**What the hub has to build on.**

- The relay hands each finished request to the request log's `RecordRequest`, which never waits and never fails: a dropping queue of 10,000, batches of 500, a failed batch tried again with the same token, the items each of the last 512 sessions has (ADR-0007, the request log spec's Writing).
- `requests` is a `MergeTree` ordered by `(started_at, id)`. Each insert carries a deduplication token, and each table remembers its last 1,000 inserts (`non_replicated_deduplication_window`): a batch sent again later than that is stored twice.
- An import loads through the archive's session and its **held** rule, not through `RecordRequest`; an imported request's id is made from its source's, its `protocol` names its source form, and the request log has a renderer per stored form (ADR-0025).
- The archiver already archives again a day that gained rows after it was archived (ADR-0018).
- `PUT /api/session-titles` takes any hub key and the `x-cota-machine` tag, and the CLI's title reporter reads each source on from where its last run stopped, sends batches, records each batch the hub kept, and writes `titles.error` (ADR-0022, the title reporter spec).

## Decision

### One record, two ways in

A **reported request** (`CONTEXT.md`) is a row of the same request log: the same `requests`, `request_items` and `items`, read by the same queries, counted in the same traffic and shown in the same sessions, search, SQL and memory. There is no second store.

**The `Request` entity says which way a request came in.** Its fields that every request has stay at the top; the ones only a hub in the path can know move into an `origin` with two cases, **forwarded** and **reported**:

```ts
const Forwarded = Schema.TaggedStruct("forwarded", {
  protocol: ProtocolName,
  hubKey: HubKeyName,
  firstByteMs, sessionSource, userAgent, divertedFrom, follows,
  loginFingerprint, refusalReset, purpose, servedModel, stream,
  upstreamStatus, serviceTier, rateLimits, clientHeaders, errorBody,
  requestBytes, responseBytes, readingComplete,
});

const Reported = Schema.TaggedStruct("reported", {
  form: RecordForm,
  reportedBy: Schema.Option(HubKeyName),
  purpose: Schema.Literals(["", "compaction"]),
});

export const Request = Schema.Struct({
  id, startedAt, durationMs, session, machine, project, client,
  clientVersion, pool, provider, operation, model, outcome, errorType,
  errorMessage, stopReason, usage, providerRequestId, conversation,
  origin: Schema.Union([Forwarded, Reported]),
});
```

The fields keep their types of today (`request.entity.ts`). `hubKey` is a forwarded request's: the key that admitted it. A reported request's reporter is `reportedBy`, none when the owner reported it (a report takes any hub key or the owner, as titles do). `providerRequestId` and `stopReason` stay at the top because a client's record can name them. `RecordRequest.execute` takes a forwarded request only; the relay's `FinishedRequest` builds one exactly as it builds a request now.

**What the stored columns hold for a reported row.** Its `protocol` is its record form, which is how it is marked reported for ever: no other kind of request writes a record form there. Every forwarded field is its "nothing" value, the value the hub already writes when it has nothing to say:

| Column | A reported request |
| --- | --- |
| `id` | Made by the hub (below), a UUID version 7 stamped with `started_at` |
| `started_at`, `duration_ms` | When the model call started, as the record says, and its finish less its start |
| `first_byte_ms`, `follows`, `refusal_reset` | null |
| `session` | The conversation's id |
| `machine` | The report's `x-cota-machine`, as a title's machine is kept |
| `project` | As reported, where the record names one; else empty |
| `client`, `client_version` | The report's client (`antigravity`), and the version where the record names one |
| `hub_key` | The name of the hub key that reported it; empty for the owner |
| `pool`, `provider` | The report's observed pool, and that pool's provider from the configuration |
| `protocol` | The record form, `antigravity-steps` |
| `operation` | `generate` (Google's own word for a model call, `generateContent`) |
| `model`, `stop_reason`, `provider_request_id` | As reported (the record's model and response id); empty where it names none |
| `outcome`, `error_type`, `error_message` | As reported: `ok`, `error` or `cancelled`, never `refused` |
| the token columns, `usage_reported`, `usage` | The call's usage in the request log's classes, and the record's usage as JSON |
| `cost_usd` | Priced as the writer prices any request (Cost, below) |
| `purpose` | `compaction` for the call whose output is the record's compaction step, which the hub reads from the steps it stores; else empty |
| `session_source`, `user_agent`, `diverted_from`, `login_fingerprint`, `served_model`, `service_tier`, `error_body` | empty |
| `stream` | false |
| `upstream_status` | 0, the hub's "never answered": it never asked |
| `rate_limits`, `client_headers` | empty maps |
| `request_bytes`, `response_bytes` | 0; `reading_complete` true |

The read side tells three kinds apart by `protocol` alone: a protocol is a **forwarded** request's, a source form an **imported** one's, a record form a **reported** one's. `StoredProtocol` becomes `ProtocolName | SourceForm | RecordForm`, the reader's record of a request gains that origin, and the API gives it to the dashboard as `origin` so that a reported request is shown as reported wherever it is shown.

### The relay is not changed in behaviour

The relay keeps handing its finished request to `RecordRequest` in process, and never waits. **No event bus inside the hub**: a finished request has one consumer, the request log, and a bus would put a dispatch between them for no second reader. A second consumer of finished requests that must not slow the relay or the request log (the rooms of the roadmap, a live feed, a forecast) would justify one. **No durable outbox on the relay's path** in this work, the owner's "later": it would buy what the request log spec's "A spool on disk" names (a hub that crashes, or a ClickHouse away longer than 10,000 requests, loses nothing), at the cost of a disk write on every request's path, a second store to size, guard and back up, and a replay that must keep L5 and L6. Reported requests need neither: their outbox is the client's own record, on the machine.

### The intake: a report waits for the store

A machine reports with `POST /api/reported-requests` (`docs/specs/reported-requests/spec.md`): one **report** holds the model calls of one data folder, at most 500, the observed pool they bill, and, when the run read the folder to its end, the time it began reading it. The request-log module's command `ReportRequests` validates the whole report first, then stores it through the repository port, not through `RecordRequest`'s queue, and **answers only once its rows are stored** (`async_insert = 0`): the machine moves its cursor on that answer, so an answer that meant "queued in memory" would lose rows at a restart of the hub. A report the hub refuses stores nothing.

**The hub makes the id, so a second delivery is the same request.** A reported request's id is a UUID version 7 whose 48-bit time is the call's start in milliseconds and whose 74 other bits are the first bits of the SHA-256 of `cota-report:` followed by the JSON of `[<client>, <call key>]`, where the call key is the record's own id for the model call (below). The same call reported again always has the same id, whoever reports it: the same machine after a lost answer, a hub key the owner renamed or replaced, or a machine a data folder was copied to. Which hub key reported a request is what its row says (`hub_key`), never part of what the request is. And a report cannot choose an id, so it cannot name a forwarded or an imported request's.

**Delivery is at least once, so the hub leaves out what the log holds.** Before it stores, the hub asks which of the report's requests the log already **holds**, by the archive's rule (ADR-0018): a request by its id, a request's items by its request id, an item by its session and digest. It stores only the rest, and answers how many calls it stored and how many it found held. One report is stored at a time in a hub, so two deliveries of the same calls never both find them not held. The insert's deduplication token is not enough, for three reasons. A table remembers its last 1,000 inserts, and the relay's writer makes an insert of every batch, so a delivery repeated after a machine was away overnight is long out of that window. A second delivery is a new report, not the same insert again: the run reads on from a cursor that did not move and may carry more calls or fewer, so its token differs. And the token is per insert, so a report stored in part (its items written, its requests not) comes back with other contents. The held rule answers all three; the writer's token is still given, and is harmless.

**A model call's conversation is the call before it and what is new.** A report carries, with each call, only the conversation items new since the call before it in its conversation, never the conversation again, and names that call by its call key and its start (`after`), the two its id is made from, so that the hub can find it. The hub sets a call's `input` part as the call before's `input` and `output` followed by the call's new items before its output, and its `output` part as the step that carries its usage, reading the call before's parts from this report or, when an earlier report brought it, from the log by its id. A call whose call before is neither in the report nor held in the log, in the call's own session, is refused, and the report with it: calls are reported in order, and the cursor moves only after a stored answer, so this happens only when a machine's state is ahead of the hub's log, because the state came from a machine of another hub or the log was put back to an earlier time. Reporting the folder again from its first call (`cota requests remove` and `add`) is then right: the hub stores what it does not hold, and nothing twice. Each `request_items` row so lists the digests of every step through its call, as a forwarded request's lists its whole body, and each step is stored once per session. Two calls may name one call before: a step the machine read past while it was unfinished, without usage, can finish later as a model call, which is reported after the calls read past it, so that it and the first of those follow the same call; refusing it would lose the call. And a report sent again can hold a call the log already holds, with other content than was stored (its answer was lost, and the run read its steps again after they changed): the hub builds the report's later calls on that call as the report gives it, stores the report's items of it that the session does not hold, and never changes the held call's rows, so that a later call's conversation is the one its machine read.

### What a call carries, and the record form

For each model call: its call key, its usage, its model, when it started and finished, its outcome, its session, the project where the record names one, and its new items. The machine and the reporter are the caller's, never the payload's.

**The items are kept in the client's own form, as an imported request's are kept in its source form**, never converted. The form is **`antigravity-steps`**, a **record form** (`CONTEXT.md`): each conversation item is one step, as JSON, holding the step's `idx`, `step_type` and `status` as the table has them and its two protocol buffers, `metadata` and `step_payload`, written out field by field without a schema: a list of `[field number, wire type, value]` in the order of the bytes, a varint as its decimal digits, a fixed 32 or 64 bits as hex, and a length-delimited value as its text when its bytes are UTF-8, else as `{ "base64": … }`. Nothing is guessed, nothing is dropped, and the bytes can be written back exactly; which field holds a message, a tool call or a result is the renderer's to know, by a table read by trial, and a step it does not know is shown as its JSON. The request log's `protocol` column names the form; the request log gains its item text for search, its renderer for transcripts, a role rule (a reported conversation's model calls are its main requests: no sub-agent is read) and its first prompt's row, as it did for the source forms. A reported request's body, rebuilt (`GET /api/requests/{id}/body`), is `{ "steps": [ … ] }`, the steps through the call as the client recorded them, and the inspector says it is not what the client sent.

**A reported session is the client's record, not the exact requests.** For Antigravity that is its steps and each model call's usage. Its limits, which the sessions screens and the request log spec state:

- **The system prompt and the tool definitions are not captured.** They are in the record only for the newest call (fact 6), so nothing is built on them.
- **After a compaction the log shows every step, the compaction one of them.** A model call's `input` holds every step before it, which after a compaction is more than the model was sent; its usage is what the model read. A segment begins at the call after the compaction's own, which the record names: the hub stores that call with the purpose `compaction`, and the sessions' compaction rule cuts there whatever the sizes (`docs/specs/sessions/spec.md`, Segments). The prompt fell by more than half after the spike's compaction (fact 4), but not after a short conversation's (Facts to confirm when built), so the size rule alone is not enough.
- **A step reported unfinished stays so.** A model call whose step the client left unfinished for 10 minutes, or went on past, is reported as it is, as an error; if the client finishes that step later, the log keeps what was reported, since a reported request is never changed. A step read past while unfinished and without usage is remembered, and reported as a model call if it finishes with one (`docs/specs/request-reporter/spec.md`, A step not finished).
- **Up to a run late.** A reported request reaches the log when the machine's next run sends it: 30 seconds, or as long as the machine is away.
- **A format with no published schema**, which any update of Antigravity can change. The reader checks the tables and columns it reads, reports nothing from a record it cannot read and says so, and never guesses (`docs/specs/request-reporter/spec.md`).
- **No admission and no fallback.** Nothing stands between a reported request and its provider but the client, so no hub key, route, refusal, divert or quota window applies to it.

### Observed pools

A reported request bills a pool, as every request does, so that it has a provider, a price and a place in every dimension, and so that two Google sign-ins on one machine bill two pools (the owner's "to support multi account reporting"). The pool is an **observed pool** (`CONTEXT.md`): one the owner declares in the hub's configuration, that the hub never forwards for and holds no login or key for. The term was checked against the vocabulary's Avoid lists, which do not rule it out; "observed" is also said of a quota window's time, which `CONTEXT.md` now flags.

```toml
[pools.gemini]
observed = true
provider = "google"
```

- **It must have** `observed = true` and a `provider`. **It may have** `prices`, a price list's name (the provider `google` defaults to the list `google`, which 6b adds from models.dev's `google` provider, as `anthropic` and `openai` are made), and `model_prices`. **It must not have** `protocol`, `base_url`, `key`, `kept_login` or `fallback`, and no pool may name it as its `fallback`: the configuration refuses each, naming it. The `Pool` entity gains a third case, `ObservedPool { kind: "observed", id, provider, prices, ownPrices }`.
- **Admission** opens it to no hub key: no scope is `observed`, so a request to `/pools/<it>` is rejected (`WrongScope`, 403 `cota_hub_key_scope`), and A1 to A8 stand.
- **Routes and the default pool** never name it: it speaks no client's protocol, so the routes module refuses it as it refuses a pool of another protocol, and `GET /api/route` with it as an override is `pool-not-for-client`.
- **Launches** never bill it, and `cota join` and `cota configure` write nothing for it. `GET /api/machine` lists it to every hub key apart from the pools the key opens, in `observedPools` (its id, provider and display name), so that a machine can check the pool it reports to.
- **Fallback** never: it has no fallback pool and is none.
- **Quota readers, quota headers and quota logins** never: it has no reader, its requests carry no quota headers, and a quota login for it is `quota-login-not-taken` (reading Antigravity's quota is left out). `GET /api/pools` lists it with its kind and no windows.

### The machine's side

**The request reporter** (`CONTEXT.md`), `cota requests report`, is the title reporter's sibling: it runs once and ends, every 30 seconds by the machine's scheduler (`cota requests schedule`), and its rules, commands, doctor check and laws are `docs/specs/request-reporter/spec.md`.

- **Its outbox is a cursor over the client's own files**, as the title reporter's is, not a copy of the data: a report cursor per conversation (the last step reported and the call it ended), in `requests.json` in the state's directory. A run sends what is after the cursor, in reports limited by count (200 calls) and by bytes (8 MiB, a call alone over it sent alone), keeps going until it has caught up, and leaves the cursor where it is for any report the hub does not answer with success. What it could not send waits for the next run, and the record keeps it.
- **One data folder is one sign-in, so one observed pool.** The machine's configuration names, for each data folder of a client it reports, the observed pool that folder's requests bill, in `config.toml` (which holds no secret):

  ```toml
  [[clients.antigravity.reported]]
  folder = "/home/<you>/.gemini/antigravity-cli"
  pool = "gemini"
  ```

  `cota requests add <client> <folder> <pool>` checks with the hub that the pool is observed (`GET /api/machine`'s `observedPools`), keeps the folder, schedules the reporter and runs it once; `cota requests remove <client> <folder>` forgets it, and `cota requests show` prints each folder, its pool, how far each was reported and what was not, and the client's default folders that exist and are not reported. Doctor gains a `requests` check. The hub refuses a report that names a pool that is not observed. Nothing chooses or switches a sign-in: whatever starts the client with a data folder chose it.
- **The Antigravity reader** opens only `conversations/*.db` of a folder, read only, and when SQLite cannot open the live database so (fact 8) a copy of it and its `-wal` in a directory of its own; it never opens another file of the folder, the sign-in's token file least of all. It reads `trajectory_meta`'s ids, `steps`, `gen_metadata`'s model, call id and last step (never the request the newest row holds), and of `parent_references` only whether it has a row.

### Trust

- **Any hub key may report**, as any may report a title (the owner: "for now"), and the owner may. **Only as itself**: the hub key a reported request is kept under comes from the caller and never from the payload. A call is one request whoever reports it, and the first report of it is the one kept, so a hub key that knew another machine's call key and its start to the millisecond could report that call before its machine does; a hub key can already report any call it invents to an observed pool, which is what "for now" accepts. The machine is the caller's `x-cota-machine` tag, which the caller states, as on a forwarded request and a title: no hub key is bound to a machine, so a holder of any hub key can report under any machine's name, and reported through is what the hub keys' holders reported, not proof of which computer did.
- **A reported request is marked as reported for ever**, by its record form, and shown as such in every screen and in the API (`origin`).
- **It never moves admission, a refusal, a parked login, a divert or a quota window**: those are decisions the hub makes from what it saw itself. The intake reaches none of the modules that make them, and a reported request's outcome is never `refused` and its quota headers are empty, so neither the fallback nor the quota sources can read one as their own.
- **Reported through** (`CONTEXT.md`) is kept so that a silent machine is visible. Each report that ends a run's reading of a data folder says when that reading began; the hub keeps, per machine, client and observed pool, the latest such time and when the report came, in the hub store (the request-log module's step `request-log/0001-reported-through`, a table `reported_through`). The machine sends a report with no calls when it has nothing new, so an idle machine stays current. The dashboard shows, per machine and client, up to when it has been reported.

### Relayed or reported, never both

A client on a machine is launched through the hub or reported, never both, or its usage would count twice. Antigravity is reported only; Claude Code, Codex, OpenCode and Pi stay forwarded only. It is held in two places, by types: in the CLI, the clients it launches and the clients it reports are two disjoint unions, so `cota requests add` takes only a reported client and there is no shim for one; on the hub, the intake's `client` is a literal of the reported clients (`antigravity`), never one the relay forwards, and an observed pool can be reached by no forwarded request. A forwarded request's client is its tag or its user agent, which a client states; the two meet only for a client that could be pointed at the hub and reported both, and Antigravity cannot be pointed at it.

### Cost

A reported request is priced by its pool's price for its model, as a subscription pool's request is today: `Prices.of`, then `Cost.of`, once, as it is stored. A model the price list does not know has no price, so its request has no cost (`cost_usd` null, the cost spec's C1): it is never shown as zero, every money field the API answers counts it in `unpricedRequests`, and a sum with that count above zero is never shown as complete. A compaction's call whose record names no model is the same. Whether models.dev lists Gemini 4 Neon is not known; the owner can give the observed pool its own `model_prices`.

### Facts to confirm when built

Read by trial on one conversation on one machine; each was checked again in 6d (2026-11-23), on the four copies of that same throwaway conversation (no second conversation was run), against tokscale's public Antigravity parser (`antigravity_cli.rs`), a third party's public protocol definitions of Antigravity's language server, and T3 Code's public source, and with records and databases of the reader's own. What was found, and what the reader builds on (`docs/specs/request-reporter/spec.md`):

- **The usage: confirmed, and reasoning is read.** `metadata` 9 is the step's usage: 2 input not from cache, 5 input from cache, 4 cache written, 3 output with its reasoning, 9 the reasoning and 10 the rest of the output (9 and 10 sum to 3); 1 is the model, a number. tokscale reads 2, 3, 4, 5, 9 and 10 the same way, and the third party's definitions name them so. Reasoning is reported from 9, and the cache written (never above 0 in the conversation) as written for the short time.
- **Statuses: changed.** Every step's final `status` was 3 (done). A step's `metadata` 26 keeps its statuses as they went: a model's step 8 (generating) then 3, a tool's 1 (pending), 2 (running) then 3. The third party's definitions name 6 cancelled, 7 error, 9 waiting and 12 interrupted, none seen. A tool's step is written, pending, before the model's step that asked for it is finished, so a step that follows an unfinished one does not settle it: only its finishing, or 10 minutes without the files changing, does. A failed call was not seen: T3 Code's source ends an Antigravity turn whose model call failed on a step of type 17 (an error message), which the reader reads as an item, not a call.
- **The ids: confirmed, but two of them.** The database's name is `trajectory_meta.cascade_id`, each step's `metadata` 20.4 and `gen_metadata`'s `cascade_id`: the conversation's id, the reported session. `trajectory_meta.trajectory_id` is another id, each step's 20.1, and the prefix of `gen_metadata`'s call ids (`<trajectory id>-<n>`): the call key's. T3 Code's public source opens `<data folder>/conversations/<ACP session id>.db`, so the id T3 Code holds for the session is the database's name; that it keeps it as the thread's native id, which would let the title reporter title reported sessions, was not seen, since T3 Code's database is not read for this. Open.
- **The project: found.** Every user's message step holds the workspace it was sent in (`step_payload` 19.12.12, a `file://` URI). The project is read from the latest such step at or before the call, from that directory's own Git files, never by running `git`.
- **The compaction's model: found indirectly.** Its step names no model and has no `gen_metadata` row, but its usage's 1 is the same number as the `gen_metadata` rows' model (their 1.3): its model is the name such a row of the same conversation gives that number, else none.
- **Sign-in material: none seen, by shape, in one conversation.** No field of a step held anything shaped as a Google access or refresh token, an API key, a JWT or a bearer header; the long texts were paths and the conversation's own. Two fields hold opaque bytes, a tool call's 7 and the model output's 20.14, which the third party's definitions name the model's thought signatures, and the usage's 8 holds the provider's response headers (a session number seen). Open: judged by shape on one conversation, never against the token file.
- **Opening the file: changed.** A read-only open of a database in WAL mode whose `-wal` and `-shm` are absent fails, wherever it is (fact 8); a read-only open of one being written opens its `-shm` to write and changes its bytes. So the reader never opens the client's database: it always copies the database and its `-wal`, never `-shm`, into a directory of its own, comparing their sizes and times before and after, and reads the copy. Against a writer checkpointing (truncating its `-wal`) every third write, 238 copies were made: none was torn, and 53 saw the files change while copying, which the reader reads again.
- **Not tested still**: the desktop app's data folder and conversations, sub-agents, automatic compaction, long conversations, other versions of Antigravity. Open.
- **Seen in a first real run, 2026-11-23.** Four throwaway conversations, made through T3 Code's bundled Antigravity on one macOS machine, were reported by `cota requests report` to a throwaway hub. Two things were found that the spike's conversation did not show. A command that outlives its tool call's wait (`run_command` with `WaitMsBeforeAsync`) ends in a step of type 101, a task's notification, which the next model call reads: the record form's table now reads it (`docs/specs/reported-requests/spec.md`, The table of fields). And `/compact` in a short conversation did not shrink the prompt: about 35,000 tokens at the compaction's own call and at the call after it, the client's fixed preamble most of it, so the size rule cut no segment; the compaction's call is now named by its purpose (After a compaction, above). The same run saw tool steps (132) of `write_file` and `run_command` beside `read_file`, read as the table reads `read_file`'s.
- **`/usr/bin/curl` with a body of megabytes**: the reporter sends the body as a file curl reads (`--data-binary @<file>`); tested against a whole hub of the harness with a body of several megabytes (`apps/cli/src/01-presentation/requests.contract.test.ts`), not from a launchd job. Open for launchd, as ADR-0022's.

## Alternatives weighed

- **A gateway for Antigravity**, its requests relayed with its sign-in as Claude Code's are. Every field of a forwarded request, admission and fallback. It is what the Antigravity terms name as grounds for suspending the owner's accounts, and no setting to point Antigravity at it was found.
- **An event bus inside the hub**, the relay publishing finished requests and the request log one subscriber. One consumer does not need one, and the intake does not publish: a report is stored by its own command and answered from the store.
- **A durable outbox on the relay's path now.** Weighed above; the owner's "later".
- **Syncing whole sessions as snapshots**: the machine sends each conversation whole, and the hub works out what changed. Simpler on the machine, but a session of a thousand steps is sent again with every step, and the hub would diff snapshots to find model calls the record names already. The record only grows, so a cursor sends each step once.
- **A queue of copies on the machine**: each call copied into an outbox file of `cota`'s, sent and deleted. A second copy of everything, a disk that fills while the hub is away, and one more thing to lose; the record is already durable, ordered and append-only, so the cursor is the outbox.
- **Reported rows without a pool.** Every request bills one pool (`CONTEXT.md`), and every dimension, price and pool card reads it. A row without one would have no price list, no provider, and no way to tell two Google sign-ins apart.
- **A table of their own.** One more store for every reading query to union, for search, SQL, the archive, the H9 agreement and the memory skill to know, and a session's requests in two places. It is what "one record, two ways in" rules out.
- **A column marking reported requests** (`origin` in `requests`). `protocol` already marks each one, as it marks imported requests (ADR-0025). A new column changes `requests`' columns, which every archived day's manifest records, and a restore refuses a day whose columns differ from the log's (`docs/specs/archive/spec.md`, Restoring into other columns): every day archived before would become one the restore refuses, until a migration moves rows across.
- **Decoding the steps on the machine into a shape of Cota's**, named fields instead of field numbers. Transcripts and SQL would read more easily, but every stored item would be Cota's reading of a format read by trial, not the client's record: a reading improved later could not be applied to the rows already stored, and the same step read by two versions of `cota` would be two items. The stored form is the record, and the reading is the renderer's, which can change.
- **The machine making the ids.** A report could then name the id of a request the log holds, a forwarded one among them, and its call would be left out as held. The hub makes them from what the call is.
- **The reporter in the id** (`cota-report:<hub key>:…`), so that no hub key could report a call under an id another's report would have. A hub key renamed or replaced, or a data folder moved to a machine with another key, would then report its history as new requests, counted twice, and its next call would name a call before the hub could not find under the new name, with no way on that neither loses calls nor stores them twice. It would guard only against a hub key that knows another machine's call key and start, and a hub key can already report whatever it invents.
- **The insert's deduplication token alone.** Weighed above: its window, a re-read report's other contents, and a report stored in part.
- **The record's call id from `gen_metadata` as the call key.** It is the client's own id, but the compaction's call has no row (fact 6). The call key is the trajectory's id and the index of the step that carries the call's usage, both the record's own and stable, since steps never change.
- **Each call sending the digests of its whole conversation.** It spares the hub reading the call before, but a call's list grows with its conversation, so a long one is sent again in digests with every call. Naming the call before costs one read of a row the hub just wrote.
- **Through the title endpoint**, titles and requests in one report. Their limits, answers and failures differ, a title is kept on a 204 and a request only when stored, and one failing would hold back the other.

## Consequences

- **6b** builds `origin` in the `Request` entity (the relay's finished request is forwarded, its behaviour unchanged), the third kind of pool and its configuration, admission, routes, quota and fallback meeting one, `observedPools` in `GET /api/machine`, the pools group's `kind: "observed"`, and the `google` price list. **6c** builds the intake: `POST /api/reported-requests`, `ReportRequests`, the id, held, the chain, the record form's text, renderer, role rule and first prompt, and reported through in the hub store. **6d** builds the request reporter and the Antigravity reader in `apps/cli`, after confirming the facts above. **6e** builds the dashboard's reported mark, reported through, and the API that reads them.
- The request log spec gains reported requests beside imported ones; the sessions spec the record form; the api and sign-in specs the endpoint (any hub key, as `PUT /api/session-titles`); the hub store spec its table; the admission, routes, quota and fallback specs what an observed pool is to them; the CLI spec its configuration key, commands and check. Each changes in the slice that changes its behaviour.
- A reported request can arrive days late, after its day was archived: the archiver archives the day again, as it does any day that gained rows.
- A release that ships 6c adds a step to the hub store, which its release notes say.
- A reported request keeps the hub key and the machine of its first report. A hub key renamed or replaced, or a data folder moved to another machine, reports on under the new name, and what was reported stays under the old one, as a forwarded request stays under the hub key that admitted it.
- Worse than a forwarded request: no time to the first byte, no status, no quota headers, no login, no body as sent; a session shown with steps the model was not sent after a compaction; up to a run late; and a reader that an update of Antigravity can stop, which says so rather than reporting anything wrong.

## Left out

- **Reading Antigravity's quota.** A later decision; the owner uses another tool for it today.
- **Choosing a sign-in by project, or switching it when a subscription is refused.** The first is whatever starts the client with a data folder; the second is never automatic.
- **Sub-agents, automatic compaction and the desktop app's conversations**, none observed yet. The reader does not break on them: a record it cannot read gives nothing from the first step it cannot read on, and says so.
- **Reporting Claude Code's or Codex's own transcripts.** They are forwarded, and reporting them too would count them twice.

## Open for the owner

Each is written with the recommendation, marked open, in the specs.

1. **History.** When a data folder is added, report every conversation it holds (recommended: the request log is the record, and the memory skill reads it), or only those changed since it was added.
2. **The install prompt.** Whether `docs/install.md` asks the owner, on a machine with Antigravity, which data folders to report and which observed pool each bills (recommended, in 6d), or leaves it to `cota requests add` by hand.
3. **A data folder not reported.** Whether doctor warns about one of Antigravity's default folders that holds conversations and is not reported (recommended: no warning, which would nag an owner who chose not to; `cota requests show` lists them).
4. **Late.** When the dashboard calls a machine's reported through late (recommended: more than 5 minutes behind, doctor's own measure of a reporter that stopped).
