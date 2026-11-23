---
status: accepted
scope: apps/hub
owner: limineol
last_verified: 2026-11-17
review_by: 2027-02-17
supersedes: []
code:
  - apps/hub/src/modules/sign-in
  - apps/hub/src/modules/admission
  - apps/hub/src/config
---

# ADR-0012: The owner reads by signing in, an agent by a reader key

## Context

The API (ADR-0011) shows everything the request log holds: every prompt, every tool result, every file a client read, and whatever secret the owner once pasted into a conversation. Two kinds of reader need it. The owner reads it in a browser. The owner's agents read it from a shell, to recall past sessions and to run SQL.

The prototype let the dashboard in with a username and password from its environment, compared as digests in constant time, and gave the browser a cookie that was an HMAC of an expiry keyed with the password itself: it survived restarts, could not be revoked short of changing the password, lacked `Secure`, and a failed attempt was slowed by 500 ms and nothing else. No agent could read without that cookie. Session titles were reported with the subscription hub key, the one every command Claude Code runs can read.

Cota's hub keys have a scope, which admission checks against a pool's kind (`docs/specs/admission/spec.md`, A1 to A4). A subscription hub key sits in the environment of every command a client runs, so it must never be enough to read the request log either.

## Decision

**Two ways in, and only two.** A request to the API is the owner's when it carries a valid sign-in in its cookie, and an agent's when it presents a hub key whose scope is `reader`. Anything else is answered 401 (no credential, or one the hub does not know) or 403 (a known hub key of another scope). What each may call is in `docs/specs/sign-in/spec.md`.

**The owner password is configuration.** `[sign_in] password = { env = "…" }` or `{ file = "…" }`, a secret by reference as ADR-0009 has it, read once at start and held as a `Redacted`. A hub without it has no sign-in and is read with reader keys only. There is no username: Cota has one owner. The password a sign-in presents is compared with the configured one as SHA-256 digests in constant time, as hub keys are.

> Amended by ADR-0021: the owner password is the configuration's, which wins, or one set in the browser at setup and kept in the hub store as an argon2id hash. A hub with neither (nor, once they are built, a passkey) is not set up, and signing in is answered 403 `urn:cota:not-set-up`, which replaces `sign-in-off`.

**A sign-in is a row in the hub store, not a signed cookie.** Signing in makes 32 random bytes, gives them to the browser once, and keeps only their SHA-256 in the hub store (ADR-0013), with when it was made, when it expires (30 days later; it is not extended by use), when it was last used and the browser's user agent. A request's sign-in is found by the digest of its cookie; when it carries several `cota_sign_in` cookies, as a browser does when a sibling site has planted one with a longer path, the first few are each tried, so that a planted cookie cannot sign the owner out. Signing out revokes the sign-in it was made with; the owner can list sign-ins and revoke any of them, or all but the current one. A copied cookie stops working when its sign-in is revoked, which the prototype's could not.

**The cookie.** `cota_sign_in=<token>; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`, and `Secure` when the request reached the hub over HTTPS: its URL is `https`, or it carries `x-forwarded-proto: https`, which the owner's reverse proxy sets (the hub listens on plain HTTP, ADR-0006). A spoofed header can only add `Secure`, which narrows where the browser sends the cookie. A cookie-authenticated request that changes something (any method but `GET` and `HEAD`) is refused 403 when its `sec-fetch-site` is `cross-site` or `same-site`, so another site under the owner's domain cannot act through the owner's browser; so is a sign-in, which has no cookie yet, so that a page cannot spend the attempt limit below. Reader keys are not cookies and are not checked this way. Every body the API reads must be said to be JSON (`content-type: application/json`), else it is refused 415 before it is read: a page can send a body to another site without asking first only as text, a form or a typeless blob, and Effect would read a body with no type as JSON.

**Failed attempts are slowed and capped, across the hub.** Every wrong password is answered after one second. Beyond 10 wrong passwords within 10 minutes, every sign-in attempt, right or wrong, is answered 429 with `retry-after` until the oldest of those failures is 10 minutes old, so a guesser learns nothing from an answer during the lock-out. The count is in memory: a restart clears it. It is counted for the whole hub, not per address, because behind a reverse proxy every request comes from the proxy's address and `x-forwarded-for` is the client's to write. Anyone who can reach the hub's API, with no credential, can therefore keep the owner from signing in: ten wrong passwords every ten minutes renew the lock-out for as long as they keep arriving. A web page the owner visits cannot, since its attempts are refused before they count. They cannot guess faster than ten passwords per ten minutes, and during a lock-out existing sign-ins and reader keys still work.

> Amended by ADR-0021: wrong setup codes and wrong current passwords are counted with wrong passwords, toward the same 10.

