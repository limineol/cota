---
name: cota-memory
description: Use when you are asked about past work on any of the owner's machines (what was decided, tried, run, changed or said in an earlier session, by you or another coding agent), when you want to find an earlier session or read its transcript, or when you are asked numbers about the owner's use of models (sessions, requests, tokens, cost). It reads the owner's request log through `cota memory`.
---

# Cota memory

The owner runs a hub, Cota, that every coding agent on their machines (Claude Code, Codex, OpenCode, Pi) sends its model requests through, and it keeps each request in a **request log**: who sent it, when, from which machine and project, and the whole conversation it carried, with every tool call and what came back. That log is your memory of past sessions, the owner's and other agents', and `cota memory` reads it for you.

This works only on a machine that has joined the hub and keeps a reader key. Check first:

## Before you start

```sh
cota memory get /api/machine
```

It answers `{"hubKey":{"name":…,"scope":"reader"},"pools":[]}` when the machine can read the log. If it says `cota: this machine keeps no reader key`, or `has not joined a hub`, or `does not know this machine's reader key`, stop and tell the owner: they give the machine its reader key with `cota memory key`. Do nothing else to get one.

`cota memory` prints the hub's answer on standard output (JSON, as the hub gave it, for `get` and `sql`) and every problem on stderr as a line starting `cota: `; it exits 0 when the hub answered with success and 1 otherwise. A problem of the hub's is `cota: the hub answered <status>: <its problem>`, whose `detail` says what was wrong.

**Times.** Every time is UTC, written `2026-10-06T09:12:00Z` in a parameter. The sessions list and search look at **the last 7 days unless you give `from`**: for anything older, give `from` (and `to`, the end, which is now unless given). When you do not know when it was, give a `from` far back, as the commands below do.

## Find a session by what was said

Search finds the conversation items (a prompt, an answer, a tool call or what it returned) holding **every word** you give, in any order. Words are whole: `retry` does not find `retries`, and a phrase is only its words. Titles are not searched: see the next section for them.

```sh
cota memory get /api/search q='login test flaky' from=2000-01-01T00:00:00Z
```

Each of its `hits` has the `session`, the `request` that first carried the item, its `part` and `role`, when it was first seen (`at`), and a `snippet` of its text. `next`, when it is not `null`, is a cursor: give it as `cursor=<next>` with the same parameters for the next page. `limit` is 1 to 100 hits (20 unless given).

The sessions list takes the same `q` and answers sessions rather than items, each with its `id`, its `title` (or `null`), its `firstPrompt`, its `projects`, `machines`, `clients` and `models`, when it started and ended, its usage and its `costUsd`:

```sh
cota memory get /api/sessions q='login test flaky' from=2000-01-01T00:00:00Z
```

When the exact words find nothing, widen them: `prefix=true` also matches words that start with yours, and `fuzzy=0.2` words within a few letters of yours:

```sh
cota memory get /api/search q='flakey' prefix=true fuzzy=0.2 from=2000-01-01T00:00:00Z
```

Both take filters, each repeatable (`project=a project=b` is either): `project`, `machine`, `client` (`claude-code`, `codex`, `opencode`, `pi`), `model`, `pool`, `provider`. A project is its repository's path, lowercased, such as `acme/billing`.

## Find a session by its project, machine, time or title

The sessions list without `q` lists every session of the window, the newest first (`sort=recent`; also `requests`, `tokens`, `cost`), 50 at a time (`limit` up to 200, `offset` to page):

```sh
cota memory get /api/sessions project=acme/web machine=laptop from=2026-11-02T00:00:00Z to=2026-11-03T00:00:00Z
```

A title is found in SQL (the section on SQL says more). A session's title is the latest one reported for it:

```sh
cota memory sql <<'SQL'
SELECT session, argMax(title, (reported_at, machine, title, reported_by)) AS title
FROM session_titles
GROUP BY session
HAVING title ILIKE '%login%'
SQL
```

## Read a transcript

Never read a session's detail (`/api/sessions/<id>`) or a request (`/api/requests/<id>`) with `get`: a long session is megabytes. Read its transcript a page at a time:

```sh
cota memory transcript 5f2b9c1e-8a47-4d3b-9e61-0c7d2a4f8b13
```

The first line says which segment it read: a long session is split in **segments** where the client compacted its conversation or started afresh, and the transcript is the last segment's, read from its last request (its **tip**); a line for each segment follows, with its tip. Then each entry, numbered: `#<n> <part>, <what>` (a message and its role, reasoning, a tool call and its name, a tool result), then its text, cut at 300 characters, and `… [<n> characters left out]` when anything was. The last line says which entries were shown and where the next page starts:

```sh
cota memory transcript 5f2b9c1e-8a47-4d3b-9e61-0c7d2a4f8b13 --from 41
```

