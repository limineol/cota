---
status: active
scope: repository
owner: limineol
last_verified: 2026-11-24
review_by: 2027-02-20
supersedes: []
code:
  - deploy/compose.yaml
  - deploy/cota.toml
  - examples/cota.example.toml
  - apps/cli/src/cli.ts
  - apps/cli/build.ts
  - .github/workflows/release.yml
  - skills/cota-memory/SKILL.md
---

# Installing Cota

This document is for a coding agent: you were given it to install Cota for the person you work for, the owner. Follow it in order. Do every step yourself unless it says the owner does it. Stop where it says stop.

## What Cota is

Cota is one hub for every AI coding subscription and API plan its owner has: Claude Code, Codex, OpenCode and Pi send their requests through it, from every machine the owner works on. The hub forwards each request with the client's own login or the key it holds for a pool, bills each project to the pool the owner chose, and keeps every request and conversation in a request log the owner reads in the hub's dashboard. Each machine runs `cota`, which joins it to the hub, launches the clients through the hub, and reports each session's title.

## Never

- Never read, copy or print a client's login: `~/.claude`, `~/.codex/auth.json`, a keychain entry, or anything a client signed in with. Cota never needs one from you; where it needs a login, the owner types it.
- Never put a secret in a command's arguments, a log, or a file you leave behind: no hub key, provider key, login, setup code or password. A secret reaches a command on its standard input, from a file only the hub reads, or from the owner's own typing. Never print a secret file.
- Never restart, stop or reconfigure anything of the owner's that Cota did not start: their Docker engine and its containers, their reverse proxy, their shell's other lines, their clients' settings beyond what `cota` writes.
- Never go on past a failed check. When a command below fails, do what its failure says; when that is the owner's to do, ask the owner and wait.
- Never type the setup code into the hub, and never choose the owner password. The owner does both.

## Ask the owner first

Ask these together, in one message, before you run anything:

1. **Where does the hub run?** One machine that stays on, that every other machine reaches, with Docker (and its `docker compose`) and `curl`, and that reaches GitHub (`github.com`, and `ghcr.io`, where the hub image is). Ask whether you may run Cota's Compose project there, `cota`: the hub and its own ClickHouse, in two containers of their Docker engine. If they already run a ClickHouse for Cota, ask for it too.
2. **Which pools?** One for each subscription and each API plan the hub should use:
   - each Claude subscription (Pro or Max), by the name the owner wants for it, and which one is the fallback of which;
   - a ChatGPT subscription, for Codex;
   - each API plan: an Anthropic API key, OpenRouter, Z.ai, OpenCode Go, or a server of their own (an OpenAI-compatible URL).
3. **The hub's address as the machines reach it**, such as `http://studio.lan:8080`, a VPN address, or `https://cota.example.com` behind a proxy the owner already runs. An `http` address that is not this machine's own is sent in the clear, hub keys included: say so, and ask whether they accept it. The proxy and the private network are the owner's; [`recipes`](recipes/README.md) has what each needs.
4. **Which machines join**, and on each, which of Claude Code, Codex, OpenCode and Pi are installed. Each needs `curl` and to reach `github.com`.
5. **On which of those machines may the coding agents read the request log?** Yes or no for each: with the machine's reader key and the memory skill, its agents can search and read every conversation every machine sent through the hub, secrets a client printed among them.

Write down the answers. Every step below names what it uses.

## The release

Cota is installed from its latest release on GitHub, [limineol/cota](https://github.com/limineol/cota/releases): the hub image, `cota` for each system, and the deployment's Compose file and configuration, all of one version. Nothing of Cota's source is needed but the memory skill's one file, taken from the repository at the release's tag (Each machine, step 5), and neither Git nor Bun.

The hub's step 2 finds that version, with the line every block that needs it begins with:

```text
VERSION="$(curl -fsSLI -o /dev/null -w '%{url_effective}' https://github.com/limineol/cota/releases/latest | sed 's|.*/tag/v||')"
```

GitHub sends `releases/latest` on to the latest release's page, whose address ends `/tag/v<version>`, and the line keeps what follows `v`. Run it as it is that once. In every later block, on every machine, write the version it found in its place, `VERSION=<version>`, so that the whole install is one release even if another is published meanwhile. To install another release than the latest, write its version there from the start.

## The hub

Run these on the hub's machine, from any directory. The hub runs from the **hub directory**, `~/cota-hub`, which holds its Compose file, its configuration, its secrets, its store and its archive.

### 1. Make the hub directory

```sh
mkdir -p "$HOME/cota-hub" && chmod 700 "$HOME/cota-hub"
(umask 077 && mkdir -p "$HOME/cota-hub/secrets" "$HOME/cota-hub/store" "$HOME/cota-hub/archive")
```

Success: both exit 0. The hub's container writes `store/` (the hub store) and `archive/` (the request log's daily copy), and reads `secrets/` and the configuration, as the owner's own user.

