---
status: active
scope: repository
owner: limineol
last_verified: 2026-11-21
review_by: 2027-02-19
supersedes: []
code:
  - tooling/verify.ts
  - tooling/laws.ts
  - tooling/mutants.ts
  - tooling/mutants.table.ts
  - proofs
  - deploy/deployment.slow.test.ts
---

# How Cota is verified

For a contributor: what the gates are, what each shows, and what none of them does. Which gate a change needs is `AGENTS.md`'s Gates table, and every command is in its Commands table.

```sh
bun run verify
```

`verify` runs every gate below, in order, and writes what it ran and what it found to `evidence/<time>-<commit>/report.md`: each gate's exit code and time, each law with the tiers its spec claims and whether they ran and passed, and each mutant's verdict. A recent run took about 21 minutes on an Apple silicon Mac, nearly two thirds of it the mutants.

## Laws

A promise Cota makes for every input is a **law**: one plain sentence in its concept's spec, with an id, such as F1, *a request without a login is kept, whatever was refused before it*, or Y5, *with `COTA_BIND` unset, the hub is published on 127.0.0.1 alone, and ClickHouse on no port of the host*. The specs in `docs/specs` hold about 245 of them. Each says which tiers hold it, and `verify` fails a law whose tier did not run or did not pass, and a tier a spec names that does not exist (`tooling/laws.ts`). A test holds a law by its title, which begins with the law's id.

The tiers, from the test's file name:

| Tier | Holds a law by | Gate |
| --- | --- | --- |
| `types` | the type checker | `bun run check` |
| `property` | property tests of the shipped code over generated inputs, with the test clock at generated times | `bun run test` |
| `replay` | recorded provider exchanges played through the real hub | `bun run test` |
| `contract` | calls to the API of a whole hub, in process | `bun run test` |
| `clickhouse` | the request log's queries and writes against a real ClickHouse | `bun run test:clickhouse` |
| `slow` | tests that need Docker or minutes: the deployment's, and the evals' scripted runs | the slow tier, below |
| `proof` | a machine-checked proof over a model | `bun run prove` |
| `agreement` | the shipped code and the proved model giving the same answers | `bun run test`, `bun run prove:models` |

## Proofs

