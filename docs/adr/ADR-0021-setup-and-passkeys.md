---
status: accepted
scope: apps/hub
owner: limineol
last_verified: 2026-11-17
review_by: 2027-02-17
supersedes: []
code:
  - apps/hub/src/modules/sign-in
  - apps/hub/src/config
  - apps/hub/src/shared/04-infrastructure/hub-store
---

# ADR-0021: The hub is set up in the browser, and the owner signs in with a password or a passkey

## Context

ADR-0012 made the owner password configuration: `[sign_in] password`, a secret by reference, read at start. A hub without one has no sign-in and is read with reader keys only. It recorded that the first-run screen of milestone 3 would set the password in the browser and keep it in the hub store as an argon2id hash, and that the record would be amended then. The roadmap gives milestone 3d first-run setup in the browser, "the owner password and the first sign-in, and no more" (pools, hub keys and quota logins stay in the configuration, ADR-0009), and passkey sign-in beside the password.

Setting a password in the browser means somebody claims the hub: whoever sends it first decides who the owner is. A hub is started before anyone has used it, often in a container whose port the owner's reverse proxy or network already reaches. It answers on that address from its first second, and what it will hold (every prompt, every tool result, every quota login) is worth claiming.

A passkey is a WebAuthn credential kept by a password manager or a device. It cannot be guessed, phished to another site, or reused from a leak, so a hub with one needs no password to guess and nothing to lock out. A browser offers one only to a page served over `https` at a host name, or on `localhost`, and binds it to that name (its relying party ID) and the page's origin. The hub listens on plain HTTP behind the owner's reverse proxy (ADR-0006, ADR-0012), so it does not know by itself the name it is reached at.

## Decision

