---
status: accepted
scope: repository
owner: limineol
last_verified: 2026-11-22
review_by: 2027-02-19
supersedes: []
code:
  - .github/workflows/release.yml
  - .github/workflows/binaries.yml
  - .github/workflows/ci.yml
  - tooling/release.ts
  - apps/cli/build.ts
  - docs/releases
---

# ADR-0027: A release is published by its tag alone: the hub image, `cota` for five systems and the deployment's files, with notes a person wrote

## Context

Cota has no release. An owner builds the hub image and `cota` from a checkout (`docs/install.md`), every version says `0.0.0`, and the two decisions that would publish them were left: ADR-0022 left publishing `cota`, signing it and `cota update` to milestone 5, and ADR-0024 left publishing the image ("a registry, its name, tags per version") to milestone 5's release slice, the owner's to start. The repository is public since 2026-11-21, so GitHub's runners cost its workflows nothing, and the public can now fetch whatever it publishes.

Three facts shape the answer. Each part of a release is public and cannot be taken back once someone has fetched it, so a release must be published by one act of the owner's, and by nothing a commit or a pull request does. An owner names the hub image in `.env` by tag and digest (ADR-0024), so what they read the digest from must be written after the image is pushed. And `cota` is cross-compiled by Bun on one system for five: a program that compiles is not one that starts, and macOS on arm64 kills a Mach-O whose signature does not cover it.

This records the release's shape, and how it is built.

## Decision

### What a release publishes

A **release** is one **version** of Cota, and publishes, all from the commit its tag names:

- **The hub image**, `ghcr.io/limineol/cota-hub:<version>`, for `linux/amd64` and `linux/arm64` (ADR-0024's two), tagged with the version alone. No `latest`: an owner names an image by tag and digest, and a tag that moves would name nothing a rollback could rely on. It is built with `COTA_VERSION` and `COTA_REVISION` set, which the Dockerfile's labels carry.
- **`cota` for the five systems of ADR-0022**, as downloads of the GitHub release, each named so its system takes it as it is, with nothing to unpack: `cota-darwin-arm64`, `cota-darwin-x64`, `cota-linux-x64`, `cota-linux-arm64` and `cota-windows-x64.exe`. `bun run cli:build -- --all` writes them under these names into `apps/cli/dist/`, so the names a release publishes are the build's own.
- **`compose.yaml` and `cota.toml`**, `deploy/compose.yaml` and `deploy/cota.toml` as they are at the tag, so that an install of a release needs no checkout, Git or Bun on the hub's machine.
- **`SHA256SUMS`**, beside them: the SHA-256 of each binary and of the two files, in the form `sha256sum -c` and `shasum -a 256 -c` read.
- **Build provenance** for every download and for the image, made by `actions/attest-build-provenance` in the workflow that built them, so that whoever wants to can check with `gh attestation verify` that a file or an image came from this repository's release workflow at that tag. GitHub keeps the attestations; nothing is pushed beside the image in the registry.
- **Its release notes** as the release's page (below), with the image's name and digest added.

No npm package, now or later in this milestone: `cota` is one file per system, which a package manager would only wrap.

### One version

Cota has one version for the whole repository. `apps/hub/package.json` and `apps/cli/package.json` state it (the hub reads its own for its quota readers' user agent, ADR-0016; `cota --version` prints the CLI's, bundled into the binary at its build), and the Dockerfile's default `COTA_VERSION`, which a build from a checkout labels its image with, is the same. They move together, in the pull request that makes a release, and the release's tag is `v` and that version. The first is `0.1.0`. A version is `<major>.<minor>.<patch>`: the release refuses a tag with anything after the patch, so there is no pre-release.

`tooling/release.ts` reads what a release needs of the repository: the versions agree, the version is of that form, and its release notes exist; given a tag, that the tag is `v` and that version. `tooling/release.test.ts` runs it on the repository as it stands, in `bun run test`, so a version moved without its notes, or moved in one manifest and not another, fails the pull request rather than the tag. `apps/hub/openapi.json`'s `info.version` is Effect's default for an API document, not Cota's version, and is left as it is.

### Release notes

A release's notes are written by a person, `docs/releases/<version>.md`, and reviewed in the pull request that moves the version. They say what Cota is in two sentences, what the release holds and what it does not, how to install it (the install prompt as it is at the tag), and what `docs/upgrading.md` tells an owner to look for: whether the release adds a step to the hub store, whether it changes ClickHouse's image, and whether it changes the Compose file, the configuration or `cota`, which the owner then replaces too.

They are a document under `docs`, so they carry ADR-0005's front matter and `docs:check` reads them: `active` while they are the latest release's, `archived` once a newer release's notes are written, in that release's pull request, since a published release is never changed and needs no review. The release's page is the notes without their front matter and title, followed by the hub image's name with its digest, which only the workflow knows: `bun tooling/release.ts page <tag> <image>` makes it.

### What starts a release

A tag `v<version>` pushed by the owner, or by someone else on the owner's word, on a commit of `main`, and nothing else. `.github/workflows/release.yml` runs on tags `v*.*.*` alone: it has no `workflow_dispatch`, and no push to a branch or pull request publishes anything. `ci.yml` builds the image and the binaries on every pull request and push to `main`, and publishes neither: the image is kept nowhere, and the binaries only as the run's artifact.

### The binaries, started on their systems

`.github/workflows/binaries.yml`, a reusable workflow that `ci.yml` and the release both call, builds all five on one Linux runner (`bun run cli:build -- --all`, as a checkout does) and then, on a runner of each system, downloads that system's binary and runs `cota --version`, which must print the version `apps/cli/package.json` states. Every pull request therefore shows that each cross-compiled binary starts where it runs; a release publishes the binaries that run started.

The runners, by GitHub's labels for its standard runners of public repositories (read on 2026-11-21 in GitHub's documentation, "GitHub-hosted runners", whose source is `data/reusables/actions/supported-github-runners.md` in `github/docs`): `ubuntu-24.04` (Linux x64), `ubuntu-24.04-arm` (Linux arm64), `macos-15` (macOS arm64), `macos-15-intel` (macOS on Intel) and `windows-2025` (Windows x64). Each is free for a public repository, so every system is run.

