---
status: accepted
scope: apps/hub
owner: limineol
last_verified: 2026-11-14
review_by: 2027-02-13
supersedes: []
code:
  - apps/hub/src/config
  - apps/hub/src/shared/04-infrastructure
  - apps/hub/src/modules/request-log/04-infrastructure/persistence
---

# ADR-0013: The hub keeps its own state in a SQLite file, and log data in ClickHouse

## Context

Milestone 2 brings state that the hub changes while it runs: sign-ins (ADR-0012), the owner's display names, session titles reported by machines, and, in the next pull request, kept logins and their refreshed tokens. ADR-0009 foresaw it: "settings the hub can change while running … will live in the hub's own store, beside this file".

The prototype kept titles in a SQLite file, display names in a JSON file rewritten whole, kept logins in one JSON file per login, and sign-ins nowhere (they were signed cookies). Its request log was ClickHouse.

ClickHouse is an append-mostly analytical store. It has no transactions, no unique constraint, no row-level update short of a mutation or a `ReplacingMergeTree` that merges "in time", and every query is a network round trip. A sign-in must be revoked now, not after a merge; a kept login's refreshed token must replace the old one exactly once, because the provider rotates it and two holders sign each other out.

## Decision

**What goes where.** The test is: would the owner's agents want it in SQL beside the requests, and is it a fact about what happened rather than a setting?

| Data | Store | Why |
| --- | --- | --- |
| Requests, items, request items | ClickHouse | Log data (ADR-0007) |
| Reported session titles | ClickHouse, table `session_titles` | Facts reported about sessions, joined with requests in SQL by agents; appended, the latest winning (`docs/specs/sessions/spec.md`) |
| Sign-ins | Hub store | Must be revoked at once; never queried with requests; a digest an agent has no use for |
| Display names | Hub store | The owner's settings, changed one at a time, read whole by the dashboard |
| Kept logins (2b) | Hub store | Secrets that must be replaced exactly once per refresh |

**The hub store is one SQLite file, opened with `bun:sqlite`.** Its path is `[store] path` in the configuration, relative to the configuration file's directory, default `cota.sqlite`. The hub opens it at start in WAL mode with `foreign_keys` on and a busy timeout of 5 seconds, creates it if it is missing (its directory must exist) with mode 0600, and keeps one connection for its life. `bun:sqlite` is synchronous; each call is a few microseconds on a local file and is run inside `Effect.sync`/`Effect.try`.

**Ports, per module.** The store is reached only through ports in the owning module's terms, never through SQL in a use case:

- `SignIns` (sign-in module): make, find by digest, touch, list, revoke one, revoke all but one.
- `DisplayNamesRepository` (display-names module): list, set, remove.
- `KeptLogins` (quota module, 2b).

> Amended by ADR-0017: the quota module's port is `QuotaLogins`, over the table `quota_logins`, because it holds only quota logins; the fallback pool's `kept_login` stays in the configuration.

Each port has a SQLite adapter in its module's `04-infrastructure/persistence/sqlite/` and an in-memory fake in its `05-tests/fakes/`. The connection, and the running of migrations, are `shared/04-infrastructure/hub-store/`: shared, because one file has one order of migrations, and infrastructure, because no use case sees it.

**Migrations are SQL steps, applied in order, once.** Each module's adapter declares its steps as a list of named SQL texts (`sign-in/0001-sign-ins`). At start, `HubStore.migrate` creates a `migrations` table if it is missing, and runs, each in its own transaction, the steps whose names it does not hold, in the order the hub lists them, recording each. A step is never edited once released; a change is a new step. A store that holds a step this hub does not know was written by a newer hub: the hub refuses to start rather than run against tables it does not understand.

**When the store is missing, unreadable or newer.** Missing: it is created. Not a SQLite file, unreadable, its directory missing, or newer: the hub prints the problem and exits 1, as for a bad configuration (ADR-0009); it is a local file the owner controls, and a hub that started without it would refuse every sign-in. Once running, a store call that fails (a full disk) fails that API call with 503 `urn:cota:hub-store-unavailable`. The relay never reads or writes the store, so forwarding never waits for it or fails because of it.

**Session titles are request log data.** `session_titles` is created by the request log's ClickHouse repository with its other tables (`docs/specs/request-log/spec.md`), and written through a request-log port. It is in the database the SQL endpoint reads.

## Alternatives weighed

- **Everything in ClickHouse.** One store to back up, and sign-ins and display names visible to SQL. But revoking a sign-in becomes a mutation or a merge, a kept login's refresh cannot replace exactly once, and every API request pays a round trip to check its cookie. The hub would also stop being able to let the owner in while ClickHouse is down.
- **JSON files, as the prototype.** No dependency, but a file rewritten whole per change needs its own atomic write, locking and migration story, and a second file per concept. SQLite gives transactions and a schema for nothing: it ships inside Bun.
- **Effect's SQL client (`effect/sql`'s `SqlClient` and `Migrator`) over a SQLite driver package.** It would give `Statement` templates and a migrator, but it means another package that must move with `effect` (AGENTS.md), and a migrator the hub needs twenty lines of. The ClickHouse client is hand-written for the same reason.
- **PostgreSQL.** A second server for a few hundred rows.
- **Titles in the hub store.** They would be a setting the owner cannot query beside the requests they name; agents asked for them in SQL in the prototype.

## Consequences

- The owner backs up two things beside the configuration: the ClickHouse database and `cota.sqlite`. Milestone 5's recipes say so. The archive (2c, ADR-0018) covers the request log's ClickHouse tables only.
- The store will hold kept logins' refresh tokens (2b), so the file is a secret from the start: mode 0600, never inside the repository's examples, and the recipes mount it from a private volume. Whether its secrets are encrypted at rest is decided with kept logins.

> Amended by ADR-0017: the store is not encrypted at rest in milestone 2b; what encrypting it would take is recorded there, open for the owner.
- `config/` gains `[store]`. A test of the composition root starts a hub on a scratch store in a temporary directory.
- Two hubs on one store file are not supported; SQLite would serialise them, but the attempt count and the SQL user's password (ADR-0015) are per process.
