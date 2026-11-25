---
status: active
scope: repository
owner: limineol
last_verified: 2026-11-24
review_by: 2027-02-19
supersedes: []
code:
  - skills/cota-memory/SKILL.md
  - apps/cli/src/03-domain/memory.ts
  - apps/cli/src/01-presentation/command-line.ts
  - apps/cli/src/02-application/queries/read-memory.query.ts
  - apps/cli/src/02-application/commands/keep-reader-key.command.ts
  - apps/cli/src/02-application/queries/doctor.query.ts
  - apps/cli/src/04-infrastructure/http-hub.ts
  - docs/install.md
---

# The memory skill

The **memory skill** (`CONTEXT.md`) lets a coding agent on one of the owner's machines use the request log as its memory: find a past session by what was said in it, or by its project, machine, time or title; read its transcript a page at a time; and ask the request log anything in SQL. It is one file, `skills/cota-memory/SKILL.md`, and it reaches the hub only through `cota memory`, which sends the machine's reader key for it. ADR-0026 gives the reasons; the evals that check it are `docs/specs/memory-evals/spec.md`.

## What the hub and `cota` lacked, and what was built

| The skill needs | What there was | What was built |
| --- | --- | --- |
| A reader key on the agent's machine | `cota join` refuses one; the owner's is a file on the hub's machine | `cota memory key`, which keeps it in `hub-keys/reader` |
| To send it without the agent seeing it | Nothing but `curl`, with the key in the agent's shell | `cota memory get` and `cota memory sql`, which read the hub's address and the key themselves |
| A transcript that fits in a context | The session detail sends the last segment's transcript whole, texts cut at 20,000 characters | `cota memory transcript`, which prints a page of it, each text cut, on the machine |
| A title to search | Search finds conversation words, not titles; no endpoint filters by title | Nothing: SQL over `session_titles` answers it, and the skill gives the query |
| A phrase, or part of a word | Search matches whole words, in any order (`docs/specs/search/spec.md`) | Nothing: SQL's `positionCaseInsensitiveUTF8` over `items.text` answers it, more slowly, and the skill gives the query |

The hub is unchanged.

## The skill

