---
status: active
scope: apps/hub
owner: limineol
last_verified: 2026-11-23
review_by: 2027-02-23
supersedes: []
code:
  - apps/hub/src/modules/quota/01-presentation/pools.api.ts
  - apps/hub/src/modules/quota/01-presentation/pools.handlers.ts
  - apps/hub/src/modules/quota/01-presentation/connect.ts
  - apps/hub/src/modules/quota/03-domain/quota-login.ts
  - apps/hub/src/modules/quota/03-domain/refreshes.ts
  - apps/hub/src/modules/quota/02-application/interfaces/quota-logins.ts
  - apps/hub/src/modules/quota/02-application/interfaces/token-endpoints.ts
  - apps/hub/src/modules/quota/02-application/commands
  - apps/hub/src/modules/quota/04-infrastructure/persistence/sqlite
  - apps/hub/src/modules/quota/04-infrastructure/provider-call.ts
  - apps/hub/src/modules/quota/04-infrastructure/token-endpoints
---

# Quota logins

A quota login is a kept login the hub uses only to read a pool's quota windows: an OAuth login of a Claude or ChatGPT subscription, given by the owner, kept in the hub store and refreshed by the hub. This spec covers which pools take one, the table it is kept in, giving and forgetting it, refreshing it, its expiry, what never reveals it, and the connect script that gives one. ADR-0017 gives the reasons; the readers that use it are `docs/specs/quota-readers/spec.md`.

It is the `quota` module: the port `QuotaLogins` (`02-application/interfaces/quota-logins.ts`) and its SQLite adapter in `04-infrastructure/persistence/sqlite/` with the step `quota/0001-quota-logins`, listed in `hub.ts`'s `storeSteps` after the display-names module's; the port `TokenEndpoints` with one adapter per provider in `04-infrastructure/token-endpoints/`; the commands `GiveQuotaLogin`, `ForgetQuotaLogin` and the keep-alive, the one-at-a-time refresh in the module's domain, on the clock; the endpoints of the `pools` group (`docs/specs/api/spec.md`); fakes of both ports in `05-tests/fakes/`; and the connect script in `01-presentation/connect.ts`.

## Values

- **Provider**: `anthropic` (a Claude login) or `chatgpt` (a ChatGPT login).
- **Quota login**: the pool it belongs to; its provider; its **access token** and **refresh token**; when the access token **ends**; for ChatGPT, the **account id**; for Claude, the **plan facts** captured when it was made, `subscriptionType` and `rateLimitTier`, each a string or none; when it was **given**, and its **generation**, an id made when it is given and never made again, which tells this giving of the pool's login from any other, even one given in the same millisecond; when it was last **refreshed**, or never; when it became **expired**, or never. A login is the same one, however refreshed since, while its pool and generation are.
- **Token**: 1 to 16,384 characters, none of them whitespace or a control character, since it is sent in a header. An account id: the same, 1 to 255 characters. A plan fact: 1 to 255 characters.

## Which pools take one

A subscription pool that speaks `anthropic-messages` takes a Claude login; a subscription pool that speaks `chatgpt-codex` takes a ChatGPT login. No other pool takes one: a keyed pool, whatever its protocol, every `openai-chat` pool, and an observed pool (ADR-0029). A pool has at most one. The fallback pool's `kept_login` in the configuration is not a quota login and does not count: a fallback pool takes a quota login like any other subscription pool.

## The table

`quota_logins`, made by `quota/0001-quota-logins` (`docs/specs/hub-store/spec.md`):

| Column | Type | Holds |
| --- | --- | --- |
| `pool` | `TEXT PRIMARY KEY` | The pool's id. |
| `provider` | `TEXT NOT NULL` | `anthropic` or `chatgpt`. |
| `access_token` | `TEXT NOT NULL` | The access token, as the provider gave it. |
| `refresh_token` | `TEXT NOT NULL` | The refresh token, as the provider gave it. |
| `ends_at` | `TEXT NOT NULL` | When the access token ends: an ISO 8601 instant, UTC, with milliseconds, as every time in the store. |
| `account_id` | `TEXT` | ChatGPT's account id; null for a Claude login. |
| `subscription_type`, `rate_limit_tier` | `TEXT` | Claude's plan facts; null when not given, and for a ChatGPT login. |
| `given_at` | `TEXT NOT NULL` | When the owner gave it. |
| `generation` | `TEXT NOT NULL` | Its generation: a UUID made when it was given. |
| `refreshed_at` | `TEXT` | When it was last refreshed; null until then. |
| `expired_at` | `TEXT` | When a refresh was refused; null while it is not expired. |

