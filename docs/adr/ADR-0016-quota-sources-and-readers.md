---
status: accepted
scope: apps/hub
owner: limineol
last_verified: 2026-11-14
review_by: 2027-02-13
supersedes: []
code:
  - apps/hub/src/modules/quota
---

# ADR-0016: A pool's quota windows come from quota readings and quota headers, read on demand

## Context

The dashboard's first screen shows every pool's quota windows: how much of each is used, whether usage is on pace, and when it resets (`PRODUCT.md`). Milestone 0 built the calculation (`docs/specs/quota-windows/spec.md`: standing and pace); nothing feeds it yet.

The prototype fed it one way per pool (`dashboard/server/limits.ts`): it called each provider's usage endpoint when the overview was loaded, with the hub's key for Z.ai and OpenCode Go and with a login of its own for Claude and ChatGPT accounts, cached the answer for 60 or 120 seconds, and, for a Claude account it had no login for, fell back to an estimate of the 5-hour window, replayed from the times of its requests, without a percentage. A failure was cached like a success and retried a period later, without backoff. The Claude and ChatGPT endpoints it called are the ones the providers' own clients use for their usage screens; neither is documented.

Cota has a source the prototype did not use. The relay already keeps every answer's quota headers in the request log (`requests.rate_limits`, `docs/specs/protocols/spec.md`, "Also read"): Anthropic's subscription answers carry `anthropic-ratelimit-unified-*`, and ChatGPT's Codex answers `x-codex-*`. They cost no login and no call. What they hold, read from the recorded exchanges (`apps/hub/src/shared/05-tests/replay/exchanges`), is narrower than the plan for this milestone assumed:

- The three recorded Anthropic answers (Claude Code 2.1.322, 2026-11-12) carry the 7-day window's utilization and reset (`-7d-utilization`, `-7d-reset`), the overall `-unified-reset`, `-unified-status`, `-representative-claim`, `-fallback-percentage` and the overage headers. **None carries a 5-hour window** (`-5h-utilization`, `-5h-reset`). Those names appear only in constructed exchanges, from the milestone 1 reading of Claude Code's binary.
- The two recorded Codex answers (Codex 0.167.2, 2026-11-12) carry `x-codex-primary-*` and `x-codex-secondary-*` (`used-percent`, `window-minutes`, `reset-at`, `reset-after-seconds`), `x-codex-plan-type`, `x-codex-active-limit` and the credits headers. The secondary window's `reset-at` was empty.
- The scrubber keeps a quota header's name and only the shape of its value (ADR-0008: a number below 10⁹ becomes `0`, one at or above it `1800000000`). So the recordings prove which headers exist, not their units: that Anthropic's utilization is a fraction and Codex's percentage a percent, and the lengths `300` and `10080` minutes, come from the providers' clients' code, as the constructed exchanges have them.

## Decision

**A pool's windows come from two sources**, each window saying which (`docs/specs/quota-sources/spec.md`):

1. a **quota reading**: what a quota reader got from the provider's usage endpoint;
2. the **quota headers** of the pool's latest answers, read from the request log.

**No window is estimated.** A window is shown when one of the two reports it, and not otherwise. Not every plan has a 5-hour window: ChatGPT's and Claude's $100 and $200 plans may have none. On 22 measured Claude Code answers the weekly headers were there and no `-5h-*` header, from a plan that has no 5-hour window. A plan that has one reports it, with its percentage, in its quota headers or in a quota reading. An estimate replayed from request times, as the prototype made, assumes that every Claude plan has a 5-hour window that opens with a request, so where a plan has none it would invent one.

**Per window, the newest observation wins.** A window is known by its scope and its length. For each, the answer gives the current observation made last, a quota reading winning a tie; an observation is current while its reset is ahead, or, without a reset, for one length after it was made. So a reading two minutes old does not hide a request's headers from a second ago, and a reading still gives what headers never carry (per-model windows, Z.ai's and OpenCode Go's windows, a Claude plan's name).

**The windows are a pool's.** A request diverted to the fallback pool is recorded under it, so its headers are that pool's. A pool is one subscription today (`CONTEXT.md`, flagged ambiguities); if several logins of one subscription pool are used and their answers alternate, the pool shows the latest answer's numbers. Nothing is built for it: that is load balancing's question (`docs/roadmap.md`).

