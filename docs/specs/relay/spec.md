---
status: active
scope: apps/hub
owner: limineol
last_verified: 2026-11-23
review_by: 2027-02-23
supersedes: []
code:
  - apps/hub/src/hub.ts
  - apps/hub/src/modules/relay
  - apps/hub/src/modules/admission
  - apps/hub/src/lib/copy.ts
  - apps/hub/src/lib/tee.ts
  - apps/hub/src/shared/04-infrastructure/shutdown.ts
  - apps/hub/src/shared/03-domain/client.ts
  - apps/hub/src/main.ts
---

# Relay

The relay is the hub's request path: it takes a client's request, decides whether and with which credential to forward it, forwards it, and hands what it saw to the request log. This spec covers that path, which is the relay module (`apps/hub/src/modules/relay`; paths below are under it). ADR-0006 gives the reasons; the protocols' own rules are in `docs/specs/protocols`, and what is recorded is in `docs/specs/request-log/spec.md`.

## The request a client sends

```
<method> {hub}/pools/<pool>/<rest>?<query>
x-cota-key: <hub key>
x-cota-project: <project>      optional
x-cota-machine: <machine>      optional
x-cota-client: <client>        optional
…the client's own headers and body
```

- `<pool>` is a pool's id from the configuration.
- `<rest>` and `<query>` are whatever the client appends to its provider's base URL.
- The **hub key** is the value of `x-cota-key`. A request to a keyed pool that has no `x-cota-key` presents the bearer token of its `authorization` header instead, because OpenCode and Pi can only send their key there, and without a bearer token its `x-api-key`, where Claude Code sends `ANTHROPIC_API_KEY`. A request to a subscription pool presents only `x-cota-key`, and a request to a pool the hub does not have is read as a subscription pool's, so the answer to a request without a known hub key says nothing about which pools exist. The admission module decides which value is presented (`docs/specs/admission/spec.md`).
- The **tags** are the three optional headers. A tag is trimmed and cut to 200 characters. A missing tag is recorded as empty.
- The request's **client** is its `x-cota-client` tag, else the one its user agent names (`docs/specs/request-log/spec.md`, `client`), by `Client.of` (`apps/hub/src/shared/03-domain/client.ts`). A forwarded request never claims a **reported client** (`antigravity`, ADR-0029, Relayed or reported, never both): a tag naming one, in any case, is passed over as if the request had none, and a user agent naming one makes the client `unknown`. The request is forwarded and recorded all the same; it is not refused, since the tag is the client's own word and refusing it would stop a request for a label.

`GET /health` answers `200` with `{"status":"ok"}` and needs no hub key.

## Steps

The route (`01-presentation/relay.routes.ts`) turns a request under `/pools/` into a call to the `ForwardRequest` command (`02-application/commands/forward-request.command.ts`), and its answer into the response. In this order:

1. **No WebSocket.** The route answers a WebSocket upgrade with 426 before anything else.
2. **Admit.** `ForwardRequest` asks the admission module's `AdmitRequest` query with the pool and the values that can be the hub key: `x-cota-key`, the bearer token of `authorization`, and `x-api-key` (`docs/specs/admission/spec.md`). On a rejection, the route answers with the hub's error (below) and stops. Nothing is recorded in the request log.
3. **The path and the method.** A path the pool's protocol does not serve, or a method the hub does not relay, is answered 404 and stops.
4. **Read the body**, whole, up to the body limit. Over the limit, answer 413, close the connection, and stop.
5. **Describe.** The pool's protocol reads the method, path, headers and a decoded copy of the body, and says what the request is: its operation, model, session and whether it streams. A body that cannot be decoded or parsed is still forwarded; the request is then described from its path and headers alone.
6. **Choose the credential** (next section), by the `PlanCredential` query (`02-application/queries/plan-credential.query.ts`).
7. **Forward.** `ForwardRequest` gives the request to the provider port (`02-application/interfaces/provider.ts`), whose adapter (`04-infrastructure/provider/http-provider.ts`) sends it to the pool's base URL plus `<rest>?<query>` and streams the response back.
8. **Read** a copy of the response as it passes. When the request is finished, the provider adapter gives it to the request log's `RecordRequest` command.

## Choosing the credential

**A keyed pool.** Every credential the client sent is removed (`authorization`, `x-api-key`, `api-key`, `x-goog-api-key`). If the pool has a held key, it is set in the header the client's own credential came in: `x-api-key: <held key>` when the request carried an `x-api-key` that is not empty, otherwise `authorization: Bearer <held key>`, never both. A client is configured as its provider's documentation says, with a hub key in place of the provider's key, and the provider gets its key where it expects it. A pool without a held key is sent no credential.

