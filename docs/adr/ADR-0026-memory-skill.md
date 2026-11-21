---
status: accepted
scope: repository
owner: limineol
last_verified: 2026-11-19
review_by: 2027-02-19
supersedes: []
code:
  - skills/cota-memory/SKILL.md
  - apps/cli/src/03-domain/memory.ts
  - apps/cli/src/02-application/queries/read-memory.query.ts
  - apps/cli/src/02-application/commands/keep-reader-key.command.ts
---

# ADR-0026: The memory skill is a file of the repository that reaches the request log only through `cota memory`, which keeps the machine's reader key and never shows it

## Context

The request log holds every session of every machine: what the owner asked, what each agent answered, every tool it ran and what came back. The hub's API already reads it as a memory would need: search over conversations (`GET /api/search`, and `q` on the sessions list), a session's transcript (`GET /api/sessions/{session}`), one request (`GET /api/requests/{id}`), and read-only SQL (`POST /api/sql`), each open to a reader key (ADR-0012, ADR-0015). Milestone 5d is what lets a coding agent use it: a skill, written for an agent that has never seen Cota, and evals that ask agents questions whose answers are in a request log of known content.

What an agent on one of the owner's machines lacks today:

- **A reader key.** `cota join` refuses one (ADR-0022): a machine keeps a subscription key and a keyed key, neither of which reads the request log. The owner's reader key is a file on the hub's machine (`secrets/agents`, `docs/install.md`), and no machine has it.
- **A way to send the key that the agent never sees.** Whatever an agent prints, reads or runs goes to its model, and the hub records it: a key that passed through an agent's context is in the request log in the clear, where search finds it for every later reader.
- **A transcript it can read.** A session's detail carries its last segment's transcript whole, each text cut at 20,000 characters: a long session is megabytes, which would fill an agent's context in one call.
- **Where the hub is.** The machine's configuration has it (`hub` in `config.toml`), in a file whose place depends on the system (ADR-0022, J15).

## Decision

**The skill is a file of the repository**, `skills/cota-memory/SKILL.md`, in the form coding agents load a skill: front matter with its `name` and a `description` that says when to use it, then the instructions. It is written for a coding agent that has never seen Cota: when to use it, the commands, the tables worth knowing, what the request log cannot say, and what an agent must never do. It changes with `cota`, whose commands it teaches, in the same commits. Its behaviour, and the commands it uses, are `docs/specs/memory-skill/spec.md`.

**It reaches a machine by the owner copying it** into the folder each client reads skills from (the spec lists them, as facts to confirm on each client). Neither `cota join` nor any other command writes into a client's own folders for it: that is the owner's choice, made once a machine has a reader key.

**The skill calls the hub only through `cota memory`**, never `curl`. `cota memory` reads the hub's address from the machine's configuration and the reader key from its file, sends the key in `x-cota-key`, and prints the hub's answer:

- `cota memory get <path> [<name>=<value>…]`: a reading endpoint, `GET /api/…`, its parameters encoded by `cota`, the answer's JSON as the hub gave it;
- `cota memory sql`: the SQL on standard input to `POST /api/sql`, its answer as the hub gave it;
- `cota memory transcript <session> [--request <id>] [--from <n>] [--entries <n>] [--cut <n>]`: one **transcript page** of a session's last segment, or of one request, each text cut on the machine, with the segments' tips and where the next page starts;
- `cota memory key`: the owner keeps the machine's reader key, from standard input or a prompt that does not echo, once the hub says it is a reader key it knows.

So the key never appears in an agent's command, its output, its context or the request log; a search query or a session id with spaces, colons or a backslash needs no quoting beyond the shell's; it is the same on Windows, which has no POSIX shell; and a transcript reaches the agent a page at a time. The hub's API is unchanged: the session detail and the inspector still send a transcript whole, and `cota` cuts it.

