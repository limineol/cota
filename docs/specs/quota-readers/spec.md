---
status: active
scope: apps/hub
owner: limineol
last_verified: 2026-11-14
review_by: 2027-02-13
supersedes: []
code:
  - apps/hub/src/modules/quota/02-application/interfaces/quota-reader.ts
  - apps/hub/src/modules/quota/03-domain/readers.ts
  - apps/hub/src/modules/quota/03-domain/readings.ts
  - apps/hub/src/modules/quota/04-infrastructure/provider-call.ts
  - apps/hub/src/modules/quota/04-infrastructure/readers
---

# Quota readers

A quota reader asks a provider's usage endpoint for a pool's quota windows and plan. This spec says which pool has which reader, what each sends and reads, how its answer becomes windows, and when the hub reads. ADR-0016 gives the reasons. What wins between a quota reading and the other sources is `docs/specs/quota-sources/spec.md`; the quota logins two of the readers use are `docs/specs/quota-logins/spec.md`.

It is the `quota` module: which pool has which reader (`03-domain/readers.ts`); the port `QuotaReader` (`02-application/interfaces/quota-reader.ts`), in the module's terms (a pool and its reader, with the credential, in; a quota reading, a read failure, or the quota login found expired, out); one adapter per provider in `04-infrastructure/readers/` (`anthropic.ts`, `chatgpt.ts`, `zai.ts`, `opencode-go.ts`), each decoding its answer with a Schema, over the one call they share (`usage-endpoint.ts`), whose user agent, time limit, decoding and failures the token endpoints share too (`04-infrastructure/provider-call.ts`), and `readers.ts`, the port's layer over HTTP; the cache and its backoff (`03-domain/readings.ts`), a service of the module's domain that runs a read it is given and keeps its outcome, on Effect's clock; and a fake of the port in `05-tests/fakes/`.


**Every reader's answer shape comes from the prototype's code** (`dashboard/server/limits.ts`, `claude.ts`, `chatgpt.ts`), not from recorded traffic: no usage answer has been recorded, and recording one needs the owner's word first. Each adapter's fixture is constructed, says so in its name or its source, and names the prototype's lines it follows. The Anthropic and ChatGPT endpoints are undocumented: they are the ones the providers' own clients read for their usage screens (the prototype read them "the way CodexBar reads it").

## Which pool has which reader

| Pool | Reader | Credential | Period |
| --- | --- | --- | --- |
| A keyed pool whose provider is `zai` and that holds a key | Z.ai | the held key | 60 seconds |
| A keyed pool whose provider is `opencode-go` and that holds a key | OpenCode Go | the held key | 60 seconds |
| A subscription pool that speaks `anthropic-messages` | Anthropic | its Claude quota login | 120 seconds |
| A subscription pool that speaks `chatgpt-codex` | ChatGPT | its ChatGPT quota login | 120 seconds |
| Any other pool | none | | |

The provider is the pool's `provider` in the configuration, whose default for an `openai-chat` pool is the pool's id (ADR-0009). A pool with a reader is read only while it has its credential: a subscription pool without a quota login, or whose quota login is expired, is not read and has no quota reading.

## What every reader does

- **One `GET`**, with `Accept: application/json`, `User-Agent: cota/<version>` (the `version` of `apps/hub/package.json`) and the credential, abandoned 10 seconds after it was sent. Nothing else is sent: no cookie, no body, no trace header. A redirect is not followed: it is an answer like any other status, since following it could carry the credential to another host.
- **The answer decides the outcome:**

  | Answer | Outcome |
  | --- | --- |
  | 2xx whose body decodes with the reader's Schema and gives at least one window | a quota reading: its windows and plan, taken when the answer ended |
  | 2xx that does not decode, or decodes to no window | failure `unreadable` |
  | 401 | with a quota login: one refresh and one more call (`docs/specs/quota-logins/spec.md`); a 401 again, or with a held key, is failure `refused` |
  | 429 | failure `rate-limited`, with the time its `retry-after` names when it gives one: a whole number of seconds after the answer (`^[0-9]+$`), or an HTTP date in the IMF-fixdate form (`Fri, 13 Nov 2026 10:30:00 GMT`); any other value (`1.5`, `-5`, an ISO instant, an obsolete date form) gives none. A time more than 24 hours after the answer is taken as 24 hours after it, so that one malformed answer cannot stop a pool's reads for longer than a day |
  | any other status | failure `failed`, with the status |
  | no answer within 10 seconds, or no connection | failure `unreachable` |
  | the quota login's refresh was refused | the login becomes expired, the pool's state is forgotten and the pool is no longer read; the quota API says so in the pool's `quotaLogin` (`docs/specs/quota-logins/spec.md`) |

