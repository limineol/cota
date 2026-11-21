---
status: accepted
scope: apps/hub
owner: limineol
last_verified: 2026-11-12
review_by: 2027-02-12
supersedes: []
code:
  - apps/hub/src/modules/relay
  - apps/hub/src/lib/tee.ts
  - apps/hub/src/lib/copy.ts
  - apps/hub/src/hub.ts
---

# ADR-0006: The relay forwards bytes, and the pool is in the path

## Context

ADR-0001 decided that the hub forwards each request in the protocol it arrived in. This record decides how: what a client's URL looks like, what the hub may touch on the way through, and what it reads.

The prototype shows what goes wrong when a gateway owns the request. Bifrost parsed every body and wrote it again, so it had to strip a pool prefix from the model id, force a usage option into streams, rename a token-limit field for one provider, and decompress Codex's bodies before it could do any of that. Each rewrite was a place where a client update could break. Codex needed four patches because of an allow-list of routes that fell behind every release.

Three facts about the clients shape the answer:

- Codex turns features off unless its provider's base URL ends in `/backend-api/codex`, and it compresses request bodies with zstd.
- Codex and Claude Code both treat a 401 as "my login is bad" and start a new login.
- Codex stops reading a stream at its last event and hangs up, before the provider closes it.

## Decision

- **The pool is in the path.** A client is configured with `{hub}/pools/<pool>` as its provider's base URL. The hub strips that prefix and appends the rest, with the query exactly as sent, to the pool's base URL. No header and no field in the body chooses the pool, so nothing in the body is ever rewritten to remove one.
- **The body is forwarded as the bytes that arrived**, compressed if it arrived compressed. The response body goes back as the bytes the provider sent, with its `content-encoding`. The hub reads a copy.
- **Any path under the pool's base URL is forwarded.** There is no allow-list of routes to fall behind a client. The protocol's adapter recognises the operations it knows; anything else is forwarded and recorded as `other`.
- **Headers are forwarded except four groups:** the connection's own (`connection`, `keep-alive`, `transfer-encoding`, `te`, `trailer`, `upgrade`, `proxy-*`, `host`, `content-length`), the hub's (`x-cota-*`), cookies, and the credential where the pool's kind says the hub supplies it. The hub adds one header of its own to a provider's request, `accept-encoding: identity` when the client sent none, and one to the client's response: `x-cota-request`, the request's id.
- **The credential follows the pool's kind.** A subscription pool's request goes out with the login it came in with, or, when the `Fallback` service says divert, with the fallback pool's kept login. A keyed pool's request goes out with the held key, or with no credential when the pool has none; whatever credential the client sent is dropped. The held key goes out in the header the client's own credential came in: `x-api-key` when the request carried one, otherwise `authorization: Bearer`, never both. Anthropic's API takes a key in `x-api-key`, while the providers that speak its protocol for a coding plan document a bearer token, so the owner configures a client as its provider's documentation says, with a hub key in place of the provider's key, and the hub swaps one for the other.
- **Reading never slows or breaks forwarding.** The copy of the response is parsed on the side with bounded memory. If the parser falls behind, fails, or meets something it does not know, the client still gets every byte, and the request log says the reading was incomplete.
- **A request is finished at its last event, not at the end of the connection.** When the protocol's stream has a terminal event, the request is finished there. A client that hangs up after it is not a cancellation.
- **The hub's own refusals are never 401.** A missing or wrong hub key is 403; an unknown pool is 404; a provider that cannot be reached is 502, and one that does not answer in time is 504. Each carries `x-should-retry: false` and a JSON body both families of client can show.
- **No retries, no WebSockets.** The hub sends a request once, except the one resend that a divert is. Clients retry by their own rules. A WebSocket upgrade is refused; Codex then uses HTTP for the session.

## Consequences

- A client update that adds a route, a header or a body field works without a hub release, unless the request log wants to read the new thing.
- The hub cannot fix a client's request for a provider. Where the prototype's gateway translated (a token-limit field one provider ignores, a provider-specific thinking option), the client's configuration has to be right. That belongs to the client installer (Milestone 4).
- One provider per pool path means OpenCode and Pi get a provider entry per keyed pool instead of one entry with prefixed model ids.
- Bun resolves dot segments in a path and joins repeated request headers before the hub sees them, so "as sent" is exact for the query and the body, and equivalent for the rest.
- Bun's fetch sends `accept: */*` and `user-agent: Bun/<version>` to the provider when the client sent neither, and a response with a body but no `content-type` reaches the client as `application/octet-stream`, which Effect's streamed response sets. Real clients send both. ChatGPT's Codex backend sends its event stream with no `content-type`, so Codex gets it as `application/octet-stream`, and reads it the same.
- The hub must decompress a copy of whatever a provider or client compresses: gzip, deflate, brotli and zstd, each with a size limit.
