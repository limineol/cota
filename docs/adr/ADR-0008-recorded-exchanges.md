---
status: accepted
scope: apps/hub
owner: limineol
last_verified: 2026-11-12
review_by: 2027-02-12
supersedes: []
code:
  - apps/hub/src/shared/05-tests/replay/exchanges
  - apps/hub/src/shared/05-tests/replay
  - apps/hub/src/modules/recording
---

# ADR-0008: Wire formats are held by recorded exchanges

## Context

The hub reads three protocols it does not own, sent by four clients that change every week. ADR-0004 says what is not proved is tested, "with recorded fixtures where there is a wire format". A fixture written from documentation tests the author's reading of the documentation. A fixture recorded from real traffic tests the hub against the provider.

Real traffic is also the owner's: prompts, file contents, account ids, logins. None of it may be committed.

## Decision

- **An exchange is kept as one request and its response as the hub saw them:** method, path, headers and body in, status, headers and body out. The exchanges live with the hub's tests, one file each.
- **Exchanges are recorded through the hub itself.** A recorder, off unless the environment variable `COTA_RECORD_TO` names a directory when the hub starts, writes each exchange after scrubbing it (`apps/hub/src/modules/recording/02-application/commands/record-exchange.command.ts`). What a client sends through a hub differs from what it sends direct, so a recording made any other way would test the wrong thing. The switch is not in the config file, which is deployed and copied: recording is a short act on one machine.
- **Scrubbing keeps structure and drops content, by allow-list** (`apps/hub/src/modules/recording/03-domain/scrubber`; the lists are `vocabulary.ts`, and the recorder spec says how they are used). The keys a protocol defines, numbers, booleans and nulls are kept. A string is kept only under a key on the allow-list (types, roles, model ids, stop reasons, event names, error types and codes) and when it passes that key's rule; every other string is replaced by a filler that tells only its length class. A key the protocol does not define, and every key inside a tool's input or schema, is replaced, and so is every string and number under it. JSON inside a string, a JWT's claims and a tool's input spread over stream deltas are scrubbed inside. A header is kept only when its name is on the allow-list, and its value only when it is a word of the protocol; any other header is dropped, name and all, as are the hub's own `x-cota-*` headers and cookies. Logins and identifiers are replaced by fixed fakes, counted and never computed from the real value. Nothing is kept because it looked harmless.
- **Every exchange says where it came from:** `recorded` (date, client and version) or `constructed` (the document or source it was written from). A refusal cannot be recorded on demand, so refusals start as constructed and are replaced when one is caught.
- **The replay test runs the real hub.** It starts the hub and a fake provider on real sockets, plays each exchange's request at the hub, serves its response from the fake, and asserts three things: the provider received the bytes the client sent, the client received the bytes the provider sent, and the request it logs is the one the exchange file expects.
- **A client upgrade is a re-recording.** Each recorded exchange names the client version. A new version is recorded beside the old until the old is no longer supported.

## Consequences

- The scrubber is the one thing between the owner's data and a public repository. Its laws (recorder spec: S1, nothing real survives; S2, a scrubbed exchange still replays) are held by properties and mutants, and a recording is still read by a person before it is committed, with `bun run replay:strings` listing every string left in it (`apps/hub/src/shared/05-tests/replay/exchanges/README.md`).
- A recorded exchange arrives with its expectation empty; `bun run replay:expect` writes it once the file has been read.
- Scrubbed text has no meaning, so recorded exchanges cannot test anything that depends on what the text says. Nothing in the hub may.
- An exchange written from documentation can be wrong in the way its author was. The label says which ones to trust less.
