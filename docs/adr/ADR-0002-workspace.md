---
status: accepted
scope: repository
owner: limineol
last_verified: 2026-11-12
review_by: 2027-02-11
supersedes: []
code:
  - package.json
  - tsconfig.base.json
  - biome.json
  - tooling/boundaries.ts
---

# ADR-0002: A Bun workspace that ships source

> Amended by ADR-0010: the domain is no longer its own package but the `03-domain` folders of `apps/hub`, and `tooling/boundaries.ts` also holds the hub's layer and module rules.

## Decision

- **Bun** is the package manager, script runner and runtime. `bun.lock` is the only lockfile. Root scripts fan out with `bun run --filter`. There is no Turborepo and no build step: workspace packages export their TypeScript source, and Bun and Vite run it.
- **TypeScript** runs with `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `isolatedModules` and `noEmit`. Imports carry their `.ts` extension. The compiler is run through `@effect/tsgo`, which adds Effect's diagnostics (ADR-0003).
- **Biome** lints and formats: the recommended rules, two spaces, double quotes, semicolons.
- **Imports never climb.** Inside a package, a file reaches a sibling folder through a `#` subpath import declared in that package's `package.json`, never through `..`. Across packages, a file imports the other package's declared `exports`. There are no barrels: an export names one concept (`@cota/hub/fallback`).
- **Boundaries are a script.** `tooling/boundaries.ts` holds one table of which package may import which, and which modules the domain may not. `bun run boundaries` reads every import and fails on a crossing. A new package adds its row before its first file.
- **Tests run on Vitest, on the Bun runtime** (`bun --bun vitest run`), because `@effect/vitest` does not load under `bun test`.

## Layout

```
proofs            Bend models and proofs of the domain's laws,
                  and the tests that hold the shipped code to them          (Milestone 0)
tooling           the scripts behind the gates
apps/hub          the server: the domain (no IO), relay, request log, quota (Milestone 0-2)
                  readers, API
apps/web          the dashboard                                             (Milestone 3)
packages/ui       the design system                                         (Milestone 3)
apps/cli          the client for each machine, and the installer            (Milestone 4)
evals             agent evals: install, design, memory                      (Milestone 3-5)
```

A folder is created when it has content.

## Consequences

- Nothing is compiled, so nothing can be stale. The cost is that every consumer must run TypeScript, which Bun and Vite do.
- The boundaries script is ours to maintain. It is small, and its table is the one place that says what depends on what.