The macOS binaries are built on Linux too. Bun 1.4.2's documentation of executables says only how to sign one with `codesign` on a Mac, nothing of a signature when cross-compiling; its source says what it does: at the tag `bun-v1.4.2`, `src/exe_format/macho.rs` re-signs every arm64 Mach-O it writes with an ad-hoc signature over the whole file, the bundle included (`MachoSigner`, skipped only with `BUN_NO_CODESIGN_MACHO_BINARY`), whatever system it runs on. That signer was wrong in Bun 1.3.12, whose arm64 programs macOS killed at launch (oven-sh/bun#29120), and its fix (oven-sh/bun#29272) is in 1.4.2. If the `macos-15` job ever shows otherwise, the macOS binaries are built on a macOS runner instead.

### The release workflow

Each job has the least it needs; the workflow's default is `contents: read`, and no secret but the job's own `GITHUB_TOKEN` is used. Every action is pinned by commit, with its version beside it, as `ci.yml`'s are, and nothing from the tag's name or another field of the event reaches a shell line but through `env`.

| Job | Needs | Does | Permissions |
| --- | --- | --- | --- |
| `check` | | `bun tooling/release.ts check <tag>`; the tag's commit is an ancestor of `main`; no published release has the tag | `contents: read` |
| `binaries` | `check` | `binaries.yml`: the five built, each started on its system | `contents: read` |
| `image` | `check`, `binaries` | builds the image for both platforms with `COTA_VERSION` and `COTA_REVISION`, and pushes it as `ghcr.io/limineol/cota-hub:<version>`, signed in to the registry with the job's token; gives its digest | `contents: read`, `packages: write` |
| `attest` | `binaries`, `image` | `SHA256SUMS` of the binaries and the two files; provenance of each file it names, and of the image by its digest | `contents: read`, `id-token: write`, `attestations: write` |
| `release` | `check`, `image`, `attest` | the release's page, and the GitHub release of the tag with it, the five binaries, `SHA256SUMS`, `compose.yaml` and `cota.toml` | `contents: write` |

