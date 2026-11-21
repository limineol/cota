---
status: active
scope: evals/install
owner: limineol
last_verified: 2026-11-19
review_by: 2027-02-18
supersedes: []
code:
  - docs/install.md
  - evals/install/tasks.ts
  - evals/install/world.ts
  - evals/install/world/machine.Dockerfile
  - evals/install/world/provider.ts
  - evals/install/world/stand-ins
  - evals/install/installer.ts
  - evals/install/owner.ts
  - evals/install/document.ts
  - evals/install/rehearsal.ts
  - evals/install/agent.ts
  - evals/install/tools.ts
  - evals/install/client.ts
  - evals/install/model-owner.ts
  - evals/install/fixtures/claude.ts
  - evals/install/observe.ts
  - evals/install/criteria.ts
  - evals/install/report.ts
  - evals/install/runs.ts
  - evals/install/evaluation.ts
  - evals/install/harness.ts
  - tooling/mutants.table.ts
---

# The install evals

Milestone 4 is shown working by an agent installing Cota in clean containers from the install prompt (`docs/install.md`) alone. An **install eval** (`CONTEXT.md`) is one such run: an **installer** is given the prompt, the machines of a **world** and an owner, for one **install task**; when it says it is done, the eval reads its **criteria** and writes a report. The installer is behind a port with two kinds: the **rehearsal**, scripted, with the **scripted owner**; and the **agent installer**, a headless Claude Code on the host, with the **model owner**. The owner decided on 2026-11-18 that the agent runs on the host with the login it already has, acting only inside the world, and spends the owner's subscription, up to $15 for its first runs.

**Status.** Active. The world, both owners, the port, both installers, the criteria and the report are built. On milestone 4's prompt the rehearsal passed every criterion of the one task (`studio-and-laptop`) in about a minute and a half. Milestone 5a moved the prompt's hub onto the deployment (`docs/specs/deployment/spec.md`) and gave the hub's machine a Docker engine of its own; on that prompt the rehearsal passed every criterion twice in a row, in about two minutes each, world included (the hub's image built in the hub's machine, and the deployment's images downloaded there). What the agent installer's runs have shown is in Results, below.

## One install eval

1. The world is made (The world, below), and each machine's home is read.
2. The installer is given the prompt (`docs/install.md` of the commit under test), the machines and the owner, and acts until it says it is done, fails, or reaches a limit: 30 minutes for any installer, and for the agent installer a number of turns and a spend. An installer stopped at a limit fails `ended`, which names the limit; it is never an error of the eval.
3. The criteria are read: the title reporter's schedule is given up to 150 seconds to send each launch's title, and then the rest is read.
4. The world is removed whole (`docker compose down --volumes --remove-orphans`), on every path: a pass, a failure, an error of the eval itself, and an interrupt (`SIGINT`, `SIGTERM`), which removes it and exits 130.
5. The report is written.

The commit under test is `HEAD`; a working tree with changes runs without them, and the report says so.

## The task

An install task (`evals/install/tasks.ts`) is the owner's words, as they would answer the prompt's "Ask the owner first", and the same answers set out: the hub's machine and its address and whether plain `http` is accepted, the owner's ClickHouse, the pools (with each fallback and kept login), the machines with their clients, projects and machine logins, the routes of Claude Code and Codex, and the launches the owner makes once it is done, each with the project and pool its request must have. The one task, `studio-and-laptop`: the hub on `studio`, its deployment published on every interface there (`COTA_BIND=0.0.0.0`) and reached at `http://studio:8080`, plain `http` accepted, with the deployment's own ClickHouse (the owner runs none); pools `work` (Claude, falling back to `personal`), `personal` (Claude, with a kept login), `chatgpt` and `zai`; `studio` and `laptop` with Claude Code and Codex, `laptop` with a machine login for `work`; `acme/*` on `work`, the rest on `personal`, Codex on `chatgpt`; a launch in `acme/api` on `laptop` (billing `work` through its machine login) and in `notes` on `studio` (billing `personal` with Claude Code's own login).

## The world

One Compose project per run, `cota-install-<run>`, written as JSON beside the run's certificates in the system's temporary directory and removed with it.

