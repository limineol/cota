---
status: active
scope: apps/hub
owner: limineol
last_verified: 2026-11-12
review_by: 2027-02-12
supersedes: []
code:
  - apps/hub/src/modules/request-log/03-domain
  - apps/hub/src/shared/03-domain/usage.ts
  - apps/hub/src/shared/03-domain/price.ts
---

# Cost

A request's cost is what its usage comes to at the provider's list price. This spec covers the calculation. It is `Cost.of` in `apps/hub/src/modules/request-log/03-domain/cost.ts`, over the usage and the price that `apps/hub/src/shared/03-domain/usage.ts` and `price.ts` define; the request log's `RecordRequest` calls it once per request (`docs/specs/request-log/spec.md`).

For a subscription pool the cost is an equivalent: what the same tokens would have cost on the provider's API. It is there to compare pools, projects and sessions, not to predict a bill.

## Values

- **Usage**: a whole number of tokens, zero or more, in each of five classes: `input`, `cacheRead`, `cacheWriteShort`, `cacheWriteLong`, `output`. Input never includes cached tokens. Reasoning tokens are part of output and are not a class.
- **Rates**: a price per token for each class, in **picodollars** (a millionth of a millionth of a dollar), as a whole number. A price of 4 dollars per million tokens is a rate of 4,000,000. `input` and `output` are always given; the three cache rates may be missing.
- **Price**: the base rates, and zero or more **tiers**, each a threshold in tokens and the rates that apply above it. Tiers are listed with rising thresholds.
- **Cost**: a whole number of picodollars.

Everything is whole numbers, so the arithmetic is exact: the sum of two requests' costs is the cost of their tokens together.

## Calculating

`Cost.of(usage, price)` gives a cost, or nothing when there is no price.

1. With no price, there is no cost.
2. The **prompt** is `input + cacheRead + cacheWriteShort + cacheWriteLong`.
3. The rates that apply are those of the tier with the highest threshold the prompt is over. If the prompt is over none, the base rates apply. At a threshold exactly, the tier does not apply yet.
4. A missing cache rate is filled in: `cacheRead` and `cacheWriteShort` take the `input` rate; `cacheWriteLong` takes the `cacheWriteShort` rate after that.
5. The cost is the sum, over the five classes, of tokens times rate.

Rule 4 errs high: a provider that does not publish a cache price is assumed to charge the full input price.

## Laws

| Id | Law | Held by |
| --- | --- | --- |
| C1 | **Unpriced is not free.** Without a price there is no cost, and with a price there always is one. | property |
| C2 | **Nothing costs nothing.** Usage of zero tokens costs zero. | property |
| C3 | **One token, one rate.** One token of one class, and nothing else, costs that class's rate in the tier that applies, after the fill-in of rule 4. | property |
| C4 | **Additive.** When two usages and their sum all fall under the same rates, the cost of the sum is the sum of the costs. | property |
| C5 | **Tier by the whole prompt.** The rates used are those of the highest tier whose threshold the prompt is over, and cached tokens count towards the prompt. | property |
| C6 | **More never costs less.** When no tier lowers any rate, adding tokens to any class never lowers the cost. | property |

C2, C3 and C4 together fix the cost under one set of rates: it can only be tokens times rate, summed.

Nothing here is proved in Bend: the laws are arithmetic, which Bend has almost no library for (ADR-0004). They are held by property tests over generated usages and prices, and by mutants.

## Not built, on purpose

- **Choosing the price.** Which price a request gets (its model, the pool's price list, a fast mode's own rates) is the hub's lookup. This calculation takes the price it is given.
- **Fees that are not tokens.** A provider's charge per web search is not in the cost.
- **Regional and batch multipliers.** A request that asks for inference in one region, or runs as a batch, is priced as a standard request.
- **Currency.** Rates are US dollars.
