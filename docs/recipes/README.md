---
status: active
scope: repository
owner: limineol
last_verified: 2026-11-19
review_by: 2027-02-19
supersedes: []
code:
  - deploy/compose.yaml
---

# Recipes

What is around a deployment and is yours, not Cota's (ADR-0024, Not Cota's). Cota documents each and never runs or ships one. Each says how it was read against a deployment, and what was not run.

| | |
| --- | --- |
| [HTTPS behind your reverse proxy](https.md) | Caddy and nginx in front of the hub, streaming and long requests included; what passkeys need |
| [The hub on a private network](private-network.md) | Publishing the hub on a VPN's or overlay network's address, and what happens when that address comes up after Docker |
| [Copying the hub directory to another machine](copying-the-hub-directory.md) | Moving a deployment whole, ClickHouse's volume included, or keeping a copy of it elsewhere |
| [A usage monitor beside the hub](usage-monitor.md) | Monitors that read the clients' files, a monitor's server on the hub's machine, and one that reads the request log with a reader key |