`skills/cota-memory/SKILL.md` begins with front matter, `name: cota-memory` and a `description` that says when to use it: the agent is asked about past work (what was decided, done, tried, run or said in an earlier session, on any of the owner's machines), or wants to find an earlier session, its transcript, or numbers about the owner's use of models. Then, in this order, it says:

1. **What the request log is**, in two sentences, and when the skill applies: only on a machine that has joined a hub and keeps a reader key (`cota memory key`); without one, the agent asks the owner and does nothing else.
2. **Finding a session by what was said in it**: `cota memory get /api/search` and `/api/sessions` with `q`, with `prefix` and `fuzzy` when the exact words find nothing; the window, which is the last 7 days unless `from` says otherwise; the filters (`project`, `machine`, `client`, `model`, `from`, `to`).
3. **Finding a session by its project, machine, time or title**: the sessions list with filters, and SQL over `session_titles` for a title.
4. **Reading a transcript**: `cota memory transcript`, a page at a time; an earlier segment by its tip; one entry whole.
5. **Asking in SQL**: `cota memory sql`, the tables and columns worth knowing (`requests`, `items`, `request_items`, `session_titles`), four queries that answer real questions, and the limits (read-only, 30 seconds, 5,000 rows or 16 MiB, one statement, no `FORMAT`).
6. **What the request log cannot tell**: what was never sent through the hub (a client launched without `cota`, with `COTA=off`, or going direct while the hub could not be reached; anything before the hub started, but what an import brought); a session's work outside its conversation (files written, commands run in another terminal); and an imported request's conversation, which is in its source form (`protocol` `bifrost-responses` or `bifrost-chat`), not the client's.
7. **What it must never do**: print, read or copy the reader key (it stays in its file, and `cota memory` sends it); paste a secret it reads in a transcript (a key, a token, a password, a connection string) into an answer, a file, a commit or a message, naming it instead; widen what the key can do (ask for another key, call the API another way, write to the request log); and present a guess as a memory: an answer says which session it came from, and says plainly when the log does not hold one.

Every command in it is one the scripted answerer runs as written against a memory world's hub (`docs/specs/memory-evals/spec.md`): the evals read its fenced blocks by section, so a command changed in the skill changes what the evals run.

## Installing it

A machine's agents read the request log only where the owner chose it for that machine: a reader key reads every conversation every machine logged, secrets a client printed among them. The install prompt asks the owner, for each machine that joins, whether its coding agents may read the request log (`docs/install.md`, Ask the owner first, question 5), and on each machine the owner said yes for, once doctor passes, gives it the reader key and copies the skill (Each machine, step 5):

```sh
cota memory key < "$HOME/cota-hub/secrets/agents"   # on the hub's machine; elsewhere the owner runs it alone and pastes the key at the prompt
cota memory get /api/machine                        # its hubKey's scope is reader
mkdir -p ~/.claude/skills/cota-memory && curl -fsSL -o ~/.claude/skills/cota-memory/SKILL.md "https://github.com/limineol/cota/raw/v<version>/skills/cota-memory/SKILL.md"
```

The installer gives the key itself only on the hub's machine, from its file; on another machine the owner types it, and the key is never in a command, an argument, a file of its own or the conversation. A release does not publish the skill (ADR-0027 lists what it does), so a machine with no checkout takes `SKILL.md` from the repository at the release's tag, which GitHub serves from `raw.githubusercontent.com`; nothing checks it against `SHA256SUMS`, as the release's own files are. From a checkout, `cp -R skills/cota-memory ~/.claude/skills/` copies the same folder.

Claude Code reads a user's skills from `~/.claude/skills/<name>/SKILL.md`. Where Codex, OpenCode and Pi read them (`~/.codex/skills`, `~/.agents/skills`, `~/.config/opencode/skills`, `~/.pi/agent/skills` are their documented or likely places) is to be confirmed on each client before the install prompt names it; until then the prompt copies the skill into Claude Code's folder alone, and the owner copies it where another client's own documentation says.

## Doctor's check

Doctor (the CLI spec's Doctor) gains one check, `memory`, after the request reporter's `requests`, last. It needs `config`, and `hub` to pass; `hub-keys` checks only the subscription and keyed keys, so this is the one check that asks the hub about the reader key.

| Outcome | When | Problem | Fix |
| --- | --- | --- | --- |
| passed | `hub-keys/reader` holds a key the hub answers (`GET /api/machine`, waited for 5 seconds, as `hub-keys` asks) with the scope `reader` | | |
| warned | the machine keeps no reader key: the file is absent or holds only spaces | `this machine keeps no reader key, so coding agents on it cannot read the request log with cota memory` | `cota memory key, if the owner wants this machine's agents to read the request log` |
| failed | the hub does not know the key, does not say what it is within 5 seconds or cannot say, or knows it under another scope; or the file cannot be read | as `hub-keys` words it for the reader key (`the hub does not know the reader hub key`, `the hub key kept as the reader one is a subscription key`), or `<file> cannot be read: <why>` | `cota memory key` |
| skipped | `config` failed, or `hub` did not pass | | |

A warning is not a failure: doctor's exit and `--json`'s `ok` are as they were, so a machine whose owner gave it no reader key passes doctor with this warning, which the install prompt says to expect (`docs/install.md`, Each machine, step 3). The check reads the key and shows it only to the hub, in `x-cota-key`, as `hub-keys` shows the others; it prints and returns nothing of it (J9 runs doctor on a machine that keeps a generated reader key). Its mode is the `files` check's, as every hub key's is. Its outcomes are held by a contract test (`apps/cli/src/01-presentation/memory.contract.test.ts`: none, a reader key, a key the hub does not know, a subscription key kept as the reader one) and by J14 over machines that keep a reader key in each state; its mutants are in `tooling/mutants.table.ts`.

## `cota memory`

Every subcommand needs a machine that has joined (`config.toml` with `hub`), and all but `key` the reader key. `key` waits 5 seconds for the hub, as a join does; the others 40 seconds, longer than the SQL console gives a query. `get`, `sql` and `transcript` print the answer on standard output and every problem on stderr, starting `cota: `; each subcommand exits 0 when the hub answered with success, 1 otherwise, and 2 when used wrongly (`sql` given no query among them).

| Subcommand | Does |
| --- | --- |
| `cota memory key` | Reads one key (standard input's first line that is not empty, or a prompt that does not echo), asks the hub what it is (`GET /api/machine`), and keeps it in `hub-keys/reader` (0600, its directories 0700) only when the hub knows it and its scope is `reader`. It says `cota: kept the reader key; cota memory reads the request log with it.`, or why not: no key given, the hub not reached, a key the hub does not know, or a key of another scope (`that is a subscription hub key; cota memory needs a reader key, which opens no pool`), never the key. |
| `cota memory get <path> [<name>=<value>…]` | `GET <hub><path>`, where `<path>` starts `/api/` and holds no query; each `<name>=<value>` is a query parameter, split at its first `=`, a name given twice sent twice, in order, each encoded by `cota`. Prints the answer's body as the hub gave it. |
| `cota memory sql` | Reads SQL from standard input (one statement, not empty) and sends it as `POST /api/sql`. Prints the answer's body as the hub gave it: `{ columns, rows, truncated, elapsedMs }`. |
| `cota memory transcript <session>`, or `cota memory transcript --request <id>`, with `[--from <n>] [--entries <n>] [--cut <n>]` | Prints a transcript page (below): of the session's last segment, from its detail (`GET /api/sessions/{session}`), or of one request, from the inspector (`GET /api/requests/{id}`). It takes a session or `--request`, not both. |

A problem the hub answers (4xx or 5xx) is printed on stderr as `cota: the hub answered <status>: <its body>` (for `transcript`, the problem's detail, else its title, in place of the body) and exits 1; a hub that cannot be reached is `cota: <hub> cannot be reached, or did not answer within 40 seconds.`; a machine without a reader key is `cota: this machine keeps no reader key; the owner gives it one with cota memory key.`; a reader key the hub does not know (401) is `cota: <hub> does not know this machine's reader key; the owner gives it again with cota memory key.` Neither `get` nor `sql` reads the answer beyond its bytes, so what is printed is exactly what the hub said.

### A transcript page

`--from` is the first entry shown, counting from 1 (default 1); `--entries` how many at most (1 to 200, default 40); `--cut` the characters (code points) of each entry's text shown at most (1 to 100,000, default 300). An entry's **text** is, for a message, its parts one a line (a text part's text, an image as `[image <media type>, <n> bytes]`, another part's JSON); for reasoning, its text, or `[hidden]`; for a tool call, its input; for a tool result, its output; for an other, its JSON.

```text
session 0194a1c0-…: segment 2 of 2, read from its tip 0194a2f1-… (anthropic-messages), 37 entries
segment 1: 14 requests from 2026-10-06T10:00:00.000Z, tip 0194a1d3-…
segment 2: 9 requests from 2026-10-06T11:42:10.000Z, tip 0194a2f1-…
#1 system, system message
You are Claude Code, …
… [2104 characters left out]
#2 input, user message
The webhook sender drops events when …
#3 output, tool call Bash (toolu_01)
{"command":"grep -rn ECONNRESET src/webhooks"}
entries 1 to 3 of 37; the next page: --from 4
```

The first line names what the page is read from: for a session, its segment and tip, then one line a segment, so an earlier segment is read with `--request <its tip>`; with `--request`, `request <id> (<protocol>), <n> entries`. Each entry is a line `#<n> <part>, <what>` (`<role> message`, `reasoning`, `tool call <name>` with its call id in brackets when it has one, `tool result of <name>` or `tool result` with `, an error` when it is one, `other`), then its text cut at `--cut`, then `… [<n> characters left out]` when anything was: what the page cut and what the hub cut before it (20,000 characters of a text in a session's detail, 100,000 in the inspector). The last line says which entries were shown and where the next page starts, or `that is the last.` A session with no main request with a conversation prints `session <id> has no transcript: no main request of it carries a conversation.`, a request without one `request <id> has no transcript: the request log kept no conversation of it.`, and each exits 0. A `--from` past the last entry prints the first line and `there is no entry <n>: the transcript has <total>.`

## Laws

| Id | Law | Held by |
| --- | --- | --- |
| O1 | **A page is bounded, and says what it left out.** For every transcript and every page asked of it, the page shows at most `--entries` entries, each text at most `--cut` characters, and the number it gives as left out of each is the text's whole length less what it shows, plus what the hub cut. | property |
| O2 | **Pages partition a transcript.** Reading pages from the first entry, each from the start the page before gave, shows every entry exactly once, in order, and ends with the page that says it is the last. | property |
| O3 | **The reader key stays in its file.** No `cota memory` subcommand prints the reader key, in an answer, a line of its own or a problem, or passes it in any argument; it reaches only the hub, in `x-cota-key`. | contract |

O1 and O2 run the page's rendering (`apps/cli/src/03-domain/memory.ts`, `pageOf`) over generated transcripts of every kind of entry, texts of one to four UTF-8 bytes a character, around and past the cut, with and without the hub's own cut, and generated pages, `memory.laws.test.ts`. O3 runs `cota memory key`, `get`, `sql` and `transcript` against the harness's hub (`apps/cli/src/01-presentation/memory.contract.test.ts`), with the reader key given on standard input and at a prompt, the hub answering every way (success, a problem, a key it does not know, a key of another scope), and finds the key in no line printed, no prompt and no problem.

## Not built, on purpose

- **`curl` in the skill**, and **an MCP server** (ADR-0026).
- **Transcript pages from the hub.** `cota` cuts what the hub sends whole.
- **Searching titles from the API.** SQL over `session_titles` answers it.
- **Installing the skill from `cota`.** The install prompt's agent copies it on the owner's word, into Claude Code's folder alone until the other clients' folders are confirmed; `cota` writes into no client's folder for it (ADR-0026).
- **Writing to the request log through `cota memory`.** `get` only reads, and the SQL user cannot write; a reader key's one write, reporting titles, is `cota titles report`'s.
