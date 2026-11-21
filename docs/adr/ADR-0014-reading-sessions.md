---
status: accepted
scope: apps/hub
owner: limineol
last_verified: 2026-11-13
review_by: 2027-02-13
supersedes: []
code:
  - apps/hub/src/modules/request-log
  - apps/hub/src/modules/relay/02-application/interfaces/protocol.ts
  - apps/hub/src/modules/relay/04-infrastructure/protocols
---

# ADR-0014: Sessions are read from structure, and rendered per protocol in the request log

## Context

A session's page shows its requests, which of them are the main conversation, where the conversation was compacted, and the transcript of each stretch. The prototype decided all of this from prompt text:

- a request whose first 400 characters contained "naming a coding session" was Claude Code's title request;
- among requests with tools, the 120-character prefix of the system prompt with the most input tokens was the main conversation, and the others were subagents;
- a new segment started when a successful request's input fell under half the previous one's, where "input" included cached tokens;
- the first prompt was the first user text that did not start with `<` or `# AGENTS.md instructions`;
- every transcript was OpenAI Responses items, because its gateway had converted every protocol to them.

Each rule broke or would break when a client reworded a prompt or two system prompts shared a prefix, and the archiver kept 400 characters of every request only to keep the first one working.

Cota has more to go on. The client's own word, where it gives one, is in `purpose` (`x-claude-code-request-class`: `main`, `auxiliary`; Codex's `x-openai-subagent` and `request_kind`: `review`, `turn`) and in the kept headers (`x-claude-code-agent-id`, `x-codex-parent-thread-id`). Each request's items are digests in order (`request_items`), so two requests with the same system prompt have equal `system` digests, exactly. Usage is stored by class, so the whole prompt is a sum. And the request log stores each protocol's own JSON (ADR-0007), so a transcript must be rendered per protocol at read time.

## Decision

**No rule reads the wording of a prompt.** Request roles, segments, titles and the first prompt are decided from the client's own word, from the request's structure (operation, outcome, the digests and layout of its parts, its params) and from usage. The rules, with their laws, are `docs/specs/sessions/spec.md`. In short:

- **Request role**, in this order: a request without a conversation is `utility`; a request whose params ask for a structured answer with the single required property `title`, as Claude Code's title request does, is `title`; a request the client marks as a subagent is `subagent`; a request whose `purpose` the protocol maps to a role has that role; otherwise a request without tools is `utility`, and the requests with tools are grouped into threads by their `system` digests (by their first `input` digest when they have no system part), the thread with the largest total prompt size is `main` and the others are `subagent`.
- **Prompt size** is input plus cache read plus both cache writes. Cota's input never includes cached tokens (ADR-0007), so the prototype's "input" is this sum.
- **Segments**: the main requests in order, a new segment starting with a successful main request whose prompt size is under half the previous successful one's in the segment, or with the first main request after one the client named a compaction. Each segment is read as the transcript of its tip, its last successful request.
- **Generated title**: the answer of the session's latest successful `title` request, read as the JSON object its params asked for.
- **First prompt**: the text of the last user message of the session's first main request: what the person said last before the model first answered.

These are decided when the session is read, from what `RecordRequest` stored; nothing about roles is written at ingest (the request log spec's "Classifying").

**Rendering stored items into a transcript is a request-log port with one adapter per protocol.** The port, `Transcripts` (`modules/request-log/02-application/interfaces/transcripts.ts`), takes a protocol's name and a request's items and gives transcript entries, values of `modules/request-log/03-domain/transcript.ts`. Its adapters are `modules/request-log/04-infrastructure/transcripts/<protocol>.ts`, one per protocol, collected in a registry the module's `module.ts` provides, as the relay's `Protocols` are. Adding a protocol adds its renderer here (AGENTS.md's checklist for a protocol gains the line).

## Alternatives weighed

For where the per-protocol rendering lives:

1. **A new member of the relay's `Protocol` port, reached through a relay query.** The knowledge of each wire format would stay in one folder per protocol, beside `describe`, the reader and `conversation.textOf`. But the request log would depend on the relay to read its own data, while the relay already depends on the request log's `RecordRequest`: the two modules would each call the other, and the request log's reading could not be built, tested or reasoned about without the relay's module. The `Protocol` port is what the relay needs to forward a request (its comment says so); rendering a stored item for a person is not that, and it would put a reading concern on the request path's port.
2. **A port in the request log with one adapter per protocol** (chosen). The request log reads what it stores, with no new dependency between modules: ADR-0010's rule that a module reaches another only through its commands and queries is not even exercised. The cost is that each protocol's item shapes are known in two places, the relay's protocol (to split, digest and take the text of items) and the request log's renderer (to show them). Both are held to the same recorded exchanges: the replay test renders every exchange's stored items, so a renderer that falls behind a protocol fails in the same run as the protocol's own tests.
3. **A module of its own (`transcripts`).** It would make the rendering a peer of the request log with a query the request log or the API calls. But it would own no state, no command and no port of its own beyond the renderers, and its only caller would be the request log: a module boundary with nothing on one side. If a second reader of stored items appears (the archive's restore, Milestone 5's importer), the port can move to `shared` then.

For deciding roles and segments:

- **Copying the prototype's prompt-text rules.** Rejected for the reasons in the context: they break silently when a client changes its wording.
- **Classifying at ingest and storing the role.** A role depends on the rest of the session (which thread has the most prompt), which is not known when a request is written, and a stored role could not be corrected when a rule improves. Reading decides it, from data that does not change.
- **Asking the client for every role.** Claude Code says `main` and `auxiliary` only when the owner sets `CLAUDE_CODE_GATEWAY_HINT_HEADERS=1`; OpenCode and Pi say nothing. The client's word is taken first where it exists, and structure decides the rest.

## Consequences

- The compaction rule still contains a threshold (half), the one heuristic kept from the prototype. It is stated as a law with its number, so changing it is a spec change. A client's own compaction marker, where one is recorded, makes the threshold irrelevant for that client; none is recorded yet for Claude Code or Codex (open in the sessions spec).
- The title rule depends on the shape of Claude Code's title request (`output_config.format` with a JSON schema whose only required property is `title`, recorded in `recorded-session-title.json`). If Claude Code changes it, generated titles stop appearing, loudly in the replay test, and reported titles (Milestone 4) still work.
- Rendering is lossy by design: an entry shows what a person reads. An item a renderer does not know is shown as its JSON, never dropped, and `GET /api/requests/{id}/body` gives the request's body as it was forwarded (`RebuildConversation`, L1), for when the rendering is not enough.
- A session's page reads its `request_items` digests (small) and, for the transcript of one segment, the items of one request. It never reads a session's whole text.
