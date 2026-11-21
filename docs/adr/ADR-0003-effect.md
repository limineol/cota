---
status: accepted
scope: repository
owner: limineol
last_verified: 2026-11-14
review_by: 2027-02-11
supersedes: []
code:
  - apps/hub/src/shared/03-domain
  - apps/hub/src/modules/admission/03-domain
  - apps/hub/src/modules/relay/03-domain/fallback.ts
  - apps/hub/src/modules/request-log/03-domain
  - apps/hub/src/modules/quota/03-domain
  - tooling/boundaries.ts
---

# ADR-0003: Effect 4 for all logic, the domain included

> Amended by ADR-0010: the domain is the `03-domain` folders of `apps/hub`, not a package of its own, so it inherits `apps/hub`'s list of allowed unstable APIs; the boundaries tool's in-process list is what keeps it off them.

## Context

A hub is streams, timeouts, retries, cancellation when a client hangs up, background refreshes and resources that must be released. Effect 4 gives each of those a typed, testable form, and makes a function's dependencies and failures part of its signature. It became stable in October 2026.

The domain could have been left as plain functions that take `now` as an argument. It is not: the decisions it makes depend on time and on state that concurrent requests share, and those are exactly what Effect models. One way of writing logic, everywhere, is worth more than a second style for the smallest package.

## Decision

- **All logic is Effect**, in the domain and in the shell alike.
- **A concept that holds state is a service.** It is a `Context.Service` with a `layer` that builds it, in a module named for the concept and imported as a namespace, the way Effect's own modules are: `Fallback.Fallback` is the service, `Fallback.layer(policy)` builds it, `Fallback.Decision` is a type. Its state lives in a `Ref` and changes only through its operations.
- **A calculation that needs the time is an effect.** It reads the clock through `DateTime.now`; it does not take `now` as an argument. Tests move time with `TestClock`.
- **Operations are `Effect.fn` with a name** (`Effect.fn("Fallback.decide")`), so every decision is a span.
- **Nothing is wrapped for show.** A private helper that needs neither time, state nor a service stays a plain function. What a package exports to be called is an effect or a service.
- **The domain has no IO.** It reaches the world only through the clock and through services it declares. From `effect` it imports only the modules listed in `tooling/boundaries.ts`: the data modules `Schema`, `Option`, `Result`, `DateTime`, `Duration`, `HashMap`, `HashSet`, `Array`, `Order`, `Equal`, `Data`, `Match`, `Predicate` and `Function`, and `Effect`, `Context`, `Layer`, `Ref`, `Clock`, `Redacted` and `Fiber`. `Redacted` holds a secret in a domain value so that printing it prints `<redacted>` (a quota login's tokens); `Fiber` lets a one-at-a-time service of the domain run the work its callers give it to its end in the service's own scope, whoever still waits for it (the quota module's `Readings` and `Refreshes`, ADR-0010). Neither reaches outside the process. Its tests may also import `Arbitrary`, `effect/testing` and `@effect/vitest`. Nothing that reaches outside the process is on that list, and adding a module is a reviewed change to it. `bun run boundaries` fails on anything else.
- **Types are Schemas.** A type is declared once, as a `Schema`, and its TypeScript type is derived from it. The same declaration decodes untrusted input at the boundary and generates inputs for property tests.
- **Generators, not chains.** Effect code is `Effect.gen` or `Effect.fn` with early returns. `pipe` wraps a finished effect in a policy (retry, timeout, span, a provided layer). If the logic of a function lives in a chain of combinators, rewrite it.
- **Errors are tagged values.** An expected failure is a `Schema.TaggedError` in the error channel. A defect is a bug and is allowed to crash the fibre; nothing in the application layer catches one. An operation that cannot fail has `never` there, and no error is invented to fill it.
- **A port is a `Context.Service`; an adapter is a `Layer`.** The composition root is the only place layers are joined.
- **The type check knows Effect.** `bun run typecheck` runs `@effect/tsgo`, the TypeScript compiler with Effect's diagnostics. An effect that is built and never run, or a `yield` without its `*`, type-checks in plain TypeScript and does nothing at run time; here it is an error.
- **Unstable modules stay behind our own services.** Effect marks stability per export. Its HTTP modules (`effect/http`), its SSE decoder (`effect/encoding/Sse`) and the Bun platform package (`@effect/platform-bun`) are marked unstable and may break in a minor release. Only adapters import them, so a break is fixed in one place. The type check fails on any API its authors mark unstable unless the package's tsconfig names it in `allowedUnstableApis`. The base list, which the domain inherits, is the two the tests need: `@effect/vitest` and `effect/Arbitrary`. An app that needs more repeats the plugin entry in its own tsconfig with its own list, so the domain's list stays short.
- **Versions.** `effect` and every `@effect/*` package are pinned to one exact version and upgraded together, with the changelog read.

## Consequences

- The hub gets the domain as services it provides, not as functions it must wrap in state and time itself.
- Reading the domain takes knowing Effect's generators, services and layers. That is the price of one style.
- A proof is about a model of a decision, and the decision now runs inside an effect. The agreement tests (ADR-0004) run the real service, with the test clock set to each generated time, against the model.
- We depend on modules their authors mark unstable. The adapters are where that risk is held.
