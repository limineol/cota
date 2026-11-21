---
name: verify-domain
description: Check a change to the domain (the 03-domain folders in apps/hub/src) or proofs against the laws of the fallback decision, the quota windows, admission and cost, with property tests, Bend proofs, agreement tests between the proved models and the shipped code, and mutants. Use before committing any change to the domain or proofs, when a law, spec, model or proof changes, or when a verification gate fails.
---

# verify-domain

The domain decides whether a request may use a pool, which pool it bills, what its usage costs and what a quota window says. Some of what it promises holds for every input, and is written as a law with an id in the concept's spec (`docs/specs/admission/spec.md`, `docs/specs/fallback/spec.md`, `docs/specs/cost/spec.md`, `docs/specs/quota-windows/spec.md`). This skill tells you what holds each law, what that covers and what it does not, and how to keep it so. ADR-0004 says why it is built this way.

## The one command

```sh
bun run verify -- --verdict
```

It runs every gate below in order, never stops early, exits non-zero if any failed, and writes `evidence/<UTC time>-<commit>/report.md` and `report.json`. It takes about ten seconds on an 18-core laptop and longer with fewer cores, most of it the mutants, which run one per CPU. The first `--verdict` run downloads Bend 2.0.40 and Lean 4.34.0 into `.tools/` and builds the kernel; later runs reuse it. Without `--verdict` (and outside CI) proofs are checked by Bend's own checker only.

