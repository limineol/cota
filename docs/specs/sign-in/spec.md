---
status: active
scope: apps/hub
owner: limineol
last_verified: 2026-11-23
review_by: 2027-02-17
supersedes: []
code:
  - apps/hub/src/modules/sign-in
  - apps/hub/src/shared/01-presentation/caller.middleware.ts
  - apps/hub/src/shared/03-domain/caller.ts
  - apps/hub/src/shared/03-domain/bearer-token.ts
  - apps/hub/src/config/config.ts
---

# Sign-in

Who may call the hub's API, how the hub is set up, and how the owner signs in, with a password or a passkey. ADR-0012 and ADR-0021 give the reasons. It is the `sign-in` module (`apps/hub/src/modules/sign-in`), the middleware every API group declares, `CallerMiddleware` (defined in `apps/hub/src/shared/01-presentation/caller.middleware.ts` and implemented by the sign-in module), and the admission module's `IdentifyHubKey` query (`docs/specs/admission/spec.md`). The endpoints themselves are in `docs/specs/api/spec.md`.

## Values

- **Owner password**: the configuration's, `[sign_in] password`, a secret by reference (ADR-0009), or the stored password. When the configuration holds one, it alone signs in and the stored one is not consulted (ADR-0021).
- **Stored password**: an owner password set in the browser, at setup or by a change, kept in the hub store as an argon2id hash made by `Bun.password` with a memory of 65,536 KiB, 2 passes and 1 lane (`$argon2id$v=19$m=65536,t=2,p=1$…`), with when it was set (`docs/specs/hub-store/spec.md`). One at most. It is 12 to 1,024 characters, with no rules of composition.
- **Way in**: how the owner can sign in: the configuration's owner password, the stored password, or a passkey. The API never removes the last one (The last way in).
- **Set up**: a hub is set up when it has a way in. A hub that is not set up has no way in for the owner until it is set up.
- **Setup code**: on a hub that is not set up, 12 characters of Crockford's base32 (`0123456789ABCDEFGHJKMNPQRSTVWXYZ`, 60 bits) from a cryptographic source, made at start and written in three groups of four, `K7QM-2F9X-HD3P`. The hub keeps only the SHA-256 of its 12 characters, in memory, for as long as it runs or until it is set up. A code given is read as Crockford's base32 is: hyphens and spaces are taken out, the rest is upper-cased, `O` is read as `0` and `I` and `L` as `1` (the alphabet has none of them, so a code typed from a screen cannot be wrong for that), and its SHA-256 is compared with the one kept in constant time, as a hub key's is.
- **Sign-in token**: 32 random bytes from a cryptographic source, written as base64url without padding (43 characters). The browser holds it in the cookie `cota_sign_in`, as the connect script does in memory while it runs (`docs/specs/quota-logins/spec.md`); the hub never holds it after answering.
- **Sign-in**: `id` (a UUID version 7), the SHA-256 of the token in hex, `createdAt`, `expiresAt` (30 days after `createdAt`), `lastUsedAt`, `revokedAt` (none until revoked) and `userAgent` (the sign-in request's, cut to 200 characters). Kept in the hub store (`docs/specs/hub-store/spec.md`).
- **Passkey**: a WebAuthn credential the signed-in owner made, discoverable and with user verification: `id` (a UUID version 7), its credential id (base64url, one passkey per credential id), its public key (COSE, as the authenticator gave it: not a secret), its signature counter, its transports, the relying party it was made at (its RP ID and origin), `userAgent` (the making request's, cut to 200 characters), `createdAt` and `lastUsedAt` (none until it signs in). Kept in the hub store (`docs/specs/hub-store/spec.md`); its private key never leaves the owner's authenticator.
- **Relying party**: where a passkey lives, taken from a request's `Origin` as the platform's URL parses it: the origin, as the URL writes it, and its host name as the RP ID, when the origin is `https` at a host name that is not an IP address (v4 or v6, in whatever writing the URL reads as one: `https://2130706433` is `127.0.0.1`), or is `localhost` over `http` or `https`, at any port. A browser offers a passkey nowhere else. Any other `Origin`, or none, is refused with 400 `urn:cota:not-a-passkey-origin`, whose detail says what a browser needs.
- **Challenge**: 32 random bytes from a cryptographic source, written as base64url, issued for making a passkey or for signing in with one, at a relying party. The hub keeps the challenges in memory with what each was issued for, never in the store. One lasts 5 minutes from when it is issued and is used once: the first answer that names it uses it, whether or not the rest of that answer verifies. At most 64 are outstanding; issuing one more drops the oldest. What this costs: anyone may ask for sign-in options, so a flood of them can drop a challenge the owner's browser is still answering, and that ceremony fails and is started again, as a restart, which forgets every challenge, makes it.
- **Caller**: who an API request comes from, once the middleware has decided: the **owner**, with the sign-in that admitted them, or a **hub key**, with its name and scope.

## Who is asking

The middleware looks at a request in this order, and the first rule that gives an answer wins:

1. **The cookie.** For each `cota_sign_in` value the request's `Cookie` header carries, in its order, the first 5 of them, the hub takes the SHA-256 of the value and looks it up. The first that is a sign-in that exists, is not revoked and whose `expiresAt` is after now makes the caller the owner. Any other cookie value is no sign-in, and the hub goes on to the next, then to rule 2, so a stale cookie does not hide a hub key sent beside it. A browser sends every cookie of one name that sites under the hub's domain set, those with the longest path first, so a sibling site can plant `cota_sign_in` values ahead of the hub's own: trying each keeps the owner signed in behind up to four of them.
2. **The hub key.** The presented hub key is `x-cota-key`, trimmed, when it is not empty, else the bearer token of `authorization`. The admission module's `IdentifyHubKey` compares its digest in constant time with every hub key's and gives the key's name and scope, or nothing.
3. Otherwise there is no caller.

On a hub that is not set up no cookie makes a caller, whatever sign-ins the hub store still holds.

`lastUsedAt` is written when a sign-in admits a request and was last written more than a minute before.

## Who may call what

Each endpoint says who may call it: the owner alone (the default), a reader key or the owner, or any known hub key or the owner. One that needs no caller is added to its group before the group declares `CallerMiddleware`. The middleware decides who the caller is and whether the endpoint admits them, in that one place, before the endpoint reads its path, query or body.

| Endpoints | Who may call | No caller | Subscription or keyed hub key | Reader key | Owner |
| --- | --- | --- | --- | --- | --- |
| `POST /api/sign-in`, `GET /api/sign-in`, `POST /api/setup`, `POST /api/sign-in/passkey/options`, `POST /api/sign-in/passkey`, `GET /api/openapi.json` | anyone | yes | yes | yes | yes |
| `PUT /api/session-titles`, `POST /api/reported-requests`, `GET /api/machine`, `GET /api/route` | any hub key | 401 | yes | yes | yes |
| `GET /api/me`, `GET /api/overview`, `GET /api/series`, `GET /api/breakdown`, `GET /api/facets`, `GET /api/errors`, `GET /api/sessions`, `GET /api/sessions/{session}`, `GET /api/requests/{id}`, `GET /api/requests/{id}/body`, `GET /api/search`, `POST /api/sql`, `GET /api/schema`, `GET /api/display-names`, `GET /api/pools`, `GET /api/routes` | reader | 401 | 403 | yes | yes |
| `POST /api/sign-out`, `GET /api/sign-ins`, `DELETE /api/sign-ins`, `DELETE /api/sign-ins/{id}`, `GET /api/owner-password`, `PUT /api/owner-password`, `DELETE /api/owner-password`, `POST /api/passkeys/options`, `POST /api/passkeys`, `GET /api/passkeys`, `DELETE /api/passkeys/{id}`, `PUT /api/display-names/{kind}/{key}`, `DELETE /api/display-names/{kind}/{key}`, `PUT /api/pools/{pool}/quota-login`, `DELETE /api/pools/{pool}/quota-login`, `PUT /api/routes/{client}` | owner | 401 | 403 | 403 | yes |

`GET /api/pools` and the two quota-login endpoints are built (`docs/specs/api/spec.md`, Pools). A quota login can spend the subscription it reads, so giving or forgetting one is the owner's alone. The walker (`apps/hub/src/api.contract.test.ts`) holds this table written out, one endpoint a line, and fails when an endpoint's declaration differs from it or an endpoint is missing from it; I1 to I3 read who may call an endpoint from that table, never from the declaration they test. The OpenAPI document gives a reader endpoint and an any-hub-key one the cookie, `x-cota-key` and the bearer token as security, with the hub key scopes each admits as the requirement's roles (`["reader"]`, or `["subscription", "keyed", "reader"]`), and an owner's endpoint the cookie alone.

401 is `urn:cota:sign-in-required`; 403 is `urn:cota:not-allowed`, whose detail names what the caller may not do and never which hub key it presented.

**Changing requests from a browser.** When the caller is the owner and the method is not `GET` or `HEAD`, a request whose `sec-fetch-site` is `cross-site` or `same-site` (in any case) is refused with 403 `urn:cota:cross-site`. So are `POST /api/sign-in`, `POST /api/setup`, `POST /api/sign-in/passkey/options` and `POST /api/sign-in/passkey`, which have no caller (Signing in, Setup, Signing in with a passkey). A request without `sec-fetch-site` (not a browser) or with `same-origin` or `none` goes on.

**Bodies are JSON.** A request to any endpoint with a body (a `content-length` above 0, or a `transfer-encoding`) whose `content-type` is not `application/json` (its parameters aside, in any case), or that has none, is refused with 415 `urn:cota:unsupported-media-type` before anything else is decided: before the caller, before the body is read. A page of another site can send a body without a preflight only as `text/plain`, a form or a typeless blob, so neither its sign-in or setup attempts nor anything else it sends reaches an endpoint.

## How the owner signs in

`GET /api/sign-in` answers anyone, signed in or not, `{ setUp, password, passkey }`: whether the hub is set up, whether a password signs the owner in (the configuration's or the stored one), and whether a passkey does (the hub keeps one). It says nothing else: not where the password is kept, nor when it was set, nor which passkeys exist or where. The sign-in screen reads it before anyone is signed in.

## Signing in

`POST /api/sign-in` with `{ "password": "<text>" }`, a body said to be JSON (above):

1. If the request's `sec-fetch-site` is `cross-site` or `same-site`: 403 `urn:cota:cross-site`. The password is not looked at, and nothing is counted.
2. If the hub has no owner password: 403 `urn:cota:not-set-up` when it is not set up, and 403 `urn:cota:password-off` when it keeps a passkey (the owner turned the password off, The owner password). Neither is counted.
3. If the attempt limit (below) is reached: 429 `urn:cota:too-many-attempts`, with `retry-after` in whole seconds until it is not. The password is not looked at.
4. The password given is compared with the owner password: with the configuration's as their SHA-256 digests in constant time, else with the stored one by argon2id. If they differ, the failure is counted, and the hub answers 401 `urn:cota:wrong-password` one second after the request arrived.
5. Otherwise the hub makes a token, stores the sign-in, and answers 204 with the cookie `cota_sign_in=<token>` and the attributes `Max-Age=2592000`, `Path=/`, `HttpOnly` and `SameSite=Strict`, and `Secure` when the request's URL is `https` or the first value of its `x-forwarded-proto` is `https`. The hub writes them in that order: `cota_sign_in=<token>; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Strict`. When the password was the stored one and it was changed while it was compared, the sign-in just made is revoked and the answer is the 401 of step 4, not counted: the password is no longer the owner's.

The password is between 1 and 1,024 characters; anything else is the 400 of a payload that does not decode, which does not repeat the password, and is not counted as a failure. A body over 1 MiB is 413 `urn:cota:body-too-large` (`docs/specs/api/spec.md`, Limits).

**The attempt limit.** The hub remembers the times of failed attempts, for the whole hub and in memory: wrong passwords at sign-in, wrong setup codes (Setup) and wrong current passwords (Changing the password), counted together. The limit is reached when 10 failures happened within the last 10 minutes. `retry-after` is the time until the oldest of those 10 is 10 minutes old, rounded up to a whole second; the problem's `detail` says it too. A successful attempt does not clear the count. A comparison takes its place in the count before it starts, at the time it starts, and gives it back when it was right; a place taken by an attempt still being compared counts as a failure until then. argon2id compares asynchronously, so attempts sent together are compared at once: each takes its place first, and once 10 are taken within the window the rest are answered 429, so no more than 10 wrong ones are ever compared in 10 minutes. A right attempt being compared beside others can therefore get a 429 it would not get alone.

What the limit costs the owner: anyone who can reach the hub's API, with no credential at all, can keep signing in (and setup) paused. Ten wrong passwords every ten minutes hold it for as long as they keep arriving, since each pause lasts until the oldest of the last ten is 10 minutes old. A page in the owner's own browser cannot do it: its attempts are refused before they count (I9, I10). During a pause, sign-ins already made still open the API, a passkey still signs in, and reader keys still read; a restart of the hub clears the count.

## Setup

At start, a hub that is not set up makes a setup code (Values) and prints one line in its log, at level `INFO`: `this hub is not set up: open its dashboard, give it the setup code K7QM-2F9X-HD3P and choose the owner password`. A hub that is set up makes none and prints none. A restart makes a new code, and the one before opens nothing.

`POST /api/setup` with `{ "code": "<text>", "password": "<text>" }`, callable by anyone, in this order:

1. If the request's `sec-fetch-site` is `cross-site` or `same-site`: 403 `urn:cota:cross-site`. Nothing is looked at, and nothing is counted.
2. If the hub is set up: 409 `urn:cota:already-set-up`.
3. If the attempt limit is reached: 429 `urn:cota:too-many-attempts`, as for signing in.
4. The code given is compared with the setup code. If it is not the setup code, the failure is counted, and the hub answers 401 `urn:cota:wrong-setup-code` one second after the request arrived.
5. Otherwise the password is hashed and stored, and the browser is signed in: the answer is the one a sign-in gets (204 and the cookie, Signing in, step 5). If the store already holds a password when it is written (two setups sent together), nothing is written and the answer is 409 `urn:cota:already-set-up`: the store's table holds one row by a constraint, and the write that finds it taken loses. Once set up, the hub forgets its setup code.

The code is 1 to 64 characters and the password 12 to 1,024; anything else is the 400 of a payload that does not decode, which repeats neither, and is not counted.

## The owner password

`GET /api/owner-password`, the owner's alone, answers `{ source, setAt }`: where the owner password is kept, `configuration`, `hub-store` or `none`, and when the stored one was set (`null` unless `source` is `hub-store`).

`PUT /api/owner-password` with `{ "current": "<text>", "password": "<text>" }`, the owner's alone (and refused from another site, as every owner's request that changes something):

1. If the configuration holds the owner password: 409 `urn:cota:password-in-configuration`. Nothing is counted; it is changed in the configuration, and takes effect when the hub restarts.
2. If the hub keeps no stored password (the owner signed in with a passkey and turned the password off), the password is set, with no `current` and whatever `current` says: hashed, stored, and every live sign-in but the one that made the request revoked, as a change does; 204. If a password is stored when it is written (two sent together), nothing is written and the answer is the 401 of step 4, not counted.
3. If the attempt limit is reached: 429 `urn:cota:too-many-attempts`.
4. `current` is compared with the stored password. If it is missing or is not the stored password, the failure is counted, and the hub answers 401 `urn:cota:wrong-password` one second after the request arrived.
5. Otherwise the stored hash is replaced by the new password's, its `setAt` is now, and every live sign-in but the one that made the request is revoked. The answer is 204. The store replaces the hash only while it is still the one `current` was compared with: of two changes sent together, both compared with one hash, the first write wins and the other finds the hash gone, writes nothing and is answered the 401 of step 4, not counted, as a sign-in that lost the race is. A change that finds no stored password at all, because the password was turned off while it was compared, stores the new one, as step 2 does.

`current`, when given, is 1 to 1,024 characters and `password` 12 to 1,024, else the 400 of a payload that does not decode, which repeats neither, and is not counted.

`DELETE /api/owner-password`, the owner's alone, turns the password off: it forgets the stored password and answers 204, also when none is stored. It is refused with 409 `urn:cota:last-way-in` when the stored password is the last way in: the hub keeps no passkey and the configuration holds no password (The last way in). A hub whose configuration holds the password forgets the stored one, which it never consults (ADR-0021), and is signed in to with the configuration's as before. On a hub with a passkey and no password, a password sign-in is answered 403 `urn:cota:password-off`, and the owner turns the password on again with `PUT /api/owner-password`, without `current`.

## Passkeys

The signed-in owner makes passkeys, lists them and removes them; anyone may sign in with one. Where a passkey lives is the relying party of the request that asked to make it, kept with it: a sign-in is verified against that, never against the sign-in request's `Origin`, so a hub needs no setting for its public name and a forged `Origin` gains nothing (ADR-0021). A hub reached at a new name needs a passkey made there. `@simplewebauthn/server` 14.1.0 makes the options and verifies the answers; the hub never checks attestation (it asks for none). A hub whose configuration holds the password takes passkeys too, and they sign in beside it.

**Making one.** `POST /api/passkeys/options`, the owner's, with no body: if the request's `Origin` has no relying party, 400 `urn:cota:not-a-passkey-origin`. Otherwise the hub issues a challenge for making a passkey at that relying party and answers the creation options, `PasskeyCreationOptions`: the relying party `{ name: "Cota", id }`, the owner as the one user `{ id: "Y290YS1vd25lcg" (base64url of cota-owner), name: "owner", displayName: "Cota owner" }`, the challenge, the algorithms EdDSA, ES256 and RS256 (COSE -8, -7, -257), a `timeout` of 300,000 ms (as long as the challenge lasts), `attestation: "none"`, `excludeCredentials` of the passkeys already kept at that RP ID, `authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "required" }` and `extensions: { credProps: true }`.

`POST /api/passkeys`, the owner's, with the browser's answer as WebAuthn's JSON writes it (`PasskeyCreationResponse`: `id`, `rawId`, `type: "public-key"`, `response: { clientDataJSON, attestationObject, transports? }`; other fields a browser sends are ignored): the challenge its client data names is used. If it is not one the hub issued for making a passkey, or no longer lasts, or the answer does not verify against that challenge's relying party (its origin and RP ID) with the user present and verified and an algorithm offered, the answer is 400 `urn:cota:passkey-not-made`, which says no more. A credential id the hub keeps already is 409 `urn:cota:passkey-exists`. Otherwise the passkey is kept, with the request's user agent, and the answer is it as `Passkey`.

**Listing and removing.** `GET /api/passkeys`, the owner's, answers `{ passkeys: Passkey[] }`, newest first: `{ id, userAgent, origin, createdAt, lastUsedAt }`, never the key, the credential id or the counter. `DELETE /api/passkeys/{id}`, the owner's, removes one and answers 204; an id the hub does not keep is 404 `urn:cota:no-such-passkey`, and the last way in is 409 `urn:cota:last-way-in`: the last passkey of a hub with no stored password and none in the configuration.

**Signing in with a passkey.** `POST /api/sign-in/passkey/options`, which anyone may call, with no body:

1. If the request's `sec-fetch-site` is `cross-site` or `same-site`: 403 `urn:cota:cross-site`.
2. If the request's `Origin` has no relying party: 400 `urn:cota:not-a-passkey-origin`.
3. If the hub keeps no passkey: 409 `urn:cota:no-passkeys`.
4. Otherwise the hub issues a challenge for signing in and answers the request options, `PasskeyRequestOptions`: `{ challenge, rpId, timeout: 300000, userVerification: "required" }`, with no list of credential ids, so it tells nobody which passkeys exist.

`POST /api/sign-in/passkey`, which anyone may call, with the browser's answer as WebAuthn's JSON writes it (`PasskeySignInResponse`: `id`, `rawId`, `type: "public-key"`, `response: { clientDataJSON, authenticatorData, signature, userHandle? }`):

1. If the request's `sec-fetch-site` is `cross-site` or `same-site`: 403 `urn:cota:cross-site`. Nothing is looked at.
2. The challenge the answer's client data names is used. The answer signs in only when that challenge was issued for signing in and still lasts, the hub keeps a passkey with the answer's credential id, and the answer verifies against that passkey's kept RP ID and origin: signed by its key, the user present and verified, and its signature counter past the kept one unless both are 0 (as the library checks it: an authenticator that keeps no counter sends 0). Any other answer is 401 `urn:cota:passkey-refused`, the same problem whichever check failed.
3. Otherwise the passkey's counter becomes the greater of the kept one and the answer's, its `lastUsedAt` is now, and the browser is signed in: the answer is the one a sign-in gets (204 and the cookie, Signing in, step 5). A passkey removed while its answer was checked signs nobody in: the answer is the 401.

A passkey sign-in is not counted toward the attempt limit and is not paused by it, and its 401 comes at once: a passkey cannot be guessed, so a failure is no guess. The bodies are bounded by the API's 1 MiB, and a credential id is 1 to 1,364 characters of base64url (1,023 bytes); anything else is the 400 of a payload that does not decode.

## The last way in

The API never removes the last way in: forgetting the stored password is refused unless a passkey or the configuration's password remains, and removing a passkey is refused unless another passkey or a password (stored or configured) remains. Each check is made by the store in the same call as the change it allows: one SQLite transaction on the store's one connection, which nothing interleaves with. So of a forgetting and a removal sent together on a hub with one passkey and a stored password, one passes and the other is answered 409 `urn:cota:last-way-in`. A hub that is set up stays set up, whatever the owner sends; the way back in after losing every passkey is still the configuration's password (ADR-0021).

## Signing out and revoking

- `POST /api/sign-out` revokes the sign-in that admitted it and answers 204 with the cookie `cota_sign_in=` and `Max-Age=0`, with the other attributes as above.
- `GET /api/sign-ins` lists the sign-ins that are neither revoked nor expired, newest first, marking the one that admitted the request as current. It never shows a token or a digest.
- `DELETE /api/sign-ins/{id}` revokes one; an id that is not a live sign-in is 404 `urn:cota:no-such-sign-in`. Revoking the current one is signing out, without clearing the cookie.
- `DELETE /api/sign-ins` revokes every live sign-in but the current one, and answers the number revoked.

Revoked and expired sign-ins are deleted from the store once they ended more than 30 days before: each sign-in deletes them as it is made.

## Laws

| Id | Law | Held by |
| --- | --- | --- |
| I1 | **No caller, no data.** Every endpoint but those anyone may call (`POST /api/sign-in`, `GET /api/sign-in`, `POST /api/setup`, `POST /api/sign-in/passkey/options`, `POST /api/sign-in/passkey`) and `GET /api/openapi.json` answers 401 to a request with no cookie and no hub key, and to one whose cookie and hub key the hub does not know. | contract |
| I2 | **Spending keys do not read.** Every endpoint but those and the ones any hub key may call (`PUT /api/session-titles`, `POST /api/reported-requests`, `GET /api/machine` and `GET /api/route`) answers 403 to a subscription or keyed hub key. | contract |
| I3 | **Readers do not manage.** A reader key gets 403 from every endpoint the table above keeps for the owner. | contract |
| I4 | **Only digests are kept.** After any sequence of setups, sign-ins with a password or a passkey, changes of the password, passkeys made, sign-outs and revocations, the hub store holds no token, no setup code, no password in the clear, no challenge and no passkey's private key: SHA-256 digests of tokens, one hash of the stored password, and passkeys' public keys, which are not secrets. | property |
| I5 | **Revoked and expired sign-ins open nothing.** A token whose sign-in is revoked, or whose `expiresAt` is not after now, makes no caller, whatever else is true. | property |
| I6 | **A token opens only its own sign-in.** Signing out, or revoking by id, ends exactly the sign-in named and no other. | property |
| I7 | **Guessing is capped.** In any 10 minutes at most 10 wrong passwords, setup codes and current passwords are compared, whether sent one after another or together; once 10 have been, every attempt that would be compared is answered 429 until the oldest of them is 10 minutes old, whatever it gives. A passkey's answer is not compared: it neither counts nor waits. | property |
| I8 | **A wrong guess costs a second.** No 401 `urn:cota:wrong-password` or `urn:cota:wrong-setup-code` is answered less than one second after its request arrived. | property |
| I9 | **Other sites do not sign in or set up.** A sign-in, with a password or a passkey, a request for passkey options, or a setup whose `sec-fetch-site` is `cross-site` or `same-site` is answered 403 `urn:cota:cross-site`, whatever it gives, and is not counted toward the attempt limit. | contract |
| I10 | **Bodies say they are JSON.** Every endpoint answers 415 `urn:cota:unsupported-media-type` to a request whose body has no `content-type` or one other than `application/json`, whoever sends it, before it decodes the body; a sign-in or a setup so refused is not counted toward the attempt limit. | contract |
| I11 | **Setup happens once, and only with the code.** Over any sequence of setups with right and wrong codes, the right ones in any writing, sent one after another or together, and any passwords, the password stored is the one given by the first setup that held the hub's setup code, and no other setup changes anything or signs anyone in. | property |
| I12 | **The configuration's password wins.** On a hub whose configuration holds an owner password, setup and changing the password are refused, and no stored password signs in, whatever the store holds. | property |
| I13 | **A changed password ends the other sign-ins.** After a change, the new password signs in and the old one does not, the sign-in that made the change is live, and every other is revoked, one made with the old password while the change was made among them; of changes sent together, one is made and the others are answered as a wrong password. | property |
| I14 | **A passkey lives only where a browser offers one.** A request's `Origin` gives a relying party exactly when it is `https` at a host name that is not an IP address, or `localhost` over `http` or `https`, at any port: its host name as the RP ID, and the origin as the URL writes it. | property |
| I15 | **A challenge is used once, and within 5 minutes.** A challenge is given back once, with what it was issued for, and only while it lasts, 5 minutes from when it was issued; of more than 64 outstanding, the oldest are dropped. | property |
| I16 | **A passkey signs in only as itself.** An answer signs in exactly when it is signed by a kept passkey's key, for that passkey's RP ID and origin, over a challenge issued for signing in, not used and still lasting, with the user verified and the counter not behind; every other answer is the one 401 and makes no sign-in. | property |
| I17 | **The API never removes the last way in.** Over any sequence of setting, changing and forgetting the password and making and removing passkeys, sent one after another or together, on hubs with and without a configured password, a hub that was set up stays set up, and the commands refused as the last way in are exactly those that would leave no way in. | property |

I1 to I3 are derived from the API's definition (ADR-0011): one test (`apps/hub/src/api.contract.test.ts`) walks every endpoint of a running hub with every kind of caller, so an endpoint added later is held by them without a test of its own.

The property laws run against the `sign-in` module (`apps/hub/src/modules/sign-in/sign-in.laws.test.ts`) with the test clock, a setup code the test knows, and a password hasher that stands in for argon2id: it is fast, and lets other fibers run while it hashes and compares, as argon2id does, so attempts sent together interleave. The real hasher has its own examples: a hash verifies its password and no other, and is argon2id with the parameters above.

- I4 to I6 run over generated sequences of setups, sign-ins with a password and with a passkey, changes of the password, passkeys made, sign-outs, revocations, requests and clock moves, against the module over the in-memory store and again over a SQLite store in a temporary file, whose every table is scanned for the tokens, the passwords, the setup code, the challenges and the passkeys' private keys (the software authenticator's, which never leave it). Each sequence is drawn for a hub whose configuration holds the password, or for one that is not set up and starts with a setup. The moves land on a sign-in's last live millisecond and on its expiry, and every sequence starts by signing in and moving to the millisecond before, the instant of and the millisecond after that sign-in's expiry.
- I7 and I8 run over generated sequences of attempts and waits against the module over the in-memory store: setups with wrong codes and then the right one, sign-ins and changes of the password with right and wrong passwords, some sent together, up to twelve at once. Each passes the edge of the window (twelve wrong guesses of one kind sent together, after a right setup unless they are setup codes, then attempts a millisecond before, at and a millisecond after the oldest of them is 10 minutes old), and I7 compares every answer with the limit worked out from the attempts' kinds and times alone. Beside them, an example sends ten passkey answers signed by the wrong key, which are refused at once, then signs in with the right password (not paused), sends eleven wrong passwords (the eleventh is 429) and signs in with the passkey (not paused).
- I11 runs over generated sequences of setups, each with a wrong code or the right one written in upper case, lower case, without its hyphens, with spaces, or with `O` for `0` and `I` or `L` for `1`, some sent together, and then signs in with every password given, over the in-memory store and over SQLite. I12 runs over a store that holds a stored password before the hub starts, against sequences of setups, changes and sign-ins with the stored password, the configuration's and others, over both stores. I13 runs over sequences of sign-ins and changes, some with a sign-in with the old password sent while the change is made and some of two or three changes sent together from sign-ins of their own, over both stores, and after each change signs in with the old password and the new ones.

The passkey laws are in `apps/hub/src/modules/sign-in/passkeys.laws.test.ts`, against the real `@simplewebauthn/server`: a software authenticator (`05-tests/software-authenticator.ts`) makes ES256 key pairs with WebCrypto and answers the hub's options as a browser's library would, with attestation `none`, and with the flags, counter, origin and RP ID it is told to use.

- I14 runs over generated origins: `https`, `http`, `ftp` and `wss`; host names in any case, punycode and a `.localhost` subdomain; `localhost` in any case; IPv4 addresses dotted, as one decimal or hexadecimal number, in octal and shortened; IPv6 addresses, one an IPv4-mapped one; ports, the scheme's default among them; and origins that do not parse, or none. Each is compared with the relying party worked out from how it was made.
- I15 runs over generated sequences of issues (up to 70 at once, for either purpose and either of two relying parties), takes of issued and unissued challenges, and clock moves that land a millisecond before and at a challenge's expiry, against the in-memory challenges with the test clock. Each take is compared with the answer worked out from the history alone. Every sequence takes a challenge twice, takes the oldest of 65 issued at once and the next, and takes two at the edge of their life.
- I16 runs over generated ceremonies on a hub with three passkeys (one that keeps no counter and one that counts, at `https://cota.example`, and one on `http://localhost:4317`), each answered with up to two faults (another key, an unknown credential id, the other site's options and origin, another origin, another RP ID, a challenge issued for making a passkey, one never issued, no user verification, a counter not past the kept one, the passkey removed before the answer) and answered at once, a millisecond before its challenge expires or as it expires, and replays of the last answer, over both stores. Every sequence makes each fault alone. The sign-ins the store holds are exactly the answers that signed in.
- I17 runs each generated sequence on a hub set up by setup and on one whose configuration holds the password, over both stores, with up to three commands sent together. After each step the hub is still set up, and the answers and the ways in left (the stored password's hash and the passkeys) are those of the commands run one after another in some order, worked out from the ways in before them. Every sequence removes the only passkey while forgetting the stored password, then forgets the password and removes the last passkey one after the other.

I9 and I10 send ten wrong passwords and ten wrong setup codes from another site, and from a sibling one, and ten with each of no content type, `text/plain`, a form, a multipart form and `application/jsonp`, then sign in with the right password, or set up with the right code, which must still be answered 204, and asks for passkey options and answers with a passkey from another site and a sibling one, which are refused 403 before anything is looked at (`sign-in.contract.test.ts`); the walker also sends every endpoint, with the owner's cookie, a body with each of those framings and a chunked one, and checks each is 415. The whole-hub harness starts hubs with and without a configured password: on one without, the setup code is printed once in the log at start, and the code it prints sets the hub up; on one with, none is printed.

## Not built, on purpose

- **Usernames, several owners, roles.** Cota has one owner, and a passkey is always the owner's.
- **Renaming a passkey.** It is known by where and in what browser it was made, and when it was last used.
- **Checking attestation.** The hub asks for none and trusts no authenticator's maker: a passkey is the owner's because the signed-in owner made it.
- **Resetting a forgotten stored password.** The configuration's password is the way back in (ADR-0021): set `[sign_in] password` and restart. While it is there it is the owner password, and the stored one can be changed again only once it is removed.
- **A setup code given any other way than the log, or kept across a restart.**
- **Sliding expiry.** A sign-in lasts 30 days from when it was made, however often it is used.
- **Per-address limits.** Every address behind the owner's proxy is the proxy's.
- **CORS.** The dashboard is served from the hub's own origin (Milestone 3); agents are not browsers.
- **Reader keys in `x-api-key`, or in the query string.**