Where Cota decides who pays (whether a request is diverted, and to which pool), a law is also proved in [Bend 2](https://github.com/bendlang/bend) over a small model of the decision, in `proofs/fallback`. `bun run prove --verdict` rechecks each proof with a kernel whose soundness is proved in Lean 4. Bend compiles the proved model to JavaScript, which is committed; `bun run prove:models` fails when the committed copy is not what the compiler makes; and the agreement tests run generated histories through both the model and the real service and require the same answer. A proof covers the model and nothing else, the agreement tests are what tie it to the code, and Bend's front end is not proved: [`proofs/README.md`](../proofs/README.md) and [ADR-0004](adr/ADR-0004-verification.md) say exactly what a pass establishes.

## Recorded exchanges

Each provider's wire format is held by exchanges: provider traffic recorded through the hub and scrubbed, or written from a provider's documents, in `apps/hub/src/shared/05-tests/replay/exchanges` (31 of them). The replay test plays each through the real hub against a fake provider, whole and cut into chunks, and checks what the hub sent, what it answered and what it logged. The scrubber, which is all that stands between recorded traffic and this repository, has its own law and mutants. [ADR-0008](adr/ADR-0008-recorded-exchanges.md) says how an exchange is recorded, and the exchanges' README how to record one.

## Mutants

```sh
bun run mutants
```

A check nobody has seen fail proves nothing. `bun run mutants` breaks the shipped code in about 740 named ways (`tooling/mutants.table.ts`), each against the test that should notice, and fails when a break goes unnoticed, no longer applies because the code moved, or does not type-check. ADR-0004 asks for one for each law. It runs every property from one seed, so a verdict does not change from run to run.

## The dashboard's stories

```sh
bun run stories
```

Every story of `apps/web` and `packages/ui` runs as a test in Playwright's Chromium, once in the light theme and once in the dark: a render error, a failed play function or an accessibility violation found by axe fails it. Each screen has a story per state that matters, fed by constructed fixtures, never by real traffic.

## The slow tier and the evals

```sh
bun run test:evals
```

The slow tier (`*.slow.test.ts`) needs Docker, the ClickHouse of `bun run test:clickhouse`, Playwright's Chromium, and several minutes. It holds:

- **The deployment.** `deploy/deployment.slow.test.ts` builds the hub image from the working tree, brings a deployment up from nothing under a Compose project of its own, sends a request through a fake provider and finds it in the request log, keeps the request log and the hub store across `down` and `up`, runs the deployment spec's upgrade and rollback blocks as written, and finds that ClickHouse never starts without its password. It removes everything it made.
- **One rehearsal of the install eval, one scripted run of the memory evals, and the design eval's harness**, below.

The evals are not gates of every commit. Each also has a run with a real coding agent, which spends a subscription and is run on purpose.

### Design evals

```sh
bun run evals:design
```

The design eval asks a coding agent to build a screen of the dashboard twice, in two scratch copies of the repository: one as it is, one as if `DESIGN.md` had never been written. It scores each run (the check, the design lint, its stories) and has a blind judge say, rule by rule, whether the run followed `DESIGN.md`; the report, in `evals/design/reports`, says which rules the document changed. It needs Claude Code (`claude`) or Codex (`codex`) signed in, spends their subscription, and is never run by `verify`. `--tasks pool,keys`, `--arms with,without`, `--repetitions 3`, `--runner claude|codex` and `--model <id>` choose what is run (by default every task, both arms, once, with Claude Code at `claude-sonnet-5-5`), and `--judge-only <report folder>` scores and judges a report's kept patches again. The slow tier checks that both copies are made as they should be and replays two kept patches through the scores, screenshots and a scripted judge. One run has been made, of one task with one run an arm: it proved the path and showed nothing yet about the rules. [The design evals spec](specs/design-evals/spec.md) says what is measured and what it does not show.

### Install evals

```sh
bun run evals:install
```

The install eval follows [`install.md`](install.md) in a world of its own: two clean Ubuntu containers, `studio` and `laptop`, and a fake provider, in a Compose project named `cota-install-<run>` that it removes whole when it ends. The rehearsal does what the prompt says, taking each command from the prompt's own blocks; a scripted owner answers its questions and does the owner's steps (the keys, the Setup screen, the machine login, the routes, the crontab), with fakes. `studio`, the hub's machine, has a Docker engine of its own inside it, where the prompt's `docker build` and `docker compose` run the deployment. It then reads whether the install is done: doctor on each machine, a request from each launched client in the request log with its project and the pool its route names, each title reported, the routes, no secret in a command or anything printed, and nothing of the owner's changed but Cota's part. The report is written to `evals/install/reports`. It needs Docker and a few minutes, runs no real client, contacts no provider, and runs in the slow tier.

```sh
bun run evals:install -- --installer claude
```

makes Claude Code the installer, on this machine with the login it already has: a headless `claude` whose only tools run a command in one of the world's machines and send the owner a message, and which is refused before its first turn if it has any other. A small model plays the owner, and the owner's steps are the same code with fakes. It spends your subscription, up to `--budget-usd` (5) for the installer and `--owner-budget-usd` (0.5) for the owner, and stops at 30 minutes and `--turns` (200); `--model` and `--owner-model` choose the models (`claude-sonnet-5-5` and `claude-haiku-5-5`). Its own transcript is kept beside the report. Of its eight runs so far, three passed every criterion, the last on the deployment; the spec's Results say why each other failed. [The install evals spec](specs/install-evals/spec.md) says what it shows and what it does not.

### Memory evals

```sh
bun run evals:memory
```

The memory eval asks questions about past work whose answers are in a request log of known content: eleven constructed sessions in four projects on three machines, written into a scratch database of the ClickHouse of `bun run test:clickhouse`, read by a hub of its own, and a machine that keeps that hub's reader key. Each question is answered through the memory skill (`skills/cota-memory/SKILL.md`), whose commands are `cota memory get`, `cota memory sql` and `cota memory transcript`, and each answer is scored by code: right, wrong, missed (an honest "not there" where something is), or leaked, when it holds a secret of the world. The scripted answerer takes every command from the skill's own blocks, so it shows the commands, as written, find each answer; it does not show that an agent would choose them. It runs no real client, contacts no provider, drops what it made, and runs in the slow tier. The report is written to `evals/memory/reports`.

`bun run evals:memory -- --answerer claude` makes a headless Claude Code the answerer, whose one tool runs `cota memory` in the world's machine; it spends your subscription, up to `--budget-usd` (0.5) and `--turns` (30) a question, with `--model` (`claude-sonnet-5-5`). No run of it has been made yet. [The memory evals spec](specs/memory-evals/spec.md) says what it shows and what it does not.

## Where it has run

Every gate, on one Mac (Apple silicon, macOS, OrbStack for Docker), and in the repository's CI workflow (`.github/workflows/ci.yml`, which runs `verify` with the proofs rechecked, builds the hub image for both platforms, and builds `cota` for its five systems and starts each on a runner of its own system), on GitHub's Linux runners, for every pull request and push to `main`. The deployment's test has run under OrbStack and on a runner's Docker Engine; the install eval's world runs a Docker engine inside an Ubuntu container on either.

## What it does not show

- **That real providers answer as the exchanges say today.** The exchanges are recordings and documents; a provider that changes its wire format is found by its clients first.
- **That the quota logins work against the real sign-ins.** The connect script has run only against fakes of Claude Code, Codex and the macOS keychain.
- **Windows, Linux outside a container, Docker Desktop, amd64.** None has run anything.
- **That an agent would always install Cota, or use the memory skill well.** The rehearsal and the scripted answerer show the commands work as written; the agent runs are few.
- **That a property holds for every input.** Property tests sample; only the fallback laws are proved, and only of their model.
