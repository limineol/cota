---
status: draft
scope: apps/cli
owner: limineol
last_verified: 2026-11-22
review_by: 2027-02-22
supersedes: []
code: []
---

# The request reporter

What reads the record a client that cannot be pointed at the hub writes of its conversations, and reports each model call in it to the hub: `cota requests report`, run every 30 seconds by the machine's own scheduler (`CONTEXT.md`, Request reporter), and the commands that say which data folders it reads. Its one reader is Antigravity's (below). ADR-0029 gives the reasons; the endpoint it calls, `POST /api/reported-requests`, and what the hub does with a report are `docs/specs/reported-requests/spec.md`; the rest of `cota` is `docs/specs/cli/spec.md`, and its sibling, which this follows where it can, is `docs/specs/title-reporter/spec.md`.

**Status.** Draft: nothing here is built. Milestone 6d builds it, after confirming what ADR-0029 lists under Facts to confirm when built, and this spec changes with what is found; it becomes active then. Antigravity's tables and field numbers are as one conversation on one machine showed them, read by trial.

## The configuration

Each data folder the machine reports is one entry of `config.toml` (ADR-0022), which holds no secret:

```toml
[[clients.antigravity.reported]]
folder = "/home/<you>/.gemini/antigravity-cli"
pool = "gemini"
```

| Key | Holds | Rules |
| --- | --- | --- |
| `clients.<client>.reported` | The data folders of a reported client this machine reports, each `{ folder, pool }` | Only a reported client (`antigravity`) has it, and a reported client has no other key: `clients.<client>` is a launched client or a reported one, never both, by the client's type. |
| `folder` | A data folder: the directory the client was started with, whose `conversations` directory holds its record | An absolute path, kept as given; two entries never name one folder (compared after resolving links). |
| `pool` | The observed pool the folder's model calls bill | A pool id. Two folders may bill one pool. |

A join keeps them as it keeps `[launch]` and the other `clients` settings, after them, in the table's form; leaving removes them with the file.

## Commands

| Command | Does |
| --- | --- |
| `cota requests add <client> <folder> <pool>` | Checks that `<client>` is a reported client, that `<folder>` exists and is a directory, and that the hub lists `<pool>` in `observedPools` (`GET /api/machine`, with the hub key the reporter sends with); keeps the entry; schedules the reporter when it is the first entry; and runs it once, printing what it reported. A folder already kept is given its new pool, and says so: calls reported before keep the pool they billed. |
| `cota requests remove <client> <folder>` | Forgets the entry and its cursor; removes the schedule when it was the last. What was reported stays on the hub. A folder not kept says so and exits 1. |
| `cota requests show` | Prints each kept folder, its pool, how far it was reported (the time of the last run that caught up with it), each conversation not reported and why, and each of the client's default folders (`~/.gemini/antigravity-cli`, `~/.gemini/antigravity`) that exists, holds a `conversations` directory and is not kept. `--json` prints the same as JSON. It reads, and never writes or calls the hub. |
| `cota requests report` | One run (below). |
| `cota requests schedule` | Installs the schedule (below); `--remove` removes it. |

On a machine that has not joined, each says so and exits 1, writing nothing.