| Gate | Command | Fails when |
| --- | --- | --- |
| check | `bun run check` | Biome, a type error, an Effect diagnostic (an effect built and never run, an unstable API its package's tsconfig does not allow), an import across a boundary, or stale doc front matter |
| test | `bun run test` | a property test, an agreement test, an example, or a coverage floor fails |
| clickhouse | `bun run test:clickhouse` | a test of the request log against a real ClickHouse fails, or ClickHouse cannot be reached (it never skips; start `compose.dev.yaml`'s, as CI starts the same image as a service) |
| prove | `bun run prove -- --verdict` | a proof in `proofs/*/PROOF.bend` does not check (`FAIL`), or Bend cannot run (`ERROR`) |
| prove:models | `bun run prove:models` | a committed `model.mjs` is not what Bend compiles from its `model.bend` |
| mutants | `bun run mutants` | a mutant survives, its text is not in its file exactly once (stale), it does not type-check or stops its test from running (broken), or a test a mutant names fails on the unmutated code |

`verify` also fails when a spec's "Held by" column names a tier that did not run or did not pass for that law, or a word that is not a tier (`types`, `property`, `replay`, `clickhouse`, `proof`, `agreement`). A test titled `"<id>: …"` holds the `replay` tier when it is in `replay.test.ts` or a `*.replay.test.ts` file (the hub's replay of recorded exchanges, ADR-0008), the `clickhouse` tier when it is in a `*.clickhouse.test.ts` file (run by `bun run test:clickhouse`), and the `property` tier anywhere else; one never counts for another. A spec whose front matter names no code yet (`code: []`) is not checked until it does.

## What each check covers

Every law is held by property tests of the shipped code. The fallback laws, whose failure would bill the wrong pool, are also proved about a Bend model, and the shipped code is tested against that model.

| Law | Property | Harm if it breaks | Held by |
| --- | --- | --- | --- |
| F1 | A request without a login is kept, whatever was refused before it. | Anyone holding a hub key could spend the fallback pool's subscription. | proof, agreement, property |
| F2 | A diverted request goes to the fallback pool of the pool it bills, and to no other. | A refused login spends a subscription the owner never chose for it. | proof, agreement, property |
| F3 | Recording a refusal for another login or model never changes the decision for a request. | One login's limit moves another login's requests. | proof, agreement, property |
| F4 | A request is diverted only if a refusal for its own login and model has a reset after `now`. | Requests are moved without the provider having refused them. | proof, agreement, property |
| F5 | Once `now` reaches the latest reset for a login and model, its requests are kept again. | A login stays diverted after its limit has reset, spending the fallback pool for nothing. | proof, agreement, property |
| F6 | Recording the same refusals in any order, any number of times, gives the same decisions. | Concurrent responses would need ordering, or a retry would change who pays. | proof, agreement, property |
| F7 | `forget` changes no decision made at or after the time it ran. | Housekeeping silently ends a diversion early. | property |
| Q1 | Elapsed is between 0 and 1 and resets-in is never negative, for any `now`. | The dashboard shows a window over 100% gone or resetting in the past. | property |
| Q3 | An emptying time is always shorter than resets-in. | The dashboard warns of emptying after the window has already reset. | property |
| Q4 | In reserve and ahead of pace are always by at least 2 points. | Noise around zero is shown as a lead or a reserve. | property |
| A1 | A request that presents no hub key, or one the policy does not know, is rejected, whatever pool it names. | Anyone who can reach the hub spends the owner's pools. | property |
| A2 | A request is admitted only to a pool whose kind is its hub key's scope. | A subscription hub key, which every command a client runs can read, spends a pool the hub pays for with a key it holds. | property |
| A3 | A request without a known hub key gets the same answer whether or not the pool it names exists. | Someone without a hub key learns which pools exist. | property |
| A4 | An admitted request's answer carries the kind the policy gives its pool and the name the policy gives its hub key. | The hub chooses the credential for the wrong kind of pool, or the request log names the wrong hub key. | property |
| A5 | A request that presents a reader key is rejected, whatever pool it names. | An agent's reader key, given only to read the request log, spends a pool. | property |
| A6 | `IdentifyHubKey` gives the name and scope the policy gives the presented key's digest, and nothing for a key the policy does not know or a request that presents none. | The API lets in a key the hub does not know, or reads a subscription key as a reader key. | property |
| C1 | Without a price there is no cost, and with a price there always is one. | A model with no known price is shown as free, or a priced request goes unpriced. | property |
| C2 | Usage of zero tokens costs zero. | A request that used nothing is charged. | property |
| C3 | One token of one class, and nothing else, costs that class's rate in the tier that applies, after the fill-in of rule 4. | A class is billed at another class's rate, or a missing cache rate is taken as free. | property |
| C4 | When two usages and their sum all fall under the same rates, the cost of the sum is the sum of the costs. | Totals over projects and sessions differ from the sum of their requests. | property |
| C5 | The rates used are those of the highest tier whose threshold the prompt is over, and cached tokens count towards the prompt. | Long prompts are priced at the short-prompt rates, or at the wrong tier. | property |
| C6 | When no tier lowers any rate, adding tokens to any class never lowers the cost. | A request that used more is shown as cheaper. | property |

- **Property** (`apps/hub/src/modules/*/03-domain/*.laws.test.ts`): one `it.effect.prop` per law, named `"<id>: <sentence>"`, over generated inputs built from the domain's Schemas, 1000 runs each with a fresh seed. Each case builds a fresh `Fallback` service from `Fallback.layer(policy)`, records its history with the test clock set to each refusal's time, and asks with the clock set to `now`; the quota laws run `standing` the same way. The admission laws build an `Admission` service, or for A6 an `IdentifyHubKey` query over the SHA-256 hasher, from each generated policy, and the cost laws run `Cost.of` over generated usages and prices; neither reads the clock. It runs the code that ships; a pass is evidence, not proof.
- **Proof** (`proofs/<model>/LAWS.bend`, `PROOF.bend`): each law stated over every input of the model and proved; `--verdict` rechecks the proof with a kernel whose soundness is proved in Lean. A pass covers the model only.
- **Agreement** (`proofs/<model>/agreement.test.ts`): generated scenes run through the shipped service or effect, under the test clock, and through `model.mjs`, the proved model compiled to JavaScript, which must give the same answer. This is the only link between a proof and the shipped code. The same file has a coverage test that samples the same 2000 scenes on every run, prints the share reaching each rule, and fails if any share drops below 5%. The sample is fixed because the floor judges the generators, which only a change to them can move; the instants around a reset sit near 6%, where a fresh sample would fall below the floor now and then.
- **Mutants** (`tooling/mutants.table.ts`): named breaks of the shipped code, the hub's included, at least one per law. Each names the test that must fail; the runner prints that test's counterexample. Each mutant runs in its own copy of the repository, which leaves out only `.git`, `.tools`, `evidence` and `node_modules` (linked, not copied), so a mutant can break any file, the tooling included. In that copy only the named test runs, in the test file that declares it, and the mutant must type-check, with Effect's diagnostics, in its own project and in the named test's. Mutants run in parallel, one per CPU; other tests that would also notice a mutant are not run or counted. Mutants without a law break a spec rule that no law states, such as the 15-minute parking or what the cost schemas refuse; the test they name, an agreement test or an example, catches them.

## Files each model mirrors

| Model | Mirrors | Adapter |
| --- | --- | --- |
| `proofs/fallback/model.bend` | `decide`, `record` and `parkedUntil` of the `Fallback` service in `apps/hub/src/modules/relay/03-domain/fallback.ts`. `forget` is not modelled. The model takes `now` and a refusal's `refused_at` as arguments where the service reads the clock. | `proofs/fallback/adapter.ts`: `afterHistory(policy, history)` gives `decide` and `parkedUntil` in the domain's types, for a history of refusals each with the time it was recorded, which it passes as `refused_at` |

`standing` and pace (Q1, Q3 and Q4) are floating-point and have no model. Admission (A1 to A6) has no state or time to prove anything over, and cost (C1 to C6) is arithmetic, which Bend has almost no library for; both are held by property tests and mutants only. `proofs/README.md` explains how to read a law in Bend, and the notation.

## Bounds and assumptions: what a pass does not cover

- A proof is about `model.bend`. Its tie to the TypeScript is the agreement tests, which sample: they hold the code to the model wherever the generators look, not everywhere.
- The generators look at small worlds on purpose, so histories collide: three pools, two logins, two models, instants on a five-minute grid in one hour, nudged by a millisecond, with `now` often at, just before or just after a reset. The collisions are what the laws need: another login or model in the same history (F3), and policies with chains and with a pool named as its own fallback pool (F2). One hour is enough because the code only compares times and adds 15 minutes, so every ordering of a refusal's recording, its reset and `now` occurs inside it. A 15-minute parking that starts late in the hour ends past it; `now` still lands at its reset and a millisecond either side, and the stretch between the end of the hour and that reset is the same stretch that an earlier refusal's parking covers.
- The adapter carries times from 1970 to 2^48 − 1 ms, and ids by interning within one call. Outside that, it throws rather than answers. A bug in the adapter is a bug in this evidence: keep it small enough to check by reading.
- Bend's front end (parser, translation to the kernel) is unaudited; only the kernel is proved. `bend PROOF.bend -o PROOF.bendtt` writes the translation if a law's meaning is in doubt.
- In the model, `Nat` has no upper bound; in `model.mjs` arithmetic past 2^48 − 1 throws.
- A refusal's reset, the time it is recorded and `now` are generated independently (`anyTime`), and F6 replays histories out of order, so the test clock moves backwards as well as forwards. This is the spec's input space, not a slip: the laws hold for any clock. About half the agreement scenes record a refusal at a time after `now`, and about one in a hundred is a diverted scene a forward-moving clock could produce. That costs no evidence, because a decision depends only on each login and model's latest reset and on `now`, and when a refusal was recorded enters only as the start of its 15 minutes.
- Nothing here runs the domain's operations concurrently. `record` changes what is parked in one `Ref.update`, which is what lets concurrent responses record without being ordered (F6); no test makes two fibres interleave inside it, so that is held by reading the code.
- The admission generators use two hub key digests, three names, three scopes and two pools, with one to three of each in a policy, so a request's hub key is often unknown, its pool often unknown, and two keys of one scope often carry different names. About one case in twelve is admitted.
- The cost generators use small counts: each class's tokens are 0 half the time and 1 to 20 otherwise, rates are 0 to 30 million picodollars, and a price has up to three tiers whose thresholds start anywhere from 0 to 19 and rise by 1 to 20. C4 builds its price around the two usages it generated, with tiers under the smaller prompt and over the sum, so the three always fall under the same rates. C5 puts the prompt within one token of a tier's threshold and splits it across the four prompt classes. C6 builds each tier's rates as the previous tier's, filled in, plus a raise of zero or more. A coverage test in `cost.laws.test.ts` samples the same 2000 cases on every run and fails if fewer than 5% reach a tier for C4, the base rates for C4, each side of a threshold and the threshold itself for C5, or a tier that the cached tokens change. Large counts are pinned by one example (the largest safe integer of input), not by the properties.
- Nothing here covers the shell: parsing provider formats, hashing, IO.
- `model.d.mts` is written by hand from the generated `model.mjs`. If a model's data types change, update it, or the adapter will build values the model reads wrongly.

## Changing the domain or a model

Run the one command. A change that keeps the laws keeps every gate green. Then read the evidence's law table: every law's tiers should say passed or checked.

- **A behaviour change** updates the concept's spec and its `last_verified` in the same commit (AGENTS.md), then the model if the function is modelled, then `bun tooling/bend.ts models` to recompile `model.mjs`.
- **A mutant reported stale** means the code it breaks has moved. Rewrite its `find` and `replace` against the new code so it breaks the same thing; never delete it to pass.
- **A mutant that survives** means no test notices that break. Strengthen the test or its generators; never weaken the mutant.

## Adding a law

In this order, each step reviewed before the next:

1. **The spec sentence.** Add the law to the concept's spec table with the next id and the tiers that will hold it.
2. **The property test.** `it.effect.prop("<id>: <sentence>", …)` in the concept's `*.laws.test.ts`, with generators that make the interesting cases collide. Watch it fail on a broken copy of the code.
3. **The Bend law and proof.** If it holds over naturals and every history and is worth proving: the law in `LAWS.bend` under the spec sentence, named `<id in lower case>_<words>`, then its proof in `PROOF.bend`. `bun run prove`.
4. **The agreement test.** If the law needs something the model does not have yet, extend `model.bend`, recompile, update `model.d.mts` and the adapter, and make sure the agreement test and its coverage floors reach the new case.
5. **The mutant.** At least one row in `tooling/mutants.table.ts` that breaks the law in plain words and names the property test that must fail. `bun run mutants`.

Then update the law table in `proofs/README.md`, this skill's table, and the sync line below.

## When a proof stops checking

`SOME PROOFS FAIL` is not a counterexample, and Bend gives none. A proof can stop checking because the model changed in a way the law survives, because a step of the proof followed the old code, or because the law is false.

1. Run the law's property test and agreement test: `bun run test`. They shrink a failure to a small counterexample.
2. If one fails, the law is false for the code: decide from the spec whether the code or the model is wrong, and fix that one.
3. If none fails, repair the proof.

Never weaken the law, the model or a mutant to make a check pass. A failing check is a finding: report it.

## Last confirmed in step with the code

Commit `c045f6c`, 2026-11-11: the model in `proofs/fallback` was read against the `Fallback` service, then in `packages/domain`, and `bun run verify -- --verdict` passed. Commit `449610c` moved it to `apps/hub/src/modules/relay/03-domain/fallback.ts`; since `c045f6c`, `fallback.ts` changed only an import path and its service's key. When the covered code changes, read the diff since that commit against the model before trusting a green run, then move this line.
