---
status: accepted
scope: repository
owner: limineol
last_verified: 2026-11-11
review_by: 2027-02-11
supersedes: []
code:
  - tooling/docs-check.ts
---

# ADR-0005: Documentation as managed context

## Context

Stale Markdown becomes an instruction to an agent. A document nobody is made to revisit is wrong within months and still read as true.

## Decision

- `docs/adr` holds decisions. `docs/specs/<concept>/spec.md` holds behaviour: what the code does, its laws and what it deliberately does not do. `CONTEXT.md` holds meaning. `docs/roadmap.md` holds the plan.
- Every document under `docs`, and `CONTEXT.md`, carries front matter: `status` (draft, active, accepted, superseded, archived), `scope`, `owner`, `last_verified`, `review_by`, `supersedes`, and the `code` paths it describes.
- Only `accepted` ADRs and `active` specs are authoritative. Code and executable checks outrank prose.
- `AGENTS.md` is the one agent policy: an index and the rules, not an encyclopaedia. `CLAUDE.md` only includes it.
- `bun run docs:check` fails on missing front matter, a `review_by` date that has passed, a `code` path that does not exist, and a `supersedes` entry whose target is not marked superseded.

## Consequences

- A review date that passes fails the gate. The fix is to read the document against the code and move both dates, which is the point.