The image is pushed without buildx's own provenance attestation inside it: the image's provenance is GitHub's, and the index then holds only the two platforms' images. Its description is an annotation of the index, which is where the registry reads a multi-platform image's description from.

### The order of a release

1. **The release pull request** moves the version in both manifests and the Dockerfile, writes the release's notes (and archives the previous release's), and is reviewed like any other; its CI builds and starts what the tag will publish.
2. **CI is green on `main`** for the merged commit.
3. **The tag**: the owner pushes `v<version>` on that commit, or has it pushed on their word.
4. **The workflow** runs the jobs above in their order. Nothing is public until the `image` job pushes, and the GitHub release is made last.
5. **What is checked afterwards**: the release's page lists the eight downloads and gives the image's digest; the image's manifest lists both platforms under that digest; `sha256sum -c SHA256SUMS` passes on the downloads; `gh attestation verify` passes for a download and for the image; a downloaded `cota --version` prints the version; and the image is pulled without signing in to the registry. GitHub's documentation says a personal account's new package starts private: if this one does, the owner makes it public in its settings, which GitHub does not let be undone.

### When a release fails part-way

- **Before the `image` job pushes** (the check, a binary that does not start, a build): nothing is public. A failure of a runner is re-run; a fault in the repository is fixed on `main` by a pull request, and the tag, which nothing has fetched yet, is pushed again on the fixed commit.
- **After the image is pushed and before the GitHub release exists**: the image is in the registry, but no notes give its digest, so no owner names it. "Re-run failed jobs" runs `attest` and `release` again with the digest the `image` job gave, which a successful job keeps. Re-running the `image` job itself builds again and pushes a new digest under the same tag; that is acceptable only while no GitHub release exists, and the digest before is left untagged.
- **A `release` job that fails while uploading** may leave a draft release, since `gh release create` makes a release a draft while it uploads its files; the draft is deleted before the job is re-run.
- **Once the GitHub release is published**, it is never re-run or changed, its tag is never moved, and its image's tag is never pushed again: the `check` job refuses a tag whose release is published. A fix is a new patch version, with its own notes.

### Left

- **Signing `cota` for macOS and Windows.** Neither is signed with a developer's identity: the arm64 macOS binary carries Bun's ad-hoc signature, which lets it start, and macOS's and Windows's own checks may refuse or warn about a copy a browser downloaded. Signing needs an Apple Developer ID and notarization, and a Windows certificate, which cost money and are the owner's.
- **`cota update`.** Updating `cota` stays building it again, or, once the install moves onto releases, downloading the next release's binary.
- **An npm package**, or any other package manager's.
- **Moving the install and upgrade guides onto the published artifacts.** They must stay true at every commit, and nothing is published until a tag, so the next slice moves them against a real release.

> Amended by ADR-0028: the install and upgrade guides take the latest release, whose version a line of theirs finds by GitHub's `releases/latest`, so they name no version; updating `cota` is installing another release's binary the same way. A release's notes, under how to install it, say that the prompt installs that release rather than the latest with `VERSION` set to it.

## Alternatives weighed

- **Building the macOS binaries on a macOS runner.** It would be needed if Bun did not sign a cross-compiled arm64 program. Bun 1.4.2 does, and the `macos-15` job is what shows it on every pull request; one Linux runner building all five keeps one build for every system and the build a checkout makes.
- **`workflow_dispatch`, or publishing from `main`.** A button or a merge is easier to press by mistake than a tag is to push, and neither names the version it publishes. A tag is the one act that says which commit and which version.
- **A `latest` tag on the image.** It is what `docker pull` takes without a tag, but it moves with every release, and ADR-0024 names an image by tag and digest so that the image a rollback starts is the one it ran.
- **Notes generated from the commits.** Commits say what changed in the code; an owner needs to know what to do before an upgrade, which a person writes and a reviewer reads.
- **The notes written on GitHub's release page.** Not reviewed, not in the repository, and lost to `docs:check` and to anyone reading a checkout.
- **`docker/login-action` and `docker/build-push-action`.** Two more actions to pin and trust for what two commands do; `ci.yml`'s image job already builds with `docker buildx build`.
- **Pre-release versions** (`0.1.0-rc.1`). Nothing needs one yet: the release pull request's CI builds and starts everything a tag publishes.

