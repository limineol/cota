---
status: active
scope: apps/hub
owner: limineol
last_verified: 2026-11-14
review_by: 2027-02-13
supersedes: []
code:
  - apps/hub/src/modules/quota/03-domain
---

# Quota windows

A pool's allowance comes in quota windows: a 5-hour window, a week, a month, sometimes one per model. This spec covers what a quota window is and where it stands against time. It is an effect in `apps/hub/src/modules/quota/03-domain/quota.ts`, `standing`, which reads the time from the clock; below, `now` is the clock's time when it runs. Where a pool's windows come from, and which observation of a window wins, is `docs/specs/quota-sources/spec.md`.

## Values

A **quota window** has a length longer than zero, a **window scope** (the whole plan, or one thing the provider names, by its own name for it), a **window source** (`reading` or `headers`), the percentage used the provider gave, from 0 to 100, and the time it was **observed**. It has a span (when it started and when it resets) unless the provider gave no reset, which happens for a window that has not opened yet. Names for people ("5-hour", "Weekly", "Opus only") are the dashboard's, worked out from the length and the scope.

Every window's numbers are the provider's: Cota never works out a window, or a percentage, of its own.

A **span** starts strictly before it resets.

## Standing

`standing(window)` says where a window stands at `now`.

- A window without a span is **unplaced**: nothing is known about its time.
- Otherwise the answer has:
  - **elapsed**, the share of the span that has passed, from 0 to 1;
  - **resets in**, the time left until the reset, never negative;
  - **pace**.

**Pace** compares the percentage used with the share of time gone. The first rule that applies wins:

1. 100% used is **full**.
2. Let *lead* be the percentage used minus the percentage of time elapsed. A lead of less than 2 points either way is **on pace**.
3. A negative lead is **in reserve**, by that many points.
4. Otherwise the window is **ahead of pace**, by the lead in points. If any time has passed since the start, the answer also says when the allowance empties at the rate so far: after `(100 − used) / used × time since the start`.

The rate so far is the average since the span started: the percentage used over the time since the start. It is all that two numbers can give. Under it, being ahead of pace and emptying before the reset are the same fact: a window empties before its reset exactly when its lead is above zero. So this rule has no "ahead, but will last" answer to give, and the emptying time is always sooner than the reset (Q3). A window that is behind the line is in reserve, and in reserve means it lasts until the reset at the rate so far.

The emptying time is a projection, not a prediction. A window that used 60% in its first hour and has been idle since is ahead of pace, and is shown emptying, although nothing is being used. Telling that apart takes the times of recent requests, which this calculation is not given (see "Not built").

Before its span has started, a window has no rate to project, so it can be ahead of pace without an emptying time.

How pace is worded and coloured is the dashboard's business, not this function's.

## Laws

| Id | Law | Held by |
| --- | --- | --- |
| Q1 | **In range.** Elapsed is between 0 and 1, and resets-in is never negative, for any `now`, before the span or after it. | property |
| Q3 | **Empties before the reset.** When pace gives an emptying time, it is shorter than resets-in. | property |
| Q4 | **The band is respected.** In reserve and ahead of pace are always by at least 2 points. | property |

Q1, Q3 and Q4 are floating-point arithmetic, which Bend cannot state usefully, so they are property-tested only.

## Not built, on purpose

- **Where windows come from.** The quota headers and which observation wins are `docs/specs/quota-sources/spec.md`; the quota readers `docs/specs/quota-readers/spec.md`.
- **Names for windows.** The dashboard names a window from its length and scope.
- **A projection from recent use.** The request log knows when each request was made, so a later rule can project from the rate of the last minutes or hours, and say "ahead of pace, but will last". It would be a new calculation with its own laws; it is on the roadmap, not here.
- **A history.** The prototype this is rewritten from had one more pace, "ahead of pace" without an emptying time, for a window that is ahead but would last until its reset. Writing Q3 showed that the prototype's own formula could never give that answer once the span has started, so it is gone. The case is real in the world; it needs the projection from recent use above.