The tokens are stored as they came, not encrypted (ADR-0017). The store file is created readable and writable by the hub's user only (M4); from this milestone it holds logins that can spend a subscription, so it is guarded, mounted and backed up as the environment's secrets are. A row whose pool is no longer in the configuration is left alone and never used; giving a login to the pool again replaces it.

## Giving and forgetting

`PUT /api/pools/{pool}/quota-login`, the owner's alone, with a body that is one of:

```json
{ "provider": "anthropic", "accessToken": "…", "refreshToken": "…", "endsAt": "2026-11-13T15:31:29.873Z", "subscriptionType": "max", "rateLimitTier": "default_claude_max_20x" }
{ "provider": "chatgpt", "accessToken": "…", "refreshToken": "…", "accountId": "…" }
```

`subscriptionType` and `rateLimitTier` are each a plan fact or `null`; `endsAt` any ISO 8601 instant. A body that does not decode is the 400 of `ProblemDetails`, whose detail never repeats a token, as the sign-in's never repeats a password: a contract test sends a token too long and one with a space, and checks the answer holds neither.

1. A pool the configuration does not have: 404 `urn:cota:no-such-pool`.
2. A pool that takes no quota login, or takes the other provider's: 400 `urn:cota:quota-login-not-taken`, whose detail says which (`The pool "zai" is a keyed pool: only a subscription pool takes a quota login.`, `The pool "gemini" is an observed pool: only a subscription pool takes a quota login.`, `The pool "codex" takes a ChatGPT login, not a Claude one.`). Nothing is stored.
3. Otherwise the row is replaced whole: the tokens and facts given, `given_at` now, a new `generation`, `refreshed_at` and `expired_at` null. A Claude login ends at its `endsAt`. A ChatGPT login ends at its access token's `exp`: when the token is a JWT whose payload is a JSON object with a numeric `exp`, in Unix seconds, read without verifying the token, as Codex does; else 8 days after now, as Codex assumes without one. The pool's reading state is forgotten (`docs/specs/quota-readers/spec.md`), so the next ask reads with the new login.
4. Answer 200 with the pool's `QuotaLogin` (below). A store that fails: 503 `urn:cota:hub-store-unavailable`.

`DELETE /api/pools/{pool}/quota-login`, the owner's alone: 404 `no-such-pool` for a pool the configuration does not have, 404 `urn:cota:no-quota-login` when the pool has none (an expired one is one); otherwise the row is deleted, the pool's reading state forgotten, and the answer is 204. Forgetting is not revoking: the provider still honours the login, its refresh token for weeks, until the owner revokes it there. The store overwrites the deleted row and empties its write-ahead log at once (`PRAGMA secure_delete = ON`, then `PRAGMA wal_checkpoint(TRUNCATE)`), and does the same when a give replaces a pool's login, so the forgotten tokens are left in neither file; a backup or snapshot taken before then still holds them.

Neither is ever a reader key's: a quota login can spend the subscription it reads (ADR-0017).

## Its state in the quota API

Each pool of `GET /api/pools` has `quotaLogin`: `null` for a pool that takes none, else a `QuotaLogin`:

| Field | Type | Holds |
| --- | --- | --- |
| `provider` | `"anthropic"` or `"chatgpt"` | Whose login the pool takes. |
| `state` | `"none"`, `"active"` or `"expired"` | Whether it has one, and whether it is expired: an expired login is still kept, until the owner gives a new one or forgets it, and an active one is used. |
| `givenAt`, `refreshedAt`, `endsAt`, `expiredAt` | time or `null` | As in the table; all `null` when `state` is `none`. |