- **A failure's `detail`** is one sentence the hub writes, naming the provider and what happened (`Anthropic's usage endpoint answered 503.`, `Z.ai's usage endpoint could not be reached.`, `Z.ai's usage endpoint did not answer within 10 seconds.`, `Z.ai's usage answer could not be read: data.limits is missing.`), with the path of the first field that did not decode and whether it is missing or malformed (`data.limits[0].percentage is malformed`), or why the answer is not read (`it is not JSON`, `it gives no window`). It never holds the answer's body, a value from it, a header, a token or a key.
- **Decoding.** Each reader decodes only the fields below; any other field is ignored, as is an array entry the reader skips by rule. A field below that is present with another type, or a percentage that is not a finite number, fails the decoding. A percentage is clamped to 0 to 100 once decoded. A window whose length is not above zero, or whose length in milliseconds is above 2^53 − 1 (the largest whole number the hub holds exactly), is skipped by rule, not a failure, as the quota sources spec says of a header's.
- **Duplicates.** When a reading gives two windows with the same scope and length, the first, in the order below, is kept.
- **A plan name** capitalises a provider's id: its first character in upper case, the rest as given (`pro` is `Pro`).

## Z.ai

- **Request**: `GET <origin of the pool's base URL>/api/monitor/usage/quota/limit`, with `Authorization: Bearer <held key>`. For the base URL `https://api.z.ai/api/coding/paas/v4` it is `https://api.z.ai/api/monitor/usage/quota/limit`.
- **Read**: `data.limits`, an array (required), each entry `{ type: string, unit: integer, number: integer, usage?: number | null, currentValue?: number | null, percentage?: number | null, nextResetTime?: integer | null }`; and `data.level`, a string or null, optional. `data` missing, or `limits` not an array, is `unreadable`. Whether Z.ai answers a bad key with a 200 whose body has no `data` is not known; if it does, this rule makes it a failure. An entry is read in two steps: its `unit` first, which must be an integer, and only when the unit is one below, the rest of it; an entry of another unit is skipped unread.
- **Each entry** is one window:
  - **Length**: `number` times the unit `unit` names: `1` a day, `3` an hour, `5` a minute, `6` a week. An entry with another unit is skipped. These codes are the prototype author's reading of the API, not documented.
  - **Used**: `currentValue / usage × 100` when `usage` is above 0 and `currentValue` is a number (the exact counts); else `percentage` (which Z.ai rounds to a whole number); an entry with neither is `unreadable`.
  - **Reset**: `nextResetTime`, Unix **milliseconds**, when above 0; else no span (a window not yet started).
  - **Scope**: `TIME_LIMIT` (the scope's name is the type) for an entry whose `type` is `TIME_LIMIT`, which the prototype showed as "MCP tools"; the plan for any other type.
- **Plan**: `data.level`, capitalised; none when it is missing or empty.
- **Fixture**: constructed from `limits.ts` lines 46 to 66.

## OpenCode Go

- **Request**: `GET <the pool's base URL>/usage`, with `Authorization: Bearer <held key>`. For the base URL `https://opencode.ai/zen/go/v1` it is `https://opencode.ai/zen/go/v1/usage`.
- **Read**: `usage` (required, an object) and in it `rolling`, `weekly` and `monthly`, each optional and null or `{ percent: number, resetsAt: string | null }`, `resetsAt` an ISO 8601 instant.
- **Windows**, all of the plan: `rolling` is 5 hours, `weekly` 7 days, `monthly` 30 days (the prototype's assumption; OpenCode Go does not say). `resetsAt` null gives no span; a string that is not an instant is `unreadable`.
- **Plan**: none.
- **Fixture**: constructed from `limits.ts` lines 68 to 84.

## Anthropic

Undocumented.

- **Request**: `GET https://api.anthropic.com/api/oauth/usage`, with `Authorization: Bearer <the quota login's access token>` and `anthropic-beta: oauth-2025-04-20`.
- **Read**: `five_hour` and `seven_day`, each optional and null or `{ utilization: number, resets_at: string | null }`; and `limits`, optional, null or an array.
  - `utilization` is a **percentage from 0 to 100** here, where the quota headers' utilization is a fraction (`docs/specs/quota-sources/spec.md`).
  - `resets_at` is an ISO 8601 instant; null gives no span.
- **Windows**: `five_hour` is the plan's 5 hours, `seven_day` the plan's 7 days. An entry of `limits` is read when it is an object whose `kind` is `weekly_scoped` and whose `scope.model.display_name` is a non-empty string; it must then have `percent` (a number) and `resets_at` (an instant or null), and is a 7-day window whose scope is that display name ("Claude Opus"). Any other entry is skipped.
- **Plan**: not in the answer. It is named from the quota login's plan facts, captured when the login was made: `subscriptionType`, capitalised (`pro` is `Pro`, `team` is `Team`), and for `max` only, followed by `<n>x` when `rateLimitTier` holds `max_<n>x` (`Max 20x`). A Team seat's tier can say `max_5x`, which is why only `max` takes the multiple. None without a `subscriptionType`. A plan that changed since the login was made shows the old name until a new login is given.
- **Fixture**: constructed from `limits.ts` lines 86 to 114 and `claude.ts` lines 92 to 125.

## ChatGPT

Undocumented: chatgpt.com's internal `backend-api`.

- **Request**: `GET https://chatgpt.com/backend-api/wham/usage`, with `Authorization: Bearer <the quota login's access token>` and `ChatGPT-Account-Id: <its account id>`.
- **Read**: `plan_type`, a string or null, optional; `rate_limit`, optional, null or a limit; `additional_rate_limits`, optional, null or an array of `{ limit_name?: string | null, metered_feature?: string | null, rate_limit?: limit | null }`. A **limit** is `{ primary_window?: window | null, secondary_window?: window | null }`, and a **window** `{ used_percent: number, limit_window_seconds: integer, reset_at: integer }`.
- **Windows**: each window of `rate_limit` is of the plan; each window of an additional limit is scoped to its `limit_name`, else its `metered_feature` (an additional limit with neither is skipped). The length is `limit_window_seconds`; a window whose length is 0 or less is skipped. `reset_at` is Unix **seconds**; 0 or less gives no span. Primary before secondary, `rate_limit` before the additional ones, in their order.
- **Plan**: `plan_type`: `pro` is `Pro 20x`; `prolite` and `pro_lite` are `Pro 5x`; `free_workspace` is `Free Workspace`; any other is capitalised; none when missing or empty. The same names serve the `x-codex-plan-type` header (`docs/specs/quota-sources/spec.md`).
- **Fixture**: constructed from `limits.ts` lines 116 to 148 and `chatgpt.ts` lines 106 to 132.

The Anthropic and ChatGPT endpoints are constants of their adapters. The layer of each takes them as options, so tests point them at the fake provider; the configuration cannot change them. Z.ai's and OpenCode Go's follow from the pool's base URL, which is configuration already.

## When the hub reads

A pool is read on demand, never in the background. For each pool with a reader, the hub keeps in memory:

- its last good **quota reading** and when it ended, or none;
- how many reads have **failed in a row**, `n`, and the latest failure;
- when the **next read** may start.

Asking for a pool (`GET /api/pools` asks for every pool) does, at `now`:

1. If a read of the pool is running, wait for it: every caller asking meanwhile gets that read's outcome. One read at a time per pool.
2. Else, if the pool has no reading and no failure since the hub started or since its state was last forgotten, or `now` is at or after the next read's time, start a read and wait for it.
3. Else answer what is kept.

After a read that ends at `t`:

- **Good**: the reading is kept, `n` is 0, the failure is cleared, and the next read may start at `t` plus the pool's period (60 seconds with a held key, 120 seconds with a quota login).
- **Failed**: the last good reading is kept as it was, `n` grows by one, the failure is kept, and the next read may start at `t` plus the longer of `min(15 minutes, period × 2^(n−1))` and the failure's `retry-after`. With a held key, the waits after one, two, three, four and five failures in a row are 60 seconds, 2, 4, 8 and 15 minutes; with a quota login, 2, 4, 8 and 15 minutes.

Giving or forgetting a pool's quota login, and its becoming expired, forget the pool's state: its reading, its failures and its next read's time. A read of the pool still running when its state is forgotten ends without its outcome being kept, and asks meanwhile still wait for it, so that two reads of a pool are never in flight. A read, once started, runs to its end in the hub even when nobody waits for it any more (each caller of the API hung up, or `GET /api/pools` failed because the request log could not be read), and its outcome is kept like any other's: a caller that hangs up, or a request log that is down, never makes the hub call a usage endpoint again before the period or the backoff has passed. When the hub stops, a read still in flight is cut, not finished, and nothing of it is kept, as nothing is across a restart (see the quota logins spec for what that costs a refresh). Nothing is kept across a restart: the quota headers still answer for the pools that send them (`docs/specs/quota-sources/spec.md`). Every time here is the clock's (`DateTime.now`, `Effect.sleep`), so the laws run with the test clock.

Pools are read side by side: `GET /api/pools` waits for the slowest read it started. A read with a quota login can take a refresh, a call, a second refresh after a 401 and a second call, each bounded by 10 seconds.

A failure is logged once, as `quota reading failed`, with the pool, the provider, the failure's kind and the status when there is one: never a token, a key, a body or a header's value.

## Laws

| Id | Law | Held by |
| --- | --- | --- |
| U1 | **One read at a time.** For any asks of a pool, however they overlap, no two reads of that pool are in flight at once, and every ask made while a read runs gets that read's outcome. | property |
| U2 | **Not before the period.** After a good reading of a pool, no read of it starts until its period has passed (60 seconds with a held key, 120 seconds with a quota login), and the first ask at or after then starts one. | property |
| U3 | **Backing off.** After `n` failed reads in a row, no read of the pool starts before the last failure's end plus the longer of `min(15 minutes, period × 2^(n−1))` and that failure's `retry-after`, and the first ask at or after then starts one; a good reading ends the run. | property |
| U4 | **A failure keeps the last good reading.** After any sequence of reads, a pool's quota reading is its last good one, and its failure the latest since that reading, or none. | property |
| U5 | **An answer that cannot be read is a failure.** Each reader turns a 2xx answer that does not decode, or that gives no window, into the failure `unreadable`, never into a reading. | property |
| U6 | **The hub says who it is.** Every call to a usage endpoint or a token endpoint sends `User-Agent: cota/<version>` and is abandoned 10 seconds after it was sent. | property |

U1 to U4 run generated sequences of asks, read outcomes (good, each failure, a 429 with and without `retry-after`) and moves of the test clock against the cache with a scripted read, and compare every read started and every answer with the rules worked out from the sequence alone; the moves land a millisecond before, at and a millisecond after each period and each backoff. U5 runs each reader over its constructed fixture, which must give literal windows, and over generated mutations of it (a required field removed, a field of another type, a percentage that is not finite, an array emptied), each of which must be `unreadable`, and over each such change of each fixture alone, as a fixed example. A Z.ai answer whose windows are all of units it does not know, or none long, is a fixed example too. U6 runs each reader and each token endpoint against the fake provider (`apps/hub/src/shared/05-tests/fake-provider.ts`), once answering at once and once never answering, with the test clock. The adapters' answers to each status, their requests and their failures' sentences are tests beside them; the contract tests of `GET /api/pools` read the harness's Z.ai pool from the fake provider.

## Not built, on purpose

- **Background polling, and a history of readings.** ADR-0016.
- **Reading through the configuration's endpoints.** The endpoints are the adapters'.
- **Retrying a read.** Only the one call after a refreshed 401; the next ask after the backoff is the retry.
- **Persisting readings or backoff.** A restart forgets them.
- **A reader for any other provider.** A local model server, OpenRouter or an Anthropic API key has no usage endpoint the prototype read.
- **Telling a pool's windows apart by login.** `docs/specs/quota-sources/spec.md`.
