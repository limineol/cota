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

# The hub on a private network

A recipe: Cota documents it and never runs it. The network, its addresses and its firewall are yours.

When your machines share a private network (a VPN, or an overlay network such as WireGuard, Tailscale or ZeroTier), the hub can be published on the hub machine's address there, and on nothing else.

## Publish the hub there

In the hub directory, set `COTA_BIND` in `.env` to the hub machine's address on that network (here `100.64.0.5`; yours is in the network's own app or `ifconfig`), and start the hub again, which publishes it there:

```sh
cd ~/cota-hub
(umask 077 && grep -v '^COTA_BIND=' .env > .env.new && echo "COTA_BIND=100.64.0.5" >> .env.new && mv .env.new .env)
docker compose up -d --wait
```

From another machine on the network, `curl -s http://100.64.0.5:8080/health` answers `{"status":"ok"}`; from the hub's machine, `127.0.0.1:8080` no longer does.

## The machines

The address is `http`, so a join asks you to accept that it is plain HTTP to another machine. Over a network that encrypts its traffic, accept it with `--allow-plain-http` (on the join, and on `bun run quota:connect`); over one that does not, hub keys and logins cross it in the clear, and the HTTPS recipe is the way ([`https.md`](https.md)). A browser offers no passkey at an IP address, so the dashboard there signs in with the owner password alone.

## When the address comes up after Docker

An overlay network's address often appears after the machine's container engine has started. Docker publishes the hub's port when its container starts, so a hub started before the address exists is not published on it, and stays unreachable after the address appears. Publish it again:

```sh
docker compose up -d --force-recreate --wait hub
```

What the engine says differs. Under OrbStack, a hub published on an address the machine does not have starts healthy, `docker compose ps` lists the port, and nothing answers on it. A Linux engine is expected to refuse to start the container instead, saying it cannot assign the address; that was not run here.

Two ways around it, each with its cost: a reverse proxy on loopback in front of the hub ([`https.md`](https.md)), whose own binding is then the same question; or `COTA_BIND=0.0.0.0`, which publishes the hub on every network the machine is on, its local network included, where a firewall of yours must keep others out.

## How this was read

Against a deployment brought up as the deployment's slow test does, under a Compose project of its own, on macOS with OrbStack, on 2026-11-19, with the `.env` line above (each address in place of `100.64.0.5`) and `docker compose up -d --wait`:

- published on a non-loopback address the Mac has (a bridge interface's): the hub answered `/health` there, and nothing answered on `127.0.0.1`;
- published on an address the Mac does not have (`192.0.2.10`): `up` succeeded, `docker compose ps` listed `192.0.2.10:<port>->8080/tcp`, and nothing listened;
- `docker compose up -d --force-recreate --wait hub` published it again on loopback.

Not run: a real VPN or overlay network, a reboot with its address coming up late, and a Linux engine.