- **The clean machines**, one per machine of the task, of the image `cota-install-machine` (`evals/install/world/machine.Dockerfile`, its target `machine`): Ubuntu 24.04 with `ca-certificates`, `cron`, `curl`, `git`, `openssl` and `procps`, and Bun 1.4.2 from its image, each base pinned by digest; a user `owner` (uid 1000, `/bin/bash`), without root; cron running. When the world starts, each is given the stand-ins of its task's clients in `/usr/local/bin` (`evals/install/world/stand-ins`), a checkout of the commit at `~/cota` (a git repository fetched from a bundle of it, so that the prompt's `git rev-parse` names the commit, and as shallow as the clone the eval runs in), Codex's `config.toml` with the owner's own lines, and the owner's projects as git repositories with their `origin`. Its host name is its name in the task. Every command runs as `owner` in `bash -c`, with `HOME`, `USER`, `SHELL=/bin/bash` and `LANG` as a terminal of theirs has them. The image stays between runs, as a base image does; it holds nothing of Cota.
- **The hub's machine** is of the image `cota-install-hub-machine`, the same machine with `iptables` and Docker's static binaries (the engine, its CLI, Compose and Buildx) from `docker:29.9.2-dind`, pinned by digest (the target `hub`). Its own Docker engine starts with it, keeping its data in a volume of the run, and the owner is in its `docker` group, as on a developer's machine with Docker. It is the world's one privileged service, which an engine inside a container needs. The host's Docker socket is mounted into nothing: the world never reaches a container of the host's, and the deployment's containers are the hub's machine's own. The engine downloads the images the deployment needs (Bun's two, as the Dockerfile names them, and ClickHouse's) when the prompt needs them: given from the host's cache by `docker save` and `docker load`, they were not found by the digests that name them, since a loaded image has no repository digest, so the world gives none.
- **The stand-ins.** `claude` records its arguments and directory in `~/.stand-ins/claude.jsonl`, and with `-p <message>` sends one message to `$ANTHROPIC_BASE_URL/v1/messages` with the headers of `ANTHROPIC_CUSTOM_HEADERS`, a session in `x-claude-code-session-id`, and `CLAUDE_CODE_OAUTH_TOKEN` or its own login (a fake) as its credential, then writes a transcript with an `ai-title` where Claude Code keeps them. `codex` records its arguments and ends. Each is a script in `/usr/local/lib/stand-ins`, linked to from `/usr/local/bin`, as npm installs a client, so that doctor takes it for the client and not for another gateway's wrapper script.
- **No ClickHouse of its own.** The deployment's, in the hub's machine's engine, holds the request log, with the password the installer made; the criteria read it there, as root on that machine, through the container Compose labels as the project `cota`'s `clickhouse`. The world never uses `cota-dev`'s.
- **The fake provider** (`evals/install/world/provider.ts`), a Bun server in Bun's image that answers a message to the Messages API as Anthropic does, and anything else with a 404. On the world's network it is every provider's host name (`api.anthropic.com`, `console.anthropic.com`, `platform.claude.com`, `claude.ai`, `chatgpt.com`, `api.openai.com`, `auth.openai.com`, `api.z.ai`, `opencode.ai`, `openrouter.ai`, `models.dev`), as network aliases, and answers `https` with a certificate of a CA made for the run, which the machines trust through `NODE_EXTRA_CA_CERTS`, and so does the hub's container: on the hub's machine `COMPOSE_FILE` names, beside the hub directory's `compose.yaml`, a Compose file of the world's (`/etc/cota-install/compose.world.yaml`) that gives the `hub` service that variable and the CA, read-only. So the hub is configured as the prompt says, with no address of the eval's in it, and what it forwards never leaves the world. Before the installer starts, each machine fetches every one of those names and must reach the fake provider, and so must a container of the hub's machine's engine on a network of its own, as the deployment's are, or nothing runs.
- **The network** is the project's default one. Nothing is published to the host, so runs never collide. It reaches the internet, which `bun install` needs.

What this world differs in from a developer's machine, and why:

