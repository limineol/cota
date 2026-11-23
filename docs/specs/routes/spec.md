---
status: active
scope: apps/hub
owner: limineol
last_verified: 2026-11-23
review_by: 2027-02-23
supersedes: []
code:
  - apps/hub/src/modules/routes
  - apps/hub/src/hub.ts
---

# Routes

Which pool a launch of a client bills for a project: each client's ordered list of routes and its default pool, kept on the hub, changed by the owner, and answered one launch at a time to a machine. ADR-0023 gives the reasons; what a machine does with the answer is `docs/specs/cli/spec.md`.

**What is built.** The `routes` module (`apps/hub/src/modules/routes`): its `03-domain` holds the patterns (`project-pattern.ts`), matching, shadowing, checking a list and the answer to one launch (`route-list.ts`), with the laws below; its port `RoutesRepository` over the hub store and its step `routes/0001-routes`; the command `ChangeRoutes`, the queries `ListRoutes` and `AnswerRoute`, and `WarnOfUnfitRoutes`, which the module runs once at start; and the three endpoints. Settings → Routes, the dashboard's part that lists and changes them, is `docs/specs/dashboard/spec.md`'s (Settings).

## Values

- **Routed client**: `claude-code` or `codex`, the clients whose pool a launch chooses. A routed client's **protocol** is `anthropic-messages` for `claude-code` and `chatgpt-codex` for `codex`. OpenCode and Pi have no routes (ADR-0023).
- **Project**: what a launch reads (`docs/specs/cli/spec.md`, The project), as its `x-cota-project` tag carries it: trimmed, 1 to 200 code points.
- **Project pattern**: trimmed and lowercased when stored, then 1 to 200 code points, with no control character, at most one `*`, and that only as its last character; `*` alone is not one. A pattern without `*` is **exact**; one with it is a **prefix** pattern, whose **stem** is the pattern without its `*`.
- **Route**: `{ position, pattern, pool }`, where `position` counts from 1 in the order the routes are tried and `pool` is a pool's id.
- **A client's list**: its routes in order (0 to 200 of them), its **default pool** (a pool's id, or none), its **revision** (an integer, 0 for a list never stored, one more at each stored change) and when it last changed.
- **Fits**: a pool fits a routed client when the configuration has it and its protocol is the client's. A subscription pool and a keyed pool both fit Claude Code; every pool that fits Codex is a subscription pool. An observed pool speaks no protocol, so it fits no client: a route, a default pool or an override naming one is refused as one that does not speak the client's protocol (ADR-0029).

Lowercasing is `toLowerCase` on the whole string, which depends on no locale.

## Matching

1. A pattern **matches** a project when, the project lowercased, an exact pattern equals it, or a prefix pattern's stem starts it. `acme/*` matches `acme/api` and `acme/tools/cli`, not `acme`; `acme*` matches `acme`, `acme-site` and `acme/api`.
2. A client's answer for a project is its first route, by position, whose pattern matches the project; else its default pool; else **no route**.
3. When the route or the default pool answered names a pool that does not fit the client (the configuration no longer has it, or its protocol changed, or it became an observed pool), the answer is that problem, `route-pool-gone`, naming the position (or the default). No later route and no default pool is tried in its place.
4. With an **override** (a pool named in the question), the answer is that pool when it fits the client, whatever the routes; an override the configuration does not have is `no-such-pool`, and one that does not fit is `pool-not-for-client`.
5. The answer depends on the client's list, the configuration and the question, and on nothing else: not the caller, not the time.

## Shadowing

A route is **shadowed** when an earlier route of the same list matches every project it matches, so it can never be a first match. With exact and prefix patterns that is exactly:

1. an earlier exact pattern equal to it;
2. an earlier prefix pattern whose stem starts it (for an exact pattern), or starts its stem (for a prefix pattern).

An earlier exact pattern never shadows a later prefix pattern: `acme/api` before `acme/*` leaves `acme/web` to the second.

## Checking a list

