---
status: active
scope: apps/hub
owner: limineol
last_verified: 2026-11-23
review_by: 2027-02-19
supersedes: []
code:
  - apps/hub/src/shared/04-infrastructure/hub-store
  - apps/hub/src/shared/03-domain/hub-store.ts
  - apps/hub/src/modules/routes/04-infrastructure/persistence/sqlite
  - apps/hub/src/modules/request-log/04-infrastructure/persistence/sqlite
---

# Hub store

The hub store is the hub's own SQLite file: what the hub changes while it runs and is not the request log. ADR-0013 gives the reasons and what lives here rather than in ClickHouse.

The connection and its migrations are `apps/hub/src/shared/04-infrastructure/hub-store/hub-store.ts`: the service `HubStore` and its `layer`, which `main.ts` builds from the configuration before anything else, so that it is opened first and closed last. Each table belongs to one module. The module's port speaks in its own terms, and its SQLite adapter, in its `04-infrastructure/persistence/sqlite/`, yields `HubStore` and runs its SQL through `HubStore.use`. The module's steps (below) are exported beside that adapter, its `module.ts` exports them as `steps`, and `hub.ts` lists every module's in `storeSteps`, which `main.ts` gives the store (and the whole-hub harness its scratch store). No use case sees the store, and the relay never yields it.

## The file