**A subscription pool.** Its hub key comes only from `x-cota-key`, since its `authorization` carries the login. The request's **login** is the bearer token of its `authorization` header (the header's whole value when it is not a bearer token) or, without one, its `x-api-key`; the same login sent either way is the same login. The hub takes the login's fingerprint as the protocol says to, and asks `Fallback.decide` with the pool, the fingerprint and the model. A request without a login, or without a model, is not asked about: it is kept. Nor is a request to a pool whose protocol knows a refusal only from the body (ChatGPT's): such a pool has no fallback pool, so it is kept, its refusal is recorded in the request log and passed on, and nothing is parked.

- **Keep**: forward with the client's own credential headers, untouched.
  - If the answer is a **refusal** (the protocol says what one is), and the request has a login and a model: call `Fallback.record` with the fingerprint, the model and the refusal's reset, then `Fallback.decide` again.
    - If that says **divert**: drop the refused response, and forward the same request once more as below. The refused request and the diverted one are two requests in the request log; the second names the first, and is stamped with the moment it was sent again.
    - If it says **keep** (the pool has no fallback pool): the client gets the refusal as the provider sent it.
- **Divert**: forward with the fallback pool's kept login in place of the client's credential (every credential header the client sent is removed, and `authorization: Bearer <kept login>` is set), to the fallback pool's base URL. The diverted request bills the fallback pool and says which pool it was diverted from. Whatever the fallback pool answers, a refusal included, goes to the client. A request is diverted at most once, and a refusal of a diverted request is not recorded with `Fallback`.

**When a refusal is known.** Whether an answer is a refusal is decided before its first byte reaches the client, from what the protocol needs: Anthropic's needs the status and headers only, so a successful stream is never held back. A dropped refusal is not read: its provider connection is released, nothing of it reaches the client, and it is recorded with the status and the headers' readings but no body (`response_bytes` 0, no error body). A protocol that needs the start of the body knows only once the body has passed to the client; its refusal is recorded in the request log and passed on, and a pool that speaks it has no fallback pool to divert to and is not asked about (`docs/specs/protocols`).

The hub runs `Fallback.forget` once a minute.

## Forwarding

**Request headers.** All are forwarded except:

- the connection's own: `connection`, `keep-alive`, `proxy-connection`, `proxy-authenticate`, `proxy-authorization`, `transfer-encoding`, `te`, `trailer`, `upgrade`, `host`, `content-length` (the last two are set again for the provider);
- every header whose name starts with `x-cota-`;
- `cookie`;
- the credential headers, as the section above says.

If the client sent no `accept-encoding`, `accept-encoding: identity` is sent, so the provider does not compress an answer the client did not ask to have compressed. The hub adds nothing else, though Bun's fetch, which sends the request, adds `accept: */*` and `user-agent: Bun/<version>` when the client sent neither.

**Request body.** The bytes that arrived, with their `content-encoding`.

**Response.** The provider's status, headers and body bytes go back to the client as they arrive, except the connection's own headers. `content-length` is not kept: the body is sent in chunks. `set-cookie` is passed on. The hub adds `x-cota-request: <id>`, the request's id in the request log. A response with a body and no `content-type` gets `application/octet-stream`, which Effect's streamed response sets. A redirect is passed to the client, not followed.

**Limits.** All can be set in the configuration.

| Limit | Default | Over it |
| --- | --- | --- |
| Request body | 128 MiB | 413 |
| Decoded copy of a compressed body | 256 MiB | forwarded; the conversation is not recorded |
| Time for the provider to send its status and headers | 10 minutes | 504 |
| Copy of a response read for the request log, buffered | 256 chunks | forwarded; the reading is marked incomplete |
| Answer that is not a stream, read for the request log | 16 MiB | forwarded; the reading is marked incomplete |

There is no limit on how long a response may stream, and no timeout while it is quiet. Clients have their own.

Only what is read is held. The copy of an answer is read when the protocol reads the request's operation (`docs/specs/protocols`), and the body of an answer of 400 or above that is not a stream is kept up to 64 KiB for its error; every other answer is counted as it passes and not kept.

## When a request is finished

The first of these finishes the request, with its outcome:

| What happened | Outcome |
| --- | --- |
| The protocol's stream reached its terminal event, or a response that is not a stream ended, with a status under 400 | `ok`, unless the terminal event itself reports a failure (`error`) |
| The provider answered with a recognised refusal | `refused` |
| The provider answered 400 or above, otherwise | `error` |
| The provider could not be reached, did not answer in time, or broke the stream before its terminal event | `error` |
| The client hung up before any of the above | `cancelled` |
| The hub was shutting down and cut the stream | `error`, with the hub named as the cause |

An answer is an **event stream** when its `content-type` is `text/event-stream`, or when it has no `content-type`, its status is under 400 and the request asked for a stream: ChatGPT's Codex backend sends its streams without one. Any other answer is not a stream, whatever the request asked for.