### 2. Get the release

Download the release's Compose file and configuration, check them against its `SHA256SUMS`, put them in the hub directory, and pull its hub image:

```sh
VERSION="$(curl -fsSLI -o /dev/null -w '%{url_effective}' https://github.com/limineol/cota/releases/latest | sed 's|.*/tag/v||')"
RELEASE="https://github.com/limineol/cota/releases/download/v$VERSION"
DOWNLOADS="$(mktemp -d)" && cd "$DOWNLOADS" &&
  curl -fsSLO "$RELEASE/compose.yaml" && curl -fsSLO "$RELEASE/cota.toml" && curl -fsSLO "$RELEASE/SHA256SUMS" &&
  [ "$(grep -cE '  (compose\.yaml|cota\.toml)$' SHA256SUMS)" = 2 ] &&
  grep -E '  (compose\.yaml|cota\.toml)$' SHA256SUMS | if command -v shasum >/dev/null; then shasum -a 256 -c -; else sha256sum -c -; fi &&
  cp compose.yaml "$HOME/cota-hub/compose.yaml" && (umask 077 && cp cota.toml "$HOME/cota-hub/cota.toml") &&
  docker pull "ghcr.io/limineol/cota-hub:$VERSION" &&
  cd "$HOME" && rm -rf "$DOWNLOADS" && echo "Cota $VERSION"
```

Success: `compose.yaml: OK` and `cota.toml: OK`, the pull, and last `Cota <version>`: that is the version every later block names (The release, above). On a failure it stops where it failed:

- `curl` says `Could not resolve host` or cannot connect: this machine does not reach GitHub. Its network is the owner's: tell them, and wait.
- `curl` says `The requested URL returned error: 404`: no release has that version. Check `VERSION`.
- A line ends `FAILED`, or it stops after the downloads having checked nothing: a file did not arrive as the release published it, or `SHA256SUMS` does not name both files. Run the block again; if it fails again, stop and tell the owner, and do not go on.
- `docker pull` cannot connect to the Docker daemon: Docker is not running. Stop and tell the owner: never restart their Docker engine.

`ghcr.io/limineol/cota-hub` is public: the pull needs no sign-in. The release's page gives the image's digest, which step 4 writes into `.env` from what was pulled, and the release's files and image carry GitHub's build provenance: the owner may check either (`gh attestation verify <file> --repo limineol/cota`, or `oci://ghcr.io/limineol/cota-hub:<version>` in place of the file). Neither is a step of yours.

### 3. Make the secrets

The hub keys and ClickHouse's password are long random strings, one file each, readable by the owner's user alone. Make them without printing them:

```sh
for name in clickhouse clients fleet agents; do (umask 077 && openssl rand -hex 24 > "$HOME/cota-hub/secrets/$name"); done
```

Success: it exits 0 and prints nothing. `clickhouse` is the password of the hub's ClickHouse, which reads it from that file; `clients` is the subscription key, for Claude Code and Codex; `fleet` is the keyed key, which spends the keys the hub holds, for OpenCode and Pi; `agents` is the reader key, which reads the request log and opens no pool, and which step 5 of each machine gives the machines of question 5 the owner said yes for.

For each API plan of question 2, the owner puts its key in a file of its own; you never see it. Ask the owner to run this in their own terminal, paste the key, and press Enter and then Ctrl-D, with the pool's name in place of `zai`:

```sh
(umask 077 && cat > "$HOME/cota-hub/secrets/zai")
```

A Claude subscription that is another's fallback needs a kept login the same way: the owner runs `claude setup-token`, signed in to that subscription, and pastes what it prints into `"$HOME/cota-hub/secrets/<pool>-login"`. With a ClickHouse the owner already runs (question 1), its password goes in `"$HOME/cota-hub/secrets/clickhouse"` the same way, in place of the one the loop made.