- **The hub's Docker engine is inside its machine**, privileged, and starts with no image, so each run downloads the deployment's.- **No systemd user session.** `cota` cannot schedule the title reporter; the owner's crontab runs it, the prompt's branch for such a system.
- **No `ssh` between machines.** A machine other than the hub's joins by the owner typing the keys, the prompt's other branch.
- **The providers are the fake provider**, by their names, and the machines and the hub's container trust its CA; the hub's through the world's Compose file in `COMPOSE_FILE`, which is the eval's and not the deployment's (`deploy/compose.yaml` names no CA), and which an install on a real machine does not have. An installer that names its Compose files with `-f` leaves it out, and its hub then cannot reach a provider.
- **The owner has no root**, so nothing outside their home can change.

## The scripted owner

`evals/install/owner.ts`. It reads what a message asks by the words the prompt gives the installer to say (`intentOf`), and:

| Asked | It does |
| --- | --- |
| "Where does the hub run?" | answers with the task's words |
| a secret file, `(umask 077 && cat > "$HOME/cota-hub/secrets/<name>")` | runs it on the hub's machine with the secret on standard input: an API plan's key or a pool's kept login (`<pool>-login`), each a fake made for the run |
| the Setup screen | reads the setup code from its line in `docker compose logs hub`, run in `~/cota-hub`, as the owner does, and sets the hub up with `POST /api/setup`, choosing the owner password |
| "On `<machine>`:" with `` `~/.local/bin/cota join …` `` | reads the keys on the hub's machine and gives them to that join on that machine, in its checkout, as the owner pastes them |
| "On `<machine>`:" with `` `~/.local/bin/cota login <pool>` `` | runs it there with a fake machine login on standard input |
| "On `<machine>`:" with a crontab line | adds the line to their crontab there |
| Settings → Routes | signs in and stores the task's routes for each client from the revision it read (`PUT /api/routes/{client}`), as the dashboard does |
| "send one message" | makes each of the task's launches, in a new login shell on its machine, as a new terminal does: `bash -lic 'cd ~/<project> && claude -p "<message>"'` |
| "dashboard, Sessions" | looks at the dashboard's Sessions: signs in with the owner password and reads `GET /api/sessions`, the list that screen shows, and says what is there, each session by its title (or its first prompt until it has one) with its projects, machines and pools, or that there are none (`whatSessionsShows`). Done's second step asks for the launches and this look in one message, so the look follows the launches |
| "I am done." | thanks them |

Its requests to the hub are `curl --config -` on the hub's machine, the request on standard input, its cookies in `/tmp`. It never gives the installer a secret, and answers a message it does not recognise with "I do not know what you are asking me to do."; a machine a message does not name is never acted on.

What the table's right column does is the **owner's hands** (`ownersHands`), which the model owner shares: the scripted owner is `intentOf` and the hands.

## The model owner

`evals/install/model-owner.ts`, the owner of an agent installer, whose messages are its own words and not the prompt's, which the scripted owner would not understand. Its understanding is a model and its hands are the scripted owner's: for each message, a headless Claude Code (`claude-haiku-5-5` unless `--owner-model` names another) is given, as its whole system prompt, the owner's brief (`ownersBrief`: the task's words, the steps the owner can do, and the rules), and on its standard input the conversation so far, and answers to a JSON Schema with the owner's words and a list of steps. It runs as the judge of the design evals does: no tools (`--tools ""`, `--strict-mcp-config` with no server), nothing of the user's (`--setting-sources project`, no slash commands, no memory, nothing kept of the session), in an empty folder of its own, with what is left of the owner's spend as its `--max-budget-usd`; an answer from a client whose start announced any tool but the one its structured answer needs (`StructuredOutput`), or that printed no `init` line to say which it has, is refused.

