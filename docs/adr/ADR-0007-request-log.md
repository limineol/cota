---
status: accepted
scope: apps/hub
owner: limineol
last_verified: 2026-11-15
review_by: 2027-02-12
supersedes: []
code:
  - apps/hub/src/modules/request-log/02-application
  - apps/hub/src/shared/03-domain/conversation.ts
  - apps/hub/src/modules/request-log/04-infrastructure/persistence
---

# ADR-0007: The request log is written as each request passes

## Context

The prototype's request log was Bifrost's log table. Bifrost wrote a request's whole history again with every request: 76 GB in twelve days. The prototype recovered with views that de-duplicated after the fact, five minutes behind, an archiver, and a job that emptied the log. Its dashboard carried two code paths for every conversation read, one for the log and one for the store.

Much of what the dashboard wanted was never in the log at all: which login spent a pool, where a request was diverted from, the time to the first byte, the two prices of cache writes, whether the client hung up. What is not captured as a request passes cannot be recovered later.

## Decision

- **ClickHouse, written by the hub.** Three tables: `requests` (one row per request), `items` (each conversation item once per session) and `request_items` (for each request, its items in order, and what is needed to rebuild its body). The hub creates them at start if they are missing. ADR-0001 chose ClickHouse; the dashboard's queries are aggregates over time ranges, and the owner's agents query it with SQL.
- **One row per exchange with a provider.** A refused request that is sent again to the fallback pool is two rows; the second names the first. Each row is written once, when the request is finished.
- **A conversation is stored in the provider's own shape.** Items are the protocol's own JSON: Anthropic messages, Codex input items, Chat Completions messages. Nothing is converted to a common form, so nothing is lost in one. A reader picks the parser by the row's protocol.

  > Amended by ADR-0029: the log also holds reported requests, each one model call a machine read from its client's record and reported, written when the hub stores the report rather than as a request passes, waiting for ClickHouse and never through the writer's queue; their items are in the client's own record form (`antigravity-steps`), which their `protocol` names, never converted.

- **An item is stored once per session, by content.** Its key is a 128-bit digest of its JSON after the parts that move between requests (Anthropic's `cache_control` markers) are taken out. What was taken out is kept per request, so a request's body can be rebuilt as the same JSON value. Byte equality is not promised: whitespace and key order are not kept.
- **Usage is stored by class, and never guessed.** Input never includes cached tokens; cache writes are split by lifetime; reasoning is recorded as a part of output. A stream that gave no usage is recorded as usage not reported, not as zero. The provider's usage object is kept verbatim beside the classes.
- **Cost is computed once, at ingest,** from the usage and the price in force (the `Cost` calculation in the domain). The tokens are kept, so it can be recomputed.
- **Writing is off the request path.** A finished request is put on a bounded queue; a writer batches the queue into ClickHouse, through the request log's repository port (ADR-0010), and retries. Forwarding never waits for ClickHouse and never fails because of it.
- **A batch ClickHouse declines is split, not retried as it is.** A batch that could not be delivered is tried again unchanged. A batch ClickHouse answers it will not keep would be declined on every try, and nothing after it would be written: it is split in halves until the request ClickHouse will not keep stands alone, and that request is dropped, logged and counted, but only once ClickHouse has stored another request and then declined it again. Dropping on a declined insert alone would empty the queue into nothing whenever ClickHouse declines everything, as with a full disk.
- **Logins and keys never reach the request log.** A row carries the login's fingerprint. Request headers are recorded from an allow-list per protocol.

## Consequences

- There is nothing to de-duplicate, archive around or empty later, and one path for every read.
- A hub that crashes loses the requests still on its queue, and one that cannot reach ClickHouse for longer than the queue holds drops the oldest. Both are logged and counted. A spool on disk is the fix if this turns out to matter.
- A request ClickHouse will not keep is lost, logged with ClickHouse's reason and counted, and the requests around it are written. The hub does not judge ClickHouse's reason: what proves a request is the cause is that ClickHouse stores others and not it.
- A reader needs a parser per protocol to show a transcript. That is the price of not converting.
- The tables are the contract for Milestone 2's API and for SQL written by the owner and their agents. Until the first release they change freely; after it, by migration.
- The prototype's data is in Bifrost's shape. Moving it is the importer in Milestone 5.
