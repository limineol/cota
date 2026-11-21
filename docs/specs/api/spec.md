---
status: active
scope: apps/hub
owner: limineol
last_verified: 2026-11-19
review_by: 2027-02-18
supersedes: []
code:
  - apps/hub/src/api.ts
  - apps/hub/openapi.json
  - apps/hub/src/hub.ts
  - apps/hub/src/shared/01-presentation
  - apps/hub/src/modules/sign-in/01-presentation
  - apps/hub/src/modules/request-log/01-presentation
  - apps/hub/src/modules/request-log/02-application/queries
  - apps/hub/src/modules/request-log/02-application/commands/report-session-titles.command.ts
  - apps/hub/src/modules/request-log/03-domain/traffic.ts
  - apps/hub/src/modules/display-names/01-presentation
  - apps/hub/src/modules/quota/01-presentation
  - apps/hub/src/modules/admission/01-presentation
  - apps/hub/src/modules/routes/01-presentation
---

# API

The hub's HTTP API: what the dashboard (Milestone 3) and the owner's agents read the request log through. ADR-0011 gives its form, ADR-0012 who may call it. The definition in `apps/hub/src/api.ts` and the committed `apps/hub/openapi.json` are the contract, and this spec says what they must say.

**What is built.** Every endpoint this spec lists: the conventions, the errors, the filters, the `sign-in` and `traffic` groups, the `sessions` group (`GET /api/sessions` with `q`, `GET /api/sessions/{session}` and `PUT /api/session-titles`), the `requests`, `search`, `sql` and `display-names` groups, `GET /api/openapi.json`, the `pools` group (`GET /api/pools` and a pool's quota login, whose behaviour is `docs/specs/quota-sources/spec.md`, `docs/specs/quota-readers/spec.md` and `docs/specs/quota-logins/spec.md`), the `machine` group (`GET /api/machine`), the `routes` group (`GET /api/routes`, `PUT /api/routes/{client}` and `GET /api/route`), the limits, and the laws H1 to H9.

Sessions, transcripts and titles are `docs/specs/sessions/spec.md`; search `docs/specs/search/spec.md`; SQL `docs/specs/sql/spec.md`; display names `docs/specs/display-names/spec.md`; signing in, setup and who may call what `docs/specs/sign-in/spec.md`. This spec lists every endpoint with its parameters, its answer and its errors, and the rules they share.

## Conventions

- Every path is under `/api`. Bodies are JSON, and say so: a request with a body whose `content-type` is not `application/json` (parameters such as `charset` aside, in any case), or that has none, is 415 `unsupported-media-type` before anything of it is read (`docs/specs/sign-in/spec.md`, I10). Answers are `application/json`, `204` with no body, or a problem.
- **Times** are ISO 8601 instants in UTC with milliseconds: `2026-11-13T07:31:29.873Z`. A time in a query may be any ISO 8601 instant, an offset included.
- **Tokens and counts** are JSON integers.
- **Money** is a string holding a decimal number of dollars with 12 decimals (`"0.004215000000"`), so no sum is rounded. A price is money too: the dollars a million tokens cost (`GET /api/machine`). Every money field of the request log comes with `unpricedRequests`: how many requests that reported usage have no cost (`docs/specs/cost/spec.md`, C1). A sum is never shown as complete when that count is above zero.
- **Usage** sums are an object `{ input, cacheRead, cacheWriteShort, cacheWriteLong, output, reasoning }`, the request log's classes. Requests whose usage was not reported add nothing to it and are counted in `usageUnreported`.
- **Prompt size** is `input + cacheRead + cacheWriteShort + cacheWriteLong` of one request, or `null` when its usage was not reported.
- **Traffic.** A model listing (`operation` `models`) is a client checking which models exist, not work. Every endpoint below except the inspector, the body and SQL leaves model listings out.
- A field that can be absent is `null`, never missing.
- **Roles.** A request's request role is the field `requestRole`; `role` is always a conversation item's own, as the protocol has it (a hit's, an entry's message's).
- **Characters**, where a text is cut or a length is limited, are Unicode code points. **Text is ordered** by code point, which is the order of its UTF-8 bytes.
- **Percentiles** `{ p50, p95 }` are exact: of `n` values sorted, the `p`-th is the value at index `⌊p·n⌋`, counting from 0 (`quantileExact` in ClickHouse).

## Errors

Every error the API gives is an RFC 9457 problem, `application/problem+json`:

```json
{ "type": "urn:cota:no-such-session", "status": 404, "title": "There is no such session.", "detail": "The request log has no session \"0193…\"." }
```

`type` is what a client switches on; `title` is fixed per type; `detail` describes this case and never holds a hub key, a password, a token or a login. A request whose path, query or body does not decode is `{ "type": "about:blank", "status": 400, "title": "Bad Request", "detail": "…", "errors": [{ "path": ["query", "limit"], "message": "…" }] }` (Effect's `ProblemDetails` middleware).

These can come from any endpoint that reads what they name:

| `type` | Status | When |
| --- | --- | --- |
| `urn:cota:sign-in-required` | 401 | No sign-in and no hub key, or ones the hub does not know |
| `urn:cota:not-allowed` | 403 | The caller is known but may not call this endpoint |
| `urn:cota:cross-site` | 403 | A browser request that changes something came from another site: a signed-in one, signing in (with a password or a passkey), or setting up |
| `urn:cota:unsupported-media-type` | 415 | The request has a body not said to be JSON (Conventions) |
| `urn:cota:body-too-large` | 413 | The request body is over 1 MiB (Limits) |
| `urn:cota:hub-store-unavailable` | 503 | The hub store failed |
| `urn:cota:request-log-unavailable` | 503 | ClickHouse could not be reached, did not answer within the query limit, or failed; or, for a search with a tolerance, the log's words are still being gathered after an upgrade (`docs/specs/search/spec.md`, Tolerance); `detail` says which, and the error code it failed with, never ClickHouse's message |
| `urn:cota:empty-window` | 400 | A reading endpoint's `from` is not before its `to` |
| `urn:cota:stale-cursor` | 400 | A search's `cursor` does not continue a search with the same `q`, `prefix`, `fuzzy`, window and filters, or is not a cursor |

Each endpoint below lists the others it can give. An answer the hub fails to encode is `{ "type": "about:blank", "status": 500, "title": "Internal Server Error" }`, which the `ProblemDetails` middleware declares beside its 400. A path under `/api` that is no endpoint is 404 with no body.

The 401 and 403 problems come from `CallerMiddleware` (`docs/specs/sign-in/spec.md`), which every group declares and the endpoints anyone may call come before, and which decides who the caller is before an endpoint decodes anything. The 415 and the 413 come from `JsonBody`, and the 400 from `ProblemDetails`, which every group declares (`apps/hub/src/shared/01-presentation`); `JsonBody` runs before `CallerMiddleware`, so a body that is not JSON is refused whoever sends it.

## Filters

`overview`, `series`, `breakdown`, `facets`, `errors`, `sessions` and `search` select requests with the same query parameters:

| Parameter | Default | Meaning |
| --- | --- | --- |
| `from` | `to` less 7 days | Requests that started at or after this instant. |
| `to` | now | Requests that started before this instant. `from` must be before `to`. |
| `tz` | `UTC` | An IANA time zone name, for the series' buckets. An offset (`+05:30`) is not a name, and a name the hub does not know is a 400. |
| `pool`, `model`, `client`, `machine`, `project`, `provider`, `hub_key` | none | Repeatable. A request matches when its value is one of those given. `model` is the model asked for. |
| `outcome` | none | Repeatable: `ok`, `error`, `refused`, `cancelled`. |

A repeatable parameter takes at most 50 values of at most 255 characters each. The **window** is `[from, to)`.

The **dimensions** a series, a breakdown or the facets are by: `pool`, `model`, `client`, `machine`, `project`, `provider`, `hub_key`, `outcome`.

## Signing in (the `sign-in` group, the sign-in module)

| Method and path | Body | Answer | Errors |
| --- | --- | --- | --- |
| `GET /api/sign-in` | | `WaysIn` | |
| `POST /api/sign-in` | `{ password }` | 204 and the cookie | `cross-site` 403, `not-set-up` 403, `password-off` 403, `too-many-attempts` 429, `wrong-password` 401 |
| `POST /api/sign-in/passkey/options` | | `PasskeyRequestOptions` | `cross-site` 403, `not-a-passkey-origin` 400, `no-passkeys` 409 |
| `POST /api/sign-in/passkey` | `PasskeySignInResponse` | 204 and the cookie | `cross-site` 403, `passkey-refused` 401 |
| `POST /api/setup` | `{ code, password }` | 204 and the cookie | `cross-site` 403, `already-set-up` 409, `too-many-attempts` 429, `wrong-setup-code` 401 |
| `POST /api/sign-out` | | 204 and the cookie cleared | |
| `GET /api/me` | | `Me` | |
| `GET /api/sign-ins` | | `{ signIns: SignIn[] }` | |
| `DELETE /api/sign-ins/{id}` | | 204 | `no-such-sign-in` 404 |
| `DELETE /api/sign-ins` | | `{ revoked }`, the number of sign-ins ended | |
| `GET /api/owner-password` | | `OwnerPassword` | |
| `PUT /api/owner-password` | `{ current?, password }` | 204 | `password-in-configuration` 409, `too-many-attempts` 429, `wrong-password` 401 |
| `DELETE /api/owner-password` | | 204 | `last-way-in` 409 |
| `POST /api/passkeys/options` | | `PasskeyCreationOptions` | `not-a-passkey-origin` 400 |
| `POST /api/passkeys` | `PasskeyCreationResponse` | `Passkey` | `passkey-not-made` 400, `passkey-exists` 409 |
| `GET /api/passkeys` | | `{ passkeys: Passkey[] }`, newest first | |
| `DELETE /api/passkeys/{id}` | | 204 | `no-such-passkey` 404, `last-way-in` 409 |

Anyone may call `GET /api/sign-in`, `POST /api/sign-in`, `POST /api/setup`, `POST /api/sign-in/passkey/options` and `POST /api/sign-in/passkey`, which need no caller. `GET /api/me` is a reading endpoint: a reader key or the owner may call it. The others are the owner's (`docs/specs/sign-in/spec.md`). A `429` carries `retry-after`. A password is 1 to 1,024 characters to sign in and as `current`, and 12 to 1,024 as the `password` of a setup or a change; a setup's `code` is 1 to 64; a passkey's credential id is 1 to 1,364 characters of base64url. A body that breaks these is the 400 of one that does not decode, and repeats none of them.

`WaysIn` is `{ setUp, password, passkey }`: whether the hub is set up, whether a password signs the owner in, and whether a passkey does.

`Passkey` is `{ id, userAgent, origin, createdAt, lastUsedAt }`: the browser and the origin it was made at, and when it last signed in, or `null`.

`PasskeyCreationOptions` and `PasskeyRequestOptions` are WebAuthn's options as JSON (`PublicKeyCredentialCreationOptionsJSON` and `PublicKeyCredentialRequestOptionsJSON`), which a browser's `PublicKeyCredential.parseCreationOptionsFromJSON` and `parseRequestOptionsFromJSON` take; `PasskeyCreationResponse` and `PasskeySignInResponse` are what its credential's `toJSON()` gives (`docs/specs/sign-in/spec.md`, Passkeys, has every field).

The passkey problems: `password-off` 403 (the owner turned the password off; sign in with a passkey), `not-a-passkey-origin` 400 (the request's `Origin` is not one a browser offers a passkey at; `detail` names it), `no-passkeys` 409, `passkey-not-made` 400, `passkey-exists` 409, `no-such-passkey` 404, `passkey-refused` 401 (one problem whatever failed), `last-way-in` 409.

`Me` is `{ caller: "owner" | "hub-key", hubKey: { name, scope } | null, signIn: { id, createdAt, expiresAt } | null }`.

`SignIn` is `{ id, createdAt, expiresAt, lastUsedAt, userAgent, current }`; `current` is true for the sign-in that made the request.

`OwnerPassword` is `{ source: "configuration" | "hub-store" | "none", setAt }`: where the owner password is kept, and when the stored one was set, or `null`.

## Traffic (the `traffic` group, the request-log module)

Every endpoint of the group is a reading endpoint: a reader key or the owner may call it (`docs/specs/sign-in/spec.md`). Each makes one ClickHouse query. Errors: `empty-window` 400, `request-log-unavailable` 503.

### `GET /api/overview`

The window's totals, the same for the window of equal length just before it, for deltas, and when the request log begins.

| Field | Type | Holds |
| --- | --- | --- |
| `window` | `{ from, to }` | The window. |
| `previous` | `{ from, to }` | `to` is the window's `from`; it is as long as the window. |
| `totals`, `previousTotals` | `Totals` | Over the window, and over `previous`, with the same filters. |
| `firstRequestAt` | time or `null` | When the earliest traffic request in the request log started, whatever the window and the filters; `null` when there is none. |

`Totals`:

| Field | Type | Holds |
| --- | --- | --- |
| `requests` | integer | Traffic requests. |
| `sessions` | integer | Distinct sessions among them. |
| `outcomes` | `{ ok, error, refused, cancelled }` | Requests by outcome. |
| `usage` | usage | Summed by class. |
| `usageUnreported` | integer | Requests whose usage was not reported. |
| `costUsd`, `unpricedRequests` | money, integer | The summed cost, and how many requests with usage have none. |
| `durationMs` | `{ p50, p95 }` or `null` | Of `ok` requests; `null` when there are none. |
| `firstByteMs` | `{ p50, p95 }` or `null` | Of requests that got a first byte; `null` when none did. |

### `GET /api/series`

Traffic over time, by one dimension. Extra parameter: `by`, a dimension (default `pool`).

The **bucket** is the shortest of 5 minutes, 15 minutes, 30 minutes, 1 hour, 3 hours, 6 hours, 12 hours and 1 day whose length is at least a 150th of the window's, and 7 days when none is. A bucket starts where ClickHouse starts it:

- under an hour, at a whole multiple of its length since the Unix epoch, whatever `tz` (in a zone whose offset is not a whole multiple of it, such as Asia/Kathmandu's for 30 minutes, it does not start on the local hour);
- from an hour to 12 hours, where the clock in `tz` reads a whole multiple of its length since midnight; of the two instants the clock reads that time on the day it goes back, the one with the request's own offset;
- a day, at midnight in `tz`, and 7 days at midnight on the Monday.

The **keys** are the 12 values of `by` with the most requests in the selection, ties by value; the rest are summed under the key `null`.

| Field | Type | Holds |
| --- | --- | --- |
| `bucket` | `"5m"`, `"15m"`, `"30m"`, `"1h"`, `"3h"`, `"6h"`, `"12h"`, `"1d"`, `"7d"` | |
| `keys` | `(string or null)[]` | The keys that have points, most requests first, ties by key, `null` last when present. |
| `points` | `Point[]` | One per bucket and key that had requests, by `at` then by the order of `keys`. Empty buckets are left out. |

`Point` is `{ at, key, requests, errors, usage, costUsd, unpricedRequests }`, `at` being the bucket's start and `errors` its requests whose outcome is `error`.

### `GET /api/breakdown`

Traffic by one dimension. Extra parameters: `by` (required), `limit` (1 to 500, default 50).

| Field | Type | Holds |
| --- | --- | --- |
| `rows` | `Row[]` | By `requests`, most first, then by `key`. |
| `distinctKeys` | integer | How many values `by` has in the selection, beyond `limit` included. |

`Row` is `{ key, requests, sessions, errors, usage, costUsd, unpricedRequests, lastAt }`; `key` is the empty string for requests without a value (a missing tag).

### `GET /api/facets`

For every dimension, the values it takes and how many requests have each. A dimension's values are counted under every filter except that dimension's own, so choosing a pool still shows the other pools.

| Field | Type | Holds |
| --- | --- | --- |
| `pool`, `model`, `client`, `machine`, `project`, `provider`, `hub_key`, `outcome` | `{ value, requests }[]` | Non-empty values, most requests first, ties by value, at most 100 each. |

### `GET /api/errors`

Failed requests grouped by cause. When `outcome` is not given it is `error`; a refusal (`refused`) or a hang-up (`cancelled`) is not an error and is grouped only when asked for.

A group is the requests that share `provider`, `model`, `outcome`, `upstreamStatus`, `errorType` and the first 500 characters of `errorMessage`.

| Field | Type | Holds |
| --- | --- | --- |
| `groups` | `Group[]` | The 200 groups whose last request is latest, latest first; of groups whose last requests started at once, the one whose `latestRequest` is greatest first. |
| `requests` | integer | All failed requests selected, in every group. |
| `distinctGroups` | integer | How many groups there are, beyond 200 included. |

`Group` is `{ provider, model, outcome, upstreamStatus, errorType, message, requests, firstAt, lastAt, pools, clients, latestRequest }`; `pools` and `clients` are the distinct values, sorted; `latestRequest` is the id of its latest request (of those that started at once, the greatest id), for the inspector.

## Sessions (the `sessions` group, the request-log module)

### `GET /api/sessions`

The sessions with at least one traffic request in the window that matches the filters. A session's fields are over all its traffic, in and out of the window.

Extra parameters:

| Parameter | Default | Meaning |
| --- | --- | --- |
| `q` | none | A search query (`docs/specs/search/spec.md`): only the sessions with an item that matches, each with its newest such item's snippet. A `q` with no word or more than 20 is a 400. |
| `prefix` | `false` | `true` or `false`: with `q`, a word of the query also matches a word that starts with it (`docs/specs/search/spec.md`, Tolerance). Without `q`, nothing. |
| `fuzzy` | 0 | A number from 0 to 1: with `q`, a word of `n` characters also matches a word within `min(2, round(n × fuzzy))` edits of it. Without `q`, nothing. |
| `sort` | `recent` | `recent` (latest `endedAt` first), `requests`, `tokens` (all usage classes summed) or `cost` (unpriced as nothing), most first. Ties by `id`. |
| `limit` | 50 | 1 to 200. |
| `offset` | 0 | 0 to 10,000. |

| Field | Type | Holds |
| --- | --- | --- |
| `sessions` | `ListedSessionRow[]` | One page, in the order `sort` gives. |
| `total` | integer | How many sessions are selected. |
| `limit`, `offset` | integer | As asked. |

`SessionRow`, and `ListedSessionRow`, which is a `SessionRow` with a `snippet`:

| Field | Type | Holds |
| --- | --- | --- |
| `id` | string | The session id as the request log has it (`request:<id>` for a request that carried none). |
| `startedAt`, `endedAt` | time | When its first and its last traffic request started. |
| `requests`, `errors` | integer | Its traffic requests, and those whose outcome is `error`. |
| `pools`, `projects`, `machines`, `clients`, `providers`, `models` | `string[]` | The distinct non-empty values, sorted. |
| `usage`, `usageUnreported`, `costUsd`, `unpricedRequests` | | Summed over its requests. |
| `title` | `Title` or `null` | `docs/specs/sessions/spec.md`, Titles. |
| `firstPrompt` | string or `null` | Its first prompt, cut to 500 characters. |
| `snippet` | `Snippet` or `null` | `ListedSessionRow` only: with `q`, the snippet of the session's newest matching item (`docs/specs/search/spec.md`); without it, `null`. |

`Title` is `{ text, source: "reported" | "generated", at, machine }`; `machine` is the reporting machine for a reported title and `null` for a generated one, and `at` is when it was reported or generated.

### `GET /api/sessions/{session}`

One session: its requests with their roles, its segments, and the transcript of its last segment. `{session}` is the id, percent-encoded. Model listings are left out, as everywhere but the inspector. Errors: `no-such-session` 404 when no traffic request has it. The query `ReadSession` answers it in five reads of the request log (`docs/specs/request-log/spec.md`, Reading), however long the session.

| Field | Type | Holds |
| --- | --- | --- |
| `session` | `SessionRow` | |
| `requests` | `RequestSummary[]` | Its traffic requests, oldest first: the latest 10,000 when it has more. |
| `requestsCut` | integer | How many older requests were left out (0 almost always). |
| `segments` | `Segment[]` | In order, over its main requests among its latest 10,000 (all of them, almost always). |
| `transcript` | `Transcript` or `null` | Of the last segment's tip; `null` when the session has no main request with a conversation. |

`RequestSummary`:

| Field | Type | Holds |
| --- | --- | --- |
| `id`, `startedAt` | | |
| `requestRole` | `"main"`, `"subagent"`, `"title"`, `"utility"` | Its request role. |
| `segment` | integer or `null` | Its segment's index, for a main request. |
| `operation`, `purpose`, `model`, `servedModel`, `stopReason` | string | As recorded. |
| `outcome`, `upstreamStatus`, `errorType` | | As recorded. |
| `promptSize`, `outputTokens` | integer or `null` | `null` when usage was not reported. |
| `costUsd` | money or `null` | |
| `durationMs`, `firstByteMs` | integer, integer or `null` | |
| `tools` | integer or `null` | How many tool definitions it sent; `null` without a conversation. |
| `divertedFrom`, `follows` | string or `null` | As recorded. |

`Segment` is `{ index, startedBy: "start" | "size" | "compaction", firstRequest, lastRequest, tip, startedAt, endedAt, requests, promptSize }`: `startedBy` says why it began (the session's start, a prompt under half the previous one's, or the client's compaction), `tip` is the request its transcript is read from, and `promptSize` is the tip's.

`Transcript` is `{ request, protocol, entries, cutCharacters }`, rendered as `docs/specs/sessions/spec.md` says, with each text cut at 20,000 characters. An earlier segment's transcript is its tip's, from the inspector.

### `PUT /api/session-titles`

Machines report their sessions' titles. Any known hub key may call it, or the owner (`docs/specs/sign-in/spec.md`). Body: `{ titles: { "<session>": "<title>" } }`, 1 to 1,000 entries; a session id of 1 to 255 characters; a title of any length, which is trimmed and cut to 200 characters. A lone surrogate in a session id or a title (JSON can write one as an escape, `"\ud800"`) is kept as U+FFFD (`docs/specs/request-log/spec.md`, Well-formed text). An empty title clears the session's reported title. The reporting machine is the request's `x-cota-machine` tag, trimmed and cut to 200 characters, or empty without one. Answer: 204. One entry that does not decode rejects the whole body, and nothing is stored. Errors: `request-log-unavailable` 503 when the titles could not be kept.

## Requests (the `requests` group, the request-log module)

Built. The query `InspectRequest` answers the inspector in three reads of the request log, and `RebuildConversation` the body in two; each reads the request's session first and then only that session's rows (`docs/specs/request-log/spec.md`, Reading).

### `GET /api/requests/{id}`

The request inspector: one request, whatever its operation. Errors: `no-such-request` 404, also for an id that is not a UUID version 7.

| Field | Type | Holds |
| --- | --- | --- |
| `request` | `RequestRecord` | Every column of `requests` (`docs/specs/request-log/spec.md`), named in camel case, with `usage` parsed as JSON (or `null` when it was not reported), `rateLimits` and `clientHeaders` as objects, and `promptSize` added. |
| `requestRole` | request role or `null` | Within its session; `null` for a traffic request older than its session's latest 10,000, which the role rules do not read (`docs/specs/sessions/spec.md`, Values). |
| `segment` | integer or `null` | `null` but for a main request among its session's latest 10,000. |
| `params` | JSON object or `null` | The body without its conversation's parts; `null` without a conversation. |
| `tools` | `{ name, description }[]` or `null` | The items of its `tools` part, the description cut to 2,000 characters; either is `null` when the protocol's renderer finds none. Tools a client sends inside its input (Codex's `additional_tools` item) show in `input`, not here. |
| `system`, `input`, `output` | `Entry[]` or `null` | Its conversation's parts rendered (`docs/specs/sessions/spec.md`), each text cut at 100,000 characters. |
| `cutCharacters` | integer | How many characters were cut, over all entries. |
| `followedBy` | id or `null` | The request sent again after this one was refused, if any. |

### `GET /api/requests/{id}/body`

The request's body as the hub forwarded it, rebuilt from the request log (`RebuildConversation`; the request log spec's L1: the same JSON value, not the same bytes); for an imported request, whose `protocol` is a source form, its conversation as the import source logged it, not what the client sent (ADR-0025), which the inspector says beside it. Answer: the JSON object. Errors: `no-such-request` 404, also for an id that is not one; `no-conversation` 404 for a request whose body was not stored. When the request log fails while rebuilding, the 503's `detail` is `ClickHouse could not be reached, or failed the query.`: the repository that stores and rebuilds conversations does not say which (`RequestsRepositoryFailed`).

## Search (the `search` group, the request-log module)

### `GET /api/search`

The conversation items whose text holds every word of a search query, or with a tolerance a word near each, newest first, a page at a time. The filters select sessions, as the sessions list does. The query `SearchItems` answers it in two reads of the request log. Errors: `empty-window` 400, `stale-cursor` 400, `request-log-unavailable` 503 (with a tolerance, also while the log's words are gathered once after an upgrade).

Extra parameters:

| Parameter | Default | Meaning |
| --- | --- | --- |
| `q` | required | A search query: 1 to 200 characters holding 1 to 20 words. One with no word or more than 20 is a 400. |
| `prefix` | `false` | `true` or `false`: a word of the query also matches a word that starts with it. |
| `fuzzy` | 0 | A number from 0 to 1: a word of `n` characters (code points) also matches a word within `min(2, round(n × fuzzy))` edits of it, halves rounded up. Outside 0 to 1, or not a number, is a 400. |
| `limit` | 20 | 1 to 100 hits a page. |
| `cursor` | none | The `next` of the page before, at most 2,264 characters (the longest the hub makes; a cursor is ASCII, so as many bytes), given with the same `q`, `prefix`, `fuzzy`, window and filters. |

Answer `{ hits: Hit[], next: string | null }`. A `Hit` is `{ session, item, request, part, role, at, snippet }`, and a `Snippet` `{ text, start }`. The fields, the order, the cursor, the snippet and the tolerance, with the bounded widening of each word, are `docs/specs/search/spec.md`. Without `prefix` and `fuzzy`, or with `prefix=false` and `fuzzy=0`, search is exactly the exact search, its cursors included.

## SQL (the `sql` group, the request-log module)

Both endpoints are reading endpoints: a reader key or the owner may call them, `POST /api/sql` included (`docs/specs/sign-in/spec.md`). They run as the SQL user, never the hub's own ClickHouse user, and `POST /api/sql` is limited by the SQL console's own limits, which the owner sets in `[sql]` (by default 30 seconds, 5,000 rows or 16 MiB), not the 30-second limit below.

| Method and path | Body | Answer | Errors |
| --- | --- | --- | --- |
| `POST /api/sql` | `{ sql }` | `{ columns, rows, truncated, elapsedMs }` | `sql-unavailable` 503, `query-failed` 400, `format-not-allowed` 400, `query-too-long` 400 |
| `GET /api/schema` | | `{ database, tables }` | `sql-unavailable` 503 |

`Column` is `{ name, type }`; `rows` are arrays of JSON values in the columns' order. `tables` are `{ name, engine, rows, bytes, comment, columns }`, with `rows` and `bytes` `null` for a view, and their `columns` `{ name, type, comment }`. The rest is `docs/specs/sql/spec.md`.

## Display names (the `display-names` group, the display-names module)

`GET` is a reading endpoint; `PUT` and `DELETE` are the owner's alone (`docs/specs/sign-in/spec.md`).

| Method and path | Body | Answer | Errors |
| --- | --- | --- | --- |
| `GET /api/display-names` | | `{ names: DisplayName[] }` | |
| `PUT /api/display-names/{kind}/{key}` | `{ name }` | `DisplayName` | |
| `DELETE /api/display-names/{kind}/{key}` | | 204 | `no-such-display-name` 404 |

A `DisplayName` is `{ kind, key, name, source }`. `kind` is `pool`, `model`, `client`, `machine` or `project`; `key`, percent-decoded once from the path, is 1 to 255 characters; `name` is 1 to 80 characters once trimmed, and a lone surrogate in it is kept as U+FFFD. A path or body outside those is a 400. The rest, the built-in names and what a name equal to its key does, is `docs/specs/display-names/spec.md`; its laws are D1 to D4.

## Pools (the `pools` group, the quota module)

`GET /api/pools` is a reading endpoint; `PUT` and `DELETE` of a quota login are the owner's alone (`docs/specs/sign-in/spec.md`).

| Method and path | Body | Answer | Errors |
| --- | --- | --- | --- |
| `GET /api/pools` | | `{ pools: Pool[] }` | `request-log-unavailable` 503, `hub-store-unavailable` 503 |
| `PUT /api/pools/{pool}/quota-login` | a quota login | `QuotaLogin` | `no-such-pool` 404, `quota-login-not-taken` 400, `hub-store-unavailable` 503 |
| `DELETE /api/pools/{pool}/quota-login` | | 204 | `no-such-pool` 404, `no-quota-login` 404, `hub-store-unavailable` 503 |

`{pool}` is a pool's id, percent-decoded once.

| `type` | Status | Title |
| --- | --- | --- |
| `urn:cota:no-such-pool` | 404 | The hub has no such pool. |
| `urn:cota:quota-login-not-taken` | 400 | This pool does not take that quota login. |
| `urn:cota:no-quota-login` | 404 | The pool has no quota login. |

### `GET /api/pools`

Every pool of the configuration, in order of id, with its quota windows (W7). Asking starts a read of each pool whose quota reading is due and waits for them (`docs/specs/quota-readers/spec.md`, When the hub reads); which windows a pool has, and from which source, is `docs/specs/quota-sources/spec.md`. Every standing is worked out at the answer's time (in the example below, 10:03:00). A pool with nothing to read has `windows` empty.

`Pool`:

| Field | Type | Holds |
| --- | --- | --- |
| `id` | string | The pool's id. |
| `kind` | `"subscription"` or `"keyed"` | |
| `protocol` | `"anthropic-messages"`, `"chatgpt-codex"` or `"openai-chat"` | |
| `provider` | string | The pool's provider, from the configuration. |
| `plan` | string or `null` | The plan's name (`docs/specs/quota-sources/spec.md`, The plan). |
| `windows` | `Window[]` | The plan's first, then by scope; within a scope, shortest first. |
| `observedAt` | time or `null` | The latest `observedAt` of its windows; `null` when it has none. |
| `reading` | `Reading` or `null` | The state of its quota reading; `null` for a pool the hub does not read: one without a quota reader, or whose reader lacks its held key or a quota login that is not expired. |
| `quotaLogin` | `QuotaLogin` or `null` | `null` for a pool that takes no quota login (`docs/specs/quota-logins/spec.md`). |

`Window`:

| Field | Type | Holds |
| --- | --- | --- |
| `lengthMs` | integer | Its length. |
| `scope` | string or `null` | `null` for the whole plan; else the provider's name for the model or feature it covers. |
| `source` | `"reading"` or `"headers"` | |
| `usedPercent` | number | From 0 to 100. |
| `startsAt`, `resetsAt` | time or `null` | Its span; both `null` when the provider gave no reset. |
| `observedAt` | time | When the quota reading was taken, or when the request whose answer carried the headers started. |
| `standing` | `Standing` or `null` | `null` when it has no span (unplaced, `docs/specs/quota-windows/spec.md`). |

`Standing` is `{ elapsed, resetsInMs, pace, points, emptiesInMs }`: `elapsed`, the fraction of the window's span that has passed, a number from 0 to 1 and not a duration; `resetsInMs` an integer; `pace` one of `"full"`, `"on-pace"`, `"in-reserve"`, `"ahead-of-pace"`; `points`, the lead in percentage points, a number for `in-reserve` and `ahead-of-pace` and `null` otherwise; `emptiesInMs`, an integer for `ahead-of-pace` when the window's span has started and `null` otherwise. The durations, `resetsInMs` and `emptiesInMs`, are whole milliseconds, rounded down.

`Reading` is `{ at, failure, nextAttemptAt }`: `at`, when the last good quota reading ended, or `null` when there has been none since the hub started or the pool's state was forgotten; `failure`, the latest failure since it, or `null`; `nextAttemptAt`, when the next ask may read the pool, or `null` when it has never been read. A `Failure` is `{ at, kind, status, detail }`: `kind` one of `"unreachable"`, `"refused"`, `"rate-limited"`, `"failed"`, `"unreadable"` (an expired quota login is not a failure: the pool is no longer read, and its `quotaLogin` says `expired`); `status` the provider's HTTP status, or `null`; `detail` the hub's sentence, which never holds a token, a key or the provider's body.

`QuotaLogin` is `{ provider, state, givenAt, refreshedAt, endsAt, expiredAt }` (`docs/specs/quota-logins/spec.md`, Its state in the quota API). No field of any of these ever holds a token.

```json
{ "pools": [{
  "id": "personal", "kind": "subscription", "protocol": "anthropic-messages", "provider": "anthropic",
  "plan": "Max 20x", "observedAt": "2026-11-13T10:02:11.000Z",
  "windows": [
    { "lengthMs": 18000000, "scope": null, "source": "headers", "usedPercent": 41, "startsAt": "2026-11-13T08:00:00.000Z", "resetsAt": "2026-11-13T13:00:00.000Z", "observedAt": "2026-11-13T10:02:11.000Z",
      "standing": { "elapsed": 0.41, "resetsInMs": 10620000, "pace": "on-pace", "points": null, "emptiesInMs": null } },
    { "lengthMs": 604800000, "scope": null, "source": "reading", "usedPercent": 12, "startsAt": "2026-11-10T00:00:00.000Z", "resetsAt": "2026-11-17T00:00:00.000Z", "observedAt": "2026-11-13T10:01:30.000Z",
      "standing": { "elapsed": 0.4884, "resetsInMs": 309420000, "pace": "in-reserve", "points": 36.84, "emptiesInMs": null } }
  ],
  "reading": { "at": "2026-11-13T10:01:30.000Z", "failure": null, "nextAttemptAt": "2026-11-13T10:03:30.000Z" },
  "quotaLogin": { "provider": "anthropic", "state": "active", "givenAt": "2026-11-01T09:00:00.000Z", "refreshedAt": "2026-11-13T07:12:00.000Z", "endsAt": "2026-11-13T15:12:00.000Z", "expiredAt": null }
}] }
```

### `PUT /api/pools/{pool}/quota-login` and `DELETE`

`PUT` takes `{ provider: "anthropic", accessToken, refreshToken, endsAt, subscriptionType, rateLimitTier }` or `{ provider: "chatgpt", accessToken, refreshToken, accountId }`, replaces the pool's quota login, and answers its `QuotaLogin`. `DELETE` forgets it. The values' bounds, what each does and what each refuses are `docs/specs/quota-logins/spec.md`, Giving and forgetting.

### Pool cards

The overview's pool cards need no endpoint of their own. A card is a pool of `GET /api/pools`, with its quota, beside its traffic, which the traffic group already answers with `GET /api/breakdown?by=pool` (no other filter; a pool without traffic in a window has no row in it):

- today's requests, tokens and cost: with `from` the start of today in the owner's zone;
- the last 30 days' requests, tokens and cost, and the last request (`lastAt`): with `from` 30 days before now;
- active sessions: `sessions`, with `from` 15 minutes before now. A request that carried no session id is a session of its own (`docs/specs/sessions/spec.md`), where the prototype did not count it.

## Machine (the `machine` group, the admission module)

`GET /api/machine` answers what the caller is and the pools it opens, as a machine needs them to join and to configure its clients (`docs/specs/cli/spec.md`). Any known hub key may call it, or the owner (`docs/specs/sign-in/spec.md`). It is the admission module's query `ReadMachine`, whose laws are A7 and A8 (`docs/specs/admission/spec.md`, The machine).

| Method and path | Body | Answer | Errors |
| --- | --- | --- | --- |
| `GET /api/machine` | | `Machine` | `hub-store-unavailable` 503 |

```json
{
  "hubKey": { "name": "fleet", "scope": "keyed" },
  "pools": [{
    "id": "zai", "kind": "keyed", "protocol": "openai-chat", "provider": "zai", "displayName": "Z.ai",
    "models": [{
      "id": "glm-5", "name": "GLM-5", "contextTokens": 204800, "outputTokens": 131072, "imageInput": false,
      "price": {
        "base": { "input": "1.000000000000", "cacheRead": "0.200000000000", "cacheWriteShort": "0.000000000000", "cacheWriteLong": "0.000000000000", "output": "3.200000000000" },
        "tiers": []
      }
    }]
  }]
}
```

`Machine`:

| Field | Type | Holds |
| --- | --- | --- |
| `hubKey` | `{ name, scope }` or `null` | The hub key the caller presented, its name and scope (`subscription`, `keyed` or `reader`); `null` for the owner. |
| `pools` | `MachinePool[]` | The pools the caller opens, in order of id: every pool for the owner, the pools whose kind is its scope for a hub key, so none for a reader key. |

`MachinePool`:

| Field | Type | Holds |
| --- | --- | --- |
| `id`, `kind`, `protocol`, `provider` | | As `GET /api/pools` has them. |
| `displayName` | string or `null` | The owner's name for the pool (`docs/specs/display-names/spec.md`); pools have no built-in names. |
| `models` | `MachineModel[]` | For a keyed pool, the models of its price list and of its own prices (ADR-0009), in order of id; empty for a subscription pool, whose client lists its own. |

`MachineModel`:

| Field | Type | Holds |
| --- | --- | --- |
| `id` | string | The model's id, as the price list or the pool's own prices name it. |
| `name` | string | The model's display name: the owner's, else the built-in one, else its id. |
| `contextTokens`, `outputTokens` | integer or `null` | Its context and output limits in tokens, from the price list (`docs/specs/protocols/spec.md`, Prices); `null` where the list does not know them, as for a model only the pool's own prices name. |
| `imageInput` | boolean or `null` | Whether it takes image input, from the price list; `null` where it does not know. |
| `price` | `ModelPrice` | The pool's own price for the model when it has one, else its list's: `{ base, tiers }`, each tier `{ threshold, rates }`, its rates applying to a prompt over `threshold` tokens (`docs/specs/cost/spec.md`). Each rates object is `{ input, cacheRead, cacheWriteShort, cacheWriteLong, output }`, money per million tokens, with a missing cache rate filled in as a cost fills it in (`docs/specs/cost/spec.md`, rule 4), so it is the price the request log costs that model's requests at. A service tier's price is not answered. |

It holds no secret: no hub key's secret, no held key and no kept login. It has no errors of its own; it reads the display names from the hub store, so it can give `hub-store-unavailable`.

## Routes (the `routes` group, the routes module)

Each routed client's list of routes and its default pool, and which pool one launch bills (`docs/specs/routes/spec.md`, which holds every value, rule, answer and problem, and the laws N1 to N11). `GET /api/routes` is a reading endpoint, `PUT /api/routes/{client}` the owner's alone, and `GET /api/route` any known hub key's, or the owner's (`docs/specs/sign-in/spec.md`): a machine asks it at each launch, and its answer never depends on the key that asked.

| Method and path | Body | Answer | Errors |
| --- | --- | --- | --- |
| `GET /api/routes` | | `{ clients: RouteList[] }` | `hub-store-unavailable` 503 |
| `PUT /api/routes/{client}` | `{ revision, routes: [{ pattern, pool }], defaultPool }` | `RouteList` | `routes-refused` 400, `routes-changed` 409, `hub-store-unavailable` 503 |
| `GET /api/route?client=…&project=…&pool=…` | | `RouteAnswer` | `no-route` 404, `route-pool-gone` 409, `no-such-pool` 404, `pool-not-for-client` 400, `hub-store-unavailable` 503 |

| `type` | Status | Title |
| --- | --- | --- |
| `urn:cota:no-route` | 404 | No route matches, and the client has no default pool. |
| `urn:cota:route-pool-gone` | 409 | The route names a pool this client cannot bill. |
| `urn:cota:pool-not-for-client` | 400 | That pool does not speak this client's protocol. |
| `urn:cota:routes-refused` | 400 | The routes were not stored. |
| `urn:cota:routes-changed` | 409 | The routes changed since they were read. |

`no-such-pool` is the pools group's problem. `routes-refused` is the one problem of the API with a field of its own beside `detail`: `refusals`, each `{ position, reason, shadowedBy }`.

## The definition

`GET /api/openapi.json` answers the OpenAPI document of the definition, the same as the committed `apps/hub/openapi.json`. It needs no caller.

## Limits

| Limit | Value | Over it |
| --- | --- | --- |
| A request body | 1 MiB | 413 `body-too-large`, and the connection is closed |
| One ClickHouse query for an endpoint | 30 seconds, stopped by ClickHouse; a query the hub stops waiting for is cancelled | 503 `request-log-unavailable` |
| Requests listed for one session | 10,000 | the oldest left out, counted in `requestsCut` |
| Requests the role rules read, for one session | 10,000, its latest | the older ones have no role or segment, and give no title or first prompt |
| Sessions offset | 10,000 | 400 |

## Laws

| Id | Law | Held by |
| --- | --- | --- |
| H1 | **Only declared problems.** Every answer of an endpoint is its declared success or a problem whose `type` the endpoint declares, or the 400 of a request that did not decode, and never a 500: the 500 every endpoint declares, of an answer the hub fails to encode, is a bug. | contract |
| H2 | **Answers decode.** Every success decodes with the endpoint's success Schema. | contract |
| H3 | **The contract is reviewed.** The committed `apps/hub/openapi.json` is exactly `OpenApi.fromApi` of the definition. | contract |
| H4 | **Model listings are not traffic.** Adding model-listing requests to any request log changes no answer of overview, series, breakdown, facets, errors, the sessions list or search. | property |
| H5 | **Totals agree.** For any request log and filters, the overview's requests, errors, usage, cost and unpriced count equal their sums over a breakdown by any dimension with no limit, and over the series' points. | property, clickhouse |
| H6 | **The previous window adjoins.** `previous.to` is `window.from`, and both are equally long. | property |
| H7 | **Facets are filters.** For any request log and filters, each dimension's facet is the non-empty values the overview counts requests for with that value as its dimension's only filter, each with that count. | property, clickhouse |
| H8 | **Pages partition.** For any sort, the pages of the sessions list, read by `offset` from 0 in steps of `limit`, are disjoint, keep the order, and together are `total` sessions. | property |
| H9 | **ClickHouse agrees with the fake.** For generated request logs written by `RecordRequest`, every reading query answers the same over the ClickHouse reader as over the in-memory one. | clickhouse |

The contract tier (ADR-0011) runs a whole hub through the harness (`apps/hub/src/shared/05-tests/harness.ts`), with a scratch hub store in a temporary file and the request log's fake, and calls it over HTTP: `*.contract.test.ts`. One test (`apps/hub/src/api.contract.test.ts`) walks every endpoint of the definition with every kind of caller and with bodies that do and do not decode, and checks each answer's status and body against the endpoint's declared successes and problems, refusing any 500 (H1, H2); the group's own tests call it through the typed client, which decodes every answer (H2), and assert literal answers. H3 compares the committed document, and the one the hub serves, with the definition's; `bun run openapi` rewrites the committed one.

H4 to H7 run the reading queries over generated request logs on the request log's in-memory reader, whose answers are plain code (`docs/specs/request-log/spec.md`, Reading): the logs (`apps/hub/src/modules/request-log/05-tests/traffic.ts`) span changes of clock in three zones, with every outcome, model listings, empty tags and messages past 500 characters. H9 writes such logs through `RecordRequest` to a scratch ClickHouse database and asks both readers the same generated questions, in the time zones whose offsets are whole, half and three-quarter hours; a second test compares every bucket and zone at requests ten minutes apart around each change of clock, and around Berlin's falling back on 25 October, a whole-hour zone's hour lived twice. H5 and H7 run in ClickHouse too, over the whole hub's queries. For the sessions list, H4 and H8 run `ListSessions` over the in-memory reader on generated logs whose requests carry conversations (`05-tests/sessions.ts`), and H9 writes such logs too, and compares, beside the pages of sessions, every session's requests as the role rules read them (with the hub's limit and with one of 3, which cuts), the items of each request's parts (one request asked for again under another session, which gives nothing, and again under its own, which adds the parts), every session's row and its requests' summaries (with a limit that cuts and the hub's), and every request's record as the inspector reads it, with its params and the request sent after it, which the logs' diverted requests give. The session detail and the inspector are contract-tested over literal answers, a diverted request and a model listing among them. For search, H4 runs `SearchItems` over the in-memory reader, reading every page, and H9 compares, beside the rest, a generated search query's first hundred hits, a page of them and the page after it, the sessions it selects with their count and order, each with a generated tolerance, the newest hit of every session for each of thirty search queries with punctuation, mixed case, accents and other scripts and sixteen that are prefixes and near misses of their words, each exact, with `prefix`, at fuzzy 0.2 and with both at 0.5, and the contents snippets are read from (`docs/specs/search/spec.md`, Laws). For the quota sources (`docs/specs/quota-sources/spec.md`), H9 writes logs whose answers carry quota headers in every protocol's names (complete, as recorded, partial, malformed and empty, on refusals and failures too, with and without a login) and compares the latest quota headers of generated pools and names since generated instants. Search and `q` are contract-tested over literal answers, an image, a stale cursor, `prefix` and `fuzzy` (a fuzziness past 1 a 400, a cursor given with another tolerance stale) among them. H9 grows with every reading query the reader gains.

## Not built, on purpose

- **A pool-card endpoint.** A card is `GET /api/pools` beside `GET /api/breakdown?by=pool` (Pool cards).
- **Range presets** (`range=24h`). A client computes `from`.
- **Streaming answers, websockets, pushed updates.** The dashboard polls.
- **Writing to the request log.** Nothing in the API changes a request or an item.
- **A sessions view in ClickHouse for SQL users.** SQL reads the tables (`docs/specs/sql/spec.md`).
- **Pagination by cursor for sessions.** Sorting by an aggregate makes a cursor no cheaper than an offset, and the offset is capped.