**A reader key reads, and changes nothing but titles.** A hub key's scope is `subscription`, `keyed` or `reader`; a pool's kind stays `subscription` or `keyed`. A reader key is presented to the API in `x-cota-key`, or as the bearer token of `authorization`. It may call every reading endpoint and `POST /api/sql`, and report session titles. It may not manage sign-ins or change display names: those are the owner's. On a pool route it is a hub key whose scope is no pool's kind, so admission rejects it whatever the pool: as `WrongScope` (403 `cota_hub_key_scope`) at a pool the hub has, as `UnknownPool` (404) at one it does not, exactly as a subscription key at a keyed pool.

> Amended by ADR-0029: a hub key of any scope, the reader's included, may also report requests (`POST /api/reported-requests`), as it may report titles; and a pool's kind may also be `observed`, which no scope is.

**Session titles take any known hub key.** A machine reports the titles of its sessions (`docs/specs/sessions/spec.md`) with the hub key it already has, whatever its scope, or the owner does with a sign-in. Each title keeps which hub key and machine reported it.

**Who is asking is decided once, by a middleware.** Every group declares one `HttpApiMiddleware`, `CallerMiddleware` (ADR-0011), which reads the sign-in cookie, else the hub key, and provides the endpoint with the caller: the owner with their sign-in, or a hub key's name and scope. Whether that caller may call the endpoint is the endpoint's declaration (an annotation, the owner alone unless it says otherwise), checked by the same middleware, in one place. The OpenAPI document names the cookie and the hub key as each endpoint's security schemes, with the hub key scopes it admits as the requirement's roles. The admission module answers who a presented hub key is, through a new query (`IdentifyHubKey`); a new `sign-in` module owns the password check, the sign-ins and the attempt count.

### Admission's laws

- **A1, A3 and A4 hold as written.** They speak of any hub key; their generators now draw from three scopes.
- **A2 holds as written**, and now also says that a reader key is admitted to no pool, because no pool's kind is `reader`. Because that is the one property a mistake in the new code would break, it is stated on its own as **A5: a reader key opens no pool**: a request that presents a reader key is rejected, whatever pool it names.
- The decision's rules and their order do not change. The pool's kind stays two-valued, so a mutant that lets `reader` match a kind is caught by A5.

## Alternatives weighed

- **The prototype's stateless signed cookie.** No store, and it survives restarts, but it cannot be revoked one at a time, and keying it with the password ties every sign-in's validity to the password's secrecy. A row per sign-in costs one lookup per request in a local file.
- **A JWT for the owner, or for agents.** It moves the same choice (stateless and unrevocable, or stateful) behind a format the hub does not need, and invites `alg` mistakes.
- **Letting subscription or keyed hub keys read.** A subscription key is in every command's environment; anything a model can be talked into running could read every conversation. Reading needs its own scope.
- **A per-address limit on sign-in attempts.** Behind the owner's reverse proxy every address is the proxy's, and `x-forwarded-for` can be forged by the attacker it is meant to count.
- **A hashed password (argon2id, which Bun ships) in the configuration.** It keeps a leaked configuration from revealing the password, but the owner would need a tool to make the hash before Milestone 3's first-run screen exists, and the hub keys are already plain secrets by reference beside it. When the first-run screen sets the password in the browser (Milestone 3), it is stored in the hub store as an argon2id hash, and this record is amended.
- **`HttpApiSecurity` schemes for the cookie and the hub key.** Effect's security middleware tries each scheme in turn and goes on to the next when a handler fails, whatever the failure. A 403 for a known caller, and the cross-site refusal, would be lost to the next scheme's 401, and the order of the rules (`docs/specs/sign-in/spec.md`) would be the builder's. One plain middleware decides who is asking and whether they may, and the schemes are written into the OpenAPI document as annotations.
- **Accepting reader keys in `x-api-key` too**, as keyed pools do. That header exists for clients that can only send a provider's key; an agent calling the API sends what it is told.

## Consequences

- The configuration gains `[sign_in]` and the `reader` scope; `docs/specs/admission/spec.md` gains A5 and `IdentifyHubKey`.
- Changing the owner password does not end existing sign-ins. The owner revokes them (`DELETE /api/sign-ins` ends all but the current one). A stored hash in Milestone 3 can tie sign-ins to the password that made them.

> Amended by ADR-0021: changing the stored password through the API (`PUT /api/owner-password`) revokes every other sign-in. Changing the configuration's still does not; the owner revokes them.
- The lock-out is global by design. If the hub's API is ever reachable by someone other than the owner, they can deny new sign-ins for as long as they keep sending ten wrong passwords every ten minutes; existing sign-ins and reader keys still work, and a restart clears the count. Keeping `/api` behind the owner's proxy or network is what prevents it.
- Every API request with a cookie reads the hub store. Its `last_used_at` is written at most once a minute per sign-in.
