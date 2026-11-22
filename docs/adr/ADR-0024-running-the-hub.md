---
status: accepted
scope: repository
owner: limineol
last_verified: 2026-11-22
review_by: 2027-02-18
supersedes: []
code:
  - Dockerfile
  - .dockerignore
  - deploy/compose.yaml
  - deploy/cota.toml
---

# ADR-0024: The hub runs from one image, beside its ClickHouse, by a Compose file the owner keeps in a hub directory

## Context

Milestone 5 is the release. Until now the hub has been started by hand: `docs/install.md` runs `bun install` in a checkout, starts ClickHouse from `compose.dev.yaml` (its password the throwaway one, `throwaway-dev-password`, its port `127.0.0.1:18123`), and starts the hub with `nohup bun run hub`, which runs until the machine restarts; keeping it running is left to "the owner's choice of service manager". That is a way to try the hub, not to depend on it.

The owner decided on 2026-11-18 that Cota replaces the prototype on the machine the prototype runs on, straight, with a way back and no trial beside it. So the first thing milestone 5 needs is a real way to run the hub there: one that starts at boot, survives a restart with its data, keeps its secrets in files, says when it is healthy, binds only where the owner says, and can be upgraded and taken back to the image before.

The prototype ran as one Compose project of seven services on one machine: its ClickHouse (published on loopback only, a password from the environment), a one-shot service that applied its SQL views on every `up`, the gateway, an archiver sidecar, its dashboard, a fallback service, and a reverse proxy that held the HTTPS names, every published port bound to the address of a private overlay network plus loopback. Two lessons from it are kept here. A port bound to an overlay network's address does not open when the container engine starts before that network is up, and only a restart fixes it. And a bind mount of a single file keeps the old file when the repository replaces it, so it mounted directories.

Cota is fewer moving parts: the hub is one process that relays, logs, archives, reads quotas and serves the dashboard (ADR-0001, ADR-0018, ADR-0019); beside it there is only ClickHouse (ADR-0007) and the hub store, a SQLite file (ADR-0013). The configuration names its secrets by reference, `{ env = … }` or `{ file = … }`, and "a container gets its secrets as environment variables or mounted files" (ADR-0009). The dashboard's files spec already says that release images build the dashboard with the hub.

## Decision

### The hub image

- **What is in it.** Bun, at the version of `package.json`'s `packageManager` (1.4.2), the workspace's `package.json` and `bun.lock`, the hub's production dependencies only (`@effect/platform-bun`, `@simplewebauthn/server` and `effect`, and theirs), the hub's source (`apps/hub/package.json` and `apps/hub/src`, without its tests: no `*.test.ts` and no `05-tests` folder), and the dashboard's built files. No Vite, Storybook, Playwright, Biome or Bend, and no `apps/cli` or `packages/ui` source. Bun runs the hub's TypeScript as it does in development: there is no bundle to keep in step with the source.
- **Its base** is Bun's official slim image (`oven/bun:1.4.2-slim`, Debian with glibc), named by its digest, as `compose.dev.yaml` names ClickHouse's.
- **How the dashboard gets in.** A build stage installs the whole workspace and runs `bun run web:build`; the image takes only its `apps/web/dist`, to `/app/apps/web/dist`, which is where `config/config.ts`'s `builtDashboard` looks from the hub's source. A deployment's configuration therefore needs no `[dashboard]`, and the dashboard an image serves is the one it was built with.
- **What it runs.** `WORKDIR /app`, `COTA_CONFIG=/etc/cota/cota.toml`, and the command `bun run hub`. The root `package.json` is in it so that `bun run archive:restore` and `bun run import` (ADR-0025) run from the same image, with `docker compose run --rm hub …`, against the same configuration and network.
- **Its user.** The image's own user is not root: Bun's image has a user `bun` (uid 1000) but runs as root, so the Dockerfile sets `USER bun`, and the image's entrypoint refuses to start the hub as uid 0, whoever names that user. The Compose file runs the hub as the owner's own user and group, `COTA_UID` and `COTA_GID` in the hub directory's `.env`, written at install from `id -u` and `id -g`: the files of the hub directory stay the owner's, mode 0600 and 0700, and the hub can read them without a `chown`, on Linux as through macOS's container engines. The hub never runs as uid 0.
- **How it is built.** `Dockerfile` and `.dockerignore` at the repository's root, so a checkout builds it with `docker build -t cota-hub:<commit> .`. The build stage runs on the builder's own platform; the final stage only copies files onto the base image and runs nothing, so the same files serve every platform and building for another needs no emulation.

  > Amended by ADR-0028: an owner pulls a release's image, `ghcr.io/limineol/cota-hub:<version>`, and builds one only for a commit no release holds, by the recipe of a build of your own.