The owner stores a client's whole list at once: its routes, in order, and its default pool. Each pattern is trimmed and lowercased first. The list is refused, and nothing is stored, when any of these holds; every one that holds is named, with its position (or the default), so that one answer lists them all:

| `reason` | When |
| --- | --- |
| `not-a-pattern` | A pattern breaks the rules of a project pattern. |
| `no-such-pool` | A route's pool, or the default pool, is not one the configuration has. |
| `pool-not-for-client` | A route's pool, or the default pool, does not speak the client's protocol. |
| `same-pattern` | A pattern equal to an earlier one's. |
| `shadowed` | An earlier prefix pattern shadows it (an equal one is `same-pattern`); the refusal names the earlier route's position, the first that shadows it. |

The refusals are in order of position, the default pool's last, and a route's own in the order of the table. A route whose pattern is not one is not compared with the others, and a route is compared with every earlier route whose pattern is one, refused or not. A list may be empty, and may have no default pool. A stored list's revision is the one it was stored from, plus one.

## Keeping them

Two tables in the hub store, made by the step `routes/0001-routes` of the `routes` module, listed in `hub.ts`'s `storeSteps` after the quota module's:

`route_lists`: one row per routed client whose list was ever stored.

| Column | Type | Holds |
| --- | --- | --- |
| `client` | `TEXT PRIMARY KEY` | `claude-code` or `codex`. |
| `default_pool` | `TEXT` | The default pool's id, or null. |
| `revision` | `INTEGER NOT NULL` | 1 at the first change, one more at each. |
| `changed_at` | `TEXT NOT NULL` | An ISO 8601 instant, UTC, with milliseconds. |

`routes`:

| Column | Type | Holds |
| --- | --- | --- |
| `client` | `TEXT NOT NULL REFERENCES route_lists (client)` | |
| `position` | `INTEGER NOT NULL` | From 1. |
| `pattern` | `TEXT NOT NULL` | Lowercased. |
| `pool` | `TEXT NOT NULL` | A pool's id, as it was when stored. |

`PRIMARY KEY (client, position)`, and `UNIQUE (client, pattern)`.

A change is one transaction: it updates `route_lists` where the client's revision is the one the change was read from (or inserts the row when the change is from revision 0), and only when that wrote a row, replaces the client's routes. A change whose revision is not the stored one writes nothing and is refused `routes-changed`. So of two changes from one revision, the store decides which is kept, not a check made before the write.

At start the hub reads every list and writes one warning line for each route and default pool that names a pool that does not fit its client: `Route <position> of <client> (<pattern>) names the pool <pool>, which <is not in the configuration | does not speak <protocol>>; its projects' launches stop until the route is changed.` for a route, and `The default pool of <client> is <pool>, which <…>; launches no route matches stop until it is changed.` for a default pool, `<protocol>` being the client's. It starts all the same, and when the store cannot be read then, it says so in one warning and starts.

## The endpoints

A `routes` group, owned by the `routes` module, with the conventions and errors of `docs/specs/api/spec.md`.

| Method and path | Who may call | Body | Answer | Errors |
| --- | --- | --- | --- | --- |
| `GET /api/routes` | a reader key, or the owner | | `{ clients: RouteList[] }` | `hub-store-unavailable` 503 |
| `PUT /api/routes/{client}` | the owner | `{ revision, routes: [{ pattern, pool }], defaultPool }` | `RouteList` | `routes-refused` 400, `routes-changed` 409, `hub-store-unavailable` 503 |
| `GET /api/route?client=…&project=…&pool=…` | any hub key, or the owner | | `RouteAnswer` | `no-route` 404, `route-pool-gone` 409, `no-such-pool` 404, `pool-not-for-client` 400, `hub-store-unavailable` 503 |

`{client}` and `client` are a routed client; anything else does not decode (400). `project` is required, trimmed, and 1 to 200 code points once trimmed; `pool` is optional (an override). `PUT` takes 0 to 200 routes and `revision` an integer from 0; a pattern over 200 code points, or a pool id (a route's, the default's or an override) empty or over 200, does not decode.

