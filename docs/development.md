---
status: active
scope: repository
owner: limineol
last_verified: 2026-11-22
review_by: 2027-02-19
supersedes: []
code:
  - compose.dev.yaml
  - examples/cota.dev.toml
  - examples/cota.example.toml
  - apps/hub/src/main.ts
  - apps/hub/src/restore-archive.ts
  - apps/cli/src/cli.ts
---

# Running a hub from a checkout

To work on Cota, run a hub from a checkout, against a throwaway ClickHouse, instead of a deployment. It needs [Bun](https://bun.sh) and Docker. A hub you depend on runs as a deployment ([`install.md`](install.md), [`operating.md`](operating.md)); this page is for development, and for reading the hub's API.

## The hub

```sh
bun install
docker compose -f compose.dev.yaml up -d --wait

export COTA_DEV_HUB_KEY=$(openssl rand -hex 24)
export COTA_DEV_CLIENT_KEY=$(openssl rand -hex 24)
export COTA_DEV_OWNER_PASSWORD=$(openssl rand -hex 16)
COTA_CONFIG=examples/cota.dev.toml \
COTA_DEV_CLICKHOUSE_PASSWORD=throwaway-dev-password \
bun run hub
```

Then, in another terminal with the same keys and password, send a client through it. Each keeps its own login:

```sh
# Claude Code
ANTHROPIC_BASE_URL=http://127.0.0.1:18080/pools/claude \
ANTHROPIC_CUSTOM_HEADERS="x-cota-key: $COTA_DEV_CLIENT_KEY
x-cota-project: cota" \
claude

# Codex
codex \
  -c 'model_providers.cota={name="OpenAI",base_url="http://127.0.0.1:18080/pools/codex/backend-api/codex",wire_api="responses",requires_openai_auth=true,env_http_headers={"x-cota-key"="COTA_DEV_CLIENT_KEY"}}' \
  -c 'model_provider="cota"'
```

An OpenAI-compatible client (OpenCode, Pi) takes `http://127.0.0.1:18080/pools/local` as its base URL and `$COTA_DEV_HUB_KEY` as its API key; the `local` pool forwards to a server on port 1234.

Every request is now in the request log:

```sh
curl -s 'http://127.0.0.1:18123/?database=cota&default_format=PrettyCompact' \
  -u cota:throwaway-dev-password --data-binary \
  'SELECT pool, client, model, outcome, input_tokens, output_tokens, cost_usd FROM requests ORDER BY started_at DESC LIMIT 10'
```

[`examples/cota.example.toml`](../examples/cota.example.toml) shows every setting, with a fallback pool and pools that hold a key. `cota`, below, gives the clients these variables itself.

## The dashboard

The dashboard is at the hub's own address, http://127.0.0.1:18080, once it is built. `bun run web:build` writes it to `apps/web/dist`, which the hub serves; a hub started before the first build says so and serves it once restarted. Sign in with `$COTA_DEV_OWNER_PASSWORD`. To work on the dashboard, run `bun run web` beside the running hub instead: Vite serves the app at the address it prints, shows each change as it is saved, and sends `/api` to the hub.

A hub whose configuration has no `[sign_in] password` is not set up when it first starts, and prints a setup code in its log, as a deployment does ([`operating.md`](operating.md#signing-in)). A browser offers passkeys only at an `https` address with a host name, or on `localhost`, so a hub at `http://127.0.0.1:18080` cannot have one: open it at `http://localhost:18080` to make and use passkeys on this machine.

## The API

The hub's API is under `/api`, and `http://127.0.0.1:18080/api/openapi.json` describes every endpoint. Sign in as the owner, and ask the hub who you are:

```sh
curl -s -c /tmp/cota-dev.cookies -H 'content-type: application/json' \
  -d "{\"password\":\"$COTA_DEV_OWNER_PASSWORD\"}" http://127.0.0.1:18080/api/sign-in
curl -s -b /tmp/cota-dev.cookies http://127.0.0.1:18080/api/me
```

Read the last 7 days of traffic, totalled, with the 7 days before them:

```sh
curl -s -b /tmp/cota-dev.cookies http://127.0.0.1:18080/api/overview
```

A machine reports its sessions' titles with any hub key, naming itself in `x-cota-machine`. Report one for the latest session, and list the sessions, latest first, each with its title and first prompt:

```sh
SESSION=$(curl -s -b /tmp/cota-dev.cookies 'http://127.0.0.1:18080/api/sessions?limit=1' \
  | bun -e 'process.stdout.write((await Bun.stdin.json()).sessions[0].id)')
curl -s -X PUT -H "x-cota-key: $COTA_DEV_CLIENT_KEY" -H 'x-cota-machine: laptop' \
  -H 'content-type: application/json' -d "{\"titles\":{\"$SESSION\":\"Trying the hub\"}}" \
  http://127.0.0.1:18080/api/session-titles
curl -s -b /tmp/cota-dev.cookies 'http://127.0.0.1:18080/api/sessions?limit=5'
```

Read that session: its requests with their roles, its segments, and the transcript of its last segment, which this prints (`null` for a session with no main request, such as a lone `curl`):

```sh
curl -s -b /tmp/cota-dev.cookies "http://127.0.0.1:18080/api/sessions/$SESSION" \
  | bun -e 'console.log(JSON.stringify((await Bun.stdin.json()).transcript, null, 2))'
```

Search the conversations for the items that hold every word of a query, in any case and order, newest first, each with a snippet of what a transcript shows of it. `next` continues to the next page, and `q` on `/api/sessions` keeps the sessions that hold the words:

```sh
curl -s -b /tmp/cota-dev.cookies --get --data-urlencode 'q=read file' --data-urlencode 'limit=3' \
  http://127.0.0.1:18080/api/search
```

`prefix=true` also finds the words a query word starts (`rea` finds `read`), and `fuzzy`, from 0 to 1, words a typo away (at `0.2`, one edit for a word of 3 to 7 characters, two from 8), as the MiniSearch library takes them. Without them search is exact, and a client can ask the exact search first and the tolerant one when it finds nothing:

```sh
curl -s -b /tmp/cota-dev.cookies --get --data-urlencode 'q=raad fil' --data-urlencode 'prefix=true' \
  --data-urlencode 'fuzzy=0.2' --data-urlencode 'limit=3' http://127.0.0.1:18080/api/search
```

Ask the request log anything in ClickHouse's SQL. It runs read-only as `cota_sql`, a user the hub makes that can read the `cota` database and nothing else, and an answer holds at most 5,000 rows or 16 MiB of them by default (`truncated` says whether there were more); `[sql]` in the configuration sets these limits and the others a query runs within. `/api/schema` lists the tables and their columns:

```sh
curl -s -b /tmp/cota-dev.cookies -H 'content-type: application/json' \
  -d '{"sql":"SELECT pool, count() AS requests, sum(output_tokens) AS output FROM requests GROUP BY pool ORDER BY requests DESC"}' \
  http://127.0.0.1:18080/api/sql
```

Give a pool, model, client, machine or project a name of your own, to show in place of its id. The hub already names the clients it knows and the models of its price lists; your name replaces the hub's until you remove it:

```sh
curl -s -b /tmp/cota-dev.cookies -X PUT -H 'content-type: application/json' \
  -d '{"name":"Work subscription"}' http://127.0.0.1:18080/api/display-names/pool/claude
curl -s -b /tmp/cota-dev.cookies http://127.0.0.1:18080/api/display-names \
  | bun -e 'console.log((await Bun.stdin.json()).names.filter(({ kind }) => kind !== "model"))'
curl -s -b /tmp/cota-dev.cookies -X DELETE http://127.0.0.1:18080/api/display-names/pool/claude
```

`GET /api/pools` gives every pool's quota windows, as its provider reports them: how much of each is used, when it resets, and its pace. Without any login, a Claude or Codex pool's windows come from the quota headers of the latest answers that carried them; a Z.ai or OpenCode Go pool is read with the key the hub holds for it:

```sh
curl -s -b /tmp/cota-dev.cookies http://127.0.0.1:18080/api/pools
```

A pool's `quotaLogin` in `/api/pools` says whether the hub keeps a quota login for it, and when it was given and refreshed. Give one as [`operating.md`](operating.md#quota-logins) says, with `COTA_HUB_URL=http://127.0.0.1:18080`. To forget one:

```sh
curl -s -b /tmp/cota-dev.cookies -X DELETE http://127.0.0.1:18080/api/pools/codex/quota-login
```

## `cota` from a checkout

`cota` is the command each machine runs. Build it for this system:

```sh
bun run cli:build
```

With the hub above running, join this machine. The hub keys go on standard input, one a line, never in an argument: the subscription key for Claude Code and Codex, and the keyed one for OpenCode and Pi, which spend the keys the hub holds.

```sh
printf '%s\n' "$COTA_DEV_CLIENT_KEY" "$COTA_DEV_HUB_KEY" | apps/cli/dist/cota join http://127.0.0.1:18080
```

Joined this way, the shims, the title reporter's schedule and Pi's key command run the checkout's `cota`, which a rebuild, a switch of branch or a `git clean` changes or removes, and doctor warns of it. On a machine you use, install it outside the checkout first, as the recipe of a build of your own does (`install -m 0755 apps/cli/dist/cota ~/.local/bin/cota`, [`recipes/a-build-of-your-own.md`](recipes/a-build-of-your-own.md)), and join with that.

What a join changes, and how a launch works, is [`operating.md`](operating.md#the-machines). Check the machine, and undo the join:

```sh
apps/cli/dist/cota doctor
apps/cli/dist/cota leave
```

## The archive from a checkout

Name a directory the hub can write in the configuration, read against the configuration file's directory; the hub refuses to start when it does not exist or cannot be written:

```toml
[archive]
directory = "/var/lib/cota/archive"
```

Its files are read as a deployment's are ([`operating.md`](operating.md#the-archive)). A restore from a checkout runs with the hub's configuration; the hub may be running:

```sh
COTA_CONFIG=cota.toml bun run archive:restore /var/lib/cota/archive --from 2026-11-01 --to 2026-11-10
```