**Quota readers are a port with one adapter per provider**, in the quota module (`docs/specs/quota-readers/spec.md`): Z.ai and OpenCode Go with the pool's held key, Anthropic and ChatGPT with the pool's quota login (ADR-0017). Each adapter decodes the answer with a Schema; an answer it cannot decode, or that gives no window, is a failure, never a reading without windows. The shapes come from the prototype's code, not from recorded traffic, so every adapter's fixture is constructed, and the spec says which fields are read and that the Anthropic and ChatGPT endpoints are undocumented. Z.ai's and OpenCode Go's endpoints follow from the pool's base URL; Anthropic's and ChatGPT's are constants of their adapters, replaced only through the layer's options in tests, never through the configuration.

**Reading is on demand, cached, with backoff.** A pool is read when the quota API is asked and its last reading is older than its period: 60 seconds with a held key, 120 seconds with a quota login. One read at a time per pool; callers asking meanwhile share it. A failure keeps the last good reading and says what failed, and the next attempt waits the period, then twice as long after each further failure, up to 15 minutes, and never before a 429's `retry-after`. Readings live in memory: after a restart the headers still answer. Everything runs on Effect's clock, so the laws run it with the test clock. There is no background polling and no history of readings.

**Outbound calls say who they are.** Every call to a provider's usage or token endpoint sends `User-Agent: cota/<version>`, the hub package's version, and is abandoned after 10 seconds. A read is retried only once, after a 401 answered with a refreshed quota login.

**The quota API is one reading endpoint**, `GET /api/pools` (`docs/specs/api/spec.md`): every configured pool with its windows, each with its length, scope, source, percentage, span, when it was observed, and its standing and pace as `quota.ts` computes them at the answer's time, so the dashboard and every agent agree; the pool's plan; its quota reading's state and last failure; and its quota login's state. Names for people ("5-hour", "Weekly", "MCP tools") are the dashboard's; the API gives lengths and scopes. The overview's pool cards need no endpoint of their own: their traffic (today's and the last 30 days' requests, tokens and cost, the last request, active sessions) is `GET /api/breakdown?by=pool` over those windows, which already answers it, beside `GET /api/pools`.

## Alternatives weighed

- **Readings only, as the prototype.** A Claude or ChatGPT pool without a quota login would show nothing, and every window would be up to two minutes old while the request log holds numbers from the last answer.
- **Headers only.** No login to keep, but no per-model windows, nothing for Z.ai and OpenCode Go, whose answers carry no quota headers, no Claude plan name, and, as recorded, no Anthropic 5-hour window.
- **A fixed order of sources (a reading, else headers), per pool.** Simple, but a cached reading would hide the headers of every request made since, which are the freshest numbers the hub has.
- **The prototype's estimate of the 5-hour window, for a Claude pool nothing else reports on.** It would show a window a plan may not have, without a percentage, beside windows the provider reports (above).
- **Polling in the background, with a history.** It would read providers while nobody looks, which the undocumented endpoints give no reason to risk, and a history needs a table and a retention rule nobody has asked for yet; the forecast that would use one is after parity (`docs/roadmap.md`).
- **The prototype's caching without backoff.** A provider that fails would be called every period for as long as the dashboard is open; doubling to 15 minutes costs nothing and honours a provider asking the hub to slow down.
- **Endpoints in the configuration.** It would let a mistyped URL send a login to the wrong host. The endpoints are facts of each provider's adapter; tests replace them through the layer.
- **A pool-card endpoint.** It would answer what `GET /api/breakdown?by=pool` answers, through a second query to keep in step with it.

## Consequences

- The quota module gains its application and infrastructure layers: the `QuotaReader` port and four adapters, the cache, and the queries of the quota API. It reads the request log only through one new query of the request-log module (the latest quota headers of each pool), which the ClickHouse tier holds to the in-memory reader (the api spec's H9).
- The domain's quota window gains its scope, source and the time it was observed, and loses its id and label, which were names for people (`docs/specs/quota-windows/spec.md`, when it is built).
- The Anthropic 5-hour window from headers is built on constructed evidence only. A Claude pool whose answers carry no 5-hour headers, and that has no quota reading, shows no 5-hour window.
- The undocumented endpoints can change or close without notice. A changed answer becomes an `unreadable` failure with the last good reading kept, and the headers still answer.
- `apps/hub/package.json` gains a `version`, `0.0.0` until the first release, for the user agent, and an import entry, `"#package.json"`, through which the readers read it without climbing out of `src` (ADR-0010).