To read one entry whole, give it alone with a larger cut (up to 100,000):

```sh
cota memory transcript 5f2b9c1e-8a47-4d3b-9e61-0c7d2a4f8b13 --from 7 --entries 1 --cut 20000
```

`--entries` is 1 to 200 (40 unless given). An earlier segment, or the request a search hit names, is read by its id, with the same options:

```sh
cota memory transcript --request 019a3c5e-2f10-7b44-8c9d-6e1f0a2b3c4d
```

Tool calls and their results from earlier turns appear as `input` entries: a client sends its whole conversation with each request, and the last request's answer is the `output`.

## Ask in SQL

`cota memory sql` sends the SQL on its standard input to the request log's ClickHouse, read-only, and answers `{ columns, rows, truncated, elapsedMs }`: each row an array in the order of `columns`, 64-bit numbers and decimals as strings, times in UTC. Every table and its columns:

```sh
cota memory get /api/schema
```

The ones worth knowing:

- `requests`, one row a request: `id`, `started_at`, `session`, `machine`, `project`, `client`, `pool`, `provider`, `model`, `operation` (`messages`, `responses`, `chat`; `models` for a model listing, which is no work of a session's), `purpose`, `outcome` (`ok`, `error`, `refused`, `cancelled`), `error_type`, `error_message`, `input_tokens`, `cache_read_tokens`, `output_tokens`, `cost_usd` (dollars, `NULL` when the model has no price), `duration_ms`.
- `items`, one row a conversation item of a session, kept once however many requests carried it: `session`, `request_id` (the first request that carried it), `first_seen`, `part` (`system`, `tools`, `input`, `output`), `type`, `role`, and `text`, what a transcript shows of it.
- `request_items`, one row a request: the digests of the items it carried, by part, in order.
- `session_titles`, one row a title reported: `session`, `title`, `reported_at`, `machine`, `reported_by`.

How many sessions each project had on each machine in a week:

```sh
cota memory sql <<'SQL'
SELECT project, machine, uniqExact(session) AS sessions, min(started_at) AS first, max(started_at) AS last
FROM requests
WHERE started_at >= '2026-11-02 00:00:00' AND started_at < '2026-11-09 00:00:00'
  AND session != '' AND operation != 'models'
GROUP BY project, machine
ORDER BY project, machine
SQL
```

What each project cost in a month:

```sh
cota memory sql <<'SQL'
SELECT project, round(sum(cost_usd), 2) AS cost_usd, count() AS requests
FROM requests
WHERE started_at >= '2026-11-01 00:00:00' AND started_at < '2026-12-01 00:00:00'
GROUP BY project
ORDER BY cost_usd DESC
SQL
```

A phrase, or part of a word, which search cannot find (slower: it reads every text):

```sh
cota memory sql <<'SQL'
SELECT session, request_id, part, role,
  substringUTF8(text, greatest(1, positionCaseInsensitiveUTF8(text, 'connection reset') - 80), 240) AS around
FROM items
WHERE positionCaseInsensitiveUTF8(text, 'connection reset') > 0
ORDER BY first_seen DESC
LIMIT 20
SQL
```

The limits: one statement, read-only, 30 seconds, 5,000 rows or 16 MiB of answer (`truncated` says when rows were left out), and no `FORMAT` clause. A query past a limit is a `400` whose `detail` says which.

## What the log cannot tell you

- **What never went through the hub**: a client started without `cota` or with `COTA=off`, one that went straight to its provider while the hub could not be reached, and anything before the hub started, but what the owner imported from an earlier log. "Not in the log" is not "never happened".
- **What a session did outside its conversation**: files it wrote and commands it ran are there only as the tool calls and results the model saw; a terminal of the owner's is not there at all.
- **An imported request's conversation is in its source form**: a request whose `protocol` is `bifrost-responses` or `bifrost-chat` came from an earlier log, and its transcript reads as that log kept it, not as the client sent it.
- **Whether something is true now**: a transcript says what was so then. Check the code before you rely on it.

## What you must never do

- **Never print, read, copy or ask for the reader key.** It stays in its file, and `cota memory` sends it for you. Do not look for it, and do not call the hub any other way (`curl`, a browser, another tool): what you run and read goes into the request log in the clear.
- **Never paste a secret you read in a transcript onward**: a key, a token, a password, a signing secret, a connection string. Name it instead (`the DATABASE_URL in .env`), in an answer, a file, a commit, a message or a command.
- **Never widen what the key can do**: do not ask for another key, do not write to the request log, do not change the hub's or a machine's configuration.
- **Never present a guess as a memory.** Say which session an answer came from (its id, title or first prompt, and when), and say plainly when the log does not hold it.
