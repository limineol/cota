---
status: active
scope: repository
owner: limineol
last_verified: 2026-11-22
review_by: 2027-02-20
supersedes: []
code:
  - Dockerfile
  - deploy/compose.yaml
  - deploy/cota.toml
  - apps/cli/build.ts
---

# A build of your own

A recipe: Cota documents it and never runs it. The commit, the checkout and the machine that builds are yours.

The install and the upgrade take a release ([`install.md`](../install.md), [`upgrading.md`](../upgrading.md)). To run a commit no release holds (a branch, a fork, `main` ahead of the latest release), build the hub image and `cota` from a checkout of it. Building needs Git, [Bun](https://bun.sh) for `cota`, and Docker for the image; the hub's machine still needs only Docker and the image.

## The hub image

On the hub's machine, in a checkout of the commit:

```sh
docker build --build-arg COTA_REVISION="$(git rev-parse HEAD)" -t "cota-hub:$(git rev-parse --short=12 HEAD)" .
```

It is named by its commit, and `docker image ls cota-hub` lists it. It takes a few minutes the first time.

## Installing with it

Follow the install with three changes on the hub's machine, each run from the checkout's root. In place of the hub's step 2, copy the checkout's Compose file and configuration, which a release would have given:

```sh
cp deploy/compose.yaml "$HOME/cota-hub/compose.yaml" && (umask 077 && cp deploy/cota.toml "$HOME/cota-hub/cota.toml")
```

In step 4, `.env` names the image by its local tag, which has no digest:

```sh
(umask 077 && cat > "$HOME/cota-hub/.env" <<EOF
COTA_HUB_IMAGE=cota-hub:$(git rev-parse --short=12 HEAD)
COTA_UID=$(id -u)
COTA_GID=$(id -g)
COTA_BIND=127.0.0.1
COTA_PORT=8080
EOF
)
```

with the address and port the install's step 4 says. Every other step is the install's.

## `cota`

On each machine, in a checkout of the same commit, build `cota` for that system and install it outside the checkout, where a rebuild, a switch of branch or a `git clean` cannot change it (doctor warns of a `cota` inside a checkout):

```sh
bun install
bun run cli:build
mkdir -p "$HOME/.local/bin"
install -m 0755 apps/cli/dist/cota "$HOME/.local/bin/cota"
```

The build prints `cli:build: bun-<system>-<arch> → <checkout>/apps/cli/dist/cota`. Then the install's steps for each machine go on from step 2, the join. One machine can build for all five systems instead, `bun run cli:build -- --all`, into `apps/cli/dist/` under a release's names (`cota-linux-x64`, `cota-windows-x64.exe`), for you to copy to each.

## Upgrading it

The upgrade's steps, with a build in place of a release's: move the checkout to the new commit and build the image as above in place of step 2's pull, and compare the Compose file with the checkout's:

```sh
diff deploy/compose.yaml "$HOME/cota-hub/compose.yaml"
```

In step 4, name it by its local tag, from the checkout's root:

```sh
NEW="cota-hub:$(git rev-parse --short=12 HEAD)"
(cd "$HOME/cota-hub" && umask 077 && grep -v '^COTA_HUB_IMAGE=' .env > .env.new && echo "COTA_HUB_IMAGE=$NEW" >> .env.new && mv .env.new .env)
```

Keeping what a rollback needs, the check and the rollback are the upgrade's. Going from a build of your own to a release is an upgrade to that release; if the build's commit added a step to the hub store that the release does not have, that release's hub refuses the store, and the way back is the rollback.

## How this was read

On 2026-11-22, on macOS with OrbStack, against the deployment of Cota 0.1.0 that ADR-0028's proof brought up from the release, under a Compose project of its own: the image's build above, run as printed in a checkout of the commit that writes this recipe, then this page's upgrade to it, the deployment healthy on it, and the upgrade's rollback to 0.1.0 by its tag and digest. `cota`'s build and install above, run as printed with a throwaway home, printed its version. The first two blocks, installing with a build, are the install's own before Cota moved onto releases, which its rehearsal ran. Not run: Linux, `--all` copied to other machines, and an upgrade between two builds of your own.
