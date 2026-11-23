---
status: active
scope: repository
owner: limineol
last_verified: 2026-11-22
review_by: 2027-02-19
supersedes: []
code:
  - deploy/compose.yaml
---

# Copying the hub directory to another machine

A recipe: Cota documents it and never runs it. The machines, how the files travel between them, and where copies are kept are yours.

A deployment is its hub directory and ClickHouse's volume. Moved together, with both stopped, the new machine's hub is the old one: the same request log, hub store, archive, secrets and configuration. The same commands make a whole copy kept elsewhere, ClickHouse's included.

## Before

- The new machine has what the hub's machine needs ([`install.md`](../install.md), question 1) and the hub image that `.env` names: a release's is pulled by that name, tag and digest, `docker pull "$(sed -n 's/^COTA_HUB_IMAGE=//p' ~/cota-hub/.env)"` once the hub directory is there; a build of your own, `cota-hub:<commit>`, is built there as its recipe says ([`a-build-of-your-own.md`](a-build-of-your-own.md)).
- Room on both for the copies: ClickHouse's copy is the size of its volume.
- Run only one of the two hubs at a time. Both would refresh the same quota logins, and a refresh rotates a login's refresh token, so one of them would be expired.

## On the old machine

Stop both services, then copy the volume and the hub directory into two files that only you can read:

```sh
cd ~/cota-hub
docker compose stop
(umask 077 && docker compose run --rm --no-deps -T --entrypoint tar clickhouse -C /var/lib/clickhouse -cf - . > ~/cota-clickhouse.tar)
(umask 077 && tar -C ~ -cf ~/cota-hub.tar cota-hub)
```

The first runs `tar` in a container of the `clickhouse` service, which mounts the volume, and writes what it reads to a file of yours. Both files hold every conversation and every secret of the deployment: move them to the new machine's home as you move secrets, and remove them once the new hub runs.

A stopped deployment stays stopped across a reboot. Keep it as it is until the new one has proved itself: starting it again (`docker compose start`) is the way back.

## On the new machine

```sh
tar -C ~ -xpf ~/cota-hub.tar
cd ~/cota-hub
id -u; id -g
```

If those differ from `COTA_UID` and `COTA_GID` in `.env`, change those lines to them. Then put the volume back and start:

```sh
docker compose run --rm --no-deps -T --entrypoint tar clickhouse -C /var/lib/clickhouse -xpf - < ~/cota-clickhouse.tar
docker compose up -d --wait
curl -s http://127.0.0.1:8080/health
```

The first command makes the volume, as Compose names it, and fills it. Sign in to the dashboard with the owner password: the sessions are there.

If the hub is reached at the same address as before, the machines need nothing. If not, each machine joins the new address ([`install.md`](../install.md), Each machine, step 2), which replaces the hub it had; [the deployment spec](../specs/deployment/spec.md#moving-a-hubs-machines-onto-a-new-one) has the cases. Passkeys belong to the address they were made at: at a new one, sign in with the password and make new ones. `COTA_BIND` in `.env` is an address of the old machine if it was not loopback: set the new one's ([`private-network.md`](private-network.md)).

When it is right, remove the old deployment on the old machine, which deletes its containers, its network and its volume, and the two files on both:

```sh
cd ~/cota-hub && docker compose down --volumes
```

## Only the hub directory

Without the volume, the new machine's ClickHouse starts empty, and a restore from the archive brings back every archived day ([`operating.md`](../operating.md#a-restore)): every request but those of the last day or so, which the archive has not reached yet.

## How this was read

On 2026-11-19, on macOS with OrbStack, against a deployment brought up as the deployment's slow test does, under a Compose project of its own, holding requests, an archived day, a sign-in and the hub store. The old machine's commands were run as printed in its hub directory, with the two files in a scratch folder in place of `~`; the new machine was a second hub directory and a second Compose project on the same Mac, where the new machine's commands were run as printed. The second hub started healthy with the volume made by the first command, held every request, and took the first hub's sign-in. The second project was then removed with `docker compose down --volumes`.

Not run: two machines, moving the files between them, a different user id, a new address, and a reboot of the stopped old one.
