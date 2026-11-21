---
status: active
scope: repository
owner: limineol
last_verified: 2026-11-19
review_by: 2027-02-19
supersedes: []
code:
  - deploy/compose.yaml
  - deploy/cota.toml
---

# A usage monitor beside the hub

A recipe: Cota documents it and never runs it. The monitor, its install and its updates are yours.

Tools that count a coding client's usage, such as [tokscale](https://github.com/junhoyeo/tokscale) or [Token Monitor](https://github.com/Javis603/token-monitor), keep working when the client goes through Cota, and can run beside the hub.

## Monitors that read the clients' own files

Most read the session files each client writes on its machine. A client launched through Cota still writes them, so such a monitor counts as before, on every machine, with nothing to change. It also counts what never reached the hub (a launch that went direct, `COTA=off`, history from before the hub), and prices usage by its own tables, so its numbers and the request log's differ.

## A monitor's server on the hub's machine

Some have a server that each machine reports to. Run it as a project of its own, in its own directory, never as a service added to Cota's `compose.yaml`, which an upgrade may replace. Give it a port other than `COTA_PORT`, and publish it by the same rules as the hub: loopback behind your proxy, or the private network's address ([`private-network.md`](private-network.md)).

## A monitor that reads the request log

A monitor of your own can read the request log through the hub's API, with a reader key. Give it one of its own, so that you can retire it alone ([`operating.md`](../operating.md#hub-keys)): here `monitor`, made as that section makes `laptop`, with `scope = "reader"`. A reader key opens no pool, but it reads every conversation.

From the hub's machine, keep the key in a header file only you can read, so that it is never an argument, and ask in SQL:

```sh
(umask 077 && printf 'x-cota-key: %s\n' "$(cat ~/cota-hub/secrets/monitor)" > ~/.cota-monitor-header)
curl -s -H @"$HOME/.cota-monitor-header" -H 'content-type: application/json' \
  -d '{"sql":"SELECT pool, sum(input_tokens + output_tokens) AS tokens, round(sum(cost_usd), 2) AS cost_usd FROM requests WHERE started_at >= today() GROUP BY pool"}' \
  http://127.0.0.1:8080/api/sql
```

It answers `{ columns, rows, truncated, elapsedMs }`, under the SQL console's limits ([`operating.md`](../operating.md#sql)). Times are UTC, so `today()` is the UTC day.

From a container of the monitor's own project, `127.0.0.1` is that container. Join the deployment's network, `cota_default`, reach the hub as `http://hub:8080`, and mount the key as a file:

```yaml
services:
  monitor:
    volumes:
      - ./reader-key:/run/secrets/reader-key:ro
    networks: [cota]
networks:
  cota:
    name: cota_default
    external: true
```

## How this was read

On 2026-11-19, on macOS with OrbStack, against a deployment brought up as the deployment's slow test does, under a Compose project of its own: the `curl` above, with the reader key the install makes in place of `monitor`, answered the day's tokens per pool; and a stand-in monitor (a script in the hub image that sends `x-cota-key` from the mounted file to `http://hub:8080/api/sql`), in a Compose project of its own joined to the deployment's network as above, got its answer.

Not run: tokscale, Token Monitor, or any other real monitor.