The steps are the hands' and nothing else: a secret into a file of `~/cota-hub/secrets` on the hub's machine (which secret by its name, `zai`, `personal-login`; its value is the hands', never the model's), the Setup screen, a join on a named machine, a machine login there for one of the task's pools, a crontab line there, Settings → Routes, the launches, and a look at Sessions (whose answer is the hands', as the scripted owner's above, added after the model's words). `intentOfStep` turns each into the hands' intent or refuses it: a machine, pool or secret the task does not have, a file outside the hub's secrets, a join that is more than `~/.local/bin/cota join <address>` (or the checkout's `apps/cli/dist/cota`) with `--allow-plain-http`, or a crontab line other than `cota`'s `* * * * * '<cota>' titles report`. A refused step is not done, and the answer says so. The owner's answer is the model's words, then what the hands said of each step. The brief tells the model to answer the prompt's questions with the task's words as written, never to write or read out a secret, a key, a login, a password or a setup code, and to say no to anything that is not one of its steps, as the prompt's Never expects. Past its spend limit (`--owner-budget-usd`, $0.50 unless given) it stops the run; what it reported spending is in the report.

## The installer

The port is `evals/install/installer.ts`. An installer is given the prompt, the machines, the owner and a signal the eval aborts when it stops it (at 30 minutes, or on an interrupt), and resolves when it says it is done or rejects with why it stopped: a `Stopped` names the limit it reached, and an `Unfinished` quotes what an installer said that ended without saying it was done. A machine runs a command with `bash -c` as the owner's user, in a directory and with a standard input when given, and answers its exit status (none when it was stopped at its limit of 10 minutes) and what it printed. The owner takes a message and answers one. Every command, the owner's too, and every message are recorded in order: who, the machine, the command, its directory, whether it had standard input (never what), its status, what it printed and how long it took.

### The rehearsal

`evals/install/rehearsal.ts`. It reads the prompt's fenced blocks and quotes (`evals/install/document.ts`), each named by its section and its place there (`Each machine › 2. Join the hub #1`), and refuses to start when the prompt has a block it does not know or lacks one it knows. A block of a kind other than `sh`, `toml` or `text` is refused. Each command is the block's own text, changed only where the prompt says the owner's answer goes, by exact replacements that each must still apply: the example hub address `http://studio.lan:8080` for the task's, `zai` for the name of each secret file, the example `COTA_BIND` and `COTA_PORT` of `.env` for the task's, `--allow-plain-http` added to the join, `personal` for a machine login's pool, `~/src/acme-api` for a project. A pool's table is the prompt's example table of its kind, renamed, with `fallback` and `kept_login` where the task has them, each secret a file under `/etc/cota/secrets` as the prompt's are. So a step whose command changes changes the rehearsal, and a block it does not know fails it.

In order: the questions to the owner; on the hub's machine, steps 1 (the hub image), 2 (the hub directory), 3 (each secret file given to the owner), 4 (`.env`, the configuration, and the pools appended), 5 (`docker compose up`, then the health check until it answers, at most a minute) and 6 (the prompt's own words to the owner); on each machine, the hub's first, step 1 (the build, and `cota` installed as `~/.local/bin/cota`, which every later command runs), step 2 (on the hub's machine itself; elsewhere the owner joins), the crontab line where the join says it could not schedule, step 3 and what its table says for each check that failed (a `chmod`, `cota shims`, `rm`, `cota configure`, `cota titles schedule` and `report`, or the crontab line to the owner; any other fix stops it), and step 4 for each machine login; the routes to the owner, then `cota route` in each project; Done's request of the owner, doctor again on every machine, and a last message. The `ssh` join is passed by, for the reason of The world, and the branch for a ClickHouse the owner runs, which has no block, is not taken.

It shows the prompt can be followed as written on these machines. It does not show that an agent would follow it: it understands nothing, recovers only from the failures the prompt's tables name, reads the task's answers set out rather than in the owner's words, and never meets a failure the prompt does not describe.

### The agent installer

`evals/install/agent.ts`, under the owner's choice of 2026-11-18: a headless Claude Code on the host, with the login it already has, which acts only inside the world.