**Open for the owner: history.** When a folder is added, its first run reports every conversation the folder holds, whenever written (recommended: the request log is the record, and the memory skill reads it), or only those changed since it was added (a first cursor at each conversation's end). Written here as recommended, and open.

## `cota requests report`

A run takes the lock `requests.lock` (in the state's directory) without waiting: a run that finds it held by a live process says so on stderr and exits 0, writing nothing; a lock whose process is gone is taken over. Then, for each kept folder, in the order kept:

1. **Notes when it begins reading the folder**: the run's `through` for that folder.
2. **Lists** `<folder>/conversations/*.db`: regular files whose names are a conversation's id and `.db`; nothing else of the folder is listed or opened.
3. **Reads each conversation that is due**: one with no cursor; one whose database's or `-wal`'s size or modification time differs from the cursor's; one whose cursor says it is `waiting` on an unfinished step, at every run until that is settled, since the 10 minutes pass without the files changing; and one the last run read further than the hub stored (below). The sizes and times are taken before the conversation is opened, so that a step the client adds while it is read leaves them older than the files and the next run reads it again. Each is read with the Antigravity reader, from its cursor on, into its model calls in order (each with its new items), and stops a conversation where the reader stops it.
4. **Sends them in reports** of one folder, with the subscription hub key, else the keyed one, and `x-cota-machine` (as the title reporter sends): calls in the order of their conversations and each conversation's in order, at most 200 calls and 8 MiB written out to a report, a call alone over 8 MiB in a report of its own, waiting 120 seconds for each answer. A report answered 200 moves the cursor of each conversation it held to its last call, and `requests.json` is written; any other answer, or none, stops the folder, which keeps its cursors. A conversation's `db` and `wal` are kept only once every call the run read from it was answered 200: until then they stay as they were, so a conversation whose later report failed is due at the next run though its files did not change. A 409 `report-out-of-order` says as well that the hub does not hold what this folder's cursor says was reported, and that `cota requests remove` and `add` report the folder again from its first call: the hub stores what it does not hold, and nothing twice.
5. **Ends the folder** with a report holding its `through`, when every conversation it read was sent to where the reader stopped: the last report of the folder carries it, or a report with no calls when there was nothing new, so that the hub sees a machine that is current. A conversation the reader does not report (below) does not hold back `through`: it is said by `cota requests show` and doctor instead, so that one conversation cannot make a machine look silent.

Then it writes `requests.json`, and a run with a problem writes `requests.error` (`2026-11-22T09:12:03.120Z <problem>; <problem>`), prints each on stderr and exits 1; a run without one removes it. A folder that does not exist, or a pool the hub refuses, is a problem of the run, and the other folders are still read. On standard output it says how many calls the hub stored and found held, or that there was nothing new. A machine with no hub key sends nothing, which is a problem.

On macOS every run sends through `/usr/bin/curl` (ADR-0022): curl's configuration, the hub key among it, on its standard input, and the body in a file of its own, 0600, in the state's directory, read by `--data-binary @<file>` and removed after the answer; elsewhere `cota` sends it itself. Neither the key nor an item is ever in an argument.

### The cursor

`requests.json` (0600, in the state's directory, 0700, written atomically) holds, per kept folder, per conversation:

| Field | Holds |
| --- | --- |
| `step` | The `idx` of the last step reported: the step that carries the last stored call's usage. |
| `call`, `startedAt` | That call's call key and its start, which the next report names as its first call's `after`. |
| `db`, `wal` | The sizes and modification times of the database and its `-wal`, taken before the last read of it whose every call the hub stored. |
| `waiting` | Since when the conversation has ended on an unfinished step, when it does (below). |
| `notReported` | Why the reader stopped the conversation, when it did: a reason of the table below, and the step it stopped at. |

and the times of the last run, and of the last that ended without a problem, per folder. A `requests.json` that does not read is a problem of the run, which reports nothing and leaves it as it is. `cota requests remove` and `add` of the folder start it again: every conversation is sent from its first call, and the hub stores only what it does not hold, whichever hub key reported it before.

## `cota requests schedule`

As `cota titles schedule` (`docs/specs/title-reporter/spec.md`), its own schedule beside the titles', running `cota requests report` every 30 seconds with the same variables and no secret:

| System | Definition |
| --- | --- |
| macOS | `~/Library/LaunchAgents/cota.requests.plist` |
| Linux | `$XDG_CONFIG_HOME/systemd/user/cota-requests.service` and `cota-requests.timer` |
| Windows | the task `cota requests`, its definition kept as `requests-task.xml` in the state's directory |

A Linux without a systemd user session says so, with the line that runs the reporter every minute from cron, and exits 1. Joining schedules it when the configuration keeps a folder, and runs it once; leaving removes it, before the titles'. A schedule of its own, not a second step of the titles': a slow report, megabytes over a slow link, never holds back a title, and each has its own error file and check.

**Open for the owner: the install prompt.** Whether `docs/install.md` asks, on a machine with Antigravity, which data folders to report and which observed pool each bills, and runs `cota requests add` (recommended, in 6d), or leaves it to `cota requests add` by hand.

## The Antigravity reader

### What it opens, and how

- **Only `<folder>/conversations/<id>.db`**, and its `-wal` as SQLite reads it. Never another file of the folder: not the sign-in's token file, not a log, not a setting, and nothing outside the folder.
- **Read only**: `bun:sqlite` with `{ readonly: true }`, `PRAGMA query_only = 1` and `PRAGMA busy_timeout = 5000`, as the title reporter opens T3 Code's database; one transaction per conversation, so that a run reads one moment of it.
- **When it cannot be opened so** (ADR-0029, fact 8: a live database in WAL mode without its `-shm`), it copies the database and its `-wal`, never its `-shm`, into a directory of its own (0700, in the state's directory), opens the copy, which is `cota`'s, and removes the directory after reading. A copy whose database and `-wal` changed while copied (their sizes and times before and after differ) is read again at the next run.
- It never writes to, locks for writing, checkpoints or moves a file of the client's.

### What it reads

| Table | What is read |
| --- | --- |
| `trajectory_meta` | `trajectory_id`, the conversation's id, which 6d confirms agrees with the database's name and `gen_metadata`'s call ids. |
| `steps` | `idx`, `step_type`, `status`, `has_subtrajectory`, `metadata` and `step_payload`, from the cursor's `step` on, in order of `idx`. |
| `gen_metadata` | Of each row: its `idx`, and in `data` only the model, the client's call id and the index of the last step before the call. Never the request the newest row holds, its system prompt, messages or tool declarations. |
| `parent_references` | Only whether it has a row. |

Not read: `executor_metadata`, `trajectory_metadata_blob`, `battle_mode_infos`, every other column, and every field of a buffer but those named here for the reading of a call. Before reading, it checks with `PRAGMA table_info` that each table and column it reads is there, of the type it expects.

### A model call, in the record

- **A model call is a step whose `metadata` carries usage**, finished (its `status` one a finished step has). Its call key is `<trajectory id>:<idx>`. Its session is the conversation's id. Its usage is the step's: input not from cache, from cache, and output, read as ADR-0029's facts say until 6d confirms them, reasoning 0 until then, no cache write, and the usage fields as written out (the record form's rules) as `reported`. Its times are the step's started and finished times, else its created time for both. Its model is that of the `gen_metadata` row of the call that produced it (the row whose last step before the call is the greatest below the step's `idx`, and not already matched); a step with no such row (a compaction's) has the model it names, else none. Where both give usage and they differ, the step's is reported and the conversation is said as `usage-differs` (without stopping it). Its project is read from the working directory a step names, as a launch reads a project (the CLI spec's The project), else empty; its client version where the record names one, else empty. Its outcome is `ok`.
- **Its conversation items are steps**, written in the record form `antigravity-steps` (`docs/specs/reported-requests/spec.md`): its `input` the steps after the call before's step through the step before its own, its `output` its own step.
- **A step not finished** stops the conversation's reading there, and waits: until it is finished, or until a step follows it, or until the database and `-wal` have not changed for 10 minutes; a step that finished is read as any other. One still unfinished when a step follows it, or when the 10 minutes have passed, is reported, when it carries usage, with outcome `error` and `cota_reported_unfinished` as its error type, and the reading goes on after it. **Reported so, it is final**: the cursor is past it, the hub never changes a reported request, and a step the client finishes after that is not read again, so the log keeps the step as it was when reported. The steps after the last model call wait for the next call, and are reported as its input.

### A record it cannot read

It reports nothing it cannot read, says why, and never guesses. Each stops a conversation, keeps the reason in `requests.json` and is listed by `cota requests show`, and the calls before it are reported:

| Reason | When |
| --- | --- |
| `schema` | A table or column it reads is missing, or of another type: nothing of the conversation is reported. |
| `sub-agent` | `parent_references` has a row (the conversation is a sub-agent's): nothing of it is reported. |
| `subtrajectory` | A step has `has_subtrajectory` set: reading stops at it. |
| `unreadable-step` | A step's buffer is not a protocol buffer by the record form's rules, or its usage or times are not where they are read: reading stops at it. |
| `rewritten` | The conversation's greatest `idx` is below the cursor's `step`, or its database is shorter than when read: the record changed under it, and nothing more of it is reported. |
| `too-large` | The report that would hold the call alone, written out whole with its other fields, is over 64 MiB, the hub's limit for a body: reading stops at it. |

A run reads such a conversation again only when its files change, and reports from where it stopped if the reason is gone. A conversation of the desktop app, an automatic compaction and a sub-agent are not read until seen (ADR-0029, Left out): they fall under these reasons, or are read as they are.

## Doctor's check

Doctor gains one check after `titles`. It needs `config`, and `hub-keys` to pass or warn.

| Id | Passes when | Fix |
| --- | --- | --- |
| `requests` | skipped when no folder is kept; otherwise the reporter is scheduled as `cota requests schedule` would install it, its last run was under 5 minutes ago, `requests.error` is absent, each kept folder exists and each kept pool is in the hub's `observedPools`; warned when a conversation is not reported, naming the reason and the conversation | `cota requests schedule`; with `requests.error`, what it says, then `cota requests report`; for a folder gone or a pool refused, `cota requests remove <client> <folder>`, or `cota requests add` with an observed pool; for a conversation not reported, `cota requests show`, and an issue when the reason is `schema` or `unreadable-step` (Antigravity changed) |

**Open for the owner: a data folder not reported.** Whether this check warns of a default folder of Antigravity's that holds conversations and is not kept (recommended: no warning, which would nag an owner who chose not to report one; `cota requests show` lists them).

## Laws

| Id | Law | Held by |
| --- | --- | --- |
| J19 | **Reading on reads the same.** For any record appended to step by step and read in runs cut anywhere (between steps, on an unfinished step, after a compaction), the model calls read run by run, each with its new items, are those of reading the whole record once, but for a step reported unfinished, which stays as it was reported. | property |
| J20 | **A call is sent until it is stored, and then not again.** For any sequence of appends and runs whose reports are answered 200, refused, failed or never, a call is among those each run sends until a report holding it is answered 200, and among none after, a call reported unfinished among them, whatever its step becomes; each report names as `after` the call stored before it, or one earlier in it. | property |
| J21 | **Reports within their limits.** Every report holds calls of one folder, at most 200 and 8 MiB but for a call alone over it, in order, and no report's body is over 64 MiB. | property |
| J22 | **As the record says.** A call's usage, model, times and items are those of the record when it was read, and an item written out in the record form reads back into the step's bytes exactly. | property |
| J23 | **Only the conversations' databases, and never written.** A run opens no file of a data folder but `conversations/*.db` and their `-wal` and `-shm` as SQLite reads them, opens none of them to write, and leaves every file of the folder as it was. | property, contract |
| J24 | **What it cannot read gives nothing, and is said.** For any record with a table or column missing, a sub-agent, a step that is not a protocol buffer or a record rewritten, the calls reported are those before it, and `cota requests show` and doctor name the conversation and the reason. | property |
| J25 | **Reported or launched, never both.** A client is a reported client or a launched one: `cota requests add` takes no launched client, `clients.<client>.reported` decodes for no launched client, and no shim, route or client file is written for a reported one. | types |
| J26 | **Through only once caught up.** A report carries a folder's `through` only when every call the folder's readable conversations held when the run began reading it has been answered 200, and that `through` is the moment the run began. | property |

J19, J22 and J24 build generated records (conversations of user messages, model outputs, tool calls and results, compactions, steps unfinished, failed and of unknown kinds, buffers of every wire type with text, non-UTF-8 bytes and nested messages, and the defects of J24) as SQLite databases in a scratch directory, and read them with the reader (`03-domain/antigravity-record.laws.test.ts`, `04-infrastructure/antigravity-reader.laws.test.ts`). J20, J21 and J26 run `SendReportedRequests` (the run's command; the hub's is `ReportRequests`) over generated sequences of appends and runs against a stand-in for the hub that answers each report in every way, with generated limits, and check after each run what the next has to send and the cursor (`02-application/commands/send-reported-requests.command.laws.test.ts`). J23 runs the reader over a folder that also holds a token file and others, watched by a file system that records each open and its mode, and compares every file's bytes before and after; its contract half runs `cota requests report` against a whole hub of the harness. J25 is the types of `Client` and of the configuration's `clients`. J9 (the CLI spec) covers the schedule's definition: no hub key and no variable but those carried.

**Contract tests** (`01-presentation/requests.contract.test.ts`) run `cota requests add`, `report`, `show` and `remove` on a machine of their own, joined to a whole hub of the harness with an observed pool, with a generated record in a data folder in its home: calls reported and read back from `GET /api/sessions/{session}`; a record growing between runs; a report whose answer is lost and is sent again, stored once; a pool not observed refused at `add` and at the hub; the hub away and back, `requests.error` written and removed and doctor's check failing and passing; a conversation not reported listed by `show` and warned by doctor; sending through `/usr/bin/curl`, where the system has it.

## Not built, on purpose

- **Reading Antigravity's quota.**
- **Choosing or switching a sign-in.** Whatever starts the client with a data folder chose it; `cota` reads the folder it is given.
- **Sub-agents, automatic compaction and the desktop app's conversations**, until seen.
- **Reporting Claude Code's or Codex's transcripts.** They are launched through the hub.
- **Finding data folders by itself.** `cota requests show` lists the default folders; `add` is the owner's.
- **A copy of the record kept by `cota`.** The cursor is the outbox; the record is the copy.
