---
status: accepted
scope: apps/hub
owner: limineol
last_verified: 2026-11-14
review_by: 2027-02-13
supersedes: []
code:
  - apps/hub/src/modules/quota
  - apps/hub/src/shared/04-infrastructure/hub-store
---

# ADR-0017: Quota logins are given through the API, kept in the hub store unencrypted, and refreshed by the hub

## Context

Anthropic's and ChatGPT's usage endpoints answer only to a login of the subscription (ADR-0016). The owner accepted, on 2026-11-13, that the hub keeps such a login to read a pool's usage, as the prototype did, given at setup.

The prototype (`dashboard/server/claude.ts`, `chatgpt.ts`, `scripts/connect-claude`, `scripts/connect-chatgpt`):

- got each login by signing in with the provider's own client (`claude auth login`, `codex login`) in a throwaway configuration directory on the owner's Mac, copied it into a JSON file per login in the dashboard's data volume, mode 0600, in plain text, and deleted the local copy, because every refresh rotates the refresh token and two holders sign each other out;
- refreshed it as that client's public OAuth client would: before use when under five minutes were left, after a 401 from the usage endpoint, and by an hourly keep-alive, because a refresh token lapses after a few weeks unused; one refresh at a time per login; a refused refresh was reported as "expired or revoked", and tried again at the next read;
- took the Claude plan's name from what the login file said at sign-in (`subscriptionType`, `rateLimitTier`).

The configuration's `kept_login` is a different thing: the fallback pool's long-lived token, which forwards diverted requests (`docs/specs/fallback/spec.md`). It is read at start and never changes. A login that the hub refreshes changes while it runs, and ADR-0013 put such state in the hub store, which "will hold kept logins' refresh tokens … whether its secrets are encrypted at rest is decided with kept logins".

A login made by `claude auth login` or `codex login` is the subscription's full OAuth login, not a read-only one: whoever holds it could also spend the subscription with it, and may reach whatever else of the account that login's scopes allow. A ChatGPT login's access token works against chatgpt.com's internal `backend-api`, of which the hub calls only `wham/usage`; what else of the account it reaches there (conversations, settings, account data) is not documented and was not tried, so it is taken to reach all of what the owner's own Codex sign-in reaches. A Claude login is likewise Claude Code's own sign-in to the subscription. The hub uses either only to read usage, but its value to a thief is the account's.

## Decision

**A quota login is a kept login the hub uses only to read a pool's quota windows** (`CONTEXT.md`). It is an OAuth login: the access token, the refresh token and when the access token ends, and for ChatGPT the account id, for Claude the plan facts captured at sign-in. A pool has at most one. Only a subscription pool takes one: one that speaks `anthropic-messages` takes a Claude login, one that speaks `chatgpt-codex` a ChatGPT login. It is never used to forward a request, and the configuration's `kept_login` is not one and stays as it is. The behaviour, the table, the endpoints and the laws are `docs/specs/quota-logins/spec.md`.

**It lives in the hub store**, in the quota module's table `quota_logins`, made by the step `quota/0001-quota-logins`, through the port `QuotaLogins` (ADR-0013 named it `KeptLogins`; it holds only quota logins). A refresh writes the new tokens to the store before the hub uses them, so the rotated refresh token is replaced exactly once.

**The hub refreshes it as the prototype did**, as Claude Code's and Codex's own OAuth clients would, with their public client ids: before a read when the access token ends within 5 minutes, once after a 401 from the usage endpoint, and at start and every hour for every login whose access token ends within 5 minutes. One refresh at a time per login. A refresh the provider refuses marks the login **expired**: the hub stops refreshing and using it, and says so, until the owner gives a new one. Unlike the prototype, the hub does not try a refused refresh token again.

**It never leaves the hub.** No API answer, problem, log line or request log row holds its tokens: the API gives a quota login's state (kept, expired, when it was given and refreshed, when its access token ends) and never a token.

**The owner gives it through the API**, `PUT /api/pools/{pool}/quota-login`, and forgets it with `DELETE`, both the owner's alone. Until milestone 3's setup screens and milestone 4's client exist, a **connect script** in the repository does it: it signs in with the provider's own client in a throwaway configuration directory, as the prototype's scripts did, signs in to the hub with the owner password (only the owner may give a quota login, and the owner's credential is a sign-in), sends the login, signs out, and removes every local copy. No agent ever runs it against a real provider: its tests use fake clients and a whole hub, and the README says how the owner runs it.

