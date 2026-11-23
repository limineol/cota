---
status: active
scope: apps/cli
owner: limineol
last_verified: 2026-11-23
review_by: 2027-02-23
supersedes: []
code:
  - apps/cli/src/03-domain/antigravity-record.ts
  - apps/cli/src/03-domain/requests.ts
  - apps/cli/src/03-domain/configuration.ts
  - apps/cli/src/03-domain/client.ts
  - apps/cli/src/03-domain/schedule.ts
  - apps/cli/src/02-application/commands/send-reported-requests.command.ts
  - apps/cli/src/02-application/commands/add-reported-folder.command.ts
  - apps/cli/src/02-application/commands/remove-reported-folder.command.ts
  - apps/cli/src/02-application/commands/schedule-reporter.command.ts
  - apps/cli/src/02-application/queries/show-requests.query.ts
  - apps/cli/src/02-application/queries/read-project.query.ts
  - apps/cli/src/02-application/queries/doctor.query.ts
  - apps/cli/src/02-application/interfaces/client-records.ts
  - apps/cli/src/02-application/interfaces/request-reports.ts
  - apps/cli/src/02-application/interfaces/run-lock.ts
  - apps/cli/src/04-infrastructure/sqlite-client-records.ts
  - apps/cli/src/04-infrastructure/request-answers.ts
  - apps/cli/src/04-infrastructure/http-request-reports.ts
  - apps/cli/src/04-infrastructure/curl-request-reports.ts
  - apps/cli/src/04-infrastructure/node-run-lock.ts
  - tooling/mutants.table.ts
---

# The request reporter

What reads the record a client that cannot be pointed at the hub writes of its conversations, and reports each model call in it to the hub: `cota requests report`, run every 30 seconds by the machine's own scheduler (`CONTEXT.md`, Request reporter), and the commands that say which data folders it reads. Its one reader is Antigravity's (below). ADR-0029 gives the reasons; the endpoint it calls, `POST /api/reported-requests`, and what the hub does with a report are `docs/specs/reported-requests/spec.md`; the rest of `cota` is `docs/specs/cli/spec.md`, and its sibling, which this follows where it can, is `docs/specs/title-reporter/spec.md`.

**Status.** Active: milestone 6d built it, on what it found of ADR-0029's Facts to confirm when built. Antigravity's tables and field numbers are as four copies of one throwaway conversation on one machine showed them, read by trial and against public parsers of the same record; the tests read generated records, and no run has reported a real conversation. The schedulers are those of the title reporter, driven in the tests by the same stand-in, and nothing of it ran on Windows. Sending through `/usr/bin/curl` is tested against a whole hub with a body of several MB, but not from a launchd job.

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

A folder given to `add` or `remove` names the entry kept by that very path; with none, the one entry kept by another path to the same directory (a link, or a path spelled otherwise); two such entries are ambiguous, and the command says so, names both and exits 1, changing nothing.

On a machine that has not joined, each says so and exits 1, writing nothing.

