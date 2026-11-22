---
status: accepted
scope: repository
owner: limineol
last_verified: 2026-11-22
review_by: 2027-02-20
supersedes: []
code:
  - docs/install.md
  - docs/upgrading.md
  - docs/recipes/a-build-of-your-own.md
  - evals/install/world.ts
  - evals/install/world/machine.Dockerfile
  - evals/install/world/release.ts
  - evals/install/rehearsal.ts
---

# ADR-0028: The install and the upgrade take the latest release, found once, checked and pinned; a build of your own is a recipe

## Context

Cota 0.1.0 is published (ADR-0027): the hub image `ghcr.io/limineol/cota-hub:0.1.0` for both platforms, `cota` for five systems, `compose.yaml`, `cota.toml` and `SHA256SUMS`. The install prompt (`docs/install.md`) and the upgrade guide still build the image and `cota` from a checkout, so every machine needs Git and Bun and a checkout of Cota, and the hub's machine builds an image for minutes that the release already holds. ADR-0027 left moving them onto a release to the slice after the first one was published, since a guide must be true at every commit and nothing could be fetched before a tag.

Four facts shape the answer. A guide in the repository is read at every commit, so one that names a version is wrong from the next release on, and every release would have to edit it. An agent runs a guide one block at a time, each in a shell of its own (the install eval's tools and its rehearsal do the same), so a shell variable does not outlive the block that set it. The hub image is named in `.env` by tag and digest (ADR-0024), and a tag can be pushed again while a digest cannot. And the install eval follows the prompt as written in a world of containers (`docs/specs/install-evals/spec.md`), which must keep testing the tree it runs in, not whatever release is public.

## Decision

### The guides name no version

The install and the upgrade take the latest release. A line of the guide finds its version, which GitHub gives by sending `https://github.com/limineol/cota/releases/latest` on to that release's page, `…/releases/tag/v<version>`:

```sh
VERSION="$(curl -fsSLI -o /dev/null -w '%{url_effective}' https://github.com/limineol/cota/releases/latest | sed 's|.*/tag/v||')"
```

Every later step names that one version: `https://github.com/limineol/cota/releases/download/v<version>/<file>` and `ghcr.io/limineol/cota-hub:<version>`. So the guides are true at every commit, no release edits them, and one install never mixes two releases. Since a variable dies with its block, the install prompt runs the line as written once, in the hub's step that gets the release, and says that every later block that begins with it, on every machine, takes the version found in its place (`VERSION=<version>`); a block run as written instead finds the latest again, which is the same release unless one was published meanwhile. The same substitution is how a guide names another release than the latest. The upgrade guide is for the owner's own terminal, one shell for its steps in order, and finds the version once.

The guide on `main` installs the latest release, so a change to the guide that needs something no release holds yet waits for the release that holds it.

### The hub's machine

It needs Docker with Compose, `curl`, and to reach `github.com` and `ghcr.io`; nothing of Cota's source, no Git and no Bun.

1. **The release's files.** `compose.yaml`, `cota.toml` and `SHA256SUMS` are downloaded into a temporary folder and checked with `shasum -a 256 -c` where the system has `shasum`, else `sha256sum -c`, given only the lines of the two files downloaded. `shasum` comes first because macOS's own `sha256sum` (`/sbin/sha256sum`) exits 0 when given no line, or a line it cannot read; GNU's and `shasum` exit 1. A check that fails stops the block before anything reaches the hub directory; then `compose.yaml` is copied there and `cota.toml` under `umask 077`.
2. **The hub image** is pulled by its tag, `docker pull ghcr.io/limineol/cota-hub:<version>`, and `.env` names it by tag and digest, the digest read from what was pulled: the image's `RepoDigests` entry for `ghcr.io/limineol/cota-hub`. The line is `COTA_HUB_IMAGE=ghcr.io/limineol/cota-hub:<version>@sha256:<digest>`, the form `compose.dev.yaml` and `deploy/compose.yaml` already give ClickHouse's image: Compose starts the image by its digest and never pulls it again, `docker compose ps` lists it by that name, and the rollback, which puts back the `.env` before, starts the image before by its digest. A deployment is pinned to the bytes it first ran, whatever is later pushed under the tag.
3. **What the owner may check, not a step.** The release's page gives the image's digest, which is the one in `.env`; `gh attestation verify <file> --repo limineol/cota`, or with `oci://ghcr.io/limineol/cota-hub:<version>`, shows that a download or the image was built by the release workflow at that tag (ADR-0027). The prompt says both and runs neither: an agent has no reason to hold a GitHub login.

### Each machine

`cota` is the release's file for the system, `cota-<system>-<arch>` with the system from `uname -s` lowercased and the architecture from `uname -m`, `x86_64` written `x64` and `aarch64` written `arm64` (macOS says `arm64` already): `cota-darwin-arm64`, `cota-darwin-x64`, `cota-linux-x64`, `cota-linux-arm64`, the names `bun run cli:build -- --all` writes. It is downloaded with `SHA256SUMS` into a temporary folder, its line checked as the hub's files are, and installed with `install -m 0755` as `~/.local/bin/cota`, where the install put it before; the block ends by running `~/.local/bin/cota --version`. Downloaded by `curl`, a macOS binary carries no quarantine attribute, so Gatekeeper does not stop it. Windows stays as the prompt treated it: in words, `cota-windows-x64.exe` downloaded and checked against `SHA256SUMS` (PowerShell's `Get-FileHash`) and copied to `%LOCALAPPDATA%\Programs\cota\cota.exe`. No Bun, no Git, no checkout.

Updating `cota` is installing another release's the same way. `cota update` stays left (ADR-0027).

### The upgrade

The upgrade guide moves the same way: find the version and read its release notes first; pull its image while the hub still runs; download its `compose.yaml`, checked, and compare it with the hub directory's; keep `.env` and the store as before; name the new image by its tag and the digest of what was pulled; start it; and, where the notes say `cota` changed, install the release's on each machine. The way back is what it was: the image before, by the `.env` before, and the store before.

### A build of your own

Running a commit no release holds stays possible and written down, as a recipe (`docs/recipes/a-build-of-your-own.md`): the image built from a checkout and named `cota-hub:<commit>` in `.env`, the Compose file and configuration copied from the checkout's `deploy/`, `cota` built with `bun run cli:build` and installed as `~/.local/bin/cota`, and its upgrade the guide's with a build in place of a pull. It is the owner's, as every recipe is (ADR-0024's Not Cota's): the guides and their eval follow releases.

### The install eval's world stands in for the release

The rehearsal follows the prompt as written, and what it installs is the working tree. On the world's network:

- **`ghcr.io` is a registry of the world's** (Distribution's `registry` image, by digest), holding the tree's own hub image as `ghcr.io/limineol/cota-hub:<the tree's version>`. The image is built on the host from the working tree as `cota-install-hub:<run>`, saved into the run's folder, and before the installer starts it is loaded into the hub's machine's engine, pushed to the world's registry and removed again, so that the prompt's pull is the first to bring it, by its tag, with the digest it was pushed under.
- **`github.com` is a server of the world's** (`evals/install/world/release.ts`, in Bun's image), serving the tree's own build as that version's release: `releases/latest` sent on to `releases/tag/v<version>`, and under `releases/download/v<version>/` the `cota` of the world's machines (built on the host from the working tree for Linux on the host engine's architecture), `deploy/compose.yaml` and `deploy/cota.toml` as `compose.yaml` and `cota.toml`, and their `SHA256SUMS`.
- **Both answer `https`** with a certificate of the run's CA, which the machines' `curl` trusts through the system's store (the CA added with `update-ca-certificates` when the world starts) and the hub's machine's Docker engine through `/etc/docker/certs.d/ghcr.io/ca.crt`: the world's own plumbing, as the hub's trust of the fake provider is (`COMPOSE_FILE`'s world file), never a step of the prompt.

The clean machines lose the checkout and its bundle, and Bun leaves the owner's `PATH`: the world's own copy of it is at `/usr/local/lib/cota-install/bun`, which the stand-in clients and the eval's own reads of a machine run, so a block of the prompt that needed Bun would fail. Git stays: the owner's projects are repositories, whose `origin` `cota` reads with `git` to name a launch's project. The tree under test is the working tree, its uncommitted changes included, which the report says; the prompt is read from it too. Every new image is pinned by digest, nothing is published to the host, the host's Docker socket is mounted into nothing, and the world removes all it made, the host's `cota-install-hub:<run>` included.

### The deployment's slow test

It keeps testing the working tree's image, which it builds and tags itself. The deployment spec's upgrade block, which the test runs as written, starts once the new image is on the machine: getting it (a pull from a release, or a build of your own) comes before the block and is not what the test runs; naming it in `.env` (the line the test does itself) and starting it is.

## Alternatives weighed

- **The version written in the guides, moved by each release's pull request.** One more file each release must change, a guide wrong for anyone reading it at an older commit, and nothing the latest redirect does not give.
- **GitHub's API for the latest release** (`api.github.com/repos/limineol/cota/releases/latest`). It needs JSON read without `jq`, and anonymous calls are limited per address; the redirect is a plain `HEAD` that `curl` follows.
- **A `latest` tag on the image, or `releases/latest/download/<file>`.** Each moves on its own, so the files and the image of one install could come from two releases; one version found once names all of them.
- **The version kept in a file between blocks.** The hub's machine has the hub directory for it, but the other machines have nothing of the hub's until they join, and a file left behind is one more thing the `untouched` criterion must allow.
- **The image named by tag alone, or by digest alone.** By tag, a deployment runs whatever is pushed under it next and a rollback names nothing fixed; by digest, `.env` and `docker compose ps` no longer say which version runs. Both, as ClickHouse's is named.
- **`sha256sum -c --ignore-missing` on the whole `SHA256SUMS`.** GNU's flag; macOS's `sha256sum` and `shasum` differ on it, and an empty check passes on macOS. The lines of the files downloaded, given to `shasum` first, fail the same way everywhere.
- **The eval against the real release.** It would test what is published, not the tree that changes the prompt, and need the internet for every byte; the world's release is the tree's own build behind the same names.
- **The world's image built inside the hub's machine.** It is what the prompt did before; building on the host uses the host's cache, and the hub's machine's engine then starts with no image of Cota's, as an owner's does.

## Consequences

- `docs/install.md`'s question 1 asks for Docker, `curl` and GitHub, and no longer for Git, Bun or a checkout; question 4 asks that each machine reaches `github.com` with `curl`. Its steps are the hub directory, the release, the secrets, `.env` and the pools, the start, the hand-over; and on each machine the release's `cota`. The README's install line gives the prompt's address on GitHub, since no checkout holds it.
- The quota logins' connect script and the memory skill are not part of a release: giving a quota login still needs a checkout of Cota with Git and Bun on one machine, and the skill is copied from a checkout. Each says so where it is described.
- A release's notes say how to install it: the prompt, with `VERSION` set to that release to install it rather than the latest.
- `docs/upgrading.md` and the deployment spec's upgrade step pull and name an image by tag and digest; the recipe of a build of your own holds what they did before. ADR-0022's Left, ADR-0024's image build, upgrade and install prompt, and ADR-0027's Left are amended by this record.
- The install evals spec's world gains the registry and the release server, and its clean machines lose the checkout and Bun on the owner's `PATH`; the rehearsal knows the prompt's new blocks and puts the version the hub's step found into every later block that finds it.

### Facts to confirm when built

What was run on 2026-11-22, by hand, on a Mac (Apple silicon, macOS 27.2) with OrbStack (Docker 29.4.0, its containerd image store, Compose v5.1.2), against the real Cota 0.1.0: the hub part of `docs/install.md` as written, its blocks taken from the file, in a throwaway home under a scratch folder, under the Compose project `cota-docs-release`, published on loopback at a free port, with a made-up `openai-chat` pool that calls nobody; Docker given an empty configuration, so that the pull was anonymous and no credential helper ran. It was the first `docker pull` of the release.

- **The redirect**: `releases/latest` went on to `https://github.com/limineol/cota/releases/tag/v0.1.0`, so the line found `0.1.0`.
- **The release's files**: `compose.yaml: OK` and `cota.toml: OK` from `shasum -a 256 -c`. On that Mac `/sbin/sha256sum -c` passed an empty list and a list of one unreadable line, each exiting 0; GNU's, in Ubuntu 24.04, refused the empty list with 1.
- **The image**: pulled in about a minute, `Digest: sha256:bc6b181c6e570123351b951bd4115b04f09086c699ffb99938864d4d2f58722a`, the release's. Its `RepoDigests` was that one entry, `ghcr.io/limineol/cota-hub@sha256:bc6b181c…`, which under the containerd store is also its id; `.env`'s line became `COTA_HUB_IMAGE=ghcr.io/limineol/cota-hub:0.1.0@sha256:bc6b181c6e570123351b951bd4115b04f09086c699ffb99938864d4d2f58722a`.
- **The hub**: `docker compose up -d --wait` pulled nothing and brought both services healthy; `/health` answered `{"status":"ok"}`, the log said `cota hub listening … with pools proof (openai-chat)` and the setup line, `/` answered the dashboard's HTML, and `docker compose ps` listed the hub's image by its tag and digest.
- **`cota` for that Mac**: the machine's block chose `cota-darwin-arm64`, printed `cota-darwin-arm64: OK`, and `~/.local/bin/cota --version` printed `0.1.0`; `codesign -dv` showed it `adhoc,linker-signed`, and it had no quarantine attribute.
- **The upgrade and the rollback**: `docs/upgrading.md`'s blocks, from 0.1.0 to 0.1.0, ran as written on that deployment, and so did its rollback; then the recipe of a build of your own: an image built from this commit, the upgrade to it (the hub healthy on `cota-hub:<commit>`), and the rollback to 0.1.0, which recreated the hub on `ghcr.io/limineol/cota-hub:0.1.0@sha256:bc6b181c…`. `docker pull` of the `.env` name, tag and digest together, answered that the image was up to date.
- **Provenance**: `gh attestation verify --repo limineol/cota` passed for the downloaded `compose.yaml`, for `cota-darwin-arm64`, and for `oci://ghcr.io/limineol/cota-hub:0.1.0`, and failed for a file the release does not hold.
- The project was then removed with `docker compose down --volumes`, and the folder with it.

Not run: Docker Desktop; the image pulled on amd64 or by Docker Engine on a real Linux machine (the install eval's world pulls the tree's image from its own registry, inside a Linux container); `cota` downloaded on Linux outside a container, on an Intel Mac, or on Windows; and an agent following the new prompt.
