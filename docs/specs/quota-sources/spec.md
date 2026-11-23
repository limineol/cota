---
status: active
scope: apps/hub
owner: limineol
last_verified: 2026-11-23
review_by: 2027-02-23
supersedes: []
code:
  - apps/hub/src/modules/quota/module.ts
  - apps/hub/src/modules/quota/01-presentation
  - apps/hub/src/modules/quota/02-application
  - apps/hub/src/modules/quota/03-domain/sources.ts
  - apps/hub/src/modules/quota/03-domain/quota-headers.ts
  - apps/hub/src/modules/quota/03-domain/plan.ts
  - apps/hub/src/modules/request-log/02-application/queries/read-quota-headers.query.ts
---

# Quota sources

Where a pool's quota windows come from, which one wins, and what the quota API answers for a pool. ADR-0016 gives the reasons. The calculation the windows go through (standing and pace) is `docs/specs/quota-windows/spec.md`; the quota readers are `docs/specs/quota-readers/spec.md`; quota logins `docs/specs/quota-logins/spec.md`; the endpoint's fields `docs/specs/api/spec.md`.

It is the `quota` module (`apps/hub/src/modules/quota`): the rules below with no IO in its `03-domain` (beside `quota.ts`: the header windows, what is current, and which observation wins), the query that answers `GET /api/pools` in its `02-application/queries`, and the `pools` group in its `01-presentation`. It reads the request log only through one query of the request-log module (below).


## Values

A **quota window**, as the hub answers it, has:

- a **length**, longer than zero;
- a **window scope**: the whole plan, or one thing the provider names (a model, or a feature), by the provider's own name for it;
- a **window source**: `reading` or `headers`;
- the **used percentage** the provider gave, from 0 to 100;
- a **span** (when it started and when it resets), or none when the provider gave no reset. A span starts one length before its reset: providers give the reset, never the start;
- when it was **observed**: the time of the quota reading, or when the request whose answer carried the headers started.

A window is known by its **scope and length**: two windows with the same scope and length are the same window seen twice.

A window has no id and no label: names for people ("5-hour", "Weekly", "Opus only") are the dashboard's (`docs/specs/quota-windows/spec.md`, Values).

A window is **current** at a time `now` when its reset is after `now`, or, when it has no reset, when `now` is less than one length after it was observed. A window that is not current says nothing about the allowance now: its window has reset since, or its numbers are older than the window.

## The sources

A pool's windows come from two sources: its quota reading and its quota headers. A window is answered only when one of them reports it: a pool whose provider reports no 5-hour window shows none. An observed pool has neither: no quota reader, and no forwarded answer whose headers could hold one, so it has no windows and no plan, and `ReadQuotaHeaders` is asked nothing for it (ADR-0029).

### A quota reading

The windows of the pool's last good quota reading, observed when it was taken, and its plan (`docs/specs/quota-readers/spec.md`). Only pools with a quota reader have one.

### The quota headers

The quota headers of the pool's latest answers, as the request log keeps them in `rate_limits` (`docs/specs/protocols/spec.md`, "Also read"). They cost no login and no call.

**Which answers.** For each window the headers can give, the latest request of the pool, started in the last 7 days, whose quota headers hold that window's percentage header, whatever its operation and outcome: a refused request's headers count. Its percentage, reset and length are read from that one answer's headers, never from two answers. The window is observed when that request started. A diverted request is recorded under the fallback pool, so its headers are the fallback pool's.

**Reading a value.** A header gives a number when its value, trimmed, is a decimal number (`-?[0-9]+(\.[0-9]+)?`) too small to overflow to infinity; any other value, an empty one included, is as if the header were absent. A fraction becomes a percentage by moving its decimal point two places, so `0.57` is exactly 57. A percentage is clamped to 0 to 100. A length in minutes is taken in whole milliseconds, rounded down. A reset is a Unix time in seconds, taken in whole milliseconds, rounded down; a reset of 0 or less, absent, or whose span would start or reset outside the times the hub can hold, gives a window without a span. A window whose length is absent, not a number, not above zero, or in milliseconds above 2^53 − 1 (the largest whole number the hub holds exactly, more than 285,000 years) is not a window. Primary and secondary are positions, not lengths: a window is known by its length.

**What each protocol's headers give.** "Recorded" means the header's name is in a recorded exchange (`apps/hub/src/shared/05-tests/replay/exchanges`, files whose `source.kind` is `recorded`). The scrubber keeps only the shape of a quota header's value (ADR-0008): a number below 10⁹ is recorded as `0` and one at or above it as `1800000000`. So a recording shows that a header is sent and whether its value is a small number or a Unix time, never its unit; units come from the clients' code, as the constructed exchanges have them.

