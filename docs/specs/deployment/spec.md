---
status: active
scope: repository
owner: limineol
last_verified: 2026-11-21
review_by: 2027-02-19
supersedes: []
code:
  - Dockerfile
  - .dockerignore
  - deploy/compose.yaml
  - deploy/cota.toml
---

# Deployment

A deployment is the hub and its ClickHouse as the owner runs them on one machine with Docker Compose: the hub image, the Compose file, the hub directory beside it, and ClickHouse's volume. This spec covers what each holds, how a deployment is made, started, checked, upgraded and rolled back, and how a hub's machines are moved onto it. ADR-0024 gives the reasons.

**Status.** Active. `Dockerfile`, `.dockerignore`, `deploy/compose.yaml` and `deploy/cota.toml` are built; the tests that read the two files (`deploy/deployment.test.ts`, Y3 to Y5) pass, and the slow test (`deploy/deployment.slow.test.ts`) passes on macOS with OrbStack in about two minutes, and on Linux with Docker Engine in CI, where the job that builds the image for both platforms runs too. Docker Desktop has not run it.

## The hub image

| | |
| --- | --- |
| Base | `oven/bun:1.4.2-slim`, by digest |
| `/app` | the root `package.json` and `bun.lock`; `node_modules` with the hub's production dependencies only; `apps/hub/package.json` and `apps/hub/src` without `*.test.ts` and `05-tests`; `apps/web/dist`, the dashboard built in the image's build stage |
| Environment | `COTA_CONFIG=/etc/cota/cota.toml` |
| Command | `bun run hub`, in `/app`, through an entrypoint that exits 1, saying so, when it runs as uid 0 |
| User | `bun` (uid 1000), set by the Dockerfile, since Bun's image itself runs as root; the Compose file runs it as the owner's |
| Platforms | `linux/amd64`, `linux/arm64` |
| Labels | `org.opencontainers.image.title` (`cota-hub`), `.description`, `.url`, `.licenses` (MIT), `.source`, `.revision` (the commit, from the build argument `COTA_REVISION`) and `.version` (`COTA_VERSION`) |

`bun run archive:restore` and `bun run import` run from it as `docker compose run --rm hub bun run <script> …`. Until images are published it is built from a checkout, `docker build --build-arg COTA_REVISION="$(git rev-parse HEAD)" -t "cota-hub:$(git rev-parse --short=12 HEAD)" .`. Two stages run on the builder's platform, one installing the workspace for `bun run web:build` and one the hub's production dependencies alone (`bun install --frozen-lockfile --production --filter @cota/hub`); the final stage only copies. `.dockerignore` sends the builder only the workspace's manifests, the hub's source and what the dashboard is built from, and never a test.

## The hub directory

```text
<hub directory>/            0700
  compose.yaml              from deploy/compose.yaml
  .env                      0600; no secret
  cota.toml                 0600; from deploy/cota.toml, with the owner's pools
  secrets/                  0700; one file per secret, each 0600
    clickhouse              ClickHouse's password, made at install
    clients, fleet, agents  the hub keys
    <pool>, <pool>-login    held keys and kept logins, written by the owner
  store/                    0700; the hub store
  archive/                  0700; the archive
  previous/                 0700; made by an upgrade
```

`.env` holds exactly these, each on a line of its own:

| Name | Holds | Default |
| --- | --- | --- |
| `COTA_HUB_IMAGE` | The hub image: `cota-hub:<commit>`, or a published image's tag and digest | none: required |
| `COTA_UID`, `COTA_GID` | The owner's user and group, from `id -u` and `id -g` | none: required, and never 0 |
| `COTA_BIND` | The host address the hub is published on | `127.0.0.1` |
| `COTA_PORT` | The host port | `8080` |

## The Compose file

The project is `cota`; ClickHouse's volume is `cota_clickhouse`. Its services, as ADR-0024's table gives them:

