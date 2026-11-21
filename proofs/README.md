---
status: active
scope: proofs
owner: limineol
last_verified: 2026-11-14
review_by: 2027-02-11
supersedes: []
code:
  - proofs/fallback
---

# Proofs

This directory holds machine-checked proofs of the domain's laws, written in [Bend 2](https://github.com/bendlang/bend). Each proof is about a small model of one of the domain's operations, written in Bend from its spec. A model is pure: where the shipped code reads the clock, the model takes the time as an argument. [ADR-0004](../docs/adr/ADR-0004-verification.md) says why the proofs exist and how they connect to the TypeScript that ships.

Each directory holds one model:

| File | Holds |
| --- | --- |
| `model.bend` | The model: the spec's operations, under the spec's names |
| `LAWS.bend` | The laws, one per spec law, each under the spec's sentence |
| `PROOF.bend` | The proofs |
| `model.mjs` | The model compiled to JavaScript by `bend model.bend -o model.mjs`. It is generated and committed, so the tests need no Bend |
| `model.d.mts` | The types of `model.mjs`, written by hand from the code Bend generates |
| `adapter.ts` | The model in the domain's types: ids interned to `Nat`s, times as epoch milliseconds, `Option` as `Maybe`, a policy as a list of lines, a history as refusals with the time each was recorded. The only file that knows `model.mjs`'s shape |
| `agreement.test.ts` | The agreement tests, and a test that the scenes they generate reach every rule of the operation |

## What is proved

| Law | Spec sentence | Bend law | Held by |
| --- | --- | --- | --- |
| F1 | A request without a login is kept, whatever was refused before it. | `f1_no_login_no_diversion` | proof, agreement, property |
| F2 | A diverted request goes to the fallback pool of the pool it bills, and to no other. | `f2_own_fallback_only` | proof, agreement, property |
| F3 | Recording a refusal for another login, or for another model, never changes the decision for a request. | `f3_isolation` | proof, agreement, property |
| F4 | A request is diverted only if a refusal for its own login and model was recorded with a reset after `now`. | `f4_cause` | proof, agreement, property |
| F5 | Once `now` reaches the latest reset recorded for a login and model, that login's requests for that model are kept again. | `f5_temporary` | proof, agreement, property |
| F6 | Recording the same refusals in any order, and any number of times each, gives the same decisions. | `f6_order_free` | proof, agreement, property |
| F7 | `forget` changes no decision made at or after the time it ran. | none: `forget` is not modelled | property |

"Proof" is a law in `LAWS.bend` with a proof in `PROOF.bend` that `bun run prove` checks. "Agreement" is the test beside the model that requires the shipped code, run under the test clock, to answer as `model.mjs` does. "Property" is the law's property test of the shipped code in `apps/hub`.

Q1, Q3 and Q4 are about floating-point arithmetic and are not modelled. Neither are A1 to A6 (admission has no state or time) nor C1 to C6 (cost is arithmetic); their specs say so.

Each law in `LAWS.bend` quantifies over every history and every policy the sentence covers:

- `parked` ranges over every list of refusals. `record` puts a refusal at the head of the list and `empty` is the empty list, so every list is the result of some history of refusals.
- `policy` ranges over every list of `Fallback{pool, fallback}` lines. A pool's fallback pool is the one named by the first line for that pool, so every fallback policy is one of these lists.
- A refusal's reset, in F3 to F6, is `parks_until`: the reset the provider gave, or 15 minutes after `refused_at` when it gave none. This is how the spec's `record` reads a refusal. The shipped `record` takes no time from its caller: `refused_at` is the clock's time when it runs, and the adapter passes the time each refusal of a history was recorded.
- F5's "the latest reset recorded" is stated without a maximum: every refusal recorded for that login and model parks until `now` or earlier. The law does not depend on the model computing the maximum correctly.
- F6's "the same refusals" is stated as two lists in which each refusal of one appears in the other. Recording starts from any `parked`, not only from an empty one.

## What a pass establishes

`bun run prove` passing means Bend's checker accepted a proof of every law in `LAWS.bend` about the model in `model.bend`.