After a terminal event the hub keeps passing bytes until either side closes, and a client that hangs up then is not a cancellation.

The hub names itself in `error_type` with `cota_provider_unreachable` and `cota_provider_timeout` (as below), `cota_stream_broken` when the provider broke a stream or ended it before its terminal event, `cota_hub_shutdown` when the hub cut it, and `cota_hub_failed` when the hub itself failed while forwarding.

When the client hangs up, the request to the provider is aborted.

## Stopping

On `SIGINT` or `SIGTERM` the hub stops in this order:

1. It stops accepting connections.
2. It gives the requests in flight 20 seconds (the grace period) to finish.
3. It cuts what is left: each such request is recorded as `error`, `cota_hub_shutdown`.
4. It gives the requests that are still finishing, their answers sent but their copies still being read (up to 5 seconds each, as always) or not yet given to the request log, 6 seconds more, and cuts those left, which are recorded with what was read of them.
5. It gives the request log's `RecordRequest` 10 seconds to write what it holds (`docs/specs/request-log`).

A stopped hub has therefore given the request log every request it forwarded. It exits with status 0. Stopping can take 36 seconds, so whatever runs the hub must wait at least 40 before killing it (a container's stop grace period is 10 by default).

## The hub's own errors

A request the hub answers itself gets this body, which both Anthropic's and OpenAI's client libraries can show, and the header `x-should-retry: false`:

```json
{ "type": "error", "error": { "type": "<type>", "message": "<a sentence>" } }
```

| Case | Status | `error.type` |
| --- | --- | --- |
| No hub key, or one the hub does not know | 403 | `cota_hub_key_rejected` |
| The hub key's scope does not open this pool | 403 | `cota_hub_key_scope` |
| No such pool | 404 | `cota_unknown_pool` |
| The path is not one the pool's protocol serves (see `docs/specs/protocols`), or the method is not one the hub relays | 404 | `cota_unknown_path` |
| The body is over the limit | 413 | `cota_body_too_large` |
| A WebSocket upgrade | 426 | `cota_no_websocket` |
| The provider could not be reached | 502 | `cota_provider_unreachable` |
| The provider did not answer in time | 504 | `cota_provider_timeout` |

The hub never answers 401: both Codex and Claude Code take a 401 to mean their login is bad, and start a new one.

Messages are for the owner. They say what happened and what to check, and never include a key, a login or a header value.

## Laws

| Id | Law | Held by |
| --- | --- | --- |
| R1 | **Bytes in, bytes out.** For every forwarded request, the provider receives exactly the body the client sent, and the client receives exactly the body the provider sent. | property, replay |
| R2 | **The hub's secrets stay in the hub.** A hub key and a tag never reach a provider. A held key and a kept login never reach a client. No hub key, held key, kept login or login reaches the request log or a log line. | property, replay |
| R3 | **A subscription is spent only by a login.** A request to a subscription pool reaches a provider with the credential it came with, or, when `Fallback` answered divert, with the fallback pool's kept login. It never reaches a provider with a held key. | property |
| R4 | **A keyed pool never sees a client's credential.** A request to a keyed pool reaches the provider with the pool's held key or with none. | property |
| R5 | **Reading cannot break forwarding.** Whatever the copy's reader or the recorder does (falls behind, fails, never finishes), the client receives the provider's full response. | property |
| R6 | **Recorded once.** Every request the hub sends to a provider is recorded in the request log exactly once, whatever the outcome; a rejected request is not recorded. | property, replay |
| R7 | **Never a reported client.** A forwarded request's client is never a reported client, whatever its tag and user agent. | property |

The property tests run the real hub against a fake provider on real sockets, with generated requests, bodies and responses. R5 also has one fixed case, a recorder that hangs after the first of 24 events, since a generated case holds the recorder's queue full only now and then. R7 runs `Client.of` over generated tags and user agents that name the reported clients in several cases, the forwarded clients and others (`apps/hub/src/shared/03-domain/client.test.ts`). "Replay" replays the exchanges of ADR-0008 through the real hub.

## Not built, on purpose

- **Retries.** The hub sends a request once. Clients retry by their own rules, and each retry is its own request in the request log.
- **WebSockets.** Codex can speak Responses over a WebSocket; through a provider that does not offer it, it uses HTTP.
- **Reading routes.** Routes are kept on the hub and answered to a launch (`docs/specs/routes/spec.md`), which puts the pool they choose in the URL; the relay never reads them, and forwards a request that names another pool as any request.
- **Changing what a client asked for.** The hub does not add a usage option to a stream, rename a field for a provider, or strip one. When a client does not ask for usage, the request log says usage was not reported.
- **Limits of the hub's own.** There is no rate limit and no budget per hub key.
- **TLS.** The hub listens on plain HTTP. Public names and certificates are the owner's reverse proxy's (Milestone 5 gives a recipe).
