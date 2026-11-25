---
status: active
scope: repository
owner: limineol
last_verified: 2026-11-24
review_by: 2027-02-20
supersedes: []
code:
  - deploy/compose.yaml
  - deploy/deployment.slow.test.ts
  - .github/workflows/release.yml
---

# Upgrading and going back

An upgrade moves a deployment to another release's hub image, on the same hub directory and ClickHouse volume. A rollback goes back to the image before, with the hub store as it was. These are the steps of [the deployment spec](specs/deployment/spec.md#upgrading-and-rolling-back), which its slow test runs as written against a deployment it builds; this page is the same steps as you follow them, with what each keeps.

Each upgrade keeps one way back: the image before and the store before. Run the steps in one terminal, in order: later steps use the `VERSION` and `DOWNLOADS` of earlier ones. A deployment that runs a build of your own, a commit no release holds, upgrades the same way with an image you build ([`recipes/a-build-of-your-own.md`](recipes/a-build-of-your-own.md)).

## Upgrade

### 1. Read the release's notes

Find the latest release, as the install did:

```sh
VERSION="$(curl -fsSLI -o /dev/null -w '%{url_effective}' https://github.com/limineol/cota/releases/latest | sed 's|.*/tag/v||')" && echo "$VERSION"
```

It prints the version, whose notes are its page, `https://github.com/limineol/cota/releases/tag/v<version>`, and `docs/releases/<version>.md` in the repository. To move to a release other than the latest, set `VERSION=<version>` instead. Read the notes of every release between yours and that one: a release that adds a step to the hub store says so (a rollback then needs the copy step 3 keeps), one that changes ClickHouse's image says so too (that is an upgrade of its own, below), and one that changes the Compose file, the configuration or `cota` says what to do with it.

### 2. Pull the new image, and compare the Compose file

Pull the release's hub image while the hub still runs, and download its Compose file, checked against its `SHA256SUMS`, to compare with yours:

```sh
docker pull "ghcr.io/limineol/cota-hub:$VERSION" &&
RELEASE="https://github.com/limineol/cota/releases/download/v$VERSION" &&
DOWNLOADS="$(mktemp -d)" && cd "$DOWNLOADS" &&
  curl -fsSLO "$RELEASE/compose.yaml" && curl -fsSLO "$RELEASE/SHA256SUMS" &&
  grep '  compose\.yaml$' SHA256SUMS | if command -v shasum >/dev/null; then shasum -a 256 -c -; else sha256sum -c -; fi &&
  diff compose.yaml "$HOME/cota-hub/compose.yaml"
```

It stops at the first step that fails, and the hub keeps running: go on to step 3 only once the pull succeeded and `compose.yaml: OK` was printed. `docker image ls ghcr.io/limineol/cota-hub` lists the new image beside the one running now. No output from `diff` means the Compose file did not change. The release's page gives the image's digest, and `gh attestation verify oci://ghcr.io/limineol/cota-hub:<version> --repo limineol/cota` shows it came from Cota's release workflow, if you want to check either.

### 3. Keep what a rollback needs

In the hub directory, stop the hub, so that nothing writes the hub store, and keep `.env`, the Compose file and a copy of the store in `previous/`, readable by you alone:

```sh
cd "$HOME/cota-hub" &&
  docker compose stop hub &&
  (umask 077 && rm -rf previous.new && mkdir previous.new && cp .env compose.yaml previous.new/ && cp -Rp store previous.new/store && rm -rf previous && mv previous.new previous)
```