## Consequences

- `ci.yml` gains the `binaries` job, so every pull request runs a runner of each of the five systems; its `image` job is unchanged.
- ADR-0022's "Left to milestone 5" and ADR-0024's "In CI" are amended by this record.
- `apps/hub/package.json`, `apps/cli/package.json` and the Dockerfile move to `0.1.0`, and `docs/releases/0.1.0.md` is written. Nothing was published until `v0.1.0` was pushed.
- `bun run cli:build -- --all` writes `apps/cli/dist/cota-<system>-<arch>` (with `.exe` for Windows) in place of `apps/cli/dist/<target>/cota`.
- Until the guides move onto a release, `docs/install.md` and `docs/upgrading.md` build from a checkout, as they say.

### Facts to confirm when built

What was found on 2026-11-21, before any tag:

- **Confirmed on a Mac (Apple silicon)**: `bun run cli:build -- --all` builds the five; `cota-darwin-arm64` starts and prints its version, and `codesign -dv` shows it `adhoc,linker-signed`. That Mac compiles for its own system, so it does not show a Linux runner's cross-compiled binary starting: the `macos-15` job does.
- **Found on that Mac: `cota-darwin-x64` carries the signature of Bun's own runtime** (a Developer ID, with the hardened runtime), which no longer matches the file once the program is in it (`codesign --verify`: "invalid signature"); Bun 1.4.2 re-signs arm64 programs only. It started under Rosetta all the same. Whether macOS on an Intel Mac starts it is what the `macos-15-intel` job shows; if it does not, the answer is the same as for arm64: an ad-hoc signature (`codesign --force --sign -`) on a macOS runner.
- **Not yet run, then**: the `binaries` workflow on GitHub's runners, and every job of the release workflow, which only a tag starts. How the registry links the first image to the repository and the package's visibility were read in GitHub's documentation, not run.

What the first release showed, on 2026-11-21:

- **The binaries start on their systems.** On GitHub's runners, in CI and in the release, each of the five built on Linux printed its version on its own system: `macos-15` and `macos-15-intel` among them, so the x64 Mach-O that keeps Bun's own signature starts on an Intel Mac, and `windows-2025`.
- **`v0.1.0` published [Cota 0.1.0](https://github.com/limineol/cota/releases/tag/v0.1.0)**, every job passing at its first run: the eight downloads, and the image as `ghcr.io/limineol/cota-hub:0.1.0@sha256:bc6b181c6e570123351b951bd4115b04f09086c699ffb99938864d4d2f58722a`.
- **Checked afterwards, from a Mac that was not signed in to the registry**: `shasum -a 256 -c SHA256SUMS` passed on the seven files; the downloaded `cota-darwin-arm64` printed `0.1.0`, and `codesign -dv` showed it `adhoc,linker-signed`; the registry gave the image's index to an anonymous token, its digest the one the release's page gives, with `linux/amd64` and `linux/arm64` and the description as its annotation; `gh attestation verify` passed for a binary, for `compose.yaml` and for the image.
- **The package was public from its first push**, without the owner changing its settings: an image a workflow of a public repository pushes with its `GITHUB_TOKEN` took the repository's visibility. The check of step 5 stays, since GitHub's documentation says otherwise.
- **Not run**: a re-run after a failure part-way, since none failed; `docker pull` itself, on either platform (the manifest was read from the registry's API); and `sha256sum -c` on Linux.