**History, decided by default.** When a folder is added, its first run reports every conversation the folder holds, whenever written: the request log is the record, and the memory skill reads it. The other way, only those changed since the folder was added (a first cursor at each conversation's end), was the owner's to choose, who has not answered; this is the recommendation, taken by default, and changing it is a first cursor at its end for each conversation `add` finds, in place of `firstCursor` (`03-domain/requests.ts`), which starts before the first step.

## `cota requests report`

A run takes the lock `requests.lock` (in the state's directory) without waiting: a run that finds it held by a live process says so on stderr and exits 0, writing nothing; a lock whose process is gone is taken over. The lock holds its run's process id and a token of its own, and appears whole or not at all: it is written to a file of its own and linked to its name. A run that finds a dead run's lock first takes a second lock named after that lock's text, the same way, and only then removes it, if it is still that lock, and makes its own; so of the runs that saw the same dead owner only one takes it over, none removes a lock another run made since, and a run that dies taking over leaves a lock that is taken over in turn. A run releases its lock only when it is still its own. Then, for each kept folder, in the order kept:

1. **Notes when it begins reading the folder**: the run's `through` for that folder.
2. **Lists** `<folder>/conversations/*.db`: regular files whose names are a conversation's id and `.db`; nothing else of the folder is listed or opened.
3. **Reads each conversation that is due**: one with no cursor; one whose database's or `-wal`'s size or modification time differs from the cursor's; one whose cursor says it is `waiting` on an unfinished step, at every run until that is settled, since the 10 minutes pass without the files changing; and one the last run read further than the hub stored (below). The sizes and times are those taken before the conversation was copied, so that a step the client adds while it is read leaves them older than the files and the next run reads it again. Each is read with the Antigravity reader, from its cursor on, into its model calls in order (each with its new items), and stops a conversation where the reader stops it.
4. **Sends them in reports** of one folder, with the subscription hub key, else the keyed one, and `x-cota-machine` (as the title reporter sends): calls in the order of their conversations and each conversation's in order, at most 200 calls and 8 MiB written out to a report, a call alone over 8 MiB in a report of its own, waiting 120 seconds for each answer. **It reads and sends one conversation at a time**: the reports a conversation's calls fill, with the calls read before it that did not fill one, are sent, and their cursors kept, before the next conversation is read; calls that do not fill a report wait for the next conversation's, or go in the folder's last report. So a run holds the new calls of one conversation, and at most one report's more, whatever the folder holds, and a run that dies has kept what the hub stored. A report answered 200 moves the cursor of each conversation it held past the calls it held (a late call, below, moves only `passed`), and `requests.json` is written; any other answer stops the folder, which keeps its cursors and reads no more of its conversations, and no answer, or a hub key the hub does not know (401), stops the run, since every other folder's report would meet the same. A conversation's `db` and `wal` are kept only once every call the run read from it was answered 200: until then they stay as they were, so a conversation whose later report failed is due at the next run though its files did not change. A 409 `report-out-of-order` says as well that the hub does not hold what this folder's cursor says was reported, and that `cota requests remove` and `add` report the folder again from its first call: the hub stores what it does not hold, and nothing twice.
5. **Ends the folder** with a report holding its `through`, when every conversation it read was sent to where the reader stopped: the last report of the folder carries it, or a report with no calls when there was nothing new, so that the hub sees a machine that is current. A conversation the reader does not report (below) does not hold back `through`: it is said by `cota requests show` and doctor instead, so that one conversation cannot make a machine look silent.

Then it writes `requests.json`, and a run with a problem writes `requests.error` (`2026-11-22T09:12:03.120Z <problem>; <problem>`), prints each on stderr and exits 1; a run without one removes it. A folder that does not exist, or a pool the hub refuses, is a problem of the run, and the other folders are still read. On standard output it says how many calls the hub stored and found held, or that there was nothing new. A machine with no hub key sends nothing, which is a problem.

On macOS every run sends through `/usr/bin/curl` (ADR-0022): curl's configuration, the hub key among it, on its standard input, and the body in a file of its own, 0600, in the state's directory, read by `--data-binary @<file>` and removed after the answer; elsewhere `cota` sends it itself. Neither the key nor an item is ever in an argument. curl is run with `-q` first, so that no `.curlrc` of the user's adds to or changes what it sends and prints. Neither way follows a redirect: an answer of 3xx is a failed send, as any answer the run does not read, and the hub key and the body never go to where it points.

### The cursor

`requests.json` (0600, in the state's directory, 0700, written atomically) holds, per kept folder, per conversation:

| Field | Holds |
| --- | --- |
| `step` | The `idx` of the last step reported: the step that carries the last stored call's usage; -1 before the first. |
| `call` | That call's call key and its start (`{ call, startedAt }`, milliseconds), which the next report names as its first call's `after`; `null` before the first. |
| `passed` | The steps a stored reading went past while they were not finished and carried no usage, each with the call before it (`{ idx, step, call }`: the step's `idx`, and that call's `step` and `call` as above), looked at again by every later reading (A step not finished); `[]` when there are none. |
| `stamps` | The sizes and modification times of the database and its `-wal` (`{ db, wal }`, each `{ size, changedAt }`, `wal` `null` when there is none), taken before the last read of it whose every call the hub stored. |
| `waiting` | Since when the conversation has ended on an unfinished step, with the stamps of its files then (`{ since, stamps }`), when it does (below). |
| `notReported` | Why the reader stopped the conversation, when it did: a reason of the table below, and the step it stopped at (`{ reason, step }`). |

and, per folder, the times of the last run (`ranAt`), of the last that ended without a problem (`goodAt`), and the `through` the hub last stored (`through`), each `null` until there is one. A `requests.json` that does not read is a problem of the run, which reports nothing and leaves it as it is. `cota requests remove` and `add` of the folder start it again: every conversation is sent from its first call, and the hub stores only what it does not hold, whichever hub key reported it before.

## `cota requests schedule`

As `cota titles schedule` (`docs/specs/title-reporter/spec.md`), its own schedule beside the titles', running `cota requests report` every 30 seconds with the same variables and no secret:

| System | Definition |
| --- | --- |
| macOS | `~/Library/LaunchAgents/cota.requests.plist` |
| Linux | `$XDG_CONFIG_HOME/systemd/user/cota-requests.service` and `cota-requests.timer` |
| Windows | the task `cota requests`, its definition kept as `requests-task.xml` in the state's directory |

A Linux without a systemd user session says so, with the line that runs the reporter every minute from cron, and exits 1. Joining schedules it when the configuration keeps a folder, and runs it once; leaving removes it, before the titles'. A schedule of its own, not a second step of the titles': a slow report, megabytes over a slow link, never holds back a title, and each has its own error file and check.

**The install prompt, decided by default.** The install prompt asks, for a machine with Antigravity, which data folders to report and which observed pool each bills, and runs `cota requests add` for each. The other way, leaving it to `cota requests add` by hand, was the owner's to choose, who has not answered; this is the recommendation, taken by default, and is one question and one block of the prompt. `docs/install.md` gains them with the release that holds `cota requests`, not before: the guide on `main` installs the latest release, and waits for the release that holds what it needs (ADR-0028).

## The Antigravity reader

Built on what 6d found (ADR-0029, Facts to confirm when built), in the four copies of one throwaway conversation and in public parsers of the same record; a field named here was seen there, and no more.

### What it opens, and how

- **Only `<folder>/conversations/<id>.db`** and its `-wal`, which it copies. Never another file of the folder: not the sign-in's token file, not a log, not a setting, and nothing outside the folder but the Git files of the project a step names (below).
- **It never opens the client's database.** A read-only open of a database in WAL mode fails when its `-wal` and `-shm` are absent, and one of a database being written opens its `-shm` to write and changes it (ADR-0029, fact 8 and what 6d found). So it always copies the database and its `-wal`, never its `-shm`, into a directory of its own (0700, in the state's directory), each read whole and written, taking their sizes and modification times before and after the copy; opens the copy, which is `cota`'s, with `bun:sqlite`; and removes the directory after reading. A copy whose files changed while copied is made again once, and a conversation still changing is not read this run, and is due at the next: the run does not end the folder (its `through` waits).
- It never writes to, locks, checkpoints or moves a file of the client's.
- **No link leads it out.** A `conversations` directory that is a symbolic link is not read: the run says `<folder>/conversations cannot be read: it is a symbolic link, and cota reads no conversation through one`, as it says a folder it cannot read. A database or `-wal` that is a link is read only when its real path is inside the folder's real `conversations` directory, and copied from that path; one that leads out is not read, and the run says `<path> cannot be read: it leads out of <folder>/conversations, and cota reads no conversation out of it`. Either way the folder's run does not end (its `through` waits). A regular `conversations` directory reads as above.

### What it reads

| Table | What is read |
| --- | --- |
| `trajectory_meta` | `trajectory_id`, the trajectory's id, which the call key names, and `cascade_id`, the conversation's id, which must be the database's name (else `schema`). |
| `steps` | `idx`, `step_type`, `status`, `has_subtrajectory`, `metadata` and `step_payload`: every step after the cursor's `step`, or after the `step` of a call before one of its `passed` when that is earlier, in order of `idx`; the greatest `idx`; and the `step_payload` of the last user's message (`step_type` 14) at or before that step, for its workspace. |
| `gen_metadata` | Of each row's `data`, only its field 1, and of that only 3 (the model, a number), 19 (the model's name) and, in the map 20, the entry `last_step_index`. Never the request the newest row holds, its system prompt, messages or tool declarations. |
| `parent_references` | Only whether it has a row. |

Not read: `executor_metadata`, `trajectory_metadata_blob`, `battle_mode_infos`, every other column, and every field of a buffer but those named here. Before reading, it checks with `PRAGMA table_info` that each table and column it reads is there, of the type it expects.

### A model call, in the record

- **A model call is a step whose `metadata` carries usage** (its field 9). Its call key is `<trajectory id>:<idx>`. Its session is the conversation's id, the database's name.
- **Its usage** is `metadata` 9: input 2, cache read 5, cache written for the short time 4, output 3 and reasoning 9 (part of 3), each 0 when absent; no cache written for the long time; and `reported` is `{ "fields": [...] }`, the usage's fields written out in the record form.
- **Its times**: it started at the step's `metadata` 1 (when the step was made) and finished at its 8 (completed), else its 7 (finished generating), else when it started; each `{ 1: seconds, 2: nanoseconds }`. A step's made time never changes, so a call's start is stable (`docs/specs/reported-requests/spec.md`, The id).
- **Its model** is the name (19) of the `gen_metadata` row of the call that produced it: the row whose `last_step_index` is the greatest below the step's `idx`, when no other step lies between them that carries usage or is a model's output (`step_type` 15), finished or not: such a step is another call's, though not read as one yet, so a call reported late or a step read past never lends its row. A step with no such row (a compaction's) has the name of a row of the conversation whose model (3) is its usage's 1, else none. Cut to 200 characters.
- **Its provider request id** is its usage's 11 where it is text of at most 255 characters, else empty. Its stop reason and client version are empty: the record names neither where it was seen.
- **Its project** is read from the workspace (`step_payload` 19.12.12, a `file://` URI) of the last user's message at or before it, from that directory's Git files as a launch reads a project without `git` (the CLI spec's The project): `cota` never runs `git` for a report, which on macOS could ask, from a scheduled run, to install the developer tools. Else empty.
- **Its outcome** is `ok` when its `status` is 3 (done).
- **Its conversation items are steps**, written in the record form `antigravity-steps` (`docs/specs/reported-requests/spec.md`): its `input` the steps after the call before's step through the step before its own, its `output` its own step. A buffer is written out only when it reads back into its bytes exactly: every varint, tag and length in its shortest form, wire types 0, 1, 2 and 5 only, and text only when it is UTF-8 (a byte order mark kept); else the step is `unreadable-step`.

### A step not finished

A step's `status` is 3 when done; 1 (pending), 2 (running) and 8 (generating) are a step not finished, and a tool's step is made, pending, before the model's step that asked for it is done, so a step that follows an unfinished one does not settle it. **A step not finished stops the conversation's reading there, and waits**: the conversation is due at every run, and is **settled** once its database and `-wal` have not changed for 10 minutes. A step that finished is read as any other. Settled, the reading goes on through its unfinished steps: one that carries usage is reported with outcome `error` and `cota_reported_unfinished` as its error type, and one that does not is an item. **A step reported unfinished with usage is final**: the cursor is past it, the hub never changes a reported request, and a step the client finishes after that is not read again, so the log keeps the step as it was when reported. The steps after the last model call wait for the next call, and are reported as its input.

**A step read past without usage may still become a call.** A model's step can be left unfinished before its usage is written, and finished later. So when a reading goes past an unfinished step that carries no usage, the cursor remembers it, with the call before it (`passed`), once the hub stores the call that follows it. Every later reading of the conversation first looks at each remembered step again, in order of `idx`:

- **still not finished**: it stays remembered;
- **done, with usage**: it is a **late call**, read as any model call (A model call, in the record): its call key `<trajectory id>:<idx>`, its `after` the call before remembered with it, its `input` the steps after that call's step through the step before its own, as they are now, and its `output` its own step. It is sent before the conversation's newer calls, and is forgotten once the hub stores it; a step remembered after it whose call before is earlier than it takes it as its call before;
- **anything else** (done without usage, another status, or no longer in the record): it is forgotten.

A step of the range that does not read now stops the conversation, as in A record it cannot read. The calls read past a late call stay as they were reported: they name as `after` the call before it, and hold its step, as it was, among their `input`; so two calls can name one call before (`docs/specs/reported-requests/spec.md`, Checks). `cota requests show` and doctor say nothing of remembered steps: a late call is reported as any other.

A step that carries usage with a `status` other than 1, 2, 3 and 8, none of which was seen, stops the conversation as `unknown-status`; any other step with one is an item.

### A record it cannot read

It reports nothing it cannot read, says why, and never guesses. Each stops a conversation, keeps the reason in `requests.json` and is listed by `cota requests show`, and the calls before it are reported:

| Reason | When |
| --- | --- |
| `schema` | A table or column it reads is missing, or of another type, or the conversation's id is not its database's name: nothing of the conversation is reported. |
| `sub-agent` | `parent_references` has a row (the conversation is a sub-agent's): nothing of it is reported. |
| `subtrajectory` | A step has `has_subtrajectory` set: reading stops at it. |
| `unreadable-step` | A step's buffer is not one the record form writes back exactly, or a column is null, or a call's usage is over 4,294,967,295 or its reasoning over its output, its usage written out over 64 KiB, or its times missing, before 2020 or finished before started: reading stops at it. |
| `unknown-status` | A step that carries usage has a `status` not seen (above): reading stops at it. |
| `rewritten` | The conversation's greatest `idx` is below the cursor's `step`, or its database is shorter than when read: the record changed under it, and nothing more of it is reported. |
| `too-large` | The report that would hold the call alone, written out whole with its other fields, is over 64 MiB, the hub's limit for a body: reading stops at it. |

A run reads such a conversation again only when its files change, and reports from where it stopped if the reason is gone. A conversation of the desktop app, an automatic compaction and a sub-agent are not read until seen (ADR-0029, Left out): they fall under these reasons, or are read as they are. A step of type 17, which T3 Code's source reads as a failed model call's end, was not seen: it carries no usage where T3 Code reads it, and is an item.

## Doctor's check

Doctor gains one check after `titles`. It needs `config`, and `hub-keys` to pass or warn.

| Id | Passes when | Fix |
| --- | --- | --- |
| `requests` | skipped when no folder is kept; otherwise the reporter is scheduled as `cota requests schedule` would install it, its last run was under 5 minutes ago, `requests.error` is absent, each kept folder exists and each kept pool is in the hub's `observedPools`; warned when a conversation is not reported, naming the reason and the conversation, which a failed check names too | `cota requests schedule`; with `requests.error`, what it says, then `cota requests report`; for a folder gone or a pool refused, `cota requests remove <client> <folder>`, or `cota requests add` with an observed pool; for a conversation not reported, `cota requests show`, and an issue when the reason is `schema` or `unreadable-step` (Antigravity changed) |

**A data folder not reported, decided by default.** This check does not warn of a default folder of Antigravity's that holds conversations and is not kept, which would nag an owner who chose not to report one; `cota requests show` lists them. A warning was the owner's other choice, who has not answered; this is the recommendation, taken by default.

## Laws

| Id | Law | Held by |
| --- | --- | --- |
| J19 | **Reading on reads the same.** For any record appended to step by step and read in runs cut anywhere (between steps, on an unfinished step, after a compaction), the model calls read run by run are those of reading the whole record once, with the same usage, model, times and output, but for a step reported unfinished, which stays as it was reported, and the order a late call is read in: a step read past while not finished and without usage, which later finishes with usage, is read by the first run after it finishes, before that run's newer calls; and each call names as `after` the call of the greatest step below its own among those read before it, its input every step between the two, so that a call read past a late one names the call before that late one and holds its step as it was. | property |
| J20 | **A call is sent until it is stored, and then not again.** For any sequence of appends and runs whose reports are answered 200, refused, failed or never, a call is among those each run sends until a report holding it is answered 200, and among none after: a call reported unfinished among them, whatever its step becomes, and a late call from the first run after its step finishes; each call names as `after` a call before it in its conversation, stored before its report or earlier in it: the one just before it, but for a call read past a late one. | property |
| J21 | **Reports within their limits.** Every report holds calls of one folder, at most 200 and 8 MiB but for a call alone over it, in order, and no report's body is over 64 MiB; a run reads a conversation only once the calls it read before and has not sent fit in one report. | property |
| J22 | **As the record says.** A call's usage, model, times and items are those of the record when it was read, and an item written out in the record form reads back into the step's bytes exactly. | property |
| J23 | **Only the conversations' databases, and never written.** A run opens no file of a data folder but `conversations/*.db` and their `-wal`, opens none of them to write, and leaves every file of the folder as it was. | property, contract |
| J24 | **What it cannot read gives nothing, and is said.** For any record with a table or column missing, a sub-agent, a step that is not a protocol buffer or a record rewritten, the calls reported are those before it, and `cota requests show` and doctor name the conversation and the reason. | property |
| J25 | **Reported or launched, never both.** A client is a reported client or a launched one: `cota requests add` takes no launched client, `clients.<client>.reported` decodes for no launched client, and no shim, route or client file is written for a reported one. | types |
| J26 | **Through only once caught up.** A report carries a folder's `through` only when every call the folder's readable conversations held when the run began reading it has been answered 200, and that `through` is the moment the run began. | property |
| J27 | **One run at a time.** Of runs that take the lock at once, over no lock or one whose process is gone, exactly one takes it; the lock appears whole, naming its owner, or not at all; and a run removes only its own lock. | property |

J19, J22 and J24 build generated records (conversations of user messages, model outputs, tool calls and results, compactions and other steps, steps unfinished, with or without their usage, and of a status not seen, buffers of every wire type with text, a byte order mark, non-UTF-8 bytes and nested messages, and the defects of J24) and read them with the reader (`03-domain/antigravity-record.laws.test.ts`), and as SQLite databases in WAL mode in a scratch directory, held open by a writer, with the SQLite reader (`04-infrastructure/antigravity-reader.laws.test.ts`). J20, J21 and J26 run `SendReportedRequests` (the run's command; the hub's is `ReportRequests`) over generated sequences of appends, steps finishing, files changing while copied and runs, against a stand-in for the hub that answers each report 200, 409, 503, 401, undecodable or never, with generated limits (2 to 4 calls and 7,500 to 9,000 bytes to a report), and check every report against what the hub stored before it, and every conversation read against the reports sent before it (`02-application/commands/send-reported-requests.command.laws.test.ts`); every case begins with the same four conversations and four runs, so that each law's mutants are killed whatever the seed, and every case of J19 reads past a model's step and a compaction that finish later, so that both are late calls, the second after the first, and past another model's step and a compaction of another model, the compaction finishing first. J24's naming by `cota requests show` and doctor runs `cota` itself over each reason (`01-presentation/requests.laws.test.ts`). J23 runs the reader over a folder that also holds a token file, a setting, a log and a file that is not a database, through a disk that records each path it reads, lists, stats, resolves, writes or opens as a database, and compares every file's bytes and modification time before and after; then adds a database linked to one outside the folder, and reads another folder whose `conversations` is a link to the first's, and checks each is refused, said, and touches nothing behind the link; its contract half runs `cota requests add` and `report` against a whole hub of the harness, the database held open by a writer. J25 is the types of `Client` and of the configuration's `clients`. J27 starts six runs of `cota`'s lock as processes of their own at one instant, twenty-four times, over no lock and over a dead run's lock, with a token and with its process id alone, and counts the runs that took it; then holds a dead run's lock while a live run is taking it over, and a lock that is not the releasing run's (`04-infrastructure/node-run-lock.test.ts`). J9 (the CLI spec) covers the schedule's definition: no hub key and no variable but those carried. Each law's mutants are in `tooling/mutants.table.ts`.

**Contract tests** (`01-presentation/requests.contract.test.ts`) run `cota requests add`, `report`, `show` and `remove` on a machine of their own, joined to a whole hub of the harness with an observed pool, with a generated record in a data folder in its home: calls reported and read back from `GET /api/sessions/{session}`; a record growing between runs; a report whose answer is lost and is sent again, stored once; a pool not observed refused at `add` and at the hub; the hub away and back, `requests.error` written and removed and doctor's check failing and passing; a conversation not reported listed by `show` and warned by doctor; a machine that has not joined; and sending through `/usr/bin/curl`, where the system has it, a report of several MB and a refusal.

## Not built, on purpose

- **Reading Antigravity's quota.**
- **Choosing or switching a sign-in.** Whatever starts the client with a data folder chose it; `cota` reads the folder it is given.
- **Sub-agents, automatic compaction and the desktop app's conversations**, until seen.
- **Reporting Claude Code's or Codex's transcripts.** They are launched through the hub.
- **Finding data folders by itself.** `cota requests show` lists the default folders; `add` is the owner's.
- **A copy of the record kept by `cota`.** The cursor is the outbox; the record is the copy.
- **Copying less than a whole conversation.** A conversation's database and `-wal` are copied whole each time it is due, however little is new, so a long conversation in use costs a copy of its size at every run that finds it changed. A known cost, not solved now.