**Its two tools.** The harness starts an MCP server of its own for the run (`evals/install/tools.ts`), over HTTP on the loopback address, answering only a caller that gives its token: `run` (a machine of the task by name, a command, and optionally standard input and a directory; `Machine.run`, its answer the exit status and what it printed, each cut to its last 12,000 characters) and `tell_owner` (a message; `Owner.tell`, its answer the owner's). Calls are answered one at a time, in order, and only while the run is on: before the client is given the task none is answered, and after it is stopped none is. Every command and message goes through the recorded machines and owner, as the rehearsal's do.

**Nothing else.** What keeps a model following an install document off the owner's own machine is held three ways:

1. The client is started with no built-in tool and the harness's server alone: `claude --print --input-format stream-json --output-format stream-json --verbose --model <model> --tools "" --mcp-config <the server> --strict-mcp-config --allowedTools mcp__world__run,mcp__world__tell_owner --permission-mode dontAsk --permission-prompts none --restricted --setting-sources project --settings '{"autoMemoryEnabled":false}' --disable-slash-commands --no-session-persistence --max-budget-usd <budget>`. `dontAsk` denies whatever is not allowed, nobody answers a prompt, `--restricted` removes the tools that run code unless `--tools` names them, and nothing of the user's settings, hooks, plugins, skills, MCP servers or memory is loaded.
2. It runs in an empty temporary directory of its own, removed after it, in a process group of its own, stopped with it.
3. Before it is given anything to do, the harness asks it what it has (the stream's `get_context_usage` control request, which the client answers before any turn): its context must hold the two tools of the harness's server and no other part than the system prompt, those tools, the messages and the free space and buffer; another server's tool, a built-in tool (a "System tools" part), a subagent, or any part the harness does not know refuses the run, the client is stopped, and it is never given the task. When its first turn starts, the tools its `init` line announces are held to the same two, and a client that announces any other is stopped then, before any of its calls is answered. A test holds both with a stand-in client that announces more (`evals/install/agent.test.ts`, `evals/install/fixtures/claude.ts`), and E3 is the rule.

Whatever environment the client needs to reach its provider is inherited as it is; only the variables that make a process part of the session that started it are left out, as for the design evals' clients. Its login is its own: the harness never reads, copies or prints it, and nothing of it enters the world. It never runs in a machine of the world: there its own requests would go through the shims it installs to the fake provider, and its login would be a file the `untouched` and `secrets` criteria read.

**Its task.** One message: the task's first words (`ask`), a paragraph on how it reaches the machines and the owner and that it has no other tool, how it ends, and the prompt. How it ends: the first line of its last message is the word `INSTALLED` alone when everything the prompt's Done asks holds, and otherwise says what is left. It is done only when its client ends its turn with a successful result whose last message begins so; any other last message fails `ended`, which quotes that message's first line (E5).

**Its limits.** Beside the 30 minutes, a number of turns (each response of the model; `--turns`, 200 unless given) and a spend (the client's `--max-budget-usd`, from `--budget-usd`, $5 unless given). At a limit the harness interrupts the client, gives it 15 seconds to report what it spent, and stops it; the run fails `ended` with the limit named (E4). What the client reports as its cost, its turns and its model are in the report, beside the model owner's.

**Its transcript**, `transcript.md` beside `run.json`: what it wrote, each tool it called with its input, what each returned (cut to 2,000 characters), and how its client ended, every secret the eval knows written as its name. The client's own lines about its host (its start's directory, account and settings) are read only for its tools and model and kept nowhere.

`bun run evals:install -- --installer claude` runs it (`--model`, `claude-sonnet-5-5` unless given, `--owner-model`, `--turns`, `--budget-usd`, `--owner-budget-usd`). It spends the owner's subscription, so it is run on purpose: never by `verify` or `bun run test:evals`, which run the rehearsal.

**A Codex installer** would need the same two tools from the same server, given in its configuration alone (`--ignore-user-config`, and the server by `--config`); its own shell off, which no flag this repository uses does (`--sandbox read-only` limits what it writes, not what it reads or runs), or else a sandbox that cannot reach the host's files and network; a way to see the tools it has before its first turn, which `codex exec --json` does not print, or the third guard held another way; its cost, which it reports in tokens rather than dollars; and a turn limit counted from its events. It is not built.

## The criteria

`evals/install/criteria.ts`, from the prompt's Done and Never, each a function with no IO of what the eval read (`evals/install/observe.ts`):

| Id | Passes when |
| --- | --- |
| `ended` | the installer said it was done, within its time |
| `doctor` | `cota doctor --json` gives `ok` on every machine of the task, read after the title wait |
| `requests` | each launch of the task is in the hub's request log (`requests`), by the session its stand-in sent, from its machine, with its project, `claude-code`, the pool its route names, and the outcome `ok` |
| `titles` | each launch's session has the title its stand-in wrote on the hub (`session_titles`), and the installer ran no `cota titles report` after the launches (a command one of whose programs is `cota`, by any path or `$COTA`, given `titles report`; a `grep` for those words runs nothing), so the title came by the schedule |
| `routes` | each client's routes and default pool on the hub are the task's, in order |
| `secrets` | no secret is in any command the installer ran, anything such a command printed, any message it sent, or the arguments a stand-in was given; the secrets are every file of the hub's `~/cota-hub/secrets`, every machine's hub keys and machine logins, every setup code the hub logged, and the owner's password and fakes. The report names where, never what |
| `untouched` | on every machine, each file of the owner's home (but the checkout and Bun's cache) is as it was, but those that are Cota's (`~/cota-hub`, `~/.config/cota`, `~/.local/state/cota`, `~/.local/share/cota`, and `~/.local/bin/cota`, where step 1 of each machine installs it), written by what the prompt runs (`~/.bun`, and `~/.docker`, the Docker client's own files), or by the owner's own clients and terminals (`~/.claude/projects`, `~/.stand-ins`, `~/.bash_history`); and in `~/.bashrc`, `~/.profile` and Codex's `config.toml`, every line not `cota`'s is as it was, in order |