- **Platforms: `linux/amd64` and `linux/arm64`.** The machine a single owner keeps on is as likely an Apple silicon Mac (whose container engine runs arm64 Linux) or a small arm64 board as an amd64 server, and ClickHouse's and Bun's images exist for both. Since the final stage runs nothing, two platforms cost one build stage and two copies. Other platforms are not built.
- **In CI.** 5a adds a job that builds the image for both platforms without pushing it or loading it anywhere (`--output type=cacheonly`). The deployment's slow test (`docs/specs/deployment/spec.md`) builds the image for the runner's platform itself, in the verify job's slow tier, on the runner's Docker, so that what it runs is the working tree it tests. Publishing (a registry, its name, tags per version) is milestone 5's release slice, which is a public action and the owner's to start.

> Amended by ADR-0027: the release workflow publishes the image, for both platforms, as `ghcr.io/limineol/cota-hub:<version>`, built with `COTA_VERSION` and `COTA_REVISION`, when the owner pushes a version's tag, and on nothing else. CI's job still builds it on every pull request and keeps it nowhere, and CI also builds `cota` for its five systems and starts each on a runner of its own system.

### The Compose file and the hub directory

`deploy/compose.yaml` in the repository, copied by the owner into the **hub directory**, where it runs. The project is named `cota`. The hub directory, which `docs/install.md` already calls `~/cota-hub`:

```text
~/cota-hub/                 mode 0700, the owner's
  compose.yaml              the Compose file
  .env                      COTA_HUB_IMAGE, COTA_UID, COTA_GID, COTA_BIND, COTA_PORT; no secret
  cota.toml                 the configuration, from deploy/cota.toml
  secrets/                  one file per secret, mode 0600: clickhouse, the hub keys, held keys, kept logins
  store/                    the hub store, cota.sqlite and its WAL files
  archive/                  the archive, one directory per archived day
  previous/                 what a rollback needs: the .env and the store from before the last upgrade
```

ClickHouse's data is the Docker volume `cota_clickhouse`, not a folder of the hub directory: ClickHouse runs as its own user, and its files are not the owner's to read; the archive is the request log's copy the owner can read.

**The services.**

| | `clickhouse` | `hub` |
| --- | --- | --- |
| Image | `clickhouse/clickhouse-server`, the version and digest `compose.dev.yaml` and CI use (26.8.36.3) | `${COTA_HUB_IMAGE}` |
| Mounts | the volume at `/var/lib/clickhouse`; `secrets/clickhouse` alone, read-only, at `/etc/cota/secrets/clickhouse` | `cota.toml` (read-only) at `/etc/cota/cota.toml`; `secrets/` (read-only) at `/etc/cota/secrets`; `store/` at `/var/lib/cota/store`; `archive/` at `/var/lib/cota/archive` |
| Environment | `CLICKHOUSE_DB=cota`, `CLICKHOUSE_USER=cota`, `CLICKHOUSE_PASSWORD_FILE=/etc/cota/secrets/clickhouse`, `CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1` (the hub makes its SQL user, ADR-0015) | none: every secret is a file the configuration names |
| Published | nothing | `${COTA_BIND:-127.0.0.1}:${COTA_PORT:-8080}` to the container's 8080 |
| Health | `clickhouse-client` signs in as `cota` with the secret file's password and runs `SELECT 1` | `bun -e` fetches `http://127.0.0.1:8080/health` and exits 0 only on 200 (the slim image has no `curl`) |
| Restart | `unless-stopped` | `unless-stopped`; starts once `clickhouse` is healthy |
| Stop | Docker's default | `stop_grace_period: 30s`: the writer has 10 seconds to empty its queue and the recorder 15 to finish (the request log and recorder specs), past Docker's default of 10 |
| Also | `ulimits` `nofile` 262144, as in development | `init: true`; `user: "${COTA_UID}:${COTA_GID}"` |

Both use Docker's `local` logging driver, which rotates its files; the default `json-file` grows without end, and the hub logs a line per problem for as long as it runs.

