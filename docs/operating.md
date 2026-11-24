---
status: active
scope: repository
owner: limineol
last_verified: 2026-11-23
review_by: 2027-02-19
supersedes: []
code:
  - deploy/compose.yaml
  - deploy/cota.toml
  - examples/cota.example.toml
  - apps/hub/src/restore-archive.ts
  - apps/hub/src/modules/quota/01-presentation/connect.ts
  - skills/cota-memory/SKILL.md
  - apps/cli/src/cli.ts
---

# Operating a deployment

A deployment is the hub and its ClickHouse, run by Docker Compose from the hub directory that [`install.md`](install.md) made. This page is the deployment day to day: what is where, its health and its log, signing in, what to copy, the archive, quota logins, hub keys, SQL, the memory skill, the machines, and what to do when something fails.

Every command runs in the hub directory, `~/cota-hub`, unless it says otherwise, and the hub is on the install's port, 8080: put yours in its place.

```sh
cd ~/cota-hub
```

## What is where

| | Holds | Secret |
| --- | --- | --- |
| `compose.yaml` | The two services, what they mount, the address the hub is published on | no |
| `.env` | `COTA_HUB_IMAGE` (the hub image), `COTA_UID` and `COTA_GID` (your user and group, which the hub runs as), `COTA_BIND` and `COTA_PORT` (where it is published) | no |
| `cota.toml` | The configuration: the pools, the hub keys by the files that hold them, the limits | no, but it names every secret |
| `secrets/` | One file per secret: ClickHouse's password, the hub keys, the keys the hub holds for API plans, the login of a fallback pool | yes |
| `store/` | The hub store, `cota.sqlite`: the owner password's hash, passkeys' public keys, sign-ins, display names, routes and quota logins | yes: quota logins are kept unencrypted |
| `archive/` | The archive: one directory per ended day of the request log | every conversation, in the clear |
| `previous/` | What a rollback needs, made by an upgrade ([`upgrading.md`](upgrading.md)) | as `store/` |
| the volume `cota_clickhouse` | ClickHouse's data: the request log | every conversation, in the clear |

The hub reads `cota.toml` and `secrets/` only when it starts. Its container mounts them read-only, and writes only `store/` and `archive/`, as your user. [`examples/cota.example.toml`](../examples/cota.example.toml) explains every setting.

## Starting, stopping and health

```sh
docker compose ps
curl -s http://127.0.0.1:8080/health
```

Both services say `healthy`, and the hub answers `{"status":"ok"}`. That answer says the hub is up; whether it can write the request log is in its log (below).

`docker compose stop` stops both and `docker compose start` starts them again. After a change to `cota.toml` or a file of `secrets/`, restart the hub alone:

```sh
docker compose restart hub
```

`docker compose down` removes the containers and keeps everything else, the volume included; `docker compose up -d --wait` makes them again. Never add `--volumes` to `down`: it deletes the request log.

Docker starts both again after Docker or the machine restarts, as long as Docker itself starts at boot. That is your Docker engine's setting (on macOS, Docker Desktop's or OrbStack's start at login), and Cota never changes it.

## The hub's log

```sh
docker compose logs hub
docker compose logs --follow --since 10m hub
```

Each line has its time and level. At start the hub says `cota hub listening on http://0.0.0.0:8080, with pools …`, naming each pool and its protocol, then `SQL runs as the ClickHouse user cota_sql`; inside its container it always listens on 8080, whatever `COTA_PORT` publishes. A hub that is not set up prints its setup code (Signing in). The lines worth acting on are warnings and errors:

```sh
docker compose logs hub | grep -E ' (WARN|ERROR) '
```

Each says what is wrong and, where there is one, what to do: `the hub store can be read by others than the hub's user; it holds quota logins, so make it mode 0600`; `the request log could not … ; it will try again`, again and again, when ClickHouse cannot be reached; `the request log's queue is full; it dropped its oldest request`; or one of the archive's, below. `docker compose logs clickhouse` is ClickHouse's. Both use Docker's `local` log driver, which rotates its files.

## Signing in

A new hub is not set up: its log has a line `this hub is not set up: open its dashboard, give it the setup code XXXX-XXXX-XXXX and choose the owner password`, with its own code. Open the dashboard at the hub's address: it shows the Setup screen. Give it the code (in any case, with or without its hyphens) and choose the owner password, 12 characters or more. The hub is then set up, and that browser is signed in for 30 days. A restart before then prints a new code.

The hub store keeps the owner password as an argon2id hash. Settings → Sign-ins changes it, which ends every other sign-in, lists the browsers signed in and ends them, and makes and removes passkeys. With a passkey made, the sign-in screen offers "Sign in with a passkey" beside the password, and Settings can turn the stored password off; nothing removes the last way in. A browser offers passkeys only at an `https` address with a host name, or on `localhost`: elsewhere the hub needs a reverse proxy in front ([`recipes/https.md`](recipes/https.md)). A passkey belongs to the address it was made at, and a hub reached at a new name needs a new one.