### 4. Write `.env` and the configuration

`.env` names the image of step 2 by its tag and its digest, read from the image that was pulled, so that the deployment runs those bytes and no others; then the owner's user and group, which the hub runs as, and the address and port the hub is published on. It holds no secret:

```sh
VERSION="$(curl -fsSLI -o /dev/null -w '%{url_effective}' https://github.com/limineol/cota/releases/latest | sed 's|.*/tag/v||')"
IMAGE="$(docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "ghcr.io/limineol/cota-hub:$VERSION" | grep -m 1 '^ghcr.io/limineol/cota-hub@sha256:')" &&
(umask 077 && cat > "$HOME/cota-hub/.env" <<EOF
COTA_HUB_IMAGE=ghcr.io/limineol/cota-hub:$VERSION@${IMAGE#*@}
COTA_UID=$(id -u)
COTA_GID=$(id -g)
COTA_BIND=127.0.0.1
COTA_PORT=8080
EOF
)
```

Write in `VERSION` the version step 2 printed (The release, above). Success: it exits 0, and `.env`'s first line is `COTA_HUB_IMAGE=ghcr.io/limineol/cota-hub:<version>@sha256:<digest>`. If it exits 1 and writes nothing, that image is not on this machine: pull it (`docker pull ghcr.io/limineol/cota-hub:<version>`, with the version step 2 printed) and run this block again. Do not run step 2 again once `cota.toml` holds the owner's pools: its copy replaces the file.

`COTA_BIND` is where the machines of question 3 reach the hub: `127.0.0.1`, this machine alone, behind a reverse proxy on this machine; this machine's address on a private network or a VPN the machines share; or `0.0.0.0`, every interface, for an `http` address on the owner's own network. Write the one question 3 needs, and in `COTA_PORT` the port of its address (behind a proxy, the port the proxy forwards to).