`RouteList` is `{ client, routes: [{ position, pattern, pool, fits }], defaultPool: { pool, fits } | null, revision, changedAt }`, `fits` a boolean (false for a pool gone or of another protocol since it was stored), `changedAt` null for a list never stored. `GET /api/routes` answers both routed clients, `claude-code` then `codex`, a list never stored as empty with revision 0.

`RouteAnswer` is:

```json
{
  "client": "claude-code",
  "project": "acme/api",
  "pool": { "id": "work", "kind": "subscription", "protocol": "anthropic-messages", "provider": "anthropic" },
  "by": "route",
  "route": { "position": 1, "pattern": "acme/*" },
  "defaultPool": "personal"
}
```

`by` is `route`, `default` or `override`; `route` is null unless `by` is `route`; `defaultPool` is the client's default pool's id, or null, whatever answered, so that a machine whose configuration names no own pool learns it (`docs/specs/cli/spec.md`). `project` is the project as asked, trimmed.

| `type` | Status | Title |
| --- | --- | --- |
| `urn:cota:no-route` | 404 | No route matches, and the client has no default pool. |
| `urn:cota:route-pool-gone` | 409 | The route names a pool this client cannot bill. |
| `urn:cota:pool-not-for-client` | 400 | That pool does not speak this client's protocol. |
| `urn:cota:routes-refused` | 400 | The routes were not stored. |
| `urn:cota:routes-changed` | 409 | The routes changed since they were read. |

`no-such-pool` is the pools group's, `{ "type": "urn:cota:no-such-pool", "status": 404, "title": "The hub has no such pool.", "detail": "The hub has no pool \"nowhere\"." }`. `route-pool-gone`'s detail names the position (or the default), the pattern and the pool: `Route 1 of claude-code (acme/*) names the pool work, which is not in the configuration.`, `… which does not speak anthropic-messages.`, or `The default pool of claude-code names the pool work, which …`. `routes-refused` carries `refusals: [{ position, reason, shadowedBy }]` beside its detail, `position` null for the default pool and `shadowedBy` a position for `shadowed`, null otherwise, in the order of "Checking a list"; its detail says the same in words, for a reader of the problem alone:

```json
{
  "type": "urn:cota:routes-refused", "status": 400, "title": "The routes were not stored.",
  "detail": "The routes of claude-code were not stored: route 2: shadowed by route 1; route 3: no such pool; the default pool: the pool does not speak the client's protocol.",
  "refusals": [
    { "position": 2, "reason": "shadowed", "shadowedBy": 1 },
    { "position": 3, "reason": "no-such-pool", "shadowedBy": null },
    { "position": null, "reason": "pool-not-for-client", "shadowedBy": null }
  ]
}
```

`routes-changed`'s detail is `The routes of claude-code changed since revision 3; read them again.`, `no-route`'s `No route of codex matches the project "acme/api", and codex has no default pool.`, and `pool-not-for-client`'s `The pool claude speaks anthropic-messages, and codex speaks chatgpt-codex.`, or, for an observed pool, `The pool gemini is an observed pool, which speaks no protocol, and codex speaks chatgpt-codex.`

## Settings → Routes

The dashboard's fourth part of Settings, `/settings/routes`, lists and changes each routed client's routes and asks which pool a project bills; `docs/specs/dashboard/spec.md` (Settings, and laws V43 to V46) holds what it shows and what it decides for itself. Whether a list is accepted, and which pool a project bills, is only ever the hub's answer.

## Other specs

- **`docs/specs/api/spec.md`** lists the `routes` group and its problems.
- **`docs/specs/sign-in/spec.md`**: the table of who may call what has `GET /api/route` among the endpoints any hub key may call, `GET /api/routes` among the reader's, and `PUT /api/routes/{client}` among the owner's, and I2 names the three a spending hub key may call. `api.contract.test.ts`'s `access` holds the three lines.
- **`docs/specs/hub-store/spec.md`** lists the two tables and the step.
- **`docs/specs/relay/spec.md`** says that routes are answered to launches and the relay does not read them.
- **`docs/specs/dashboard/spec.md`** holds Settings → Routes.

