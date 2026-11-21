---
status: active
scope: apps/cli
owner: limineol
last_verified: 2026-11-17
review_by: 2027-02-17
supersedes: []
code:
  - apps/cli/src/03-domain/titles.ts
  - apps/cli/src/03-domain/schedule.ts
  - apps/cli/src/02-application/commands/report-titles.command.ts
  - apps/cli/src/02-application/commands/schedule-titles.command.ts
  - apps/cli/src/02-application/queries/plan-schedule.query.ts
  - apps/cli/src/02-application/interfaces/title-sources.ts
  - apps/cli/src/02-application/interfaces/title-reports.ts
  - apps/cli/src/02-application/interfaces/scheduler.ts
  - apps/cli/src/04-infrastructure/node-title-sources.ts
  - apps/cli/src/04-infrastructure/http-title-reports.ts
  - apps/cli/src/04-infrastructure/curl-title-reports.ts
  - apps/cli/src/04-infrastructure/system-scheduler.ts
  - tooling/mutants.table.ts
---

# The title reporter

What reads the titles a machine's clients write for their sessions and sends the hub those that changed: `cota titles report`, run every 30 seconds by the machine's own scheduler (`CONTEXT.md`, Title reporter). ADR-0022 gives the reasons and where its files live; the rest of `cota` is `docs/specs/cli/spec.md`, and the endpoint it calls, `PUT /api/session-titles`, is `docs/specs/api/spec.md`.

**Status.** Active: milestone 4c built it. The schedulers are behind a port, `Scheduler`, whose adapters run `launchctl`, `systemctl --user` and `schtasks`; the tests drive them with a stand-in that records each command and runs none, so no real scheduler has run them, and nothing of it ran on Windows. Sending through `/usr/bin/curl` is tested against a whole hub, but not from a launchd job (ADR-0022, Facts to confirm). T3 Code's tables are read as the prototype read them, and no real T3 Code database was opened.

## `cota titles report`

On a machine that has not joined, it says so and exits 1, writing nothing. Otherwise:

1. Reads each source that exists, from where the last run stopped (`titles.json`): a byte offset per file. A line is read only once it ends with a line feed; the rest waits for the next run. A file shorter than its offset is read again from 0, and what was read of it before is forgotten. A line that is not JSON is skipped.
   - **Claude Code**, `~/.claude/projects/*/*.jsonl` (`%USERPROFILE%\.claude\projects` on Windows): a line holding `"type":"custom-title"` gives the owner's name (`customTitle`), and one holding `"type":"ai-title"` the generated one (`aiTitle`), the later of each winning; the session is the file's name without `.jsonl`. A first run, one with no `titles.json` that reads, skips files last changed over 14 days before. A file gone is forgotten.
   - **Codex**, `$CODEX_HOME/session_index.jsonl` (default `~/.codex`): each line's `id` and `thread_name`, both strings, the later winning. An index gone is forgotten.
   - **T3 Code**, `~/.t3/userdata/statev2.sqlite`, opened read only: each thread's title that is not deleted, for the session of each client thread behind it (`nativeThreadRef.nativeId`).

   A source that exists but cannot be read is a problem of the run (step 5); the others are still read, and their titles sent.