**The machine's reader key** is `hub-keys/reader` beside the machine's other hub keys (0600, in the configuration's directory, 0700), written only by `cota memory key` and read only by `cota memory`. `cota join` still refuses a reader key: a machine's agents get a memory only when the owner gives one on purpose, and a machine that only launches clients keeps no key that reads everything. `cota leave` removes it with the rest of the configuration's directory, and doctor's `files` check holds its mode as it holds every hub key's.

**The memory evals** (`docs/specs/memory-evals/spec.md`) follow the install evals' shape at a smaller size. A **memory world** is a scratch database of a ClickHouse the eval is given, holding a request log of constructed content written by the writer the request log's own ClickHouse tests write theirs with, run as a script of the hub's test code, a real hub process reading it, and a machine home that names that hub and keeps a reader key given by `cota memory key`. Questions carry the facts a right answer holds and what it must not. An **answerer** is behind a port: the **scripted answerer** takes every command from the skill's own fenced blocks, so the skill and the script cannot drift apart; the **agent answerer** is a headless Claude Code on the host whose one tool runs `cota memory` in the world's machine, under the install evals' three guards (no built-in tool and the eval's server alone, an empty directory, and what it has checked before it is given anything). Verdicts are given by code, never by a model: an answer is plain text whose first line says whether it found the answer, and a fact is a string with the spellings that count.

## Alternatives weighed

- **`curl` in the skill**, with the key read from a file in a subshell (`printf 'header = "x-cota-key: %s"' "$(cat …)" | curl --config -`). No code at all. But the agent handles the key, and one `cat` to check the file puts it in the request log; every search query and session id must be URL-encoded by hand; the configuration's place differs by system and Windows has no POSIX shell; and a transcript arrives whole. The title reporter's `curl` on macOS (ADR-0022) is `cota`'s own, run by `cota`, never typed by an agent.
- **Both `curl` and `cota`.** Two ways to teach and two for the evals to keep honest, for no reader the first does not serve.
- **`cota join` taking a reader key as a third scope.** One step fewer for the owner. But every machine joined from the install prompt would then keep a key that reads everything ever sent to a model, whether or not its agents need it, and J17's "no reader key" and the prompt's join would change. A separate command keeps the reader key a choice, per machine.
- **An MCP server** of `cota`'s, offering search, transcripts and SQL as tools. Each client would need it configured, and its tools would sit in every session's context; a skill is read only when its description matches, and its commands are a shell's, which every coding agent has.
- **Pages of a transcript from the hub** (`?from=&entries=&cut=` on the session detail, or a new endpoint). The megabytes would not cross the network. It changes the API the dashboard reads, its contract and its laws, for an agent's convenience that `cota` gives without it; it can come later, if the network ever matters.
- **`cota join`, or `cota memory key`, installing the skill** into each client's folder. One step fewer, but `cota` would write into folders that are the clients' and the owner's, which ADR-0022 keeps to `cota`'s marked part of a configuration file; where each client reads skills is not yet confirmed on every client.
- **A model judging the answers.** It would read answers worded any way. Code reads facts, a first line and secrets without a spend, the same every run; a question whose answer code cannot judge is written again until it can.

## Consequences

- `cota` gains `cota memory` and the file `hub-keys/reader`; the CLI spec lists the commands, and the memory skill's spec holds their behaviour and laws.
- The hub is unchanged. Its test code gains one script, `apps/hub/src/modules/request-log/05-tests/write-request-log.ts`, which only the memory evals run, to write a constructed request log into a scratch database: the evals are not a workspace and cannot import the hub.
- A machine's agents read the request log only after the owner runs `cota memory key` there and copies the skill; until then the skill says how to ask the owner.
- A transcript page still costs the hub a whole session detail, and the network its size.
- The memory evals' scripted run needs a ClickHouse (`compose.dev.yaml`'s), so it is in the slow tier; a run of the agent answerer spends the owner's subscription and is the owner's to start.
