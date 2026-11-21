---
status: active
scope: repository
owner: limineol
last_verified: 2026-11-19
review_by: 2027-02-19
supersedes: []
code:
  - Dockerfile
  - deploy/compose.yaml
  - deploy/deployment.slow.test.ts
---

# Upgrading and going back

An upgrade moves a deployment to another hub image, on the same hub directory and ClickHouse volume. A rollback goes back to the image before, with the hub store as it was. These are the steps of [the deployment spec](specs/deployment/spec.md#upgrading-and-rolling-back), which its slow test runs as written against a deployment it builds; this page is the same steps as you follow them, with what each keeps.

Until images are published, a new hub image is built from a checkout of a newer commit. Each upgrade keeps one way back: the image before and the store before. Read a release's notes first: one that adds a step to the hub store says so (a rollback then needs the copy this keeps), and one that changes ClickHouse's image says so too (that is an upgrade of its own, below).

## Upgrade

### 1. Build the new image

In your checkout of Cota, move to the commit you want (for the latest, `git pull`), and build it as the install did:

```sh
docker build --build-arg COTA_REVISION="$(git rev-parse HEAD)" -t "cota-hub:$(git rev-parse --short=12 HEAD)" .
```

`docker image ls cota-hub` lists it beside the one running now. Check whether the release changed the Compose file:

```sh
diff deploy/compose.yaml "$HOME/cota-hub/compose.yaml"
```

No output means it did not.

### 2. Keep what a rollback needs

In the hub directory, stop the hub, so that nothing writes the hub store, and keep `.env` and a copy of the store in `previous/`, readable by you alone:

```sh
cd "$HOME/cota-hub"
docker compose stop hub
(umask 077 && mkdir -p previous && cp .env previous/.env && rm -rf previous/store && cp -Rp store previous/store)
```

This replaces what an earlier upgrade kept there. If the Compose file changed, copy the old one into `previous/` too, and the new one into its place:

```sh
cp compose.yaml previous/compose.yaml
```

and, from the checkout, `cp deploy/compose.yaml "$HOME/cota-hub/compose.yaml"`.

### 3. Name the new image and start it

From the checkout, write the new image's name into `.env` in place of the old:

```sh
NEW="cota-hub:$(git rev-parse --short=12 HEAD)"
(cd "$HOME/cota-hub" && umask 077 && grep -v '^COTA_HUB_IMAGE=' .env > .env.new && echo "COTA_HUB_IMAGE=$NEW" >> .env.new && mv .env.new .env)
```

Then, in the hub directory:

```sh
docker compose up -d --wait
```

### 4. Check it

```sh
docker compose ps --format '{{.Service}} {{.Image}}'
curl -s http://127.0.0.1:8080/health
docker compose logs hub | grep -c 'cota hub listening'
```

The hub runs the new image, answers `{"status":"ok"}`, and has started once, with its pools named on that line. Sign in to the dashboard. If anything is wrong, roll back.

The machines need nothing for a new hub image. A release that changes `cota` says so: build it again on each machine as the install did ([`install.md`](install.md), Each machine, step 1), and run `cota doctor`.

### What an upgrade keeps

| | |
| --- | --- |
| The request log (ClickHouse's volume) | Kept, and written by the new image from its first request |
| The archive | Kept, and archived on by the new image |
| `cota.toml` and `secrets/` | Untouched, unless the release says to change them |
| The hub store | Used by the new image, which may add steps to it; the copy in `previous/store` is as it was |
| `.env` | The new image's name; the old `.env` is in `previous/.env` |
| The old image | Kept until you remove it (`docker image rm cota-hub:<tag>`), so that a rollback can start it |

## Roll back

In the hub directory, stop the hub, put back `.env` and the store the upgrade kept, and start it:

```sh
docker compose stop hub
cp previous/.env .env && rm -rf store && cp -Rp previous/store store
docker compose up -d --wait
```

If the upgrade put a new Compose file in place, put the old one back too, before `up`: `cp previous/compose.yaml compose.yaml`. Then check it as in step 4: the hub runs the old image.

The store is put back because a newer hub may have added a step to it, and an older hub refuses a store holding a step it does not know. So a rollback loses what the hub store gained since the upgrade:

- sign-ins made since: sign in again;
- passkeys made since, display names given, routes changed and quota logins given since;
- a quota login's refreshes since: the provider may have rotated the copy's refresh token away, and that quota login is then expired; give it again ([`operating.md`](operating.md#quota-logins)).

The request log is not rolled back: ClickHouse keeps every request either image logged, and the archive keeps archiving them, since an older hub writes the columns it knows.

## ClickHouse

ClickHouse's image is never upgraded in the same step as the hub's. A release that moves it says so, and its upgrade is a step of its own, with its own way back: ClickHouse does not promise that an older server reads what a newer one wrote, so going back from it is a new, empty volume and a restore from the archive ([`operating.md`](operating.md#a-restore)), which brings back every archived day and not the hours since. Copy the hub directory and the volume before it ([`recipes/copying-the-hub-directory.md`](recipes/copying-the-hub-directory.md)). No release has moved it yet.