- **`clickhouse`**: ClickHouse's image at the version `compose.dev.yaml` names, by digest; the volume at `/var/lib/clickhouse`; `secrets/clickhouse` read-only at `/etc/cota/secrets/clickhouse` and no other secret; `CLICKHOUSE_DB=cota`, `CLICKHOUSE_USER=cota`, `CLICKHOUSE_PASSWORD_FILE` naming that file, `CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1`; started through a guard that, unless the path is a file whose contents are not empty, prints `ClickHouse's password file /etc/cota/secrets/clickhouse is missing or empty; the install makes it` and exits 1 (it reads the file rather than its size, which a file shared from macOS can show stale just after it is rewritten), and a missing file is refused by Compose before ClickHouse starts (`bind source path does not exist`), since every bind mount of either service is made with `create_host_path: false` and so never becomes a directory Docker made; a file removed just before `up` that the engine's file sharing still shows is refused by the guard, since it has no contents to read; no port published; healthy when `clickhouse-client --user cota` with the file's password answers `SELECT 1`; `restart: unless-stopped`; `ulimits` `nofile` 262144.
- **`hub`**: `${COTA_HUB_IMAGE}` as `${COTA_UID}:${COTA_GID}`, with `init: true`; `cota.toml` read-only at `/etc/cota/cota.toml`, `secrets/` read-only at `/etc/cota/secrets`, `store/` at `/var/lib/cota/store`, `archive/` at `/var/lib/cota/archive`; no environment variable but those the image sets; `${COTA_BIND:-127.0.0.1}:${COTA_PORT:-8080}:8080`; started once `clickhouse` is healthy; healthy when `GET /health` on its own port answers 200, checked with `bun -e`; `restart: unless-stopped`; `stop_grace_period: 30s`. `COTA_HUB_IMAGE`, `COTA_UID` and `COTA_GID` are required: Compose refuses to start without them, naming each.
- Both log with Docker's `local` driver.

`deploy/cota.toml` is `examples/cota.example.toml` with: `[hub] host = "0.0.0.0"`, `port = 8080`; `[clickhouse] url = "http://clickhouse:8123"`, `database = "cota"`, `user = "cota"`, `password = { file = "/etc/cota/secrets/clickhouse" }`; `[store] path = "/var/lib/cota/store/cota.sqlite"`; `[archive] directory = "/var/lib/cota/archive"`; no `[dashboard]` and no `[sign_in]`; and each hub key, held key and kept login as `{ file = "/etc/cota/secrets/<name>" }`. It has no pool: the install appends the owner's.

## Making one

In order, each step's success what the install prompt prints for it (`docs/install.md`):

1. Make the hub directory and its folders with the modes above.
2. Build the hub image, or pull it once published, and name it in `.env` with the owner's uid and gid and the address and port the owner chose.
3. Make the secrets: `clickhouse` and the three hub keys with `openssl rand -hex 24` under `umask 077`, printing nothing; the owner writes held keys and kept logins.
4. Copy `deploy/compose.yaml`, and write `cota.toml` from `deploy/cota.toml` with the owner's pools.
5. `docker compose up -d --wait`: both services healthy.
6. `curl -s "$HUB/health"` answers `{"status":"ok"}`, and `docker compose logs hub` holds `cota hub listening`.
7. The owner reads the setup code with `docker compose logs hub` and sets the hub up in the browser.

The hub's store and archive are created by the hub at its first start. ClickHouse's database and user are created by ClickHouse's image the first time its volume is empty, and the hub's tables by its `prepare`.

## Upgrading and rolling back

**An upgrade**, in the hub directory:

```sh
docker compose stop hub
(umask 077 && mkdir -p previous && cp .env previous/.env && rm -rf previous/store && cp -Rp store previous/store)
# name the new image in .env (and, if its release says so, put its compose.yaml in place, the old one in previous/)
docker compose up -d --wait
```

Success: both services healthy, `/health` answers, and the hub's log names its pools.

**A rollback**:

```sh
docker compose stop hub
cp previous/.env .env && rm -rf store && cp -Rp previous/store store
docker compose up -d --wait
```

It loses what the hub store gained since the upgrade (sign-ins, passkeys, display names, routes, quota logins given or refreshed), and keeps every request in the request log. A release that changes ClickHouse's image upgrades it in a step of its own, never with the hub's.

## Moving a hub's machines onto a new one

For an owner replacing a gateway, or moving a hub to another machine. The machines' side is `cota` (`docs/specs/cli/spec.md`); nothing here changes it.

- **Beside the old one.** The new deployment runs at another address or port. Each machine joins it with `cota join <new address>`, which replaces the hub it had; going back is joining the old one again, or, for a gateway that is not a Cota hub, `cota leave` and that gateway's own client setup.
- **In place of the old one.** The old gateway is stopped, and the new deployment is published on its address and port. Machines still need `cota join` unless the old gateway was a Cota hub with the same hub keys. Going back is stopping the deployment (`docker compose stop`) and starting the old gateway, with the machines' clients set up for it again; the deployment's hub directory and volume are kept, so going forward again is `docker compose start`.
- **At the join, the old gateway's client setup comes off the machine.** Before `cota join`, remove what the old gateway put on the machine for its clients: its line in the shell's files that puts its directory on `PATH`, its wrapper of each client (a script named for the client that sets the provider's address itself), and its own job that reports titles. A launch takes as the real client the first file named for the client on `PATH` beyond `cota`'s shims (`docs/specs/cli/spec.md`, Launching, step 2), so a wrapper left there sends every session to the old gateway. After the join, `cota doctor`'s `clients` check names where each client was found, and warns of one that is a script or of a `PATH` line after `cota`'s.
- In both, the old gateway's data is kept as it was until the owner removes it: a way back needs it, and an import (`docs/specs/import/spec.md`) only reads it. Bringing the prototype's history into the new hub is `docs/import.md`'s steps.

The steps for the owner's own machine, which name it, are not in the repository.

## Laws

| Id | Law | Held by |
| --- | --- | --- |
| Y1 | **Up from nothing.** With an empty volume and a hub directory holding only what the install makes, `docker compose up --wait` brings both services healthy, and a request sent through the hub to a fake provider is in the request log. | slow |
| Y2 | **Kept across a restart.** After `docker compose down` and `up` again, without removing the volume, the request log, the hub store and the archive hold what they held before. | slow |
| Y3 | **No password made up.** The Compose file names no ClickHouse password; ClickHouse's password is the secret file's, and with that file missing or empty neither ClickHouse nor the hub starts. | property, slow |
| Y4 | **No secret in the environment.** Neither service has a secret as an environment variable or in its command: every secret reaches it as a file mounted read-only. | property |
| Y5 | **Loopback unless told.** With `COTA_BIND` unset, the hub is published on 127.0.0.1 alone, and ClickHouse on no port of the host. | property |
| Y6 | **Never root.** The hub's process runs as the uid `.env` names, and the hub store it creates has mode 0600 and that owner. | slow |
| Y7 | **The image serves its dashboard.** A hub started from the image, with no `[dashboard]` in its configuration, answers `/` with the index of the dashboard the image was built with. | slow |
| Y8 | **A rollback starts the image before.** After an upgrade from one image to another and a rollback, the first image runs on the store as it was before the upgrade, and the request log still holds every request either image logged. | slow |

Y3 to Y5 are tests that read `deploy/compose.yaml` and `deploy/cota.toml` as YAML and TOML (the property tier: the tier of a test that is neither replay, contract nor ClickHouse): no environment value of either service, nor any argument, holds a secret's text or the throwaway password; every `{ file = … }` names a path under `/etc/cota/secrets`, and that folder and `cota.toml` are mounted read-only; ClickHouse publishes no port, and the hub's port starts `${COTA_BIND:-127.0.0.1}`. A mutant for each: a password in the environment, a port published for ClickHouse, the default bind `0.0.0.0`.

Y1, Y2, Y6 to Y8 and Y3's second half are one slow test, `deploy/deployment.slow.test.ts`, which needs Docker: it builds the image from the working tree as `cota-hub:deploy-<run>`, and checks its labels; makes a hub directory in a temporary folder as the install does, with a fake provider as a third service (a Bun script run by the hub image, in a Compose file of its own beside the deployment's, both named by `COMPOSE_FILE`) and an `openai-chat` pool pointed at it, under a Compose project of its own, `cota-deploy-<run>` (`COMPOSE_PROJECT_NAME`), so it never meets the owner's; brings it up, sets the hub up with the setup code from its log, sends a request with the keyed hub key and finds it with the SQL console, and sets a display name; reads the hub's uid from `docker compose top` and the store's mode and owner from the folder; fetches `/` and compares it with the image's `index.html`; `down`, and finds the store's write-ahead log folded in, and `up`, and finds the request, the sign-in, the name and the archive as they were; tags the same image a second time as "the newer one", runs this spec's upgrade block (the line that names the new image done by the test), logs a request and renames the pool on the newer image, runs the rollback block, and finds the first image running, the name from before the upgrade, and both requests; finds that ClickHouse refuses `cota` without the password; empties the password file and finds `up` fails with the guard's line and no hub, then removes it and finds `up` refused, by Compose naming it or, where the engine still shows the file just removed (macOS's `/var/folders` under OrbStack), by the guard, and neither service running; and removes the project, its volume, both tags and the folder at the end, whatever happened, an interrupt included. The `slow` tier is in `tooling/laws.ts` for it, and `verify` reads its results from the slow tier's run (ADR-0024's Consequences). A test that lasts minutes archives no day, since a day is archived an hour after it ends, so Y2's archive is held only as the folder's listing, empty before and after.

## Not built, on purpose

- **TLS, the reverse proxy, the private network.** Recipes, the owner's (ADR-0024).
- **Backups by Cota.** The archive keeps the request log; the hub directory is the owner's to copy.
- **ClickHouse reachable from the host.** The SQL console, or `docker compose exec clickhouse clickhouse-client`.
- **Several hubs on one hub directory**, as two hubs on one store are not.
- **Published images, until a release.** The release workflow publishes the image for each version's tag, which the owner pushes (ADR-0027); until a release is published and the install moves onto it, the image is built from a checkout.
- **Upgrading ClickHouse with the hub.** Its own step, said by the release that needs it.