### A forgotten owner password

A password in the configuration wins over the stored one. To get back in, put a new one in a file of its own, typed into your own terminal (paste it, then Enter and Ctrl-D):

```sh
(umask 077 && cat > secrets/owner-password)
```

add it to `cota.toml`:

```toml
[sign_in]
password = { file = "/etc/cota/secrets/owner-password" }
```

and run `docker compose restart hub`. Sign in with it. You can keep it there; while it is, it is the owner password, and Settings cannot change it. To go back to a password chosen in the browser, turn the stored one off in Settings → Sign-ins, then remove the `[sign_in]` table and the file, and restart the hub. With no way in left, it is not set up again and prints a setup code; with a passkey, it is still set up and you sign in with that.

## What to copy

The hub directory holds everything of the deployment but the request log: copy it, with the hub stopped so that the hub store is whole, to wherever you keep secrets. The copy is readable by you alone:

```sh
docker compose stop hub
(umask 077 && tar -C ~ -cf ~/cota-hub-$(date +%F).tar cota-hub)
docker compose start hub
```

It holds the quota logins, which can spend their subscriptions, and the archive, which holds every conversation: guard it as you guard the secrets in it.

The request log is in ClickHouse's volume. The archive is its copy, a day at a time, of every day that ended more than an hour ago: copied with the hub directory, it gets the request log back to that point (The archive, below). A copy of the volume itself, ClickHouse stopped, is in [`recipes/copying-the-hub-directory.md`](recipes/copying-the-hub-directory.md).

Cota copies nothing off the machine. Where the copies go, and how often, is yours.

## The archive

The hub archives each UTC day an hour after it ends: a minute after the hub starts, and then an hour after each run, it writes each day not yet archived to `archive/<day>/`, one file per table of the request log (JSON lines compressed with zstd) and `manifest.json`, which says what each file holds. ClickHouse loads each file back and checks its count and checksum before the file gets its name. A day that changes later (a request that finished late) is archived again; a day the request log has lost rows of is never overwritten, and the hub says so. Its log says `the archive archived <day>: <n> rows in <n> bytes` for each day it writes.

The files hold every conversation in the clear, readable by you alone (mode 0600), and never change once named. Read a day without ClickHouse:

```sh
ls archive/2026-11-10
zstd -dc archive/2026-11-10/requests.*.jsonl.zst | jq -c '{id, started_at, pool, model, outcome}'
jq '.tables[] | {table, file, rows}' archive/2026-11-10/manifest.json
```

### A restore

A restore adds back into the request log the archived rows it does not hold: after the volume was lost, or rows were deleted. The hub may be running. It runs from the hub image, with the hub's configuration, which sees the archive at `/var/lib/cota/archive`:

```sh
docker compose run --rm hub bun run archive:restore /var/lib/cota/archive --from 2026-11-01 --to 2026-11-10
```