2. A session's title is the first of T3 Code's, Claude Code's owner name, its generated one and Codex's that is not empty once kept as the hub keeps a title: each lone surrogate U+FFFD, trimmed, cut to 200 code points, with no space left at its end. A session id the hub would refuse (empty, or over 255 code points) is not sent.
3. Sends the sessions whose title differs from the one the hub last kept for them, in batches of at most 1,000, in order: `PUT /api/session-titles` with the subscription hub key, else the keyed one, and `x-cota-machine` (the machine's name, its control characters spaces), waiting 30 seconds for each answer. A batch answered 204 is recorded as kept; any other answer, or none, stops the run, and what was not recorded is sent by the next. A machine with no hub key sends nothing, which is a problem.
4. Writes `titles.json` atomically (0600, in the state's directory, 0700) once the sources are read, after each batch kept, and at the end of a run without a problem, with the time of the run and of the last run that ended without a problem. A `titles.json` that does not read is as if there were none.
5. A run with a problem writes it, with the time, to `titles.error` (`2026-11-17T09:12:03.120Z <problem>; <problem>`), prints each on stderr and exits 1; a run without one removes the file. On standard output it says how many titles the hub kept, or that there was no new title to send.

A session whose title disappears from its sources is forgotten, and its reported title is left on the hub; should the same title come back, it is sent again. On macOS every run, the scheduled one and one run by hand alike, sends through `/usr/bin/curl` (ADR-0022): its whole request, the hub key among it, is curl's configuration on its standard input (`curl --config -`), so neither the key nor a title is in an argument, and curl's exit and the status it writes say what happened. Elsewhere `cota` sends it itself.

## `cota titles schedule`

Installs the schedule of ADR-0022, replacing one already there only when it differs, and says which; `--remove` removes it, and says when there was none to remove. It runs `cota titles report` with no other argument, by the path of the `cota` that installed it, and gives that run only the variables that say where the machine's and Codex's files are, where they are set (`XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `XDG_DATA_HOME`, `CODEX_HOME`): no other variable of the owner's, and no secret, is written into a schedule (J9).

| System | Definition | Installed by |
| --- | --- | --- |
| macOS | `~/Library/LaunchAgents/cota.titles.plist`: `StartInterval` 30, `RunAtLoad`, `ProcessType` `Background` | `launchctl bootstrap gui/<uid>`, after `launchctl bootout` of one loaded |
| Linux | `$XDG_CONFIG_HOME/systemd/user/cota-titles.service` (a `oneshot`) and `cota-titles.timer` (`OnActiveSec` and `OnUnitActiveSec` 30 seconds) | `systemctl --user daemon-reload`, `enable` and `restart` of the timer |
| Windows | the task `cota titles`, whose definition is kept as `titles-task.xml` in the state's directory: two time triggers half a minute apart, each repeating every minute, Task Scheduler's least interval, `IgnoreNew` for a run still going | `schtasks /Create /XML … /F` |

It is installed as given when its definition's files hold what it would write and the scheduler has it loaded (`launchctl print`, `systemctl --user is-enabled` and `is-active`, `schtasks /Query`). Linux without a systemd user session (a container, WSL without systemd) has no scheduler `cota` can use: `cota titles schedule` says so, with the line that runs the reporter every minute from cron, and exits 1; a join says the same and goes on; `--remove` has nothing to remove. Joining schedules it and runs the reporter once (the CLI spec's Joining, step 7), so that doctor, which ends the join, sees a run; leaving removes it first.

## Doctor's check

Doctor (the CLI spec's Doctor) gains one check, last. It needs `config`.

| Id | Passes when | Fix |
| --- | --- | --- |
| `titles` | the reporter is scheduled as `cota titles schedule` would install it, its last run (`titles.json`) was under 5 minutes ago, and `titles.error` is absent. Where the system has no scheduler `cota` can use, a run under 5 minutes ago stands for the schedule: the owner's own scheduler runs it | `cota titles schedule`; on a system without a scheduler, `edit your crontab (crontab -e) to add * * * * * '<cota>' titles report`; with `titles.error`, what it says, then `cota titles report` |

## Laws

| Id | Law | Held by |
| --- | --- | --- |
| J11 | **Reading on reads the same.** For any sequence of appends to a source, cut anywhere, inside a line or a character, the titles read run by run are those of reading the whole once. | property |
| J12 | **A title is sent until it is kept, and then not again.** For any sequence of changes and runs whose batches are kept or fail, a session's current title is among those each run has to send until a batch holding it is answered 204, and among none after until it changes; a run sends them in batches, in order, until one is not kept. | property |
| J13 | **The title shown is the one sent.** A session's title is T3 Code's, else Claude Code's owner name, else its generated one, else Codex's, the first not empty as the hub keeps it, and the hub keeps it as sent. | property |

J11 cuts generated transcripts and indexes (title lines among others, lines that are not JSON, titles with multi-byte characters) at generated byte offsets into runs, and compares what each run has read with reading the bytes up to that run's cut whole, once (`03-domain/titles.laws.test.ts`). J13 chooses among generated titles of each source, absent, empty, blank or padded, and checks the choice and that the hub's own keeping of it (the hub's `keptOf`, restated in the test) changes nothing (`03-domain/titles.laws.test.ts`). J12 runs `ReportTitles` with batches of three over generated sequences of runs, each changing T3 Code's titles and answered 204, 503, 401 or never, against a stand-in for the hub, and checks after each run what the next has to send (`02-application/commands/report-titles.command.laws.test.ts`). J9 (the CLI spec) covers the schedules' definitions: no hub key, and no variable but those carried, in any of them.

**Contract tests** (`01-presentation/titles.contract.test.ts`) run `cota titles report` on a machine of its own, joined to a whole hub of the harness, with transcripts, an index and a T3 Code database written into its home: titles reported and read back from `GET /api/sessions/{session}`; a transcript growing between runs, a line written in two halves and a title changed; a first run skipping an old transcript; the three sources disagreeing; a batch the hub refuses (its titles store failing) and then keeps, with `titles.error` written and removed and doctor's check failing and passing; sending through `/usr/bin/curl`, where the system has it. The scheduler's adapters run against a stand-in for `launchctl`, `systemctl` and `schtasks` that records what it is given (`04-infrastructure/system-scheduler.test.ts`).

## Not built, on purpose

- **OpenCode's and Pi's titles.**
- **Reading a source from anywhere but its default place**: a Claude Code moved with `CLAUDE_CONFIG_DIR`, or T3 Code's database elsewhere.