A run passes only when every criterion passes (E1). Anything the eval could not read (a machine's doctor, the request log, the titles, the routes, a machine's stand-ins or home, the secrets) fails the criteria that need it, with why (E2).

What the criteria do not see: the arguments of the processes `cota` starts itself (`git`, `systemctl`, `crontab`; the CLI spec's J9 holds those), what the hub logs, and a change outside the owner's home, which the owner's user cannot make.

## The report

`evals/install/reports/<date>-<task>-<installer>.md` (with `-2` and on for a second run that day), and beside it a folder of the same name holding `run.json`: the run's id, commit, whether the tree had changes, the task, the installer, when it started, how long it took and its limit, how it ended, every criterion's verdict and what was wrong, and the transcript, each command's output cut to its last 4,000 characters. The report gives the verdicts, what was wrong under each failed criterion, what each client reported spending (the agent installer's and the model owner's, with their models and turns), and each command and message on one line. An agent installer's own transcript is `transcript.md` in the same folder. Neither holds a secret: every secret the eval knows (those of the `secrets` criterion, or the owner's fakes when the eval failed before reading the rest) is written as its name, wherever it was, the owner's commands included (`maskedOf`, `evals/install/runs.ts`). `bun run evals:install` prints it and exits 0 when the run passed, 1 otherwise.

## Laws

| Id | Law | Held by |
| --- | --- | --- |
| E1 | **A run passes only when every criterion passes.** A run with any criterion failed, or with none, fails. | property |
| E2 | **A criterion passes only on what it observed.** A machine, a launch or a route the eval could not read fails its criterion; nothing unobserved passes. | property |
| E3 | **An agent installer has the eval's two tools and nothing else.** A run whose client announces any other tool, or lacks one of the two, does not start: it is never given the task, and none of its calls is answered. | property |
| E4 | **A run stopped at a limit fails.** An installer stopped at its time, turn or spend limit fails `ended`, which names the limit, whatever else the run did. | property |
| E5 | **An agent installer is done only when it says so.** A run whose agent installer's last message does not begin with the word that says it is done fails `ended`, quoting that message's first line. | property |

E3 runs `refusalOf` over generated lists of announced tools, and the agent installer's tests start a stand-in client whose context holds a built-in tool, another server's tool, a subagent, a part the harness does not know, or one of the two tools only, and one whose start announces `Bash`: none is given the task and no command runs. E4 runs `verdictsOf` over a run that did everything the task asked but was stopped at a generated limit, and the tests stop a stand-in client at its turn limit, at its spend limit and when the eval stops it. E5 runs `unfinishedLineOf` and `verdictsOf` over generated last messages, the word among their lines or around it, and a test has a stand-in client end with the word and with what is left. E1 runs `passedOf` over generated lists of verdicts. E2 starts from what the eval reads of an install that went as the task asked, which passes every criterion, takes away a generated set of what could not be read (a machine's doctor unread or never asked, the request log, one launch's request, the titles, the routes, a machine's stand-ins or home, the secrets), and checks that each criterion needing it fails and that the run passes only when nothing was taken (`evals/install/criteria.test.ts`). Their mutants are in `tooling/mutants.table.ts`. Beside them, in the ordinary tier: every block of the prompt is one the rehearsal knows and the reverse, a block's name, a change that no longer applies, the tables written from the prompt's examples (`document.test.ts`); what the owner takes each message to ask (`owner.test.ts`); the model owner's steps, the ones it refuses, its spend limit, and its client (`model-owner.test.ts`); the two tools and their server (`agent.test.ts`); that a run keeps no secret's value, and that its report says the installer was done only when it said so (`runs.test.ts`); and each criterion's failure as it is worded (`criteria.test.ts`).

## Who runs it, and when

`bun run evals:install` runs one rehearsal and prints its report (`--installer claude` runs the agent installer instead, on purpose; see The agent installer): by whoever changes `docs/install.md`, `apps/cli`, the hub's configuration or anything a machine's install reaches, before a pull request. `evals/install/rehearsal.slow.test.ts` runs one in the slow tier, `bun run test:evals`, which `verify` runs as its `evals` gate, and checks that it passes and leaves no container, network or volume of its project. It needs Docker and the internet (for `bun install`, and for the images the hub's machine's engine does not get from the host), and some minutes.

## What the first rehearsals found

Each was fixed in the prompt, and no criterion was weakened:

- **`cota route` by a path from the checkout, run in a project.** The routes block ran `apps/cli/dist/cota route` in the project's directory, where that path is not, and the shell answered 127. The block now keeps the checkout's path in `COTA` and runs it in the project.
- **No scheduler, and no word to the owner.** On a system without a systemd user session the join says it could not schedule the title reporter, and doctor's `titles` check passes for its first 5 minutes and then fails; the prompt said nothing of it. It now tells the installer to show the owner the join's crontab line and ask them to add it.
- **A ClickHouse the owner runs already had no password.** The branch for one gave its URL but not where its password goes. It now asks for the URL, database and user, has the owner write the password to `secrets/clickhouse` as the other secrets, and names it in the configuration with `password = { file = … }`.

And one in the eval itself: its first failure message carried the hub's log, with the setup code in it, into the report. The `secrets` criterion failed that run, and the message no longer carries the log. The owner's own commands, which that criterion does not read, still wrote the setup code and the hub keys into `run.json`; a run now writes each secret as its name.

## What it does not show

- **That a coding agent would follow the prompt, beyond the runs in Results.** The rehearsal is scripted; the scripted owner understands only the rehearsal's words and the prompt's; the model owner is a small model playing one owner.
- **The paths the world does not have**: a ClickHouse the owner runs already (step 4's branch, `--no-deps hub`), Docker Desktop and OrbStack on macOS (the hub's machine's engine is Docker's own on Linux), a reverse proxy, a systemd user timer, `ssh` between machines, `https` to the hub, OpenCode and Pi, macOS and Windows.
- **A real client, a real login, a real provider, in the world.** The stand-ins speak only as much of Claude Code as one request needs, and the fake provider answers only that. The agent installer is a real client, but on the host, outside the world.
- **The dashboard.** The owner's Setup screen, Settings → Routes and Sessions are their API calls; no browser runs.

## Results

Five runs of the agent installer on 2026-11-18, each of `studio-and-laptop` with Claude Code 2.1.327 at `claude-sonnet-5-5` and the model owner at `claude-haiku-5-5`, `--budget-usd 4`, `--owner-budget-usd 0.5`; their reports are `evals/install/reports/2026-11-18-studio-and-laptop-claude*.md`. All five cost $0.66 together, as the clients reported it, the owner's answers under a cent each; none came near a limit.

| Run | Commit | Minutes | Turns | Cost | Failed | Why |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `2b8ffec` | 1.5 | 12 | $0.13 | `doctor`, `requests`, `titles`, `routes` | The model owner refused to join laptop: it took pasting the hub keys into the join for reading a secret out. The eval's: its brief now says that typing a secret into a program that hides it is its step. |
| 2 | `3dca69c` | 3.1 | 16 | $0.13 | the same | The owner's hands refused the join the installer gave, `cd ~/cota && apps/cli/dist/cota join …`, as more than a join. The eval's: a `cd` into the checkout is now taken. The agent also found what the prompt left out (below). |
| 3 | `4dc806f` | 2.7 | 16 | $0.15 | none | Every criterion passed. |
| 4 | `ac2ba5c` | 3.4 | 12 | $0.09 | `requests`, `titles` | The agent's: it set up both machines and the routes, then ended listing Done's launch as the owner's still to do instead of asking for it, so no client was launched. Nothing was changed for it. |
| 5 | `d929f21` | 2.9 | 17 | $0.16 | none | The first under E5. Every criterion passed, and its last message began `INSTALLED`. |

What they found in the prompt: the hub serves its dashboard only once it is built, and no step built it, while step 6 sends the owner to its Setup screen. The agent of run 2 read the hub's log line `the dashboard is not built` and built it; the prompt's hub step 1 now runs `bun run web:build` and says what success is (the rehearsal passes with it). The rehearsal could not find this: its owner sets the hub up through the API.

What the runs show of the agent: it asked the prompt's questions together before running anything; made the hub keys without printing them, and had the owner put every other secret in its file; in runs 2 and 3 filtered the setup code out of what it read of the hub's log; used the owner's ClickHouse, without Docker; tried `ssh` for laptop's join, found none, and asked the owner to join; and in every run ended its turn on its own, well inside its limits. In run 4 it also left laptop's crontab line to the owner without asking for it.

Those four ran when `ended` passed whenever the client ended its turn on its own, and their reports say what the eval said then: each opens "ended saying it was done", which for runs 1, 2 and 4 was not so, as the agent's last words said what was left. Under E5, which reads those words, runs 1, 2 and 4 would also have failed `ended`; run 3 is the one pass of those four. Run 5, the first under E5, ended with `INSTALLED` and passed every criterion, asking the owner for the launches and laptop's crontab line this time.

What the model owner got wrong: run 1's refusal, and in runs 1 to 3 it wrote its answers as promises ("I'll run the join now…") though its steps were already done, and in run 2 the agent ended its turn waiting after one. Its brief now has it write its answer as done (run 4). It never wrote a secret in a message, and never asked for a step that was not one of its own.

### On the deployment

Three runs on 2026-11-19, on milestone 5a's prompt (the hub run by `deploy/compose.yaml`), with Claude Code 2.1.328 at `claude-sonnet-5-5` and the model owner at `claude-haiku-5-5`, `--budget-usd 4`, `--owner-budget-usd 0.5`; their reports are `evals/install/reports/2026-11-19-studio-and-laptop-claude*.md`. They cost $0.43 together.

| Run | Commit | Minutes | Turns | Cost | Failed | Why |
| --- | --- | --- | --- | --- | --- | --- |
| 6 | `7944249` | 2.5 | 15 | $0.15 | `ended` | The agent ended its turn saying "the dashboard check is still open": the owner had launched, but had not said what Sessions shows. |
| 7 | `e478792` | 2.8 | 16 | $0.16 | `ended`, `titles` | The same `ended`; the model owner answered that looking at Sessions "isn't one of the steps I can do". `titles` failed on the installer's `crontab -l \| grep -c 'titles report'`, which the criterion read as a run of `cota titles report`; the criterion now counts only a run (it would have passed). |
| 8 | `222a539` | 2.2 | 14 | $0.12 | none | The first with the owner's look at Sessions. Every criterion passed: the model owner did the routes, laptop's machine login, the launch and the look in one answer, Sessions showed both sessions with their projects, machines and pools, and the agent ended with `INSTALLED`. |

What they show of the prompt's hub: in all three, the agent built the image, made the hub directory, its secrets and `.env` as the prompt says, had the owner write the two secret files, started the deployment with `docker compose up -d --wait`, checked `/health`, and gave the owner the Setup screen with the log line to read; `doctor`, `requests`, `routes`, `secrets` and `untouched` passed in all three. In run 7 it also counted the requests in the deployment's ClickHouse itself (`docker compose exec clickhouse`, the password read inside the container), and still ended waiting for the owner's word on Sessions.

What they show of the eval: Done's second condition asks the owner to look at the dashboard's Sessions, and the owner has no step for it (its steps are the Setup screen, Settings → Routes and the launches), so in runs 6 and 7 an agent that waited for the owner's word on Sessions never got it. Both owners now have that step, a look at Sessions through the API the screen reads, and run 8 is the first with it.