- **Where.** `[store] path` in the configuration, resolved against the configuration file's directory; default `cota.sqlite`. Its directory must exist.
- **Opening.** At start, before the server listens, with `bun:sqlite`: created empty with mode 0600 when missing (SQLite gives its WAL files the same mode), then `PRAGMA journal_mode = WAL`, `PRAGMA foreign_keys = ON`, `PRAGMA busy_timeout = 5000`, `PRAGMA secure_delete = ON` (a deleted row is overwritten, not left in the file's free pages). A store file that already exists and that its group or others can read is opened all the same, with the warning `the hub store can be read by others than the hub's user; it holds quota logins, so make it mode 0600` and its path and mode, since a store restored from a copy keeps the copy's mode. One connection for the hub's life, closed on shutdown after the request log has been given what it holds.
- **Refusing to start.** The hub prints the problem and exits 1 when the path's directory is missing, the file cannot be read and written by the hub (checked before SQLite opens it, since SQLite opens a file it cannot write as read-only without saying so), it is not a SQLite database, or it holds a migration this hub does not know (a newer hub wrote it). It does not start without its store. The problem is one line: `The hub store <path> <what is wrong>.`
- **While running.** A store call that fails fails with `HubStoreUnavailable` (`apps/hub/src/shared/03-domain/hub-store.ts`), which fails the API call that made it, with 503 `urn:cota:hub-store-unavailable`. The relay never touches the store.

## Migrations

- A module declares its tables as an ordered list of **steps**, each a name (`<module>/<four digits>-<what>`, as `sign-in/0001-sign-ins`) and the SQL that makes the change.
- At start the hub creates `migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)` when missing. If the table holds a name the hub does not list, the hub refuses to start before running anything. Otherwise, for each step in the order the hub lists them (module by module, as `hub.ts` lists them in `storeSteps`, then step by step), it runs the steps whose names the table does not hold, each with its insert into `migrations` in one transaction. `applied_at` is the clock's time, an ISO 8601 instant in UTC with milliseconds.
- A step that fails rolls back alone and stops the start: the hub exits 1 naming the step.
- A released step is never edited or removed. A change to a table is a new step.
- A command run beside the hub that writes to the store (the import's display names, `docs/specs/import/spec.md`) opens it without migrating: it refuses a store that does not exist, or whose `migrations` do not hold exactly the steps this hub lists, so that only the hub ever changes the store's tables.

## Tables

The store holds `migrations` and the tables of the modules whose steps the hub lists, in this order: the sign-in module's `sign-in/0001-sign-ins`, which makes `sign_ins`, `sign-in/0002-owner-password`, which makes `owner_password`, and `sign-in/0003-passkeys`, which makes `passkeys`, then the display-names module's `display-names/0001-display-names`, which makes `display_names`, then the quota module's `quota/0001-quota-logins`, which makes `quota_logins`, then the routes module's `routes/0001-routes`, which makes `route_lists` and `routes`, then the request-log module's `request-log/0001-reported-through`, which makes `reported_through`.

`sign_ins` (the sign-in module, `docs/specs/sign-in/spec.md`, `apps/hub/src/modules/sign-in/04-infrastructure/persistence/sqlite`):

| Column | Type | Holds |
| --- | --- | --- |
| `id` | `TEXT PRIMARY KEY` | A UUID version 7. |
| `token_digest` | `TEXT NOT NULL UNIQUE` | The SHA-256 of the token, 64 hex digits. |
| `created_at`, `expires_at` | `TEXT NOT NULL` | ISO 8601 instants, UTC, with milliseconds. |
| `last_used_at` | `TEXT NOT NULL` | Written at most once a minute. |
| `revoked_at` | `TEXT` | Null until revoked. |
| `user_agent` | `TEXT NOT NULL` | The sign-in request's, cut to 200 characters. |

`owner_password` (the sign-in module, `docs/specs/sign-in/spec.md`, the same folder): the stored password, one row at most.

| Column | Type | Holds |
| --- | --- | --- |
| `id` | `INTEGER PRIMARY KEY CHECK (id = 1)` | Always 1: the table holds one row, so of two setups sent together the second write finds it taken and loses. |
| `hash` | `TEXT NOT NULL` | The argon2id hash of the owner password, as `Bun.password` writes it: `$argon2id$v=19$m=65536,t=2,p=1$<salt>$<hash>`. |
| `set_at` | `TEXT NOT NULL` | When it was set, at setup or by the latest change. |

`passkeys` (the sign-in module, `docs/specs/sign-in/spec.md`, the same folder): the owner's passkeys. A passkey's public key is not a secret; its private key never reaches the hub.

| Column | Type | Holds |
| --- | --- | --- |
| `id` | `TEXT PRIMARY KEY` | A UUID version 7. |
| `credential_id` | `TEXT NOT NULL UNIQUE` | The credential id, base64url: of two passkeys with one credential id, the second write finds it taken and loses. |
| `public_key` | `BLOB NOT NULL` | The public key as COSE writes it, as the authenticator gave it. |
| `counter` | `INTEGER NOT NULL` | The signature counter: 0 for an authenticator that keeps none; a sign-in writes the greater of it and the answer's. |
| `transports` | `TEXT NOT NULL` | A JSON array of the transports the browser named, empty when it named none. |
| `rp_id`, `origin` | `TEXT NOT NULL` | Where it was made: the RP ID and the origin a sign-in is verified against. |
| `user_agent` | `TEXT NOT NULL` | The making request's, cut to 200 characters. |
| `created_at` | `TEXT NOT NULL` | An ISO 8601 instant, UTC, with milliseconds. |
| `last_used_at` | `TEXT` | Null until it signs in. |

Forgetting the stored password and removing a passkey each check, in one transaction with the change, that a way in remains (`docs/specs/sign-in/spec.md`, The last way in).

`display_names` (the display-names module, `docs/specs/display-names/spec.md`, `apps/hub/src/modules/display-names/04-infrastructure/persistence/sqlite`):

| Column | Type | Holds |
| --- | --- | --- |
| `kind` | `TEXT NOT NULL` | `pool`, `model`, `client`, `machine` or `project`. |
| `key` | `TEXT NOT NULL` | The id as the request log has it. |
| `name` | `TEXT NOT NULL` | The owner's name for it. |
| `set_at` | `TEXT NOT NULL` | When it was set. |

`PRIMARY KEY (kind, key)`.

`quota_logins` (the quota module, `apps/hub/src/modules/quota/04-infrastructure/persistence/sqlite`): one row per pool that was given a quota login, its columns as `docs/specs/quota-logins/spec.md` lists them. It holds the logins' access and refresh tokens as the providers gave them, so from milestone 2b the store holds secrets that can spend a subscription: the file is guarded, mounted and backed up as the environment's secrets are.

`route_lists` and `routes` (the routes module, `docs/specs/routes/spec.md`, `apps/hub/src/modules/routes/04-infrastructure/persistence/sqlite`): one row per routed client whose list was ever stored, with its default pool, revision and when it changed, and its routes by position, their columns as the routes spec's "Keeping them" lists them, `PRIMARY KEY (client, position)` and `UNIQUE (client, pattern)` on `routes`, whose `client` references `route_lists`. A change replaces one client's list in one transaction, and writes only when the client's revision is the one it was made from.

`reported_through` (the request-log module, `docs/specs/reported-requests/spec.md`, Reported through, `apps/hub/src/modules/request-log/04-infrastructure/persistence/sqlite`): one row per machine, reported client and observed pool that reported a `through`, its columns as that spec lists them, `PRIMARY KEY (machine, client, pool)`. A report's `through` replaces the row's only when it is later, in the one statement that writes it.

## Laws

| Id | Law | Held by |
| --- | --- | --- |
| M1 | **Migrating twice changes nothing.** Opening a store that holds every step the hub lists runs no step and leaves every table as it was. | property |
| M2 | **Each step once, in order.** After any sequence of starts, each with a list that begins with the one before, every step has run exactly once, and in the listed order. | property |
| M3 | **A newer store is refused.** A store holding a step the hub does not list stops the start, and nothing in it changes. | property |
| M4 | **The file is the owner's alone.** A store the hub creates has mode 0600. | property |

M1 to M3 are property tests over generated step lists, each start on a store in a temporary directory (`hub-store.laws.test.ts`); half the generated steps make a table of their own, which running twice would fail. Beside them, M1 to M3 are held for the steps `hub.ts` lists: a store opened twice with them, one holding only the sign-in module's first step that gains the rest and keeps its sign-ins, one migrated before the stored password that gains its steps once and keeps its sign-ins, one migrated before passkeys that gains their step once and keeps its sign-ins and its stored password, and one they migrated that a hub listing only the sign-in step refuses. M4 is one example, titled with its id so that `bun run verify` counts it.

## Not built, on purpose

- **Backups by the hub.** The file is backed up with the configuration (ADR-0013); `(umask 077; sqlite3 cota.sqlite ".backup cota-backup.sqlite")` works while the hub runs and makes a copy only its user can read. Without the `umask` the copy takes the shell's, usually readable by everyone, and from milestone 2b it holds every quota login.
- **Down migrations.** Going back is restoring a backup.
- **Encryption at rest.** ADR-0017 leaves the store unencrypted in milestone 2b, whose quota logins (`quota_logins`) are the first secrets it holds; what encrypting them would take is recorded there, open for the owner.
- **Several hubs on one file.**
