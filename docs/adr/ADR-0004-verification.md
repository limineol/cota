---
status: accepted
scope: apps/hub, proofs
owner: limineol
last_verified: 2026-11-12
review_by: 2027-02-11
supersedes: []
code:
  - apps/hub/src/shared/03-domain
  - apps/hub/src/modules/admission/03-domain
  - apps/hub/src/modules/relay/03-domain/fallback.ts
  - apps/hub/src/modules/request-log/03-domain
  - apps/hub/src/modules/quota/03-domain
  - proofs
  - tooling/mutants.ts
---

# ADR-0004: Laws, and three ways to hold code to them

> Amended by ADR-0010: the domain whose laws this holds is the `03-domain` folders of `apps/hub`, which `proofs` imports through `@cota/hub`'s exports.

## Context

Some of what Cota does is a promise for every input: a request without a login is never diverted; a refusal for one login never moves another's requests. A test checks the cases someone thought to write. A promise needs more.

No tool proves properties of TypeScript itself. A proof is always about a model, and a model that drifts from the code proves nothing while still passing. So the question is never "is it proved" but "what is proved, about what, and what ties that to the code that ships".

## Decision

A promise the domain makes is written as a **law**: one plain sentence in the concept's spec, with an id. Each law is held by the strongest of three tiers that fits it, and the spec says which.

1. **Property tests of the shipped code.** Every law is checked against the real service with generated inputs, derived from the same Schemas the code declares, and with the test clock set to generated times. This tier is the backbone: it is the only one that runs the code that ships. Its inputs are sampled, so a pass is evidence, not proof.
2. **A proof about a model.** A law that holds over every history, and whose failure would bill the wrong pool or misreport a quota window, is also proved in Bend 2 over a small model of the function. CI rechecks the proofs with Bend's Lean-proven kernel (`--verdict`). A pass covers the model.
3. **Agreement between the two.** Bend compiles the proved model to a JavaScript module, which is committed. A test runs generated histories through both the model and the shipped service and requires the same answer. This is what ties a proof to the code: the laws are proved of the model, and the code is shown to agree with the model wherever we look.

Around the tiers:

- **Mutants.** `bun run mutants` breaks the shipped code in named ways, one per law, and requires a test to fail with a concrete counterexample. A check nobody has seen fail proves nothing. A mutant that survives, no longer applies because the code moved, or does not type-check fails the gate: a test that fails because the program cannot run has noticed nothing. A mutant names its test by title, and where a law is tested under its title in more than one file, any of those tests failing kills it. The gate runs every property from one seed, so a property draws the same cases each time and a verdict does not change from run to run; `bun run test` draws new cases every run.
- **Drift.** CI recompiles each model and fails if the committed JavaScript differs, so the model that was proved is the model that is tested.
- **One command.** `bun run verify` runs every tier and writes what it ran and what it found to `evidence/`.
- **A skill.** `.agents/skills/verify-domain` tells the next agent what each check covers, which files it mirrors, and the commit at which someone last confirmed that the model describes the code.

What is not proved is said plainly: anything with floating-point arithmetic, parsing of provider formats, hashing, and everything in the shell. Those are tested, with properties where there is a law and with recorded fixtures where there is a wire format.

## Why Bend

Bend 2 is fast (a check takes under a second), needs one binary, and compiles its models to JavaScript, which is what makes tier 3 possible without a second runtime. Its limits are real and accepted here: it is young, it has no proof automation and almost no arithmetic library, its compiler front end is unaudited (only the kernel is proved), and it has no 64-bit integers, so models use natural numbers. Lean 4 is the fallback if any of that starts to cost more than it gives.

## Consequences

- A law costs three artifacts. That price is the filter: most code gets tier 1 only, and that is correct.
- A Bend proof that stops checking does not show the law is false, and gives no counterexample. The property tests do. A failing proof is investigated with them, never fixed by weakening the law.
- Contributors do not need Bend to run the tests: the compiled models are committed.