**The store is not encrypted at rest in this milestone.** The hub store is created readable and writable by its user only (mode 0600), and the hub's held keys, owner password and fallback `kept_login` already sit as plain secrets in the environment or in files beside the configuration, readable by the same user. On the running hub's machine, anyone who can read `cota.sqlite` can, in every deployment Cota describes, read those too, including whatever would hold an encryption key, so there encrypting adds little. That is not true of copies of the store, which is where the exposure really is: a backup or a snapshot of the store's directory or volume (the README backs the store up with the configuration, whose secrets are only references), a copy made with `sqlite3 ".backup"` under a shell's usual umask, which is readable by everyone unless made under `umask 077`, a Docker volume other containers mount, and the store's write-ahead log, which held a forgotten login's pages until a checkpoint. In all of these the store, from this milestone, is the most valuable file, and none of them holds the environment. Encrypting the store with a key from the environment would protect exactly those copies. Instead the hub store spec, the README and the recipes say that from this milestone the store holds secrets that can spend a subscription, that it and every copy of it are guarded as the environment's secrets are, how to make a backup only its user can read, and the hub warns at start of a store others can read; a forgotten or replaced login is overwritten in the store and its log emptied at once (`docs/specs/hub-store/spec.md`). 

### Open for the owner: encrypting the store's secrets

What encrypting would take, if the owner wants a copied store or a backup to be useless without the hub's environment:

- **A key by reference.** `[store] key = { env = "COTA_STORE_KEY" }` or `{ file = … }` (ADR-0009): 32 random bytes in base64, read at start and held as a `Redacted`. A hub with secrets in its store and no key, or the wrong key, refuses to start, naming the store.
- **Encrypted columns.** Each secret column (`access_token`, `refresh_token`) holds `v1:<nonce>:<ciphertext>`: AES-256-GCM through the Web Crypto API that Bun ships, a fresh 12-byte nonce per write, and the pool's id and the column's name as associated data, so a value moved to another row does not decrypt. The rest of the row stays plain: it says nothing a thief can spend.
- **A step that encrypts what is there** (`quota/0002-…`), run once by the first hub with a key, and a check at start that every secret column is encrypted.
- **Losing the key loses the logins.** The owner gives them again with the connect script; nothing else in the store is encrypted. Changing the key takes the old one beside the new (`previous_key`) for one start.
- **What it does not protect.** A thief on the running hub's machine reads the key where the hub does. And a hub that encrypts its store still has its held keys in plain text in its environment.

It is a few hundred lines with their laws, and can be added in any later milestone without changing the API or the table's other columns.

## Alternatives weighed

- **The configuration's `kept_login` for quota too.** It is read once, at start; a refreshed login must be written back while the hub runs, and a rotated refresh token lost on a restart signs the hub out.
- **One JSON file per login, as the prototype.** ADR-0013 already chose the hub store for state the hub writes, for its transactions; a second place to back up would be a second place to forget.
- **The fallback's long-lived token (`claude setup-token`) to read usage.** It would spare a second login per Claude account, but whether that token may call the usage endpoint is unknown, ChatGPT has no such token, and a pool that is not a fallback pool has none.
- **A sign-in flow on the hub itself.** The hub would run the provider's OAuth flow and receive the code. It needs a page (milestone 3), a redirect the providers' public clients accept for another host, and would make the hub impersonate the client's sign-in screen. The connect script uses the clients' own flows unchanged.
- **Encrypting now.** See above: the cost is a key to manage, lose and rotate, for a protection that holds only for a store copied without its environment.
- **Trying a refused refresh token again, as the prototype.** A refresh token the provider refused is not going to be accepted later, and calling the token endpoint every period with it says nothing new.

## Consequences

- The hub store holds secrets from this milestone: the hub store spec, the README and milestone 5's recipes say so, and the store is backed up and mounted as a secret.
- `docs/specs/sign-in/spec.md`'s table of who may call what gains three endpoints; the walker holds them (I1 to I3).
- A quota login is the subscription's full login: losing the store loses more than usage numbers. The owner can forget a quota login through the API; forgetting is not revoking, so a login whose copy may have leaked is revoked at the provider too.
- A Claude quota login can be made only on macOS for now, as in the prototype: the script reads the login from the keychain item Claude Code makes for a configuration directory, and where Claude Code keeps it on other systems is not known from the prototype. A ChatGPT login can be made anywhere Codex runs.
- An expired login stays in the store, marked, until the owner gives a new one or forgets it, so a restart does not try it again.