| Protocol | Window | Percentage header | Reset header | Length | Scope | Seen |
| --- | --- | --- | --- | --- | --- | --- |
| `anthropic-messages` | 5-hour | `anthropic-ratelimit-unified-5h-utilization`, a fraction from 0 to 1, times 100 | `anthropic-ratelimit-unified-5h-reset`, Unix seconds | 5 hours | the plan | **constructed only**: both in `quota-probe.json`; the percentage alone in `refusal.json`, `message-not-streamed.json`, `second-turn.json`, `stream-thinking-text-tool-use.json` and `overloaded-in-stream.json`. No recorded answer carries either header, and no `-5h-*` header was in any of 22 measured Claude Code answers, from a plan that has no 5-hour window (measured on the orchestrator's dev request log, 2026-11-12, not committed): a pool whose plan has none shows none. |
| `anthropic-messages` | 7-day | `anthropic-ratelimit-unified-7d-utilization`, a fraction from 0 to 1, times 100 | `anthropic-ratelimit-unified-7d-reset`, Unix seconds | 7 days | the plan | recorded (`recorded-session-title.json`, `recorded-thinking-tool-use.json`, `recorded-turn-after-tool-result.json`, Claude Code 2.1.322): the percentage a small number, the reset a Unix time. That the percentage is a fraction is constructed in `quota-probe.json` (`0.41`), and measured: on all 22 answers a decimal fraction below 1, like `0.57`, with the reset 10-digit Unix seconds equal to `anthropic-ratelimit-unified-reset`, and `-representative-claim` `seven_day` (measured on the orchestrator's dev request log, 2026-11-12, not committed). |
| `chatgpt-codex` | primary | `x-codex-primary-used-percent`, a percentage from 0 to 100 | `x-codex-primary-reset-at`, Unix seconds | `x-codex-primary-window-minutes`, minutes | the plan | recorded (`recorded-turn-after-tool-output.json`, `recorded-turn-custom-tool-call.json`, Codex 0.167.2): the percentage and the minutes small numbers, the reset a Unix time. Measured on all 10 Codex answers: the minutes `10080`, so this plan's primary window is the weekly one, the percentage a whole number, the reset 10-digit Unix seconds (measured on the orchestrator's dev request log, 2026-11-12, not committed). Minutes of 300 (5 hours) are constructed only. |
| `chatgpt-codex` | secondary | `x-codex-secondary-used-percent`, a percentage from 0 to 100 | `x-codex-secondary-reset-at`, Unix seconds | `x-codex-secondary-window-minutes`, minutes | the plan | recorded, as above, with an empty reset in both recordings. Measured on all 10 Codex answers: the minutes `0`, the reset empty, the percentage `0` and `-reset-after-seconds` `0` (measured on the orchestrator's dev request log, 2026-11-12, not committed): **no window**, as a length of 0 is not one. A secondary window with minutes above 0 is constructed only. |
| `openai-chat` | none | | | | | Z.ai and OpenCode Go send no quota headers; `retry-after` is not a window. |

Read but not turned into windows, and why:

- `anthropic-ratelimit-unified-status`, `-reset`, `-representative-claim`, `-fallback-percentage`, `-overage-status`, `-overage-disabled-reason`, `-7d-status` (recorded) and `-5h-status` (constructed): states, not windows. `-unified-reset` with `-representative-claim` names the reset of whichever window binds, which the windows' own resets already give when they are sent.
- `x-codex-primary-reset-after-seconds`, `x-codex-secondary-reset-after-seconds`, `x-codex-primary-over-secondary-limit-percent`, `x-codex-active-limit`, `x-codex-credits-*`, `x-codex-safety-buffering-*` (recorded), `x-codex-rate-limit-reached-type` (constructed): not windows, or the same reset said relative to the answer.
- `x-<limit>-primary-*`, `x-<limit>-secondary-*` and `x-<limit>-limit-name` for a limit other than `codex`: Codex's per-model limits (milestone 1's reading of its source). None is in any exchange, recorded or constructed, so none is read; per-model windows come from a quota reading.

**The plan from headers.** `x-codex-plan-type` (recorded, its value scrubbed; measured on every Codex answer, on the orchestrator's dev request log, 2026-11-12, not committed) of the latest `chatgpt-codex` answer in the last 7 days that carries it, named as the ChatGPT reader names `plan_type` (`docs/specs/quota-readers/spec.md`).

## Which observation wins

For a pool at `now`:

1. Gather the windows of its last good quota reading and the windows its quota headers give, and keep those that are current.
2. For each scope and length among them, keep one: the one observed last; when a reading and headers were observed at the same instant, the reading's; when two of one source were, the first in the reading's order or the table's.
3. Order them: the plan's windows first, then the others by scope (by code point); within a scope, by length, shortest first.

So a reading does not hide the headers of a request made after it, and headers never hide what only a reading gives. A reading that failed keeps its last good windows (`docs/specs/quota-readers/spec.md`), which go through the same steps and lose to any newer headers.

**A pool is one subscription.** Its windows are the pool's, not a login's. When several logins of one subscription pool are used and their answers alternate, the pool shows the numbers of the latest answer that gave each window. Nothing tells logins apart here; sharing a pool's requests across subscriptions is load balancing (`docs/roadmap.md`), a later decision.

## The plan

A pool's plan is, in this order: for a pool with a Claude quota login, kept or expired, the name its plan facts give (`docs/specs/quota-readers/spec.md`, Anthropic); else the plan of its last good quota reading; else, for a `chatgpt-codex` pool, the plan its headers give; else none.

## The quota API

`GET /api/pools` (`docs/specs/api/spec.md`, the `pools` group) answers every pool of the configuration once, ordered by id, each with its windows as above, their standing and pace as `standing` (`quota.ts`) gives them at the answer's time, its plan, the state of its quota reading and of its quota login. Asking it is what starts a read of each pool whose reading is due (`docs/specs/quota-readers/spec.md`); it waits for those reads.

It reads the request log through one query of the request-log module, one ClickHouse query for all the pools asked about:

- **`ReadQuotaHeaders`**: for each pool given and each header name given, the latest request of the pool that started at or after a given instant and whose quota headers hold that name: when it started, and all its quota headers. The names asked are the percentage headers of the table above and `x-codex-plan-type`, each for the pools whose protocol sends it.

It is a method of `RequestLogReader`, answered in plain code by the in-memory reader and in SQL by the ClickHouse one, and among H9's questions (`docs/specs/api/spec.md`); the request log spec's Reading describes it. When the request log cannot be read, the endpoint answers 503 `request-log-unavailable`, as the traffic endpoints do.

## Laws

| Id | Law | Held by |
| --- | --- | --- |
| W1 | **The newest observation wins.** For any quota reading and quota headers of a pool, each scope and length that some current observation gives appears exactly once among the pool's windows, as the current one observed last, a reading winning a tie; no other window appears. | property |
| W2 | **No invented percentage.** Every window has a used percentage, and it is the number the provider gave in that one observation, as a percentage, clamped to 0 to 100. | types, property |
| W4 | **Only current windows.** No window answered resets at or before the answer's time, and a window without a reset was observed less than its length before it. | property |
| W5 | **One answer per header window.** A window whose source is `headers` takes its percentage, its reset and its length from the quota headers of one request. | property |
| W6 | **The API agrees with the calculation.** Every window's standing in an answer of `GET /api/pools` is what `standing` gives for that window at the answer's time. | property |
| W7 | **Every pool once.** `GET /api/pools` answers each pool of the configuration exactly once, in order of id, whatever the request log, the readings and the quota logins hold. | contract |

W1 to W6 run the query (`read-pools.laws.test.ts`) over a pool of each kind and protocol and generated request logs whose requests carry generated quota headers (complete, partial, malformed, empty, as recorded: Anthropic's without their 5-hour headers and Codex's with no secondary window; refusals and failures among them, with and without a login), at generated instants of the test clock on a half-hour grid around the logs' end, so that resets and observations often meet the clock, on the in-memory request log reader; each law is checked against the spec's table and rules written out again in the test, never against the code's. The query's pools there have no quota reader, so W1, W2 and W4 also run the rules (`sources.laws.test.ts`) over generated quota readings and quota headers that often tie, with fixed examples of a tie and of a window that resets at the answer's time or was observed exactly its length before it. W2 is held by the window's type too (its percentage is a required field). W6 compares each window's standing in the query's answer, which the endpoint translates field by field, with `standing` run on the window at the same instant; a contract test holds that translation over literal answers in every pace. W7 is a contract test over the harness's configuration (subscription and keyed pools of every protocol, and an observed pool) with generated request logs, pools outside the configuration among them, its Z.ai pool's usage endpoint answering a generated reading, each failure, or never, and its subscription pools each given no quota login, a kept one read from the constructed fixtures, or one whose refresh is refused; only its keyed pools and its observed pool answer no quota login. The read of the quota headers is held to the in-memory reader by H9 in the ClickHouse tier.

## Not built, on purpose

- **A history of windows.** Readings are in memory and headers are read when asked; nothing is stored. A forecast that would need one is after parity (`docs/roadmap.md`).
- **Per-model windows from headers.** No exchange holds Codex's `x-<limit>-*` headers or Anthropic's per-model ones; a quota reading gives per-model windows.
- **Placing a window from `-unified-reset` or `reset-after-seconds`.** A window is placed only by its own reset header.
- **Telling logins of one pool apart.** Load balancing, later (`docs/roadmap.md`).
- **Names for windows.** The dashboard names a window from its length and scope.
- **A window no source reports.** ChatGPT's and Claude's $100 and $200 plans may have no 5-hour window, so a window Cota worked out itself could be one the plan does not have. A pool shows only the windows its quota reading or its quota headers report (ADR-0016).