## Laws

| Id | Law | Held by |
| --- | --- | --- |
| N1 | **Matching is total and deterministic.** For every list and project, matching gives exactly one of a route, the default pool or no route, and the same one every time. | property |
| N2 | **The first match wins.** The route answered matches the project, and no route before it does. | property |
| N3 | **The default only when nothing matches.** The default pool is answered exactly when no route matches and the client has one, and no route exactly when it has neither. | property |
| N4 | **Case never matters.** A project gives the same answer as the same project lowercased. | property |
| N5 | **Shadowing is exact.** A route is refused as shadowed, or as the same pattern, exactly when an earlier route of its list matches every project it matches. | property |
| N6 | **Every stored route can win.** In every list the hub stores, each route is the first match of some project. | property |
| N7 | **Only fitting pools are stored.** A list is stored only when each of its routes' pools, and its default pool, fits the client at that moment. | property |
| N8 | **A route is never skipped.** When the route or default pool that matching picks does not fit the client, the answer is `route-pool-gone`, never another pool. | property |
| N9 | **An override names its pool.** With an override that fits the client, the answer is that pool, whatever the client's list. | property |
| N10 | **One change per revision.** Of changes sent from the same revision, one at a time or together, exactly one is stored, and every stored list is exactly the routes and default pool of one change. | property |
| N11 | **Routes open nothing.** For any lists stored, every request to a pool is admitted or rejected as it would be with none. | contract |

N1 to N4, N8 and N9 run over generated lists and projects: patterns and projects drawn from a small alphabet (`a`, `b`, `/`, `-` and an uppercase `A`) so that prefixes, equal patterns and near misses are common, lists of up to 12 routes with and without a default pool, configurations in which some routes' pools are gone, of another protocol or observed, and overrides that fit, do not fit and do not exist. Each answer is compared with the one worked out by reading the list in order with this spec's matching rule. N5 generates lists whose patterns are sometimes not patterns, and compares each refusal as shadowed or as the same pattern with a search over every project of the alphabet, lowercased (case is N4's), and one character no pattern holds (`z`), up to two characters longer than the longest pattern, which is enough for patterns that are exact or prefixes (the extra character stands for every character the patterns do not name); N6 builds lists by adding generated routes one at a time while the check accepts them, and asks the same search, for each route of the list, for a project it is the first match of. N7 runs `ChangeRoutes` over generated configurations and lists, and checks every list stored against the configuration it was stored under. N10 runs `ChangeRoutes` over generated sequences of changes, some sent together, some from the current revision and some from a stale one, over the in-memory store and over SQLite in a temporary file, and compares the stored lists with the changes that were answered as stored. N11 stores generated lists for both clients through the API of a whole hub, and sends a request to every pool of the harness's configuration and one it lacks, from every kind of caller (none, an unknown key, a keyed, a subscription and a reader key, and a hub key as a bearer token); every answer, its status and the hub's error, is the one the same hub gave before any list was stored, which is what admission (`docs/specs/admission/spec.md`, A1 to A5) decides.

## Not built, on purpose

- **Routes for OpenCode and Pi.** They choose a pool by the model the person picks (ADR-0023).
- **Patterns beyond exact and prefix**: no `*` inside a pattern, no character classes, no negation, no regular expressions.
- **The whole list for a machine.** A spending hub key gets one answer per question, never the list.
- **Routes per machine or per hub key.** A machine's own pool is the machine's (`docs/specs/cli/spec.md`).
- **The relay reading routes.** The pool stays in the path (ADR-0006); a route chooses, it does not enforce.
- **Load balancing.** A route names one pool; when a pool becomes a group of subscriptions, the hub shares its requests (ADR-0023).
- **Changing one route at a time.** A client's list is replaced whole, so its order is never half changed.