The copy is made beside `previous/` and takes its place only once it is whole, so a step that fails leaves what an earlier upgrade kept there as it was: go on only when the block exits 0, and until then `docker compose start hub` starts the hub again as it was. If the Compose file changed (step 2's `diff` printed something), put the release's in its place:

```sh
cp "$DOWNLOADS/compose.yaml" compose.yaml
```

### 4. Name the new image and start it

Write the new image's name into `.env` in place of the old, by its tag and the digest of what was pulled:

```sh
IMAGE="$(docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "ghcr.io/limineol/cota-hub:$VERSION" | grep -m 1 '^ghcr.io/limineol/cota-hub@sha256:')" &&
NEW="ghcr.io/limineol/cota-hub:$VERSION@${IMAGE#*@}" &&
(cd "$HOME/cota-hub" && umask 077 && grep -v '^COTA_HUB_IMAGE=' .env > .env.new && echo "COTA_HUB_IMAGE=$NEW" >> .env.new && mv .env.new .env)
```

Then, in the hub directory:

```sh
docker compose up -d --wait
```

### 5. Check it

```sh
docker compose ps --format '{{.Service}} {{.Image}}'
curl -s http://127.0.0.1:8080/health
docker compose logs hub | grep -c 'cota hub listening'
```

The hub runs the new image, answers `{"status":"ok"}`, and has started once, with its pools named on that line. Sign in to the dashboard. If anything is wrong, roll back. `rm -rf "$DOWNLOADS"` removes the downloads once you no longer need the release's Compose file.

The machines need nothing for a new hub image. A release whose notes say `cota` changed: on each machine, install its `cota` as the install did ([`install.md`](install.md), Each machine, step 1, with `VERSION` the new release's), which replaces `~/.local/bin/cota`, and run `~/.local/bin/cota doctor`. A machine that keeps no reader key gets a warning on doctor's `memory` line, which a `cota` before that check did not give: it is expected where you chose that the machine's agents do not read the request log, and the install's step 5 gives the key and the skill where you want them to ([`install.md`](install.md), Each machine, step 5).

### What an upgrade keeps

| | |
| --- | --- |
| The request log (ClickHouse's volume) | Kept, and written by the new image from its first request |
| The archive | Kept, and archived on by the new image |
| `cota.toml` and `secrets/` | Untouched, unless the release says to change them |
| The hub store | Used by the new image, which may add steps to it; the copy in `previous/store` is as it was |
| `.env` | The new image's name; the old `.env` is in `previous/.env` |
| `compose.yaml` | The release's, if it changed; the one before is in `previous/compose.yaml` either way |
| The old image | Kept until you remove it (`docker image rm ghcr.io/limineol/cota-hub:<version>`), so that a rollback can start it |

## Roll back

In the hub directory, stop the hub, put back `.env`, the Compose file and the store the upgrade kept, and start it:

```sh
docker compose stop hub &&
  rm -rf store.restored && cp -Rp previous/store store.restored &&
  cp previous/.env .env && cp previous/compose.yaml compose.yaml &&
  rm -rf store && mv store.restored store &&
  docker compose up -d --wait
```

It stops at the first step that fails, and the old image never starts on a store the rollback did not put back: the store in place is removed only once the kept one has been copied whole beside it. Right what failed and run the block again. Then check it as in step 5: the hub runs the old image, named by the tag and digest it ran before.

A `previous/` kept by this guide as it was at Cota 0.1.0 holds the Compose file only when that upgrade changed it. If it holds none, or one older than `previous/.env`, which an earlier upgrade left, the Compose file in place is the one that ran before: leave `cp previous/compose.yaml compose.yaml &&` out of the block.

The store is put back because a newer hub may have added a step to it, and an older hub refuses a store holding a step it does not know. So a rollback loses what the hub store gained since the upgrade:

- sign-ins made since: sign in again;
- passkeys made since, display names given, routes changed and quota logins given since;
- a quota login's refreshes since: the provider may have rotated the copy's refresh token away, and that quota login is then expired; give it again ([`operating.md`](operating.md#quota-logins)).

The request log is not rolled back: ClickHouse keeps every request either image logged, and the archive keeps archiving them, since an older hub writes the columns it knows.

## ClickHouse

ClickHouse's image is never upgraded in the same step as the hub's. A release that moves it says so, and its upgrade is a step of its own, with its own way back: ClickHouse does not promise that an older server reads what a newer one wrote, so going back from it is a new, empty volume and a restore from the archive ([`operating.md`](operating.md#a-restore)), which brings back every archived day and not the hours since. Copy the hub directory and the volume before it ([`recipes/copying-the-hub-directory.md`](recipes/copying-the-hub-directory.md)). No release has moved it yet.