- **It covers the model.** A proof says nothing about code it does not mention. The laws are proved of `model.bend` and of nothing else.
- **`--verdict` rechecks with a proven kernel.** Bend's own checker has no proof of its soundness. `--verdict` translates each proof into BendTT and checks it again with a small kernel whose soundness is proved in Lean 4. CI runs this mode.
- **The front end is unaudited.** The parser and the translation into the kernel are not proved, and the Bend compiler is young and largely AI-written. A law therefore means what its translation says. `bend PROOF.bend -o PROOF.bendtt` writes the translation, which can be read to confirm a law.
- **The tie to the TypeScript is the agreement tests.** `model.mjs` is the proved model compiled to JavaScript. The agreement tests run generated histories through both `model.mjs` and the shipped code and require the same answer. The shipped side is the real `Fallback` service, built fresh for each history, with the test clock set to each generated time. They cover what the adapter can carry: times from 1970 to 2^48 − 1 ms (the year 10889). A bug in an adapter is a bug in this evidence, so each is kept small enough to check by reading. Nothing else connects these proofs to the code that ships. The drift gate (`bun run prove:models`) fails when the committed `model.mjs` is not what the compiler produces from `model.bend`, so the module the tests use is the model that was proved.
- **Numbers are naturals.** Bend has no 64-bit integers, so times are `Nat`, which has no upper bound in the proofs. In `model.mjs` a `Nat` is a JavaScript number: an argument must be an integer from 0 to 2^53, and arithmetic past 2^48 − 1 throws. Millisecond timestamps are far below both.

## Reading a law

A law is a type, and its proof is a value of that type. This is F1:

```python
law f1_no_login_no_diversion:
  for policy: List<&2, F.Fallback>
  for parked: List<&2, F.Refusal>
  for pool: Nat
  for model: Nat
  for now: Nat
  {F.decide(policy, parked, F.Request{pool, None{}, model}, now) == F.Keep{} : F.Decision}
```

It reads: for every policy, every list of recorded refusals, every pool, model and time, `decide` of a request with no login (`None{}`) equals `Keep`. `F.` names the model in `model.bend`.

The rest of the notation:

| Form | Reads |
| --- | --- |
| `for x: T` | for every `x` of type `T` |
| `for h: P` | if `P` holds (`h` names the hypothesis) |
| `exs y: T` | there is a `y` of type `T` |
| `{a == b : T}` | `a` equals `b` |
| `{a != b : T}` | `a` does not equal `b` |
| `A & B` | both `A` and `B` |
| `Or(A, B)` | `A` or `B` |
| `A -> B` | if `A` then `B` |
| `Some{x}`, `None{}` | a value that is present, or absent |
| `+x` | the proof may use `x` more than once; it does not change what the law says |

Helper definitions used in a law, such as `Recorded`, `Within` and `AllResetBy`, are in `LAWS.bend` above the laws, each with a one-line description.

## Running the checks

```sh
bun run prove                         # bun tooling/bend.ts check
bun tooling/bend.ts check --verdict   # recheck with the Lean-proven kernel, as CI does
bun run prove:models                  # bun tooling/bend.ts models --check: the drift gate
bun tooling/bend.ts models            # recompile every model.mjs after changing a model.bend
```

The first run downloads Bend 2.0.40 into `.tools/` and checks it against a pinned sha256. The first `--verdict` run also downloads Lean 4.34.0 the same way, builds the kernel once into `.tools/bendtt/`, and removes Lean. Every file the tools write stays inside `.tools/`. Telemetry is off.

Exit codes: `0` when everything passes; `1` when a proof does not check or a `model.mjs` has drifted (`FAIL`); `2` for a usage error, when the tools cannot be installed, or when Bend or the kernel cannot run (`ERROR`). Each line names the file, and a failure prints Bend's message under it.

## When a proof stops checking

`SOME PROOFS FAIL` means a proof did not go through. It does not mean the law is false, and Bend gives no counterexample. A proof can stop checking because the model changed in a way the law survives, because a step of the proof followed the old code, or because the law is false.

Investigate with the property tests, which run the shipped code on generated inputs and shrink a failure to a small counterexample. If they find one, the law is false for the code and the code or the spec is wrong. If they find none, repair the proof. A law is never weakened to make a proof check.

A check nobody has seen fail proves nothing. Each of F1 and F4 was broken on purpose in a scratch copy of its model, the proof stopped checking, and the compiled broken model gave a concrete counterexample:

| Law | Change to the model | Counterexample from the broken model |
| --- | --- | --- |
| F1 | A request without a login is decided as login 0 | A request with no login, after a refusal for login 0, is diverted |
| F4 | A login stays parked at its reset (`<=` for `<`) | With one refusal resetting at 100, a request at `now = 100` is diverted |