Never a token, never the account id, never the plan facts (the pool's `plan` is named from them, `docs/specs/quota-readers/spec.md`).

## Using it

A read of a pool with a quota login (`docs/specs/quota-readers/spec.md`), at `now`:

1. When the login is expired, or the pool has none, there is no read.
2. When its access token ends within 5 minutes of `now` (or has ended), it is refreshed first. A refused refresh makes the login expired, and the read ends without a usage call or a reading; any other failed refresh is the read's failure (`unreachable`, `failed` or `unreadable`, naming the token endpoint), and no usage call is made.
3. The usage endpoint is called with the access token. On a 401, the login is refreshed (whatever its end) and the endpoint is called once more with the new token; a second 401 is the failure `refused`, and is not refreshed again.

## Refreshing

As Claude Code's and Codex's own OAuth clients do, with their public client ids. Every call sends `Accept: application/json` and `User-Agent: cota/<version>`, and is abandoned after 10 seconds.

| | Claude | ChatGPT |
| --- | --- | --- |
| Request | `POST https://platform.claude.com/v1/oauth/token`, `Content-Type: application/x-www-form-urlencoded`, body `grant_type=refresh_token&refresh_token=<refresh token>&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e` | `POST https://auth.openai.com/oauth/token`, `Content-Type: application/json`, body `{ "client_id": "app_EMoamEEZ73f0CkXaXp7hrann", "grant_type": "refresh_token", "refresh_token": "<refresh token>" }` |
| A good answer | 2xx with `access_token` (a token) and `expires_in` (a number of seconds above 0); `refresh_token` optional | 2xx with `access_token` (a token); `refresh_token` optional |
| The new login | The new access token; the new refresh token when one is given and not empty, else the old; it ends `expires_in` seconds after now | The new access token; the new refresh token when given and not empty, else the old; it ends at the new token's `exp`, else 8 days after now |
| **Refused** | A non-2xx answer whose JSON body's `error` is `invalid_grant` | A 401; or a non-2xx answer whose error code, lowercased, is `invalid_grant`, `refresh_token_expired`, `refresh_token_reused` or `refresh_token_invalidated`. The code is `error.code` when `error` is an object, else `error` when it is a string, else `code` |
| Other failures | A 2xx that does not decode: `unreadable`; any other status: `failed`; no answer within 10 seconds: `unreachable` | the same |

The token endpoints are constants of their adapters, replaced only through the layer's options in tests.

A good answer whose new access token ends within 5 minutes of now is written like any other, and the refresh is the failure `unreadable` (`<name>'s token endpoint gave an access token that ends within 5 minutes.`), so the read makes no usage call. A hub store that cannot be read when a read needs the login is the read's failure `failed`.

- **One refresh at a time per login.** A refresh asked for while one of the same login runs (a read, a second read, the keep-alive, a refresh after a 401) waits for it and takes its outcome. A refresh, once started, runs to its end even when the API call that asked for it is abandoned, so a rotated refresh token is never lost to a closed connection. It is not finished when the hub stops: a refresh or a read in flight then is cut. The module's one-at-a-time services are in its domain, which may not use the hub's shutdown finishers (a `FiberSet` of `shared/04-infrastructure`), and the laws' restarts stop the module with calls in flight on the test clock, so waiting for them is not simple. The consequence: a refresh cut after the token endpoint rotated the refresh token, and before the new login was written, loses the new refresh token; the store keeps the old one, whose next refresh is refused, the login becomes expired, and the owner gives it again.
- **Written before used.** A good refresh updates the row (`access_token`, `refresh_token`, `ends_at`, `refreshed_at`) in one statement before the new access token is sent anywhere, and only while the row is still that login's (the same pool and generation) and holds the refresh token the refresh sent, or the one stored when it began. The provider has rotated the refresh token, so the old one is dead: if the write fails, the hub logs it, keeps the new login in memory, beside any other login of the pool kept so (one per generation, so a refresh of an older login never takes the place of a newer one's), uses it, and writes it again at every later use and keep-alive check until a write succeeds. A restart before then leaves the store with the old refresh token, whose next refresh is refused, and the login becomes expired. A refresh whose write finds the row forgotten, or given again (another generation), while it ran ends its read as if the login were expired, with no usage call: a login the owner forgot or replaced is never sent again, though the provider may have rotated its refresh token for nothing.
- **Refused means expired.** A refused refresh sets `expired_at` to now. From then on the login is neither refreshed nor used, by reads or the keep-alive, until the owner gives a new one or forgets it; a restart keeps it expired. When the store cannot write the expiry, the hub holds it in memory and writes it again at every later use and keep-alive check, as it does a refreshed login; a restart before it is written forgets it, so the hub refreshes the login once more, is refused again, and writes that expiry. The quota API says so (`state: "expired"`) and the pool's windows come from its quota headers alone (`docs/specs/quota-sources/spec.md`).
- **The keep-alive.** When the hub starts and every hour after, on the clock, every kept login that is not expired and whose access token ends within 5 minutes of the check (or has ended) is refreshed, one login after another, so a refresh token is used before it lapses (a few weeks unused, by the prototype's experience) even while nobody reads the dashboard. A failure is logged and changes nothing else; a refusal makes the login expired.
- **Logging.** A refresh's failure is logged as `quota login refresh failed` with the pool, the provider and the failure's kind and status; an expiry as `quota login expired` with the pool; a refreshed login the store did not take as `quota login not written` with the pool; a keep-alive check that cannot read the store as `quota logins could not be read`. Never a token, a body, or the account id.

## Never anywhere else

A quota login's tokens are in exactly three places: the `quota_logins` row, the `Authorization` header of a call to the pool's usage endpoint, and the body of a call to the provider's token endpoint. They are held as `Redacted` values from the moment the API decodes them, so a log line or an error that prints one prints `<redacted>`. No API answer, no problem's `detail`, no log line, no span attribute and no request log row holds one, nor the account id (a usage call's `Authorization` and `ChatGPT-Account-Id` headers are `<redacted>` wherever the call is traced, should the HTTP client be told to record headers): the reads and refreshes do not go through the relay, so they are never recorded, and the relay never yields `QuotaLogins`, so a quota login never forwards a request (R3 stays true).

## The connect script

Until milestone 3's setup screens and milestone 4's client, the owner gives a quota login with a script in the repository (`apps/hub/src/modules/quota/01-presentation/connect.ts`), run from the repository's root on a machine where the provider's client is installed and the owner's browser is signed in to the subscription:

```sh
COTA_HUB_URL=https://cota.example bun run quota:connect <pool> [--email <address>] [--allow-plain-http]
```

Any other argument, or none, or a second pool, stops it with exit code 2 and its usage line. It never prints a token, an account id, the owner password or the hub's cookie (below).

**Reaching the hub.** `COTA_HUB_URL` names the hub; without it, or when it is not a URL, the script stops with exit code 2. The owner password is `COTA_OWNER_PASSWORD`, else typed on the terminal, which does not show it; with neither (no terminal), the script stops with exit code 2. It is never an argument, and never written anywhere. Only the owner may give a quota login, and the owner's credential is a sign-in, so the script signs in (`POST /api/sign-in`) before it asks the hub anything, keeps the cookie in memory, and signs out (`POST /api/sign-out`) before it ends, whatever happened in between. A sign-out answered 401 had nothing left to end; any other failure to sign out is said (`Could not sign out of the hub: …`), and the sign-in lapses after its 30 days. Every call to the hub sends `User-Agent: cota quota:connect`, which the owner's list of sign-ins shows, and is abandoned after a minute.

**Plain http.** The owner password and the login cross the network to the hub. Over `https`, the script sends them to any host. Over plain `http`, only to a host that `COTA_HUB_URL` writes as this machine: `localhost`, `127.0.0.0/8` or `[::1]`. A private address is not enough: `10.0.0.0/8`, `172.16.0.0/12` and `192.168.0.0/16` are where every hotel, café and office network lives, and plain http there is readable by whoever answers at that address. A name other than `localhost` is not resolved to decide (`127.0.0.1.nip.io` is a name, and refused), and nothing else is let through (not `0.0.0.0`, a private or link-local address, `100.64.0.0/10` or an IPv4 address written as IPv6). To any other host, the script stops with exit code 2 before it asks for the password, saying why (`COTA_HUB_URL is plain http to <host>, which is not this machine, so the owner password and the login would cross the network unencrypted. Use https, or pass --allow-plain-http if the hub is reached over a private or overlay network that encrypts its traffic, such as a VPN, Tailscale or ZeroTier.`), unless `--allow-plain-http` is given: an encrypted overlay network is the case it is for. A URL that is neither `http` nor `https` is always refused.

**What a run killed outright left.** A run ended by `SIGKILL`, or by the machine stopping, cannot clean up, and its throwaway directory (and, for Claude, its keychain item) may hold a login. So every run, once its arguments are read, looks in the home directory for directories whose names start `.cota-connect-` and names each, with how to remove it: `<directory> was left by a run of this script that was stopped before it could clean up, and may hold a login. Once no run of this script is running, remove it (rm -rf '<directory>') and, if it was a Claude sign-in, its keychain item (security delete-generic-password -s "Claude Code-credentials-<h>").`, `<h>` as below. It removes none of them, since a run still running has one too, and goes on.

**Steps**, each stopping the script with a message on failure:

1. Sign in to the hub. A refused sign-in stops with exit code 1 and the problem's title and detail: `The hub refused the sign-in: <title> <detail> (<status>)`.
2. `GET /api/pools`, decoded with the API's own schema of the answer (`Pools` in `pools.api.ts`): an answer it does not decode stops with exit code 1 before any client runs (`The hub's list of pools is not one this script reads: is the hub of the same version?`). Then find the pool. A pool the hub does not have, or whose `quotaLogin` is `null`, stops with exit code 2 before any client runs (`The hub has no pool "<pool>".`, `The pool "<pool>" takes no quota login: …`).
3. Check what the provider's login needs (below); each lack stops with exit code 2 before any client runs.
4. Make the login with the provider's own client in a throwaway directory (below).
5. `PUT /api/pools/{pool}/quota-login` with it, encoded with the API's own schema of the body (`GivenQuotaLogin` in `pools.api.ts`), which checks it as the hub would. A login that schema does not take is not sent, and stops with exit code 1: `The login was not kept: it is not one the hub takes: a token is 1 to 16,384 characters with no whitespace or control character, an account id 1 to 255 of them, and a plan fact 1 to 255 characters.` Any answer but 200 stops with exit code 1: `The hub did not keep the login: <title> <detail> (<status>)`. No answer: `The hub may not have kept the login: …`, since the hub may have kept it before the answer was lost.
6. Print `The hub now reads <pool>'s quota windows with <account>'s login.` and exit 0.

**Whatever happens after the throwaway directory is made**, a success, a failure, a refused `PUT` or an interrupt, the script stops the provider's client if it still runs (`SIGTERM`, then `SIGKILL` after 5 seconds), and deletes the directory and, for Claude, the keychain item, before it exits: a refresh by the hub rotates the refresh token, and a second holder would sign the hub out, or be signed out by it. A failure says that the login was not kept and why (`The login was not kept: <why>`), with exit code 1. An interrupt (`SIGINT`, `SIGTERM`, `SIGHUP` when its terminal closes or its SSH session drops, `SIGQUIT`, or Ctrl-C while the password is typed) ends it with exit code 130 and `Interrupted: the login was not kept.`, or, once the `PUT` was sent, `Interrupted: the hub may have kept the login. GET /api/pools says whether it did.` A copy it cannot delete is named, so the owner deletes it (`Could not remove <directory>, which may hold the login: remove it yourself.`, `Could not delete the keychain item "<name>", which may hold the login: delete it in Keychain Access.`), and the script exits 1 even after a kept login.

**Never printed.** The tokens, the account id and the id token are held as `Redacted` values from the moment the script reads them, and the owner password and the cookie too. The output of `claude auth status` and of `security` is read by the script and never shown; no message holds what a client or the keychain wrote, only which field was missing. The hub's problems are printed as it gives them: their details never repeat a token (G1). An unexpected failure is reported without its cause, which could hold a secret. There is no flag that prints more.

**The provider's client** is run by name from `PATH`. Its sign-in runs with the terminal; `claude auth status` and `security` run without it. Each is given only these of the script's environment, beside the client's own directory (`CLAUDE_CONFIG_DIR` or `CODEX_HOME`):

| Variables | Why |
| --- | --- |
| `PATH` | To find the programs it runs, the one that opens the browser among them. |
| `HOME`, `USER`, `LOGNAME` | The owner's home and name, where the client and `security` find the owner's keychain and files. |
| `SHELL` | The owner's shell, which Claude Code looks for when it starts. |
| `TMPDIR` | The owner's temporary directory (macOS gives each user their own). |
| `TERM`, `COLORTERM`, `LANG` and every `LC_*` | How the sign-in draws in the terminal, and in which language and characters. |
| `DISPLAY`, `WAYLAND_DISPLAY`, `XDG_RUNTIME_DIR`, `XDG_CURRENT_DESKTOP`, `DBUS_SESSION_BUS_ADDRESS`, `BROWSER` | To open the browser on Linux, where Codex runs too. |
| `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY`, and each in lowercase | A proxy the owner's network needs to reach the provider (it may hold the proxy's own credentials, which the owner set for exactly this). |
| `SSL_CERT_FILE`, `SSL_CERT_DIR`, `NODE_EXTRA_CA_CERTS` | The certificates such a network needs: Codex reads the first two, Claude Code, a Node program, the third. |

Nothing else reaches it: not the owner password under any name (`COTA_OWNER_PASSWORD`, the README's `COTA_DEV_OWNER_PASSWORD`), not a hub key, a kept login or any other secret the owner's shell holds, and nothing that would make it sign in otherwise than in the browser (`CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `CODEX_API_KEY` and the like).

**A Claude login**:

- needs the macOS keychain's `security` on `PATH`, since the login is read from the keychain: without it the script stops with exit code 2 and says that a Claude login can be connected from macOS only for now; then `--email` (exit code 2 without it); then `claude` on `PATH` (exit code 2 without it; below for which `claude`).

1. Make a directory with `mkdtemp` under the home directory (`~/.cota-connect-XXXXXX`) and take its real path, which has no symbolic link, since Claude Code names its keychain item after it: `Claude Code-credentials-<h>`, where `<h>` is the first 8 hexadecimal digits of the SHA-256 of the path.
2. Look at the keychain before the sign-in (the keychain rule, below): `security find-generic-password -s "Claude Code-credentials-<h>"` must answer 44, no such item; then `security find-generic-password -s "Claude Code-credentials"`, the item of the owner's own Claude Code, whose attributes (or that there is none) the script keeps.
3. Run `claude auth login --claudeai --email <address>` with `CLAUDE_CONFIG_DIR` set to the directory. The owner signs in in the browser. Then look at `Claude Code-credentials` again (the keychain rule). Any exit code but 0 is a failure (`Claude Code's sign-in ended with exit code <n>.`, or `was stopped by <signal>`).
4. Run `claude auth status --json` in the same environment. Its `email` must be the address given, in any case, else `Claude Code signed in as <email>, not <address>.`
5. Read the keychain item: `security find-generic-password -s "Claude Code-credentials-<h>" -w`. Its JSON's `claudeAiOauth` gives `accessToken`, `refreshToken`, `expiresAt` (Unix milliseconds), and `subscriptionType` and `rateLimitTier` (optional; an empty one is sent as `null`). No item: `Claude Code left no login in the keychain item "<name>".`; no such fields: `the keychain item "<name>" does not hold a Claude login: …`.
6. Send `{ provider: "anthropic", accessToken, refreshToken, endsAt, subscriptionType, rateLimitTier }`, `endsAt` being `expiresAt` as an ISO instant. The account the message names is the address given.
7. Delete the item (`security delete-generic-password -s "Claude Code-credentials-<h>"`, again until `security` answers 44, no such item) and the directory.

This is how the prototype's `scripts/connect-claude` did it, and it depends on Claude Code's undocumented keychain naming, which is taken from the prototype and was not seen again: no test, and no agent, ever ran the real `claude` or `security` for this script. A Claude Code that kept its login in `Claude Code-credentials` whatever its configuration directory would have the throwaway sign-in replace the owner's own login, and the script would then hold nothing of its own to read or delete.

**The keychain rule.** The script reads and deletes only a keychain item it made, and when it cannot be sure it touches nothing and says what to check:

- **The item it reads and deletes is this run's.** `Claude Code-credentials-<h>` is named after a directory `mkdtemp` has just made, and the script looks for it before the sign-in: an item of that name already there is not this run's, so the script stops with exit code 1 before any client runs, and reads and deletes nothing: `The login was not kept: the keychain item "<name>" was there before Claude Code signed in, so it is not this run's, and the script left it alone. Delete it in Keychain Access if it is not yours, then run this again.` Only after that look does the script register the item's deletion, so the only item it ever deletes is one that was not there before its own sign-in.
- **The owner's own item is unchanged by the sign-in.** Before and after the sign-in, the script asks `security` for the attributes of `Claude Code-credentials` (without `-w` or `-g`, so never its secret; its modification date among them), or learns there is none. If what `security` prints differs (the item appeared, went, or was written), the sign-in may have used the owner's item, so the script stops with exit code 1, whatever the sign-in's exit code, reads and deletes nothing of that item, and says what to check: `The login was not kept: the keychain item "Claude Code-credentials", your own Claude Code's login, changed while Claude Code signed in in the throwaway directory. Either this Claude Code keeps its login there whatever its directory, so the sign-in replaced yours, or your own Claude Code wrote it meanwhile: the script cannot tell which, so it read and deleted none of it. Check that claude still works, signed in as you, and sign in to it again if not. If this happens again, this version of Claude Code cannot be connected by this script.` An owner's Claude Code that refreshes its own login during the sign-in is a false alarm, said as one.
- **What it cannot be sure of, it stops on.** A look `security` answers with neither 0 nor 44 stops with exit code 1: `The login was not kept: security could not say whether the keychain item "<name>" exists: it ended with exit code <n>.` Before the sign-in, nothing has been written yet; after it, the throwaway's item is deleted as always, and the owner's is left alone.
- **What it does not see.** A write to the owner's item that leaves its attributes as `security` prints them, which would take a write within the same second as the first look if the modification date counts whole seconds (a sign-in in a browser takes longer). Nor does it compare the account the throwaway signed in to with the owner's own login, which it never reads: who signed in is checked by `claude auth status` (step 4).

**A ChatGPT login**, on any system Codex runs on, needs `codex` on `PATH` (exit code 2 without it); `--email` is not used.

**The provider's client** is the first file named `claude` or `codex` on `PATH` that is not one of `cota`'s shims, told by the shim's marker in its first 512 bytes (`isShim` of `#shared/03-domain/shim.ts`, the rule `cota` itself launches by). On a joined machine the shims come first on `PATH`, and a shim's client would sign in through `cota` and the hub, not to the provider; the script looks past it to the real client. With none but shims, it stops with exit code 2: `Codex (codex) is not on PATH beyond cota's shims: install it, then run this again.`

1. Make a directory with `mkdtemp` under the home directory.
2. Run `codex login -c 'cli_auth_credentials_store="file"'` with `CODEX_HOME` set to the directory, so that Codex writes the login to `auth.json` there rather than the keychain. Any exit code but 0 is a failure (`Codex's sign-in ended with exit code <n>.`).
3. Read `<directory>/auth.json`: `tokens.access_token`, `tokens.refresh_token`, and `tokens.account_id`, else the `chatgpt_account_id` claim under `https://api.openai.com/auth` in the payload of `tokens.id_token`. The id token's `email` claim names the account in the final message (`an unnamed account` without one). No file: `Codex wrote no auth.json in the throwaway directory.`; no tokens: `Codex's auth.json does not hold a ChatGPT login: …`; no account: `Codex's auth.json names no account: …`.
4. Send `{ provider: "chatgpt", accessToken, refreshToken, accountId }`.
5. Delete the directory.

**Its tests** (`01-presentation/connect.contract.test.ts`) run the script as the owner runs it, against a whole hub from the harness, with fakes of `claude`, `codex` and `security` (`05-tests/fakes/connect-clients.ts`) as the only commands on `PATH`, and a home directory and a keychain of their own; each test checks that each name resolves to its fake. They cover a login of each provider kept and read with; each stop before a client runs; a client that fails, is cancelled or signs in to another account; a login that is missing or malformed, or that the API's schema does not take (never sent); the hub's answer 401 (a sign-in revoked meanwhile), and, from a stand-in for the hub, 400 `quota-login-not-taken`, 403, 404, 413, 415 and 503, and a list of pools that is not the API's; an interrupt while the client signs in, by `SIGINT`, `SIGHUP` or `SIGQUIT`; a directory an earlier run left, named and not removed; and the keychain rule's two stops, a sign-in that changes the owner's own item (a fake `claude` that keeps its login there) and an item of the throwaway's name already there; and a joined machine, where a shim of `cota`'s comes first on `PATH` and the real client is run. In each they check what was printed, that no token, account id or password was printed or logged, that no throwaway directory and no keychain item of the script's is left, that the clients were given only the variables above (a test gives the script the owner password as `COTA_DEV_OWNER_PASSWORD`, a hub key and the variables of a client's own login, and checks the names each client saw), and that the script signed out. The fakes take their settings from a file, since the environment does not reach them. No test, and no agent, ever runs it against a real provider. The README says how the owner runs it, and `docs/install.md` gives it as the owner's step once the hub is set up.

## Laws

| Id | Law | Held by |
| --- | --- | --- |
| G1 | **A quota login never leaves the hub.** For generated quota logins and any sequence of gives, forgets, reads, refreshes, keep-alive checks and failures, no API answer, no problem, no log line and no request log row holds any of their access or refresh tokens. | property, contract |
| G2 | **A quota login never forwards.** With a quota login kept for every subscription pool, no request the relay sends to a provider carries a quota login's token. | property |
| G3 | **One refresh at a time.** For any overlapping reads and keep-alive checks, no two refreshes of one quota login are in flight at once, and each refresh sends the refresh token the previous good refresh returned, or the one given when there was none. | property |
| G4 | **A refused refresh expires the login.** Once a token endpoint refuses a quota login's refresh, no refresh and no usage call is made with that login, across restarts once its expiry is written, until a new one is given for its pool. An expiry the store could not write is held in memory only, so a restart before it is written refreshes the login once more; that refusal, written, makes it expired (a fixed example shows it). | property |
| G5 | **Fresh before use.** No usage call sends an access token that ends within 5 minutes of the call. | property |
| G6 | **One retry.** A read makes at most two usage calls, and a second only after the first was answered 401 and the login was then refreshed. | property |
| G7 | **The store holds the latest login.** After any sequence of gives and refreshes whose writes succeed, the hub store holds the tokens of the latest good refresh, or the given ones when none followed, and a hub started on it reads with them. | property |
| G8 | **Kept alive.** At the hub's start and at every hour after it, every kept quota login that is not expired and whose access token ends within 5 minutes of that check is refreshed. | property |
| G9 | **Only where taken.** `PUT /api/pools/{pool}/quota-login` with a login for a pool that takes none, or that takes the other provider's, is answered 400 `urn:cota:quota-login-not-taken`, and the hub store does not change. | contract |

The connect script makes no promise for every input, so it has no law: its tests above, and the mutants that print a token or leave a copy (`tooling/mutants.table.ts`), hold it.

The access table of `docs/specs/sign-in/spec.md` gives `GET /api/pools` to a reader key or the owner and the two quota-login endpoints to the owner alone; I1 to I3 hold them, as every endpoint's.

G1 runs generated sequences against a whole hub (the harness, with the fake provider as usage and token endpoints that answer, fail, refuse and time out), capturing every API answer, every log line and the request log fake, and searches them for every token generated; the contract test gives a login, reads, and checks the literal answers. G2 runs the relay's property test with quota logins kept and checks every request the fake provider received. G3 to G8 run generated sequences of reads, keep-alive checks, token endpoint outcomes and moves of the test clock against the module over the in-memory store, and G4 and G7 again over a SQLite store in a temporary file, restarting the module on it; the moves land a millisecond before, at and after each 5-minute mark and each hour. G4 also replays, as fixed examples, the scenes its property found in review: logins given to one pool in the same millisecond while the store fails its writes and refreshes of the older ones run. G9 is a contract test over a configuration with every kind of pool.

## Not built, on purpose

- **Encryption at rest.** Open for the owner (ADR-0017).
- **A sign-in flow on the hub.** The script uses the clients' own flows.
- **A Claude login from Linux or Windows.** Where Claude Code keeps its login outside the macOS keychain is not known from the prototype; it comes with milestone 4's client.
- **A warning before a refresh token lapses.** After parity (`docs/roadmap.md`).
- **Several quota logins per pool.** A pool is one subscription.
- **Reading the plan again after the login was made.** The Claude plan's name is what the login said when it was made.
- **Revoking a forgotten login at the provider.** `DELETE` forgets it in the hub; the owner revokes it at the provider if they want it dead.