**The deployment's configuration**, `deploy/cota.toml`, is `examples/cota.example.toml` with the container's paths: `[hub] host = "0.0.0.0"` and `port = 8080` inside the container; `[clickhouse] url = "http://clickhouse:8123"`, `database = "cota"`, `user = "cota"`, `password = { file = "/etc/cota/secrets/clickhouse" }`; `[store] path = "/var/lib/cota/store/cota.sqlite"`; `[archive] directory = "/var/lib/cota/archive"`, on by default in a deployment; and every secret as `{ file = "/etc/cota/secrets/<name>" }`. No secret is ever an environment variable of either container, so `docker inspect` shows none.

**A ClickHouse password made at install, never the throwaway one.** The install makes `secrets/clickhouse` as it makes the hub keys, `openssl rand -hex 24` under `umask 077`; ClickHouse reads it through `CLICKHOUSE_PASSWORD_FILE` and the hub through its configuration. ClickHouse's own entrypoint reads that file but, when it is missing, starts silently with no password, and with `CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT` its user then answers from any address on the project's network without one (read in the image's `docker/server/entrypoint.sh`, ClickHouse's repository on GitHub). So the Compose file starts ClickHouse through a guard that exits 1, naming the file, unless the file exists and is not empty, and only then hands over to the image's entrypoint. The hub refuses an empty secret file already (ADR-0009). `throwaway-dev-password` stays `compose.dev.yaml`'s and CI's, for development and tests only.

**The address it binds.** By default the hub is published on `127.0.0.1` only, and ClickHouse on no port of the host: nothing is reachable from another machine until the owner says so in `.env`. The owner's two ways out, each a recipe and not Cota's:

- **Behind their reverse proxy** on the same machine: `COTA_BIND` stays `127.0.0.1`, and the proxy, which holds the HTTPS name and its certificate, forwards to it. This is the way to passkeys, which a browser offers only at an `https` address with a host name (ADR-0021).
- **On a private network**, a VPN or an overlay network: `COTA_BIND` is the machine's address on it. An address that comes up after the container engine (an overlay network at boot) is not there when Docker publishes the port, and the hub is then unreachable until `docker compose up -d` is run again; the recipe says so, and the reverse proxy on loopback avoids it.

`COTA_BIND=0.0.0.0` publishes the hub on every interface: hub keys then cross the network in the clear unless something in front encrypts them, which the install prompt already asks the owner to accept or refuse.

**What the owner reaches ClickHouse with.** Not a port: the hub's SQL console (ADR-0015) for SQL, and `docker compose exec clickhouse clickhouse-client` for anything else. The restore and the import run in the `hub` service's network and reach `clickhouse` by name.

### Upgrading and rolling back

The hub image is named in `.env` as `COTA_HUB_IMAGE`, by tag and digest once images are published, by the local tag `cota-hub:<commit>` until then. Changing the image is changing that line. An **upgrade**, in the hub directory:

> Amended by ADR-0028: `.env` names a release's image by its tag and the digest of what was pulled, `ghcr.io/limineol/cota-hub:<version>@sha256:<digest>`, and a build of your own by its local tag. An upgrade pulls the new release's image before step 1, while the hub runs, and compares its Compose file with the release's; `docker image ls ghcr.io/limineol/cota-hub` lists the images a rollback can use.

1. Keep what a rollback needs: `.env` into `previous/`, and, the hub stopped (`docker compose stop hub`) so that nothing writes the store and its WAL is folded in, a copy of `store/` into `previous/store/`, under `umask 077`. A release whose Compose file changed brings its own `compose.yaml`, and the old one goes into `previous/` too.
2. Name the new image in `.env`, build or pull it, and `docker compose up -d --wait`.
3. Check: `/health` answers, and the hub's log names its pools.

A **rollback** is the same in reverse: stop the hub, put `previous/.env` (and `previous/compose.yaml`) back, replace `store/` with `previous/store/`, and `docker compose up -d --wait`. The store is put back because a newer hub may have added a migration step, and the hub refuses a store holding a step it does not know (the hub store spec, M3). What the rollback loses is what the store gained since the upgrade: sign-ins (the owner signs in again), passkeys, display names, routes and quota logins given since, and a quota login's refresh, after which the copy's refresh token may be one the provider has rotated away, so that quota login is expired and given again. The request log is not rolled back: ClickHouse keeps every request either image logged, and the archive keeps archiving it, since `prepare` only adds what is missing and an older hub writes the columns it knows.