**A hub is set up when it has a way in.** A way in is an owner password in the configuration, an owner password in the hub store, or a passkey. A hub with none is *not set up*: no cookie makes a caller, signing in is answered that the hub is not set up (403 `urn:cota:not-set-up`, which replaces ADR-0012's `sign-in-off`), and reader keys read as before. Anyone may ask how the owner signs in (`GET /api/sign-in`): whether the hub is set up, and whether a password signs in or a passkey does; never where the password is kept or when it was set, which a page needs no caller to learn and a stranger has no use for.

**Setup needs a setup code.** At start, a hub that is not set up makes a setup code from a cryptographic source: 12 characters of Crockford's base32 (60 bits), written in three groups, `K7QM-2F9X-HD3P`. It keeps only the code's SHA-256, in memory, and prints one line in its log with the code and what to do with it. A restart makes a new one; a hub that is set up makes none. A code is read as Crockford's base32 is, ignoring case, hyphens and spaces and reading `O` as `0` and `I` and `L` as `1`, so it can be typed as it is read; its digest is compared in constant time, as a hub key's is. `POST /api/setup` takes `{ code, password }` from anyone, and in this order: a request from another site is refused 403 before anything is looked at or counted; a hub already set up answers 409 `already-set-up`; the attempt limit answers 429; a wrong code is counted and answered 401 `wrong-setup-code` one second after the request arrived; otherwise the password is stored and the browser is signed in, as a sign-in is (204 and the cookie). Of two setups sent together, one wins and the other is answered 409, and the store decides it: the stored password is one row by a constraint, and the write that finds it taken loses, not a check made before the write. After setup the code opens nothing. Reaching the hub's address is not enough to claim it: whoever claims it read the hub's log, which only the owner can.

**A password set in the browser is an argon2id hash in the hub store.** `Bun.password` makes it (argon2id, 64 MiB, two passes, one lane; no dependency), in a table of the sign-in module with when it was set. It is 12 to 1,024 characters, with no rules of composition: length is what makes a password hard to guess, and rules make owners write it down. It is never logged, never in a problem and never in the OpenAPI document's examples.

**The configuration's password wins.** When `[sign_in] password` is set, it alone signs in, compared as ADR-0012 has it; the stored one is not consulted, setup is refused, and the browser cannot change it. That is also the way back in after a lock-out (a forgotten password, a lost passkey): put a password in the configuration, restart, sign in.

**The stored password is changed with the current one.** `PUT /api/owner-password` with `{ current, password }`, the owner's alone. A wrong `current` is a failed attempt like any other. A change replaces the hash it compared, or nothing (the store decides it, as it decides setup, so of two changes sent together one wins and the other is answered as a wrong password), and revokes every other sign-in, keeping the one that made it: whoever changes a password after a leak means to end what the leak opened. It is refused 409 `password-in-configuration` while the configuration holds the password. The owner sees where the password is kept (the configuration, the hub store, or nowhere) and when the stored one was set (`GET /api/owner-password`).

**One attempt limit.** Wrong passwords at sign-in, wrong setup codes and wrong current passwords share ADR-0012's limit of 10 within 10 minutes, so a guesser gains nothing by changing which door they try. argon2id compares asynchronously, so a comparison takes its place in the count before it starts and gives it back when it was right: attempts sent together cannot have more than 10 wrong comparisons in flight.

**Passkeys.** The signed-in owner makes a passkey in Settings, Sign-ins, with the WebAuthn libraries `@simplewebauthn/server` 14.1.0 in the hub and `@simplewebauthn/browser` 14.0.0 in the dashboard. A passkey is named for where it was made (its user agent in words) and is not renamed. User verification is required, and passkeys are discoverable credentials: signing in sends no list of credential ids, so the hub tells nobody which passkeys exist.

- **Its relying party ID and origin are taken from the request's `Origin` when it is made, and kept with it.** A sign-in is verified against the ones kept, so the hub needs no setting for its public name, and a forged `Origin` gains nothing: the origin a sign-in is checked against is the one the owner's own browser signed when the passkey was made, and a passkey is made only by the signed-in owner. Only `https://<host name>` and `localhost` are taken, as browsers do.
- **Turning the password off is forgetting the stored password**, allowed only when another way in remains: a passkey, or a password in the configuration. **The API never removes the last way in**: the last passkey cannot be removed while no password exists, and the check and the removal are one call to the hub store, so a forget and a removal sent together cannot both pass.
- **Challenges live in memory**: each lasts 5 minutes and is used once, and at most 64 are outstanding, the oldest dropped first. A restart forgets them, which costs a ceremony in progress its retry.

## Alternatives weighed

- **The first to arrive sets the hub up** (Home Assistant, Portainer). Nothing to read from a log, and the screen is one step shorter. But whoever reaches the address first owns the hub and everything it will record, and a hub is reachable before its owner opens it: a container started on a server, a reverse proxy configured, a port forwarded. Portainer narrows the window by refusing setup five minutes after start; the window is still open to anyone watching. A setup code costs the owner one line of `docker logs`, and is what Jenkins and Jupyter ask for the same reason.
- **A setup token in the configuration.** The owner would write a secret into the configuration in order to type it into the browser. They can already write the password itself there, and that stays possible; a second secret in the file adds a step and protects nothing more than the log line does.
- **The password only in the configuration**, as ADR-0012 has it. It keeps one place for every secret, but setup would stay editing a file and restarting, which the roadmap's first-run screens exist to remove, and a password could never change without a restart. The configuration keeps its place as the password that wins and the way back in.
- **A configured name and origin for passkeys** (an `[sign_in] passkey_origin`). WebAuthn libraries usually expect one. It is a setting the owner must get exactly right, which a hub behind a reverse proxy cannot check, and its only gain is refusing a passkey made at another of the hub's names. Kept with each passkey, the origin needs no setting; the cost is that a hub reached at a new name needs a passkey made there, and is signed in to with the password, or a passkey of the old name, until then.
- **Sign-ins tied to the password that made them**, ADR-0012's suggestion, so a change ends them by itself. It adds a column and a join to every request for what one revocation at the change does.

## Consequences

- ADR-0012 is amended: the owner password is the configuration's or the stored one, a change ends the other sign-ins, and `sign-in-off` is `not-set-up`. Its 10 in 10 minutes now count setup codes and current passwords too.
- The hub store gains the sign-in module's table `owner_password`, by a new step, and with it the owner's password hash; it is backed up and guarded as before (ADR-0013, ADR-0017).
- The hub's log holds the setup code until the hub is set up. Whoever reads the log can set the hub up, which is the point: the log is the owner's, as the configuration is. A hub restarted before it is set up prints a new code and the old one opens nothing.
- A hub can now be started with no secret written for the owner at all. The README and the example configuration keep `[sign_in] password` as optional: the password that wins, and the way back in.
- What the sign-in spec lists as not built, passkeys among them, is what this record decides and the hub does not do yet.
