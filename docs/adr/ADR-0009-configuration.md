---
status: accepted
scope: apps/hub
owner: limineol
last_verified: 2026-11-12
review_by: 2027-02-12
supersedes: []
code:
  - apps/hub/src/config
  - apps/hub/src/modules/admission/04-infrastructure/sha256-hub-key-hasher.ts
  - apps/hub/src/modules/request-log/04-infrastructure/prices
  - apps/hub/src/main.ts
---

# ADR-0009: One configuration file, with secrets by reference

## Context

The prototype was configured in five places: a gateway's JSON file, its database, an `.env` file, a reverse proxy's rules and a shell script on every machine. Which pool had a fallback was a constant in a source file.

The hub needs to know its pools, its hub keys, its ClickHouse and its prices. The owner edits this by hand, or an agent does it for them (Milestone 4), so it must be one readable file that says what is wrong with it.

## Decision

- **One TOML file**, named by `COTA_CONFIG` (default `cota.toml`). TOML takes comments, reads well for tables of pools, and Bun parses it without a dependency.
- **The file is decoded once, at start, with a Schema.** Every problem is reported at once, each with its path: every problem of its shape first, and when it has none, every broken rule and every secret that cannot be read, together. A hub with a bad file prints them and exits 1.
- **Rules a Schema cannot state are checked right after:** a fallback pool must exist, must not be the pool itself, must be a subscription pool of the same protocol and must have a kept login; two hub keys must not share a secret; a pool that speaks `openai-chat` needs a base URL; a pool that speaks `chatgpt-codex` cannot hold a key.
- **A pool's kind comes from its configuration.** A pool that holds a key is a keyed pool, and so is every pool that speaks `openai-chat`, with a key or without (a local server needs none). Any other pool is a subscription pool. Admission needs each pool to have a kind (`docs/specs/admission/spec.md`), not that the kind follow the protocol.
- **No secret is written in the file.** A secret is a reference: `{ env = "NAME" }` or `{ file = "/path" }`. The value is read at start, held as a `Redacted`, and never printed.
- **A hub key is compared by digest.** The hub keeps a SHA-256 of each hub key and compares digests in constant time.
- **A pool's prices are configuration too.** `prices = "<list>"` names one of the price lists the hub ships, and `[pools.<id>.model_prices."<model>"]` gives the pool its own price for a model, in dollars per million tokens as providers publish them (`input`, `output`, `cache_read`, `cache_write_short`, `cache_write_long`, and `tiers = [{ over = <prompt tokens>, … }]`). A price finer than a picodollar per token, tiers that do not rise, and a list the hub does not ship are reported with the rest. The lookup is in `docs/specs/protocols/spec.md`.
- **The file is read at start only.** Changing it means restarting the hub. What is parked is lost on a restart, which the fallback spec already accepts.

## Consequences

- The first-run screens of Milestone 3 and the routes of Milestone 4 need settings the hub can change while running. Those will live in the hub's own store, beside this file, not in it.
- A container gets its secrets as environment variables or mounted files, which is what container platforms provide.
