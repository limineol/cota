---
status: accepted
scope: repository
owner: limineol
last_verified: 2026-11-11
review_by: 2027-02-11
supersedes: []
code: []
---

# ADR-0001: The hub is one process we write, not a gateway we wrap

## Context

The prototype put Bifrost, a general LLM gateway, at the centre and built around it. That taught us what the hub needs, and what wrapping a general gateway costs:

- **A fork.** Codex's ChatGPT login only passes through Bifrost with four patches that are still open upstream, so the prototype runs a locally built image. A public project cannot ask people to build a fork.
- **Three services for one job.** Caddy routes work-account requests to a separate fallback service, which calls Bifrost. The fallback decision, the most delicate logic in the system, sits in a side service because the gateway has no place for it.
- **A log shaped by someone else.** Bifrost logs a request's whole history again with every request: 76 GB in twelve days, and one disk-full outage. The prototype answers with refreshable views that de-duplicate after the fact, an archiver, and a job that empties the log once the archive is verified.
- **Unused weight.** Bifrost's value is translating between provider protocols and managing provider keys. The hub translates nothing: every client speaks its own provider's protocol, and the hub forwards it.

## Decision

The hub is a single Effect program that we write. It forwards requests in the protocol they arrive in (Anthropic Messages, the ChatGPT Codex backend, OpenAI-compatible Chat Completions), reads the response stream as it passes to record usage, and writes the request log itself.

- **No translation.** A request leaves in the protocol it arrived in. A client is only ever sent to its own provider.
- **Fallback is in the request path**, as a decision the `Fallback` service in `apps/hub/src/modules/relay/03-domain` makes and the hub applies.
- **Conversations are stored once, at ingest.** The hub stores each conversation item by content hash as the request passes, so there is nothing to de-duplicate or empty later.
- **One container, plus ClickHouse.** TLS and public names are the owner's reverse proxy's job, with a documented recipe, not a service we ship.
- Bifrost stays the reference for behaviour we have to match. The patches written for it record what Codex needs.

## Consequences

- We own protocol fidelity: stream framing, Codex's extra routes, compressed request bodies, session headers. That is paid for with recorded provider traffic replayed against the real hub (`docs/roadmap.md`, Milestone 1).
- We give up Bifrost's provider catalogue, its admin UI and protocol translation. A provider that is not Anthropic, ChatGPT or OpenAI-compatible is out of scope until someone needs one.
- The prototype's data lives in Bifrost's schema. Moving it is an importer, planned last.
- Everything in this decision is still cheap to reverse: Milestone 0 ships no hub code. It gets expensive after Milestone 1.