ClickHouse is never upgraded in the same step as the hub. A release that moves ClickHouse's image says so, and its upgrade is its own step with its own way back, because ClickHouse does not promise that an older server reads what a newer one wrote: going back from it is a fresh volume and `bun run archive:restore`.

Every image is kept until the owner removes it: `docker image ls cota-hub` lists the ones a rollback can use.

### What `docs/install.md` becomes

The hub's part of the install prompt runs the deployment, and the machines' part does not change. Its question 1 asks for a machine with Docker that stays on, and whether Cota may run its Compose project there (Bun is still needed on every machine that builds `cota`, the hub's own included). Its steps: make the hub directory; build the hub image from the checkout (until images are published, then pull it); copy `deploy/compose.yaml` and `deploy/cota.toml`; write `.env` (the image, `id -u` and `id -g`, the bind address from question 3, the port); make the secrets, the ClickHouse password among them; add the pools to `cota.toml`; `docker compose up -d --wait`; check `$HUB/health`; and hand the hub to the owner, who reads the setup code with `docker compose logs hub`. "Keeping it running across restarts" stops being the owner's choice of service manager: the restart policy keeps it, as long as the machine starts its container engine at boot, which on macOS is the owner's setting of their engine. The path where the owner already runs ClickHouse stays, as `[clickhouse]` naming theirs and `docker compose up -d --no-deps hub`. The README's install line points to the same prompt, and its "Try the hub" stays what it is, a hub in a checkout against `compose.dev.yaml`, for development.

> Amended by ADR-0028: the prompt takes the latest release. Its question 1 asks for Docker, `curl` and GitHub, and no Git, Bun or checkout; its hub's steps download the release's `compose.yaml` and `cota.toml`, checked against its `SHA256SUMS`, in place of copying them, and pull its image in place of building it; and each machine downloads the release's `cota`, checked the same way, in place of building it.

### Not Cota's

- **TLS and the reverse proxy.** The hub speaks plain HTTP. HTTPS, its certificate and host name are the owner's proxy's, a recipe.
- **The private network**: the VPN or overlay, its addresses, the firewall. A recipe.
- **Backups beyond the archive.** The archive keeps the request log (ADR-0018). The hub store, the configuration and the secrets are the hub directory, which the owner copies elsewhere (a recipe says how, with the hub stopped or the store copied by `sqlite3 ".backup"` under `umask 077`); Cota copies nothing off the machine.
- **The container engine**: installing Docker, starting it at boot, its resources and its updates.
- **Anything else the owner runs beside the hub**, such as a usage monitor; the roadmap's parity table gives those a recipe at most.

## Alternatives weighed

- **A systemd unit running Bun from a checkout.** No image to build, and `git pull` is the upgrade. But the deployment would be a working tree that `git clean` or a branch switch changes, dependencies installed on the machine by whatever `bun install` resolves that day, Bun installed on the host, and ClickHouse still in Docker: two managers for two processes, and none on macOS, which has launchd and no systemd. A rollback would be a checkout and an install again, not a name.
- **A single binary.** `bun build --compile` makes one, as `cota`'s (ADR-0022). The hub would still need ClickHouse beside it, so Docker or a ClickHouse installed by hand would still be there, and the binary would carry the dashboard's files and the price lists inside it or beside it. It saves the image's base and nothing the owner touches. It can come later for a hub without Docker, from the same source.
- **Kubernetes, or a Helm chart.** One owner, one machine, two containers. A cluster adds a control plane to keep, and a chart is a second deployment to test for a user who does not exist.
- **The ClickHouse password in `.env`, interpolated into the Compose file.** One fewer file, but it is then in both containers' environments, where `docker inspect` and every process inside them read it.
- **The hub directory mounted whole into the hub.** Fewer mounts, but the hub could then rewrite its own configuration and Compose file; only the store and the archive are the hub's to write.
- **ClickHouse's data in the hub directory.** One folder to copy, but ClickHouse's files are its own user's, a copy of a running ClickHouse's folder is not a backup, and the archive is the copy meant to be read.
- **One platform.** amd64 alone would leave an arm64 machine, the likely kind for one person's hub, running it under emulation.

## Consequences

- 5a builds `Dockerfile`, `.dockerignore`, `deploy/compose.yaml`, `deploy/cota.toml`, the CI job, and the deployment's slow test, which brings the deployment up from nothing with the image it builds and a fake provider, logs a request, and keeps the request log and the hub store across `down` and `up` (`docs/specs/deployment/spec.md`). The laws held by that test are of a tier `tooling/laws.ts` does not know yet: 5a adds `slow` there and to `verify`, for `*.slow.test.ts`, and widens the slow tier's `include` beyond `evals/`.
- `docs/install.md` and the README move onto the deployment in 5a. The install evals (milestone 4d, `docs/specs/install-evals/spec.md`) follow the prompt's own commands, so their world must give the hub's machine a Docker engine of its own, and their rehearsal the new commands, in the same slice; otherwise the prompt and its evals part.
- The dashboard files spec's "The Docker image's copy of the build" stops being "Not built": the image is how a release serves the dashboard.
- A release that adds a hub store step says so, since its rollback needs the store copy; one that changes ClickHouse's image says so, since its upgrade is a step of its own.
- `compose.dev.yaml` stays as it is, for development and the ClickHouse tier, with its throwaway password.

### Facts to confirm when built

What 5a found, on 2026-11-18 and 2026-11-19, building the image and running the deployment's slow test on macOS with OrbStack (Docker Compose v5.1.2). Docker Desktop and Linux were not run.

- **Confirmed: `oven/bun:1.4.2-slim` exists for both platforms**, as an index (`sha256:cb3bbbb08e13a4a2ff400f24c7a2a1d5efa83f6ef8544d52d95a519631e2fc61`) of `linux/amd64` and `linux/arm64`, read from Docker Hub's registry and pulled by the build. **It has a user that is not root, `bun` (uid 1000, group `bun`), but its configuration names no user, so it runs as root**: the Dockerfile sets `USER bun`, and the image runs as `uid=1000(bun)`. Its entrypoint, `docker-entrypoint.sh`, is replaced by the one that refuses uid 0, which `docker run --user 0:0` shows. Its labels (title, description, url, licenses) are Bun's, so the Dockerfile sets Cota's.
- **Confirmed: Bun 1.4.2 installs one member's production dependencies alone**, with `bun install --frozen-lockfile --production --filter @cota/hub` given every workspace manifest and the lockfile: 32 packages, 76 MB in the image's `/app/node_modules`, the hub's three and theirs, under the isolated linker's `node_modules/.bun` with `apps/hub/node_modules` linking into it. `bun install --frozen-lockfile --filter @cota/web` then `bun run web:build` builds the dashboard from the same manifests (1.6 MB in `apps/web/dist`). The image is 370 MB unpacked, 86 MB as stored; its first build here took 15 s with Bun's full image already pulled, and a build with nothing changed under a second. `bun run` passes `SIGTERM` on to the script it runs.
- **Confirmed on OrbStack: the hub as the owner's uid.** It runs as the uid `.env` names, creates its store with mode 0600 and that owner in the bind-mounted `store/`, and stopped by `docker compose down` leaves no write-ahead log to fold in (Y6, Y2). The archive's files in a bind-mounted directory are not confirmed: no day ends in a test, so nothing is archived.
- **Found on OrbStack, by 5e's private network recipe (2026-11-19): an address the machine does not have is not refused.** With `COTA_BIND` naming one, `docker compose up -d --wait` brings the hub healthy, `docker compose ps` lists the port on that address, and nothing listens. So a hub started before its overlay network's address exists says nothing, and `docker compose up -d` run again changes nothing, since nothing in the project changed: `docker compose up -d --force-recreate --wait hub` publishes it again. A Linux engine's answer was not run.
- **Confirmed on OrbStack: ClickHouse's health check and its secret file.** ClickHouse's entrypoint (`docker/server/entrypoint.sh` at `v26.8.36.3-lts`) reads `CLICKHOUSE_PASSWORD_FILE` with `cat` only when it is a file, as root before it drops to its own user, and writes the user's password into its configuration on every start; the image names no user, so its health checks run as root, and root in the container reads the owner's file of mode 0600 through macOS's file sharing (Y1). That sharing can show a file stale just after it changes: a file just emptied once passed a guard testing its size (`-s`) while ClickHouse read it empty, and one just removed under `/var/folders` was still listed, without contents. The guard therefore reads the file rather than its size.
