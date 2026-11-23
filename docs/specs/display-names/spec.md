---
status: active
scope: apps/hub
owner: limineol
last_verified: 2026-11-23
review_by: 2027-02-23
supersedes: []
code:
  - apps/hub/src/modules/display-names
  - apps/hub/src/shared/03-domain/client.ts
  - apps/hub/src/modules/request-log/04-infrastructure/prices/prices.ts
  - apps/hub/src/modules/request-log/04-infrastructure/prices/update.ts
---

# Display names

A display name is the owner's name for a pool, model, client, machine or project, shown in place of its id. This spec covers what can be named, what the hub names itself, and how the owner sets and removes a name. It is the `display-names` module (`apps/hub/src/modules/display-names`): its commands `SetDisplayName` and `RemoveDisplayName` and query `ListDisplayNames`, its port `DisplayNamesRepository` over the hub store (`docs/specs/hub-store/spec.md`), the built-in names in `03-domain/built-in-names.ts`, and the endpoints in `docs/specs/api/spec.md`.

## Values

- **Kind**: `pool`, `model`, `client`, `machine` or `project`.
- **Key**: the id as the request log has it: a pool's id, a model id as the client sent it, a client's name (`claude-code`), a machine tag, a project tag. 1 to 255 characters (code points), taken as they are: not trimmed, and with any character, a slash included.
- **Name**: 1 to 80 characters after trimming. A lone surrogate in it (JSON can write half of a surrogate pair alone, as `"\ud800"`) is kept as U+FFFD, by `SetDisplayName`: the hub store's SQLite writes one as bytes that are not UTF-8, and, measured with Bun 1.4.2, read `"b\udc00c"` back as `b` and U+10063, the `c` lost.
- **Display name**: `{ kind, key, name, source }`, where `source` is `owner` or `built-in`.

## Built-in names

The hub names some ids itself, so the owner does not have to:

- **Clients**: `antigravity` is Antigravity, `claude-code` is Claude Code, `codex` is Codex, `opencode` is OpenCode, `pi` is Pi (`apps/hub/src/shared/03-domain/client.ts`).
- **Models**: the name models.dev gives the model, for every model in the price lists the hub ships. `bun run prices:update` writes each model's `name` into `prices.json` beside its prices; the hub never fetches names while running. A model models.dev gives no name has no built-in name. When two lists name one model id differently, the first list's name, in the order of the lists' names, is its built-in name.

The request log's module gives the models' names to the display-names module through `hub.ts`. Pools, machines and projects have no built-in names: their ids are the owner's own.

## Reading and changing

- `GET /api/display-names` gives every owner name and every built-in name the owner has not replaced, ordered by kind, then key, each as text (by code point). A key with an owner name appears once, as `owner`.
- `PUT /api/display-names/{kind}/{key}` with `{ name }` sets the owner's name for that key, replacing any it had, and answers the display name. A name equal to its key, once trimmed, removes the owner's name instead (as `DELETE`) and answers the built-in name, or the key itself as `built-in` when there is none.
- `DELETE /api/display-names/{kind}/{key}` removes the owner's name; 404 `urn:cota:no-such-display-name` when there is none.
- The key in the path is percent-decoded once: a key holding a slash is sent with it as `%2F`, and `%2525` is the key `%25`. In the hub store it is only ever a bound value.

Only the owner, signed in, may change names; reader keys may read them (`docs/specs/sign-in/spec.md`). Names are applied by whoever shows them: no other endpoint answers a display name in place of an id, but `GET /api/machine` (`docs/specs/api/spec.md`, Machine), which answers a machine the names of the pools and models it opens, since a spending hub key may not read `GET /api/display-names`.

## Laws

| Id | Law | Held by |
| --- | --- | --- |
| D1 | **The last set wins.** After any sequence of sets and removals, a key's owner name is the one last set, or none when it was last removed, over the in-memory and the SQLite repository alike. | property |
| D2 | **Removing restores.** Removing an owner name makes the key show its built-in name again, or none. | property |
| D3 | **Names never reach the request log.** Setting or removing a display name changes no answer of any reading endpoint (`GET`) but `GET /api/display-names` and `GET /api/machine`. | property |
| D4 | **One name per key.** `GET /api/display-names` never lists two names for the same kind and key. | property |

D1, D2 and D4 run sequences of sets and removals, a set of a name equal to its key among them, through the commands and the query (`display-names.laws.test.ts`); D3 runs them through a whole hub whose request log holds a request, and compares every reading endpoint's answer, as the owner, before and after.

## Not built, on purpose

- **Replacing every name at once**, as the prototype's settings did. One key at a time.
- **Names for sessions.** A session's name is its title (`docs/specs/sessions/spec.md`).
- **Names inside SQL.** Display names are in the hub store, not ClickHouse (ADR-0013).
- **Colours and icons.** After parity (`docs/roadmap.md`).