Without `--from` and `--to` it restores every archived day. It checks each day first (its manifest, each file's size and SHA-256, the tables' columns, and each file's count and checksum once loaded), refuses a day that fails any check with nothing added, and adds of the others only the rows the request log does not hold. It prints one line per day and a summary:

```text
2026-11-10: added 0 items, 0 request items, 2 requests and 0 titles
1 day: 1 restored, 0 already held, 0 refused, 0 failed.
```

It exits 0 when no day was refused or failed, 1 when one was, and 2 when it could not start. Running it again adds nothing (`already held`), so a restore that was interrupted is run again. Run one restore at a time: two at once can each add the same rows. After a lost volume, `docker compose up -d --wait` starts ClickHouse on a new, empty volume and the hub makes its tables; then run the restore. What happened since the last archived day (the current day, and the hour after the one before) is not in the archive. [The archive spec](specs/archive/spec.md) has every rule.

## Quota logins

Without a quota login, a Claude or ChatGPT pool's quota windows come from the headers of its latest answers. A quota login lets the hub read them from the provider, as Claude Code and Codex show them: every window, the per-model ones included, and the plan's name, current even while nobody uses the pool. It is an OAuth login of the subscription, which the hub keeps in its store and refreshes. Settings → Quota logins shows each subscription pool's, and the command that gives one.

You give one with the connect script, from a checkout of Cota, on any machine that reaches the hub and has Claude Code or Codex installed and a browser signed in to the subscription, with the hub's address:

```sh
COTA_HUB_URL=https://cota.example.com bun run quota:connect <pool>
```

A Claude pool also takes `--email <the subscription's address>`, and is connected from a Mac for now, since its login is read from the macOS keychain. On a joined machine the script runs the real client, never `cota`'s shim of it, which would sign in through the hub. It signs in to the hub with the owner password (from `COTA_OWNER_PASSWORD`, or typed), has the client sign in in a throwaway directory, sends the login to the hub, and deletes every copy left on the machine, since two holders of one login sign each other out. It prints no token, and cleans up on Ctrl-C and when its terminal closes. Over plain `http` it sends the password and the login only to this machine (`localhost`, `127.0.0.0/8`, `[::1]`); add `--allow-plain-http` when the hub is reached over a network that encrypts its traffic, such as a VPN. After your first connect, check that `claude` (or `codex`) still works, signed in as you: the real sign-ins have run against fakes of the clients only.

Settings forgets a quota login. Forgetting is not revoking: the hub stops using it and removes it from the store, but the provider still honours it, its refresh token for weeks. Revoke it at the provider if you want it dead. A quota login the provider refused to refresh is expired, and Settings says so until you give a new one. The usage endpoints of Claude and ChatGPT are undocumented: the hub calls them, and refreshes the logins, as Claude Code's and Codex's own clients do, so a change at the provider can stop a reading until Cota follows it.

## Hub keys

The install makes three hub keys: `clients` (the subscription key, for Claude Code and Codex), `fleet` (the keyed key, for OpenCode and Pi, which spends the keys the hub holds) and `agents` (the reader key, which reads the request log and opens no pool). Any number of each scope may exist, each with its own name and secret; the request log records which key each request came with.

To make one more, say for a machine you want to be able to shut out alone, make its file and add its table to `cota.toml`:

```sh
(umask 077 && openssl rand -hex 24 > secrets/laptop)
cat >> cota.toml <<'EOF'

[[hub_keys]]
name = "laptop"
scope = "subscription"
secret = { file = "/etc/cota/secrets/laptop" }
EOF
docker compose restart hub
```

Give it to the machine as a join does ([`install.md`](install.md), Each machine, step 2), from `secrets/laptop`. To retire a key, remove its table from `cota.toml` and its file from `secrets/`, and restart the hub: every machine that sends it is refused from then on (401), and doctor's `hub-keys` check fails there until it joins again with another. A key that leaked is retired the same way.

## SQL

The dashboard's SQL console runs read-only SQL over the request log beside its schema. It runs as `cota_sql`, a ClickHouse user the hub makes at every start, which can read the `cota` database and nothing else. A query runs at most 30 seconds, and an answer holds at most 5,000 rows or 16 MiB of them (`truncated` says whether there was more); `[sql]` in `cota.toml` sets these and the other limits, which no query can change. A query is one statement, without a `FORMAT` clause. A reader key can ask the same, at `POST /api/sql`, as the memory skill does. For anything else, ClickHouse's own client runs in its container, as its owner:

```sh
docker compose exec clickhouse sh -c 'clickhouse-client --user cota --password "$(cat /etc/cota/secrets/clickhouse)" --database cota'
```

That user can change and delete anything: the request log has no other copy but the archive.

## The memory skill

The memory skill ([`skills/cota-memory/SKILL.md`](../skills/cota-memory/SKILL.md)) lets a coding agent on a joined machine search past sessions, read their transcripts and ask the request log in SQL, through `cota memory`, with the machine's reader key. The agent never sees the key. On the hub's machine, give it the reader key from its file, and copy the skill where Claude Code reads a user's skills, from the checkout's root:

```sh
cota memory key < "$HOME/cota-hub/secrets/agents"
mkdir -p ~/.claude/skills && cp -R skills/cota-memory ~/.claude/skills/
```

`cota` is the command the install built and put at `~/.local/bin/cota` ([`install.md`](install.md), Each machine). On another machine, run `cota memory key` alone and paste the key at its prompt, which does not show it. It says `cota: kept the reader key; cota memory reads the request log with it.`; `cota memory get /api/machine` then answers `{"hubKey":{"name":"agents","scope":"reader"},"pools":[]}`. Where Codex, OpenCode and Pi read skills is not confirmed yet: copy the folder where their own documentation says. A reader key reads every conversation: give one only to agents you trust with all of them, and a key of its own to each, so that you can retire one alone (Hub keys).

## The machines

Each machine runs `cota`, joined to the hub by [`install.md`](install.md). A join keeps the hub's address and the machine's hub keys in `~/.config/cota`, readable by you alone. It writes a shim for each client to `~/.local/share/cota/bin`, and puts that directory first on `PATH` in the last line of your shell's file (`~/.zshrc`, `~/.bashrc` or `~/.profile`; fish gets a file of its own). It adds the hub's providers to Codex's, OpenCode's and Pi's configuration where they are installed, and changes nothing else in those files. It schedules the title reporter, which sends the hub each session's title every 30 seconds, as Claude Code, Codex and T3 Code name it.

In a new shell, `claude`, `codex`, `opencode` and `pi` are the shims, which start the real client through the hub, tagged with the project (the `origin` remote, else the directory's name) and the machine. Claude Code and Codex first ask the hub which pool the project bills, and get the login that pool spends; OpenCode and Pi bill the pool of the model you pick. Routes are set in the dashboard's Settings → Routes. On a machine:

- `cota route` says which pool a launch in this directory would bill, and why.
- `cota --pool <pool> claude`, or `COTA_POOL=<pool>`, bills another pool for one launch, and for the clients that session starts. Inside such a session, a client of the other kind (`codex` inside `claude`) is refused that pool: start it there as `cota --pool <its pool> codex`.
- `COTA=off claude` starts the client as if `cota` were not there.
- `cota login <pool>` keeps a login for a Claude subscription other than the one Claude Code is signed in to (made with `claude setup-token`), for a route that names it. A session launched with it makes model requests only: it has no claude.ai connectors and no Remote Control. A connector needed in those projects is added to the machine as a server of the user's (`claude mcp add --scope user …`), which every pool has, where it has an address of its own; one reached only through claude.ai is not to be had there. A `claude` started inside such a session is launched through `cota` again, with this pool's login. On a machine joined with `--no-shims`, start it there as `cota claude`, not `claude`: a `claude` run directly reaches the hub with the login Claude Code is signed in to, and spends that subscription under this pool's name.
- When the hub cannot be reached, a launch goes direct to the provider with the login its route would have used, and says so in one line. Those requests are neither logged nor diverted, and OpenCode and Pi cannot go direct: only the hub holds their keys.
- `cota doctor` checks the configuration, the hub and its keys, the files' modes, the shims and `PATH`, the clients and their configuration, and the title reporter. Each check that failed or warned names its fix. It names where it found each client, and warns when that file is a script (another gateway's wrapper would take every session past the hub), when a `PATH` line comes after `cota`'s, and when the shims run a `cota` inside a Git checkout.
- `cota leave` undoes the join: the title reporter's schedule, the hub's providers in the clients' files, the shims and their `PATH` line, and the keys.

[The CLI spec](specs/cli/spec.md) has every command.

## When something goes wrong

### The hub does not start

```sh
docker compose ps --all
docker compose logs hub
```

The hub prints why, and the install's step 5 lists the usual causes and their fixes ([`install.md`](install.md), The hub, step 5): a variable missing from `.env`, a missing file of the hub directory, ClickHouse's password file empty, a configuration that does not read (each problem with its place), a secret file that cannot be read or is empty. Fix it, then `docker compose up -d --wait`. A hub store that holds a step this hub does not know is one a newer image wrote: start that image again, or roll back with the store the upgrade kept ([`upgrading.md`](upgrading.md)).

### A machine cannot reach the hub

On that machine, `curl -s "$HUB/health"` with the address it joined; on the hub's machine, `curl -s http://127.0.0.1:8080/health`. If the hub answers on its own machine and not from the other:

- `COTA_BIND` in `.env` is where the hub is published: `127.0.0.1` is that machine alone, for a reverse proxy beside it.
- An address that came up after Docker started, such as a VPN's at boot, was not there when Docker published the port. Publish it again once it is up:

  ```sh
  docker compose up -d --force-recreate --wait hub
  ```

- A firewall, the VPN or the proxy is in the way. Those are yours.

Meanwhile the machine's launches go direct, with the login each route would have used: Claude Code and Codex keep working, unlogged, and OpenCode and Pi stop. [`recipes/private-network.md`](recipes/private-network.md) has more on a hub that only a private network reaches.

### Doctor fails a check

Run `cota doctor` and do what each `fix:` line says. The install prompt's table says what each check's fix means and which are yours to decide ([`install.md`](install.md), Each machine, step 3). `cota doctor --json` gives the same as JSON.

### The Mac that runs the hub sleeps

When a Mac sleeps, its container engine (Docker Desktop's or OrbStack's virtual machine) pauses with it, and the hub stops answering until it wakes: every machine's launches go direct, or stop for OpenCode and Pi. Docker's restart policy cannot help, since nothing stopped. Keep the hub's Mac from sleeping on its own: in System Settings, Energy on a desktop Mac (Battery, then Options, on a laptop on power), turn on preventing automatic sleep when the display is off. The display sleeping alone is fine. This shows what the Mac does now:

```sh
pmset -g | grep -E '^ *(sleep|displaysleep) '
```

`sleep 0` means it never sleeps on its own. That setting is yours: Cota never changes it.
