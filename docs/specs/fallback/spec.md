---
status: active
scope: apps/hub
owner: limineol
last_verified: 2026-11-23
review_by: 2027-02-23
supersedes: []
code:
  - apps/hub/src/modules/relay/03-domain/fallback.ts
  - proofs/fallback
---

# Fallback

When a provider refuses a login because it has reached its limit, the hub sends that login's requests to the pool's fallback pool until the limit resets, so the session carries on. This spec covers the decision. It is the `Fallback` service in `apps/hub/src/modules/relay/03-domain/fallback.ts`; the relay's `module.ts` provides it, and the relay's `PlanCredential` query (`modules/relay/02-application/queries/plan-credential.query.ts`) asks it and applies its answers (`docs/specs/relay/spec.md`).

The decision is the most dangerous thing Cota does: it spends a different subscription than the one the client asked for. Its laws are proved (ADR-0004).

## Values

- **Fallback policy**: for each pool, its fallback pool, if it has one. The service is built from it: `Fallback.layer(policy)`.
- **Parked**: which logins and models are parked, and until when. It starts empty, lives inside the service, and changes only through `record` and `forget`.
- **Request**, as the decision sees it: the pool it bills, the fingerprint of the login it carries (if it carries one), and the model it asks for.
- **Refusal**: a login fingerprint, a model, and the reset the provider gave, if it gave one. It is refused at the moment it is recorded.

Every operation reads the time from the clock. Below, `now` is the clock's time when the operation runs.

The laws hold whatever the clock reads at each call, earlier or later than at the call before. A refusal may be recorded at a time later than a decision made after it, or with a reset at or before the moment it is recorded. The hub's clock only moves forward, so its histories are among those the laws cover; F6 needs the rest, since replaying the same refusals in another order moves the clock back.

## Deciding

`decide(request)` answers **keep** or **divert**. The first rule that applies wins:

1. A request without a login is kept.
2. A request whose pool has no fallback pool is kept.
3. A request whose login and model are parked until a time after `now` is diverted to its pool's fallback pool. The answer carries that pool and the reset.
4. Any other request is kept.

At the reset itself the request is kept: a limit that resets at 12:00 is gone at 12:00.

Rule 2 comes before rule 3 on purpose: a parked login on a pool with no fallback pool is kept, and the client sees the provider's refusal.

## Recording a refusal

`record(refusal)` parks the refusal's login and model until the refusal's reset.

- A refusal with no reset parks for 15 minutes from `now`. That time is the refusal's reset everywhere below.
- If a refusal for that login and model was recorded before, the later of the two resets stands, whether or not the earlier one has passed.
- Nothing else that is parked changes.

## Reading and housekeeping

- `parkedUntil(login, model)` gives the reset if that login and model are parked at `now`, and nothing otherwise.
- `forget` drops everything whose reset is at or before `now`. It exists so the hub's memory does not grow; it changes no decision.

## Laws

| Id | Law | Held by |
| --- | --- | --- |
| F1 | **No login, no diversion.** A request without a login is kept, whatever was refused before it. | proof, agreement, property |
| F2 | **Own fallback only.** A diverted request goes to the fallback pool of the pool it bills, and to no other. | proof, agreement, property |
| F3 | **Isolation.** Recording a refusal for another login, or for another model, never changes the decision for a request. | proof, agreement, property |
| F4 | **Cause.** A request is diverted only if a refusal for its own login and model was recorded with a reset after `now`. | proof, agreement, property |
| F5 | **Temporary.** Once `now` reaches the latest reset recorded for a login and model, that login's requests for that model are kept again. | proof, agreement, property |
| F6 | **Order-free.** Recording the same refusals in any order, and any number of times each, gives the same decisions. | proof, agreement, property |
| F7 | **Forgetting is invisible.** `forget` changes no decision made at or after the time it ran. | property |

F1 and F4 together are the security property: holding a hub key and naming a pool is not enough to be diverted. Only a request carrying a login the provider itself refused is moved, and only to that pool's own fallback.

F6 is why concurrent responses can each call `record` without being ordered first. A refusal with no reset takes its reset from the moment it is recorded, so in F6 "the same refusal" includes that moment.

## How the hub uses it

For each request to a subscription pool that carries a login and names a model, and whose protocol tells a refusal from the answer's status and headers (Anthropic's), the hub asks `decide`. A ChatGPT pool's refusal is known only once its body has passed, so such a pool has no fallback pool and its requests are not asked about. On **keep** it forwards the request with the client's own login; if the provider's answer is a refusal it calls `record`, then `decide` again, and forwards once more if the answer is now **divert**. On **divert** it forwards the request with the fallback pool's kept login. A request is diverted at most once, and a refusal of a diverted request is not recorded. The steps, and what the request log keeps of each, are in `docs/specs/relay/spec.md`.

## Not built, on purpose

- **Recognising a refusal** belongs to each protocol (`docs/specs/protocols/spec.md`). Anthropic's is a 429 whose `anthropic-ratelimit-unified-status` is `rejected`, with the reset in `anthropic-ratelimit-unified-reset`.
- **Chains.** If the fallback pool refuses a diverted request, the client gets that refusal.
- **Checking the policy.** A policy that names a pool as its own fallback pool is the owner's mistake, and the hub's configuration rejects it (ADR-0009). The decision's laws hold for it all the same.
- **Observed pools.** An observed pool has no fallback pool and is none: the configuration refuses a `fallback` on one and a `fallback` naming one, so the policy never holds one, and no request to one reaches the relay (ADR-0029).
- **Diverting before a refusal.** A provider that keeps serving past the allowance, because the pool has paid extra usage, never refuses, so nothing is diverted. Diverting on a full quota window instead is a possible later rule; it would be a new law, not a change to these.
- **Surviving a restart.** What is parked is memory. After a restart the next request is refused once more and parked again; the client does not see it.

## Known cost

The first diverted request re-reads the whole conversation uncached against the fallback pool.