Then the configuration. `cota.toml`, which step 2 put in the hub directory, is the deployment's: the hub inside its container, its ClickHouse, its store and archive, and the three hub keys of step 3, each secret a file of `secrets/` as the container sees it, `/etc/cota/secrets/<name>`. Append to it one `[pools.<id>]` table for each pool of question 2, as in the example below, or as in the table of the same kind in Cota's example configuration ([`examples/cota.example.toml`](https://github.com/limineol/cota/blob/main/examples/cota.example.toml)): `work` and `personal` for Claude subscriptions (with `fallback` and `kept_login` where the owner named one), `chatgpt` for Codex, and `anthropic`, `openrouter`, `zai`, `opencode-go` or `local` for an API plan. Name a pool by the owner's name for it, in letters, digits and `-`. Every secret is `{ file = "/etc/cota/secrets/<name>" }`, naming a file of step 3 as the container sees it, never the secret itself and never `{ env = … }`. For example:

```toml
[pools.work]
protocol = "anthropic-messages"
prices = "anthropic"

[pools.chatgpt]
protocol = "chatgpt-codex"
prices = "openai"

[pools.zai]
protocol = "openai-chat"
provider = "zai"
base_url = "https://api.z.ai/api/coding/paas/v4"
key = { file = "/etc/cota/secrets/zai" }
prices = "zai"
```

A kept login is `kept_login = { file = "/etc/cota/secrets/<pool>-login" }`. A server of the owner's own on this machine is not `127.0.0.1` from inside the hub's container, which is the container itself: on Docker Desktop and OrbStack it is `host.docker.internal`.

With a ClickHouse the owner already runs (question 1), write its URL, database and user in `[clickhouse]` in place of the deployment's, as the hub's container reaches it; its password stays `/etc/cota/secrets/clickhouse`. Step 5 then starts the hub alone, with `docker compose up -d --wait --no-deps hub`.

Leave out `[sign_in]` and `[dashboard]`: the owner chooses the password in step 6, and the image serves the dashboard it was built with.

### 5. Start the hub

```sh
cd "$HOME/cota-hub" && docker compose up -d --wait
```

Success: it exits 0, with the containers `cota-clickhouse-1` and `cota-hub-1` healthy. Then check it, with `HUB` set to the address of question 3:

```sh
HUB=http://studio.lan:8080
curl -s "$HUB/health"
cd "$HOME/cota-hub" && docker compose logs hub | grep -c 'cota hub listening'
```

Success: `{"status":"ok"}` and `1`. The log's line names every pool. On a failure, `docker compose logs hub` (or `clickhouse`), run in `~/cota-hub`, says why:

- `up` says a variable such as `COTA_UID` is not set: `.env` lacks it (step 4).
- `up` says a `bind source path does not exist`: a file or folder of steps 1 to 4 is missing.
- `up` pulls the hub image, or says it cannot find it: `COTA_HUB_IMAGE` in `.env` is not the image step 2 pulled. Write `.env` again (step 4).
- `clickhouse` exits saying `ClickHouse's password file /etc/cota/secrets/clickhouse is missing or empty`: make it (step 3).
- The hub stopped, and its log says the configuration does not read: it prints every problem with its place, such as `at ["pools"]["zai"]["key"]`. Fix those in `cota.toml` and run `docker compose restart hub` in `~/cota-hub`. A secret file that `cannot be read` or `is empty` is the owner's to fill (step 3).
- `the request log could not create its tables; it will try again`, again and again: ClickHouse is not reachable at the `url` of `[clickhouse]`. With the deployment's own, check that `cota-clickhouse-1` is healthy.
- `curl` gets no answer from `$HUB` but does from `http://127.0.0.1:8080/health`: `COTA_BIND` (step 4) does not publish the hub where the machines reach it, or a firewall or the proxy is in the way. The network and the proxy are the owner's: tell them, and wait.

Docker keeps both containers running, and starts them again after Docker or this machine restarts, as long as Docker itself starts at boot. That is the owner's setting of their Docker engine (on macOS, Docker Desktop's or OrbStack's start at login): tell them, and do not change it yourself.

### 6. Hand the hub to the owner, and stop

The hub is not set up yet: its log holds a setup code, on a line `this hub is not set up: open its dashboard, give it the setup code ... and choose the owner password`. Do not read the code out, and do not use it. Tell the owner:

> The hub runs at `$HUB` (give the address). Open it in a browser: it shows the Setup screen. Give it the setup code from the line `this hub is not set up` that `docker compose logs hub` prints in `~/cota-hub`, and choose the owner password, 12 characters or more. Tell me when you are signed in.

Stop until the owner says they are signed in. A restart of the hub before then makes a new code.

## Each machine

Do this on every machine of question 4, the hub's own included.

### 1. Install `cota`

Download this system's `cota` from the same release, check it against the release's `SHA256SUMS`, and install it:

```sh
VERSION="$(curl -fsSLI -o /dev/null -w '%{url_effective}' https://github.com/limineol/cota/releases/latest | sed 's|.*/tag/v||')"
FILE="cota-$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m | sed 's/x86_64/x64/; s/aarch64/arm64/')"
RELEASE="https://github.com/limineol/cota/releases/download/v$VERSION"
DOWNLOADS="$(mktemp -d)" && cd "$DOWNLOADS" &&
  curl -fsSLO "$RELEASE/$FILE" && curl -fsSLO "$RELEASE/SHA256SUMS" &&
  grep "  $FILE\$" SHA256SUMS | if command -v shasum >/dev/null; then shasum -a 256 -c -; else sha256sum -c -; fi &&
  mkdir -p "$HOME/.local/bin" && install -m 0755 "$FILE" "$HOME/.local/bin/cota" &&
  cd "$HOME" && rm -rf "$DOWNLOADS" && ~/.local/bin/cota --version
```

Write in `VERSION` the version the hub's step 2 printed (The release, above). Success: `cota-<system>-<arch>: OK` and, last, that version. `FILE` is the release's name for this system's `cota`: `cota-darwin-arm64`, `cota-darwin-x64`, `cota-linux-x64` or `cota-linux-arm64`. A `404` for it means the release has no `cota` for this system. Every command below runs it as `~/.local/bin/cota`: the shims, the title reporter's schedule and Pi's key command name the `cota` that joined, so it stays where it is. `~/.local/bin` need not be on `PATH`. To update `cota` later, install another release's the same way ([`upgrading.md`](upgrading.md)), and run doctor (step 3).

On Windows the release's `cota` is `cota-windows-x64.exe`, and its place is `%LOCALAPPDATA%\Programs\cota\cota.exe`, Windows' place for a program installed for one user, under the `%LOCALAPPDATA%` that holds Cota's state and shims there (ADR-0022). Download it and `SHA256SUMS` from `https://github.com/limineol/cota/releases/download/v<version>/`, check its SHA-256 (PowerShell's `Get-FileHash` gives it, in capitals) against its line of `SHA256SUMS`, copy it there, and run it from there in place of `~/.local/bin/cota`.

### 2. Join the hub

The hub keys go on standard input, one a line, never in an argument, and never into a file on this machine other than the ones `cota` keeps. Give the subscription key, and the keyed key where OpenCode or Pi is used.

On the hub's own machine:

```sh
HUB=http://studio.lan:8080
cat "$HOME/cota-hub/secrets/clients" "$HOME/cota-hub/secrets/fleet" | ~/.local/bin/cota join "$HUB"
```

On any other machine, if it reaches the hub's machine by `ssh`, pipe them from there, so that they never touch this machine's disk:

```sh
ssh studio.lan 'cat cota-hub/secrets/clients cota-hub/secrets/fleet' | ~/.local/bin/cota join "$HUB"
```

Otherwise the owner runs `~/.local/bin/cota join "$HUB"` in their own terminal, which asks for the keys without showing them, and pastes them from the hub's machine, then an empty line. Add `--allow-plain-http` to the join when the address is `http` and the owner accepted that (question 3).

Success, with the machine's name, its shell's file and the clients found:

```text
cota: joined http://studio.lan:8080 as studio, keeping its subscription and keyed hub keys.
cota: wrote the shims of claude, codex, opencode and pi in /Users/owner/.local/share/cota/bin.
cota: /Users/owner/.zshrc now puts /Users/owner/.local/share/cota/bin first on PATH, in its last line; a new shell finds the shims.
cota: wrote /Users/owner/.codex/config.toml, with cota's provider cota-codex.
cota: scheduled the title reporter every 30 seconds, by /Users/owner/Library/LaunchAgents/cota.titles.plist.
cota: the hub kept 12 titles.
```

and then doctor's report (step 3). On a system without a scheduler `cota` can use (Linux without a systemd user session, such as a container or WSL), the join also says `cota: the title reporter was not scheduled: this system has no scheduler cota can use`, with a line for cron. Doctor's `titles` check passes on the join's own run for 5 minutes and then fails: show the owner that line now, and ask them to add it to their crontab (`crontab -e`), which is theirs.

A join that stops writes nothing and says why, in a line that starts `cota:`:

- `<hub> cannot be reached`: check `HUB`, and that `curl -s "$HUB/health"` answers on this machine. A network between the machines is the owner's.
- `... is plain http to another machine ...`: ask the owner (question 3), then join with `--allow-plain-http`.
- `the hub does not know key 2`, `key 1 is a reader key, which opens no pool`, or `keys 1 and 2 are both subscription keys, and a machine keeps one of each`: a key is named by its place, never by its value. Give the keys of the hub's step 3, `clients` then `fleet`.

### 3. Run doctor until it passes

```sh
~/.local/bin/cota doctor
```

Success: no line starts `failed`, and it exits 0. Each check prints `passed`, `warned`, `failed` or `skipped`, and a check that failed or warned prints what is wrong and a line `fix:`. `~/.local/bin/cota doctor --json` prints the same as JSON (`ok`, and each check's `id`, `outcome`, `problem` and `fix`). Do what each `fix:` says, as below, and run doctor again; stop and ask the owner where the table says so.

| Check | What its fix says | What you do |
| --- | --- | --- |
| `config` | `cota join <hub>` | Join again (step 2). |
| `hub` | the hub does not answer `GET /health` | Check `HUB` and the hub (step 5 of the hub). If the hub's machine is down or the network is in the way, tell the owner. |
| `hub-keys` | `cota join <hub>` | Join again with the keys of the hub's step 3. A warning `no keyed hub key` matters only where OpenCode or Pi is used. |
| `files` | a `chmod` of a file or directory of `cota`'s | Run that `chmod`. |
| `shims`, `path` | `cota shims` | Run `~/.local/bin/cota shims`. If `path` still fails, open a new terminal, which reads the shell's file again, and run doctor there. |
| `shims` | `install -m 0755 '<cota>' ~/.local/bin/cota && ~/.local/bin/cota shims` | A warning: the shims run a `cota` inside a Git checkout. Run it, then doctor, and do what its `configured` and `titles` rows say. |
| `clients` | `install <client>, then run cota doctor` | A warning: a client the owner does not use is fine. Installing one is the owner's choice. |
| `clients` | `head -n 20 '<file>' to see which it is, then cota doctor` | A warning: a client found is a script. Run the `head` and show the owner what it is; never remove or edit it, which is theirs. Another gateway's wrapper (it sets a provider's base URL or key) is for the owner to take off `PATH`; a version manager's shim is fine. |
| `clients` | `cota shims, which moves cota's line back to the end` | Run `~/.local/bin/cota shims`. |
| `own-pools` | `edit own_pool in '<config.toml>' ...` | Ask the owner which pool that client's own login spends; edit only that line. |
| `logins` | `cota logout <pool>` | Run it; then ask the owner whether that machine login belongs to another pool (step 4). |
| `kept-routes` | `rm '<routes.json>'` | Run it: it is `cota`'s own file. |
| `configured` | `cota configure`, or `edit '<file>' as the problem says, then cota configure` | Run `~/.local/bin/cota configure`. A file `cota` cannot rewrite is the owner's: show them the problem, and wait. |
| `titles` | `cota titles schedule`, or `fix what that says, then cota titles report` | Run `~/.local/bin/cota titles schedule`, then `~/.local/bin/cota titles report`. A problem that names the hub is fixed by the `hub` row; a file that `cannot be read` is the owner's. |
| `titles` | `edit your crontab (crontab -e) to add * * * * * '<cota>' titles report` | This system has no scheduler `cota` can use. The crontab is the owner's: show them the line, and ask. |
| `memory` | `cota memory key, if the owner wants this machine's agents to read the request log` | A warning `this machine keeps no reader key` is expected. On a machine the owner said yes for (question 5), step 5 gives the key once doctor passes; on one they said no for, leave the warning and give no key: doctor passes with it. A failure (a kept key the hub does not know, or not a reader key) is step 5's: give the reader key again as it says. |

`~/.local/bin/cota titles report` prints `cota: the hub kept 3 titles.` or `cota: there was no new title to send.` when it works.

### 4. Machine logins, where a route needs one

A machine login lets Claude Code on this machine spend a Claude subscription other than the one it is signed in to, when a route sends a project there. Do this only for such a pool, and only when the owner wants it. The owner does it, in their own terminal, on this machine: they run `claude setup-token` signed in to that subscription, and give what it prints to `cota`, which asks for it without showing it:

```sh
~/.local/bin/cota login personal
```

Success: `cota: kept the machine login for personal.` A pool that is not a Claude subscription pool of this hub is refused, with the reason.

Tell the owner what such a login does not carry. It makes model requests only, so in the projects routed to that pool Claude Code has no claude.ai connectors and no Remote Control, and does not say so. A connector they need there is added to the machine instead, by the owner, where it has an address of its own, and every pool then has it: `claude mcp add --scope user --transport http <name> <address>`, then `/mcp` in Claude Code to sign in to it. A connector reached only through claude.ai has no such address, and is not to be had in those projects.

### 5. The memory skill, where the owner said yes

Do this only on a machine the owner said yes for in question 5. It lets the coding agents there read the request log with `cota memory`, which sends the machine's reader key for them and never prints it. The key's file is readable by the machine's user, as every hub key's is, so the agents, you among them, never read it out.

First the reader key. On the hub's machine, give it from its file:

```sh
~/.local/bin/cota memory key < "$HOME/cota-hub/secrets/agents"
```

On any other machine the owner gives it, in their own terminal there: ask them to run `~/.local/bin/cota memory key`, which asks for the key without showing it, and to paste the one line of `~/cota-hub/secrets/agents` from the hub's machine. Stop until they say it is kept. Never read that file out, put the key in a command, an argument or a file, or ask for it in this conversation. Every machine given `agents` shares that one key, so retiring it ends memory on all of them at once: an owner who wants to retire one machine alone adds a reader key of its own for it ([`operating.md`](operating.md), Hub keys) and gives that one here instead.

Success: `cota: kept the reader key; cota memory reads the request log with it.` A key is refused, and nothing kept, when the hub does not know it or it is not a reader key (`that is a subscription hub key; ...`): it was not `secrets/agents`, so give that one. `could not say what the key is, so it was not kept` is the hub, which did not answer in time: check it as the `hub` row of step 3 says. Then check what the hub says the machine's key is:

```sh
~/.local/bin/cota memory get /api/machine
```

Success: its answer holds `"scope":"reader"` and `"pools":[]`.

Then copy the skill where Claude Code reads a user's skills, from the release's tag of the repository:

```sh
VERSION="$(curl -fsSLI -o /dev/null -w '%{url_effective}' https://github.com/limineol/cota/releases/latest | sed 's|.*/tag/v||')"
mkdir -p "$HOME/.claude/skills/cota-memory" &&
  curl -fsSL -o "$HOME/.claude/skills/cota-memory/SKILL.md" "https://github.com/limineol/cota/raw/v$VERSION/skills/cota-memory/SKILL.md" &&
  head -n 2 "$HOME/.claude/skills/cota-memory/SKILL.md"
```

Write in `VERSION` the version the hub's step 2 printed (The release, above). Success: `---` and then `name: cota-memory`. GitHub sends that address on to `raw.githubusercontent.com`; a `curl` that cannot resolve or reach it is the owner's network, as in step 1. Only Claude Code's folder is known: where Codex, OpenCode and Pi read skills is not confirmed, so on a machine where the owner uses one of those, tell them the skill is at `~/.claude/skills/cota-memory/SKILL.md`, to copy where that client's own documentation says, and do not guess a folder yourself.

Run doctor again (step 3): its `memory` line passes.

## Quota logins, the owner's

A quota login lets the hub read a Claude or ChatGPT subscription pool's usage the way Claude Code and Codex show it: every window, the per-model ones included, and the plan's name, current even while nobody uses the pool. Without one, the dashboard shows such a pool's windows only from the quota headers of the latest answers that carried them. It is an OAuth login of the owner's subscription, one per pool, and optional. It is the owner's to give, not yours: it takes the owner password and their browser signed in to the subscription. Do not run the command yourself.

Its connect script is not part of a release: it runs from a checkout of Cota, with Git and [Bun](https://bun.sh). Once the hub is set up, tell the owner, for each Claude or ChatGPT subscription pool they want read: on a machine of question 4 that has that pool's client (Claude Code or Codex) and a browser signed in to that subscription, in a checkout of Cota at the release's tag (`git clone --branch v<version> https://github.com/limineol/cota`, then `bun install` in it), run `COTA_HUB_URL=<hub> bun run quota:connect <pool>` in their own terminal, adding `--email <their address>` for a Claude pool, and `--allow-plain-http` where the join needed it. A Claude login is read from the macOS keychain, so a Claude pool's is connected from a Mac. On a joined machine the script runs the real client, never `cota`'s shim of it. It asks for the owner password without showing it, has the client sign in in a throwaway directory, sends the login to the hub, and deletes every copy left on the machine. The dashboard's Settings → Quota logins shows each pool's command and whether the hub keeps its login.

Success: `The hub now reads <pool>'s quota windows with <account>'s login.`

## The routes

Routes say which pool each project bills, for Claude Code and for Codex: an ordered list of project patterns, each with its pool, and a default pool. Propose them from the owner's answers (for example, `acme/*` on `work` and the rest on `personal`), and ask the owner to set them in the dashboard's Settings → Routes. Setting them from a terminal needs the owner password, which you never handle; the owner can run `~/.local/bin/cota routes set claude` themselves.

Then, on a machine, ask which pool a launch in one of the owner's projects bills. `cota route` reads the project from the directory it runs in, so run it there, with the project's directory in place of `~/src/acme-api`:

```sh
(cd ~/src/acme-api && ~/.local/bin/cota route && ~/.local/bin/cota route codex)
```

Success: it prints the project, its pool and the route that chose it. `cota: no route of claude-code matches <project>, and it has no default pool. Add one in Settings → Routes.` means the routes are not set yet.

## Done

You are done when both hold:

1. On every machine of question 4, `~/.local/bin/cota doctor` exits 0 with no `failed` line, and its `memory` line passed on each the owner said yes for in question 5.
2. A request made through a launched client appears in the dashboard. Ask the owner to open a new terminal on one machine, start `claude` (or `codex`) in a project, and send one message; then to open the hub's dashboard, Sessions: the session is there, with its project, its machine and its pool, and within a minute its title.

Tell the owner what you did, machine by machine, and anything you left to them, and that [`operating.md`](operating.md) is the deployment day to day and [`upgrading.md`](upgrading.md) its upgrades.
