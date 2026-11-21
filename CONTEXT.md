---
status: active
scope: repository
owner: limineol
last_verified: 2026-11-19
review_by: 2027-02-15
supersedes: []
code:
  - apps/hub/src/shared/03-domain
  - apps/hub/src/modules/admission/03-domain
  - apps/hub/src/modules/relay/03-domain/fallback.ts
  - apps/hub/src/modules/request-log/03-domain
  - apps/hub/src/modules/quota/03-domain
  - apps/hub/src/modules/sign-in/03-domain
  - apps/hub/src/modules/display-names/03-domain
  - apps/web/src/shared/domain
---

# Context

The shared vocabulary for code, copy, specs and conversation. A new domain concept gets its term here before it gets a type, a table, a route or a screen. The specs in `docs/specs` hold behaviour; this file holds meaning.

## The fleet

**Owner**:
The person who runs Cota, holds the subscriptions and reads the dashboard. Cota has one owner, who signs in with the owner password or a passkey.
_Avoid_: user, admin, tenant

**Owner password**:
The secret the owner gives to sign in to the hub. Either the configuration holds it, like any other secret, or the owner chose it in the browser and the hub store keeps its argon2id hash, never the password; the configuration's wins.
_Avoid_: login (a login is a client's credential for a pool), admin password, credentials

**Passkey**:
A WebAuthn credential the signed-in owner made in their browser, kept by a password manager or a device, that signs them in with no password to guess. The hub keeps its public key, never a private one, with the origin and host name it was made at, and it signs in only there. It is named for the browser that made it.
_Avoid_: security key (a passkey may live on one), WebAuthn credential outside the code, token, device

**Way in**:
How the owner can sign in to a hub: the owner password in the configuration, the stored one, or a passkey. A hub with one is set up, and the API never removes the last.
_Avoid_: credential, login (a login is a client's credential for a pool), factor, method

**Set up**:
A hub is set up once the owner has a way in. A hub that is not set up lets no owner in until someone gives it its setup code.
_Avoid_: installed, initialised, onboarded

**Setup code**:
The one-time code a hub that is not set up prints in its log at start, which proves whoever sets it up can read that log. Twelve characters in three groups, new at every start, and useless once the hub is set up.
_Avoid_: setup token, claim code, PIN, one-time password

**Sign-in**:
The owner's proof, held by one browser, that they gave the owner password or signed with a passkey: a random token the hub remembers only by its digest, until it expires or is revoked. Signing out revokes it.
_Avoid_: session (a session is a client's conversation), login, cookie (that is how a browser carries it), token

**Caller**:
Who a request to the hub's API comes from, decided once for the request: the owner, with the sign-in that admitted them, or a hub key, with its name and scope. An endpoint says which callers may call it.
_Avoid_: user, principal, identity, client (a client is a coding tool)

**Hub store**:
The hub's own file of what changes while it runs and is not the request log: sign-ins, the owner password's hash when the owner chose it in the browser, passkeys' public keys, display names and quota logins. It holds secrets, so the owner guards and backs it up as they do the configuration's secrets.
_Avoid_: database, settings, state, cache

**Hub**:
The Cota server. Every machine sends its clients' requests through it.
_Avoid_: gateway (that is what the hub is, not what it is called), proxy, router, server

**Machine**:
A computer the owner works on. A request is tagged with the machine it came from.
_Avoid_: host (the tag's wire name only), device, node, box

**Client**:
A coding tool that makes requests: Claude Code, Codex, OpenCode, Pi.
_Avoid_: harness, agent, tool, app

**Provider**:
The company or server that answers a request: Anthropic, ChatGPT, Z.ai, OpenCode Go, a local model server.
_Avoid_: upstream (a direction, not a party), vendor, backend

**Model**:
The model a request asks for, by the id the provider knows it by. A provider can limit one model while another still has allowance.
_Avoid_: engine, deployment

**Project**:
What the owner is working on when a request is made: the repository's `owner/repo`, or the directory name outside a repository.
_Avoid_: repo, workspace, cwd

## Pools and logins

**Pool**:
Whatever a request bills: one subscription, one API plan, or one local model server. Every request bills exactly one pool.
_Avoid_: account, plan (a **plan** is the name of a pool's subscription, never the pool), key, provider (several pools can share one provider)

**Login**:
The credential a client sends to spend a subscription pool. The hub forwards a client's login and never stores it.
_Avoid_: token, key, credential, session, auth

**Login fingerprint**:
A one-way digest of a login. The hub remembers fingerprints, never logins.
_Avoid_: login id, token hash

**Kept login**:
A login the owner gave the hub on purpose: the login of a fallback pool, in the configuration, or a **quota login**, in the hub store.
_Avoid_: stored token, service account

**Quota login**:
A kept login the hub uses only to read a pool's quota windows, never to forward a request: an OAuth login of the pool's subscription (its access token, its refresh token, when the access token ends, and what the provider needs beside them), given to the hub through its API and kept in the hub store, at most one per pool. The hub refreshes it as the provider's own client would. Each giving is a **generation** of the pool's quota login, an id made when it is given: refreshed, it is the same generation; given again, a new one.
_Avoid_: usage token, dashboard login, OAuth token, kept login alone where only a quota login is meant

**Hub key**:
The secret a machine sends to prove it may use the hub. A hub key cannot spend a subscription by itself: the client's login does that.
_Avoid_: virtual key, API key, VK

**Own login**:
The login a client keeps for itself on a machine, from its own sign-in flow (Claude Code's `/login`, `codex login`). The subscription pool it spends is the client's **own pool** on that machine, which the machine's configuration names, or else the client's **default pool**.
_Avoid_: personal login, default login, native login, account

**Machine login**:
A login a machine keeps for one subscription pool other than its client's own pool, made with the client's own command for a long-lived login (`claude setup-token`) and given to the machine with `cota login <pool>`. The launcher hands it to the client in place of its own login when a route names that pool. The hub forwards it like any login and never keeps it.
_Avoid_: token, setup token (that is how one is made), kept login (a kept login is the hub's), account token, work login

**Route**:
One of a client's ordered rules on the hub: a **project pattern** and the pool a launch of that client bills for a project the pattern matches. A launch takes the first of its client's routes whose pattern matches its project, else the client's **default pool**. Routes choose a pool for a launch; they never open a pool a hub key's scope does not.
_Avoid_: mapping, rule alone, account selection, policy

**Project pattern**:
What a route matches a project with: a project exactly, or the start of one followed by `*` (`acme/*`), compared without regard to case.
_Avoid_: glob, regex, filter, wildcard alone

**Shadowed route**:
A route that can never be a first match, because an earlier route of its list matches every project it matches (`acme/*` before `acme/api`). The hub refuses to store one.
_Avoid_: unreachable route, dead route, overlap

**Default pool**:
The pool a client's launch bills when none of its routes matches the project. A client has at most one; a client with neither a matching route nor a default pool has no route, and its launch stops.
_Avoid_: fallback (a fallback pool takes refused logins), catch-all, personal

**Subscription pool**:
A pool spent with a login: a Claude or ChatGPT subscription.

**Keyed pool**:
A pool spent with a key the hub holds, or with none: an API plan, or a local model server.
_Avoid_: API pool, fleet pool

**Held key**:
The provider's key for a keyed pool. The hub holds it; no client ever sees it.
_Avoid_: API key (a hub key is also a key), provider key, upstream key

**Hub key scope**:
What a hub key opens: the pools of one kind (subscription or keyed), or, for the reader scope, no pool at all but the request log through the hub's API. A hub key has one scope.
_Avoid_: permission, role

**Reader key**:
A hub key of the reader scope: what an agent the owner trusts sends to read the request log through the API. It spends nothing and changes nothing but the session titles any hub key may report. A machine keeps one for its agents only when the owner gives it with `cota memory key`, and only `cota memory` sends it.
_Avoid_: API key, read token, agent key

**Tag**:
A fact a client states about its request: the project, the machine, the client. Tags describe a request; they never decide who pays.
_Avoid_: label, metadata, dimension

## Machines and the CLI

**CLI**:
`cota`, the one command a machine runs: it joins the machine to a hub, launches clients through the hub, keeps the machine's logins, configures the clients that read a configuration file, reports titles and runs doctor. In code it is `apps/cli`.
_Avoid_: client (a client is a coding tool), agent, daemon, wrapper, shim (a shim is one of its parts)

**Join**:
To make a machine one of a hub's: `cota join <hub>` keeps the hub's address and the machine's hub keys, installs the shims, configures the clients and schedules the title reporter. A joined machine has one hub; `cota leave` undoes a join.
_Avoid_: install (installing puts `cota` on a machine; joining connects it to a hub), enrol, register, set up (a hub is set up), onboard

**Launch**:
To start a client through `cota`: find the client's real command, read the project, ask the hub for the route, give the client the hub's address, the hub key, the tags and the right login, and start it with the arguments it was given. What `cota` does to start a client is the **launcher**.
_Avoid_: wrap, proxy, run alone, spawn, exec

**Shim**:
A file named for a client's command (`claude`, `codex`, `opencode`, `pi`) in a directory `cota` puts first on `PATH`, which launches that client through `cota` with the arguments it was given. `cota <client>` launches without one.
_Avoid_: wrapper, alias, symlink, hook

**Override**:
The pool the owner names for one launch (`COTA_POOL`, or `cota --pool <pool> <client>`), which the hub answers in place of the route. It chooses a pool as a route does and opens nothing a route cannot.
_Avoid_: account, force, pin, route (an override is not stored)

**Bypass**:
The owner's choice to start a client as if `cota` were not there (`COTA=off`): no hub, no tags, no change to its login, its environment or its arguments.
_Avoid_: going direct (that is `cota`'s, when the hub cannot be reached), off switch, disable

**Going direct**:
A launch whose hub cannot be reached in time, started without the hub: to its provider with the login its route would have used, so its requests are neither logged nor diverted. It says so in one line, and never happens where it cannot work: a keyed pool, whose held key only the hub has.
_Avoid_: bypass (the owner's choice), offline mode, fallback (a fallback pool is the hub's), failover

**Kept answer**:
The last pool the hub answered a machine's launch of a client in a project, which the machine keeps (`routes.json`) so that a later launch in that project, the hub unreachable, goes direct with that pool's login, or waits longer for a pool not the client's own. It is never the route: the hub's answer always wins.
_Avoid_: cache, cached route, local route

**Title reporter**:
What reads the titles a machine's clients write for their sessions and sends the hub those that changed since it last sent them: `cota titles report`, run every 30 seconds by the machine's own scheduler.
_Avoid_: titles daemon, sync, watcher, agent

**Doctor**:
`cota doctor`: runs every **check** of a machine and says, for each that fails, what is wrong and the command that fixes it.
_Avoid_: diagnose, health check (that is the hub's `/health`), status, verify (that is `bun run verify`)

**Check**:
One thing doctor looks at on a machine, with its outcome: passed, failed, or a warning that works but is worse than it should be. A failed check names the command that fixes it.
_Avoid_: test (tests are the repository's), probe, rule, gate (gates are the repository's)

**Install prompt**:
The instructions, written for a coding agent, that install `cota` on a machine and join it to a hub: the owner pastes them into an agent on that machine.
_Avoid_: setup script, onboarding guide, install script

## Install evals

**Install eval**:
One run of an **installer** following the **install prompt** for one **install task**, in a **world** of its own, judged by its **criteria**. It shows the prompt can be followed to a working install; it is not a gate of every commit.
_Avoid_: install test, e2e test, smoke test

**Install task**:
What the owner wants installed, written as the owner would say it (where the hub runs, which pools, which machines and clients, which routes), with the same answers set out for the **scripted owner** and the criteria to read.
_Avoid_: scenario, fixture, spec

**World**:
One install eval's own Compose project, `cota-install-<run>`: its **clean machines**, the hub's with a Docker engine of its own that runs the **deployment**, and its fake provider, on a network of its own, made before the installer starts and removed whole after the criteria are read.
_Avoid_: environment, sandbox, stack

**Clean machine**:
A container with what a developer's Linux machine has (a shell, `git`, `curl`, `openssl`, `cron` and Bun), a user without root, the owner's own files, a checkout of Cota, and **stand-in** clients, but nothing of Cota installed.
_Avoid_: VM, box, fresh machine

**Stand-in**:
A program in the place of Claude Code or Codex that records what it was given and, asked, sends one request as the client would. No eval and no test runs a real client.
_Avoid_: mock client, fake client, dummy

**Scripted owner**:
Who answers an install eval's installer as the owner would: the answers to the prompt's questions, from the install task, and the steps only the owner does (typing a key, which is a fake; the Setup screen, through the API; a machine login; the routes; the crontab), never handing the installer a secret. It reads what a message asks by the prompt's own words, and its **owner's hands** do the steps.
_Avoid_: user simulator, mock owner

**Owner's hands**:
The steps only the owner does, as code with the eval's fakes, shared by the scripted owner and the model owner: whatever understands the owner's messages chooses a step, and the hands do it. Nothing else of the owner's ever runs.

**Model owner**:
The owner played by a small model for an agent installer, whose messages the scripted owner would not understand: the model reads each message with the conversation so far and answers with the owner's words and the owner's steps, which the owner's hands do. It never sees a secret.
_Avoid_: simulated user, LLM owner

**Installer**:
What follows the install prompt in an install eval, behind one port: given the prompt, the machines and the owner, it acts in the machines and talks to the owner until it says it is done. The **rehearsal** is one; the **agent installer** is the other.
_Avoid_: agent (any coding agent; the installer is the eval's port), runner, bot

**Agent installer**:
A coding agent as the installer: a headless Claude Code on the host, with its own login, whose only tools are the eval's two (a command in a named machine, and a message to the owner), stopped at its time, turn and spend limits. Its owner is the model owner.
_Avoid_: real installer, live agent

**Rehearsal**:
The scripted installer: it does what the install prompt says, taking every command from the prompt's own fenced blocks, and fails on a block it does not know. It shows the prompt can be followed as written, not that an agent would follow it.
_Avoid_: dry run, simulation, script

**Criterion**:
One thing an install eval reads to say the install is done or broke a rule of the prompt's Never, with its verdict, passed or failed, and what was wrong. A run passes only when every criterion does.
_Avoid_: check (that is doctor's), assertion, gate, score

## The memory skill

**Memory skill**:
The instructions, written for a coding agent, that let it use the request log as its memory: find a past session by what was said in it, by its project, machine, time or title, read its transcript a page at a time, and ask the request log anything in SQL, all through `cota memory` with the machine's reader key. It is a skill in the form coding agents load (`skills/cota-memory/SKILL.md`).
_Avoid_: memory alone (the request log is what it reads), recall, RAG, knowledge base, plugin

**Transcript page**:
A run of a transcript's entries as `cota memory transcript` prints them: at most a given number, each text cut at a given length with what was cut counted, and where the next page starts.
_Avoid_: chunk, excerpt, window (a quota window, or a reading endpoint's `[from, to)`)

## Memory evals

**Memory eval**:
One run of an **answerer** asked every **question** of the memory evals, each against the request log of a **memory world**, and its answers given **verdicts**. It shows the memory skill can be followed to the answers; it is not a gate of every commit.
_Avoid_: memory test, benchmark, quiz

**Memory world**:
A memory eval's hub: a scratch database of a ClickHouse holding a request log of constructed content (several projects, machines and weeks), written by the hub's own writer of its ClickHouse tests, a hub reading it, and a **machine** whose home names that hub and keeps a reader key, made before the answerer starts and removed whole after.
_Avoid_: world alone (an install eval's world is a Compose project), fixture, dataset

**Question**:
What a memory eval asks, in the owner's words, with the **facts** a right answer holds and what it must not hold, or with none when the request log has no answer. Each says how its answer is found: by search, by SQL, by reading a transcript, or not at all.
_Avoid_: query (a query is a read of the request log), prompt, task, search query (that is `q`)

**Fact**:
One thing a right answer must say, given as the spellings that count for it, compared without regard to case, spaces or backticks.
_Avoid_: keyword, expected answer, assertion

**Answerer**:
What answers a memory eval's questions, behind one port: given a question, the memory skill and the world's machine, it answers with its first line saying whether it found the answer. The **scripted answerer** is one; the **agent answerer** is the other.
_Avoid_: agent (any coding agent; the answerer is the eval's port), model, solver

**Scripted answerer**:
The answerer that does what the memory skill says, taking every command from the skill's own fenced blocks, by a plan for each question, and fails on a block it does not know. It shows the skill's commands find each answer as written, not that an agent would find it.
_Avoid_: rehearsal (the install eval's), mock agent, oracle

**Agent answerer**:
A coding agent as the answerer: a headless Claude Code on the host, given the skill and one question, whose one tool runs `cota memory` in the memory world's machine and reaches nothing else.
_Avoid_: real answerer, live agent

**Verdict**:
What a memory eval says of one answer: **right** (it holds every fact and nothing it must not, or it says the request log has no answer where it has none), **wrong**, **missed** (it says there is no answer where there is one) or **leaked** (it holds a secret of the world, which no other verdict excuses).
_Avoid_: score (a score sums verdicts), grade, criterion (that is an install eval's)

## Refusals and fallback

**Refusal**:
A provider's answer that a login has reached its limit for a model, with the time the limit resets when the provider gives one. An error that is not about a limit is not a refusal.
_Avoid_: rate limit, 429, rejection, throttle

**Fallback pool**:
The pool that takes a refused login's requests until the limit resets. A pool has at most one.
_Avoid_: backup, secondary, overflow, personal

**Parked**:
A login and model are parked from a refusal until its reset. Parked is a fact about a login and a model, not about a pool: other logins on the same pool are unaffected.
_Avoid_: limited, blocked, rate-limited, tripped

**Divert**:
To send a request to its pool's fallback pool, with that pool's kept login, because the request's login and model are parked. A request without a login is never diverted.
_Avoid_: fall back (verb), reroute, switch, spill, fail over

## Requests and the request log

**Protocol**:
The wire format a pool's provider speaks: Anthropic Messages, ChatGPT's Codex backend, or OpenAI Chat Completions. A request leaves the hub in the protocol it arrived in.
_Avoid_: API, format, dialect

**Request**:
One exchange with a provider: what the hub sent and what came back. A refused request that the hub sends again to the fallback pool is a second request, which names the first.
_Avoid_: call, log, attempt, entry, turn (a turn is the client's word and can be several requests)

**Operation**:
What a request asks the provider to do: answer a conversation, count tokens, list models, search the web, make an image. Only an operation that answers a conversation has usage and a conversation.
_Avoid_: endpoint, object type, kind

**Outcome**:
How a request ended: **ok**, **error**, **refused** (a refusal) or **cancelled** (the client hung up before the answer finished).
_Avoid_: status (that is the provider's HTTP status), result

**Usage**:
The tokens a request consumed, by class: input, cache read, cache write (short and long lived), and output. Input never includes cached tokens. Reasoning tokens are part of output.
_Avoid_: tokens (say which class), consumption

**Cost**:
What a request's usage comes to at the provider's list price. For a subscription pool it is an equivalent, not a bill. A model with no known price has no cost; it is never shown as zero.
_Avoid_: spend, price (a price is per token), bill

**Request log**:
The record of every request the hub forwarded, and of every conversation.
_Avoid_: ledger, log, logs, history, database

**Price list**:
The prices of a provider's models, per token and per class, that the hub ships (built from models.dev, with curated additions) and a pool names. A pool may also give its own price for a model, which wins. A price list also gives each model the facts models.dev knows of it: its **context limit** and **output limit** in tokens, and whether it takes **image input**.
_Avoid_: pricing, rate card, catalog

**Writer**:
What takes requests off the request log's queue and stores them through its repository in batches, once each.
_Avoid_: flusher, sink, exporter

**Declined**:
Said of a batch the request log's repository answered it will not keep as it is. A batch that could not be delivered, or whose answer was lost, **failed** and is tried again unchanged; a declined batch is split. A request declined alone is **set aside** until the repository has stored another request.
_Avoid_: refused (a refusal is a provider's), rejected, poison

**Conversation item**:
One piece of a conversation as the protocol carries it: a system block, a tool definition, a message, an output item. The request log keeps each item once per session.
_Avoid_: message (some items are not messages), entry, chunk

**Prompt size**:
Everything a request gave the model to read, in tokens: input, cache read and both cache writes. Output is not part of it. A request whose usage was not reported has no prompt size, never a size of zero.
_Avoid_: context, context size, input (input never includes cached tokens), prompt tokens (the column's name, not the concept's)

## Reading the request log

**Traffic**:
Every request but a model listing. A client listing models is checking what exists, not working, so the reading endpoints leave model listings out; the request log keeps them.
_Avoid_: usage (that is tokens), activity, load

**Selection**:
The traffic a reading endpoint counts: the requests that started in its window, `[from, to)`, and match its filters.
_Avoid_: query, scope (a scope belongs to a hub key), range

**Dimension**:
A field of a request that traffic is filtered, grouped and counted by: the pool, the model asked for, the client, the machine, the project, the provider, the hub key and the outcome. Three are tags (the machine, the project, the client): a tag is what a client states about its request, and a dimension what traffic is counted by.
_Avoid_: facet (a facet is a dimension's counted values), group by, attribute

**Bucket**:
One step of a series: a stretch of 5 minutes to 7 days, chosen from the window's length, that a series counts traffic in.
_Avoid_: interval, bin, quota window

**Facet**:
A dimension's values in a selection, each with how many requests have it, counted under every filter but the dimension's own.
_Avoid_: filter (a filter is what the owner chose), option

**Error group**:
The failed requests that share a provider, a model, an outcome, the provider's status and error type, and the start of the message. The dashboard's errors screen, which lists one per row, calls each a **cause**, as in "312 failed requests in the last 7 days, of 9 causes"; the API and the code say error group.
_Avoid_: incident, error class

**Headline**:
The one line of an error group's message that heads its row: the first line of the message's own `message` field when the provider wrote it as JSON, else its first line (`docs/specs/dashboard/spec.md`, An error's headline).
_Avoid_: title, summary, first line

## Sessions

**Session**:
The requests a client sends under one session id: one coding session, with its main conversation and everything the client asked on the side. A request that carries no session id is a session of its own.
_Avoid_: conversation (a session can hold several), thread, chat, run, sign-in

**Request role**:
What a request is to its session: **main** (the session's main conversation), **subagent** (a conversation the client started to do part of the work), **title** (the client asking a model to name the session) or **utility** (anything else: token counts, quota probes, side questions). The client's own word decides where it gives one; otherwise the rules in the sessions spec do, never the wording of a prompt.
_Avoid_: role alone (an item's `role` is the protocol's field: user, assistant), purpose (that is what the client says; the request role is what the hub concludes), kind, type, class

**Thread**:
The requests of a session that share a system prompt, or, without one, a first conversation item, and that the client's own word did not place: its main conversation, or a conversation it started on the side. The thread whose prompts add up to the most is the main thread.
_Avoid_: session (a session can hold several threads), conversation (that is what was sent), chain

**Compaction**:
The client replacing a long conversation with a summary, to carry on in less context.
_Avoid_: reset (a reset ends a quota window), truncation, summary (that is what a compaction produces)

**Segment**:
A stretch of a session's main conversation between two compactions. A session's transcript is read segment by segment, each from its **tip**: its last successful request.
_Avoid_: chapter, part (a part is a piece of a request body), window (a quota window), epoch

**Transcript**:
A request's conversation set out to be read: its items, in order, as messages, reasoning, tool calls and tool results. A transcript is a view; the request log keeps the items as the protocol carried them.
_Avoid_: history, log, chat, thread, conversation (the conversation is what was sent; the transcript is how it is shown)

**Entry**:
One thing a transcript shows: a message, reasoning, a tool call, a tool result, or an item (or a piece of one) the hub cannot read, shown as its JSON. One conversation item gives one entry or several, and each entry names the item it comes from.
_Avoid_: line, event, row, message (a message is one kind of entry)

**First prompt**:
What the person first asked in a session: the last thing they said before the model first answered in the main conversation.
_Avoid_: first message, opener, query

**Title**:
A session's name. A **reported title** is the one a machine reported for the session, the latest winning; a **generated title** is the one the client had a model write. A reported title wins over a generated one.
_Avoid_: name (a display name is something else), label, summary, topic

**Search**:
Finding the conversation items whose text holds every word of a search query, or with a tolerance a word near each, among the sessions a selection holds.
_Avoid_: filter (a filter selects requests), grep, lookup

**Search query**:
The words a search looks for, as the owner typed them (`q`). In code it is a `SearchQuery`; a query alone is a read of the request log.
_Avoid_: query (a query is a read), term, keywords, needle

**Word**:
A longest run of characters, lowercased, none of which is an ASCII space, punctuation or control character: what a search matches, never part of one.
_Avoid_: token (ClickHouse's name for it, kept to its SQL), term, keyword

**Tolerance**:
How far a word of a search query may be from a word it matches: with `prefix`, a word that starts with it (a **completion**); with `fuzzy`, a word within its **edits** (a **neighbour**). A search without one is **exact**.
_Avoid_: fuzziness for the whole (fuzziness is the `fuzzy` number alone), typo tolerance, approximate search

**Edits**:
How many characters must be inserted, removed or replaced to make one word another (their Levenshtein distance over code points); a word of the search query allows `min(2, round(length × fuzzy))` of them.
_Avoid_: distance alone, typos, errors

**The log's words**:
The distinct words of every conversation item the request log holds, kept in the table `words`. A tolerance **widens** a word of the search query among them: to itself, its first completions and its first neighbours, up to a bound.
_Avoid_: vocabulary, dictionary (the text index's own), lexicon, terms

**Hit**:
A conversation item a search found: the item, its session, the request that first carried it, and a snippet.
_Avoid_: result, match (matching is the rule a hit passed), entry (an entry is a transcript's)

**Snippet**:
Up to 280 characters of what a transcript shows of a hit's item, from a little before the first word that matches the search query's first word.
_Avoid_: excerpt, preview, highlight, summary

**SQL user**:
The ClickHouse user a caller's SQL runs as, `<database>_sql`: it may read the request log's database and nothing else, with limits the owner sets in the configuration and no query can change. The hub makes it at every start with a password it never shows.
_Avoid_: reader (a reader is a key's scope), read-only user, console user

**SQL console**:
What runs a caller's SQL as the **SQL user** and reads the answer within the caps the owner sets, by default at most 5,000 rows and 16 MiB of them, **truncated** when there was more. In code it is the `SqlConsole` port.
_Avoid_: query runner, SQL endpoint (that is `POST /api/sql`), shell

**Display name**:
The owner's name for a pool, model, client, machine or project, shown in place of its id. It changes nothing in the request log. The hub has **built-in** names for the clients it knows and the models of its price lists; the owner's name for an id replaces its built-in one until the owner removes it.
_Avoid_: label, alias, nickname, rename (renaming is giving one)

## The archive

**Archive**:
The copy of the request log the hub keeps in a directory of files, one day at a time: what a lost request log is restored from, and what an old day is read from without ClickHouse. It holds the conversations in the clear, as the request log does.
_Avoid_: backup (the owner backs up the hub store and the configuration apart), export, dump, snapshot

**Archiver**:
What archives each day of the request log once it is over, and archives again a day that changed: a job of the request-log module that runs every hour when the configuration names an archive directory.
_Avoid_: backup job, exporter, sidecar

**Day**:
In the archive and in an import, a calendar day in UTC, and the rows of the request log whose own time falls in it: the requests and request items that started in it, the conversation items first seen in it and the titles reported in it. An **archived day** is one whose manifest is in the archive.
_Avoid_: date, partition (ClickHouse's), period, bucket (a bucket is a step of a series)

**Manifest**:
An archived day's record, written last: for each table its file, size, SHA-256, rows, checksum and fingerprint, and its columns. A day is archived exactly when its manifest exists.
_Avoid_: index, metadata, catalog

**Verified**:
Said of an archive's file once ClickHouse has loaded it into a table of its table's columns and found the request log's count and checksum of that table and day. Only a verified file gets its final name.
_Avoid_: validated, checked (both say less)

**Checksum**:
The sum of a hash of every value of each row, over a table's rows of a day: equal checksums say two sets of rows are the same. A **fingerprint** is the same sum over each row's key alone, cheap enough to compare every archived day with the request log every hour.
_Avoid_: digest (an item's digest is something else), hash alone

**Held**:
Said of an archived or an imported row that the request log has: a request with its id, a request item with its request id, an equal title, or a copy of the conversation item at least as early.
_Avoid_: present, exists, duplicate

**Restore**:
Adding back into the request log the rows of an archive that it does not hold, with `bun run archive:restore`. A restore never removes or changes a row, so restoring twice adds nothing the second time.
_Avoid_: import (an import reads the prototype's log, not an archive), load (a load is ClickHouse reading a file), recover, replay (a replay is of recorded exchanges), rollback (a rollback is of a hub image)

## Running the hub

**Deployment**:
The hub and its ClickHouse as the owner runs them on one machine, with Docker Compose: the **hub image**, the **Compose file**, the **hub directory** beside it and ClickHouse's volume. One owner has one deployment.
_Avoid_: stack (the roadmap's stacks are of pull requests), install (installing puts `cota` on a machine), instance, server, environment

**Hub image**:
The container image that runs the hub: Bun, the hub's code and its production dependencies, and the dashboard built into it. It is named by its version and its digest, and the same image runs `bun run archive:restore` and `bun run import`.
_Avoid_: image alone where a picture could be meant (a transcript's image part, a model's image input), container (a container runs the image), build, release

**Compose file**:
`compose.yaml` in the hub directory: the hub and ClickHouse as services, what each mounts, the address the hub is published on, their restart policy and health checks. The repository ships it as `deploy/compose.yaml`, and the owner's copy is the one that runs.
_Avoid_: stack file, manifest (a manifest is an archived day's), recipe

**Hub directory**:
The one directory on the hub's machine that holds a deployment's Compose file and its settings (`.env`), the configuration, the secrets, the hub store and the archive: all of the deployment but ClickHouse's own data, which is in a Docker volume. The owner guards it as they guard the secrets in it.
_Avoid_: data directory, volume (ClickHouse's volume is apart), home, checkout (a checkout is the repository's)

**Upgrade**:
Moving a deployment to another hub image: the previous image's name and a copy of the hub store are kept first, then the new image starts on the same hub directory and volume.
_Avoid_: update (`bun run prices:update` updates price lists), migrate (a migration is a step of the hub store), deploy, release

**Rollback**:
Going back after an upgrade: the previous hub image started again on the copy of the hub store the upgrade kept. The request log is not rolled back: it keeps what the newer image logged.
_Avoid_: revert, downgrade, restore (a restore is the archive's)

**Recipe**:
Documented steps for something around a deployment that is the owner's and not Cota's: HTTPS and a reverse proxy, keeping the hub on a private network, copying the hub directory elsewhere. Cota documents a recipe and never runs or ships one.
_Avoid_: guide, integration, plugin, module (a module is the hub's)

## The import

**Import**:
Adding to the request log, and to the display names, what an **import source** holds that they lack, day by day, with `bun run import`. It only reads its source, never changes or removes a row of the request log or a name the owner set, and importing again adds nothing.
_Avoid_: restore (a restore is of an archive), migration (a migration is a step of the hub store), sync, load (a load is ClickHouse reading a file), backfill

**Import source**:
What an import reads: the prototype's log, which is Bifrost's request table and the prototype's conversation tables in the prototype's ClickHouse, and the titles and names files of its dashboard. It is read, never written.
_Avoid_: source alone where a window source could be meant, upstream (a direction), origin, legacy

**Imported request**:
A request the request log holds because an import added it, not because the hub forwarded it. Its id is made from the import source's own id for it, and its `protocol` names its **source form**.
_Avoid_: legacy request, migrated request, historical request

**Source form**:
The shape an import source holds a conversation in: `bifrost-responses`, the Responses-style items Bifrost logged for every client but a Chat Completions one, and `bifrost-chat`, the Chat Completions messages it logged for those. It is neither a wire protocol nor what the client sent: an imported request's items are kept in their source form, never converted into a protocol.
_Avoid_: protocol (a protocol is a wire format), format alone, dialect, schema

**Pool map**:
The owner's table, in the import's file, that names for each pool of the import source (a subscription's name, or a provider's) the pool of the hub's configuration its requests bill. An import refuses a source pool the map does not name.
_Avoid_: mapping alone, route (a route takes a project to a pool), alias, rename (a rename is a display name)

**Dry run**:
An import that reads its source and says, day by day, what it would add and what it would not carry, and why, and adds nothing anywhere.
_Avoid_: preview, simulation, check (a check is doctor's), rehearsal

**Not carried**:
Said of what an import cannot bring over, which its report says: a fact the import source never recorded (a login's fingerprint, an answer's quota headers), or a row it cannot read. A row not carried is counted with its reason, never left out unsaid.
_Avoid_: dropped (the writer drops a request), set aside (the writer sets one aside), skipped, lost

## Quota

**Quota window**:
A stretch of time with an allowance: a 5-hour window, a week, a month. A pool can have several.
_Avoid_: limit (that is the allowance), rate limit, bucket, period

**Reset**:
The moment a quota window ends and its allowance is whole again.
_Avoid_: expiry, renewal, refresh

**Window scope**:
What a quota window's allowance covers: the whole plan, or one thing the provider names, such as a model ("Claude Opus only") or a feature. In the API it is a window's `scope`: `null` for the whole plan, else the provider's name for the thing.
_Avoid_: scope alone outside the quota module (a hub key has a scope), limit type, category

**Window source**:
Where a quota window's numbers come from: a **quota reading**, or the **quota headers** of the pool's latest answers. A window says its source. A window that neither reports is not shown: Cota never works one out.
_Avoid_: origin, provenance, provider (the provider is who gave the numbers, the source is how the hub got them)

**Quota headers**:
The headers of a provider's answer that report the pool's quota windows: Anthropic's `anthropic-ratelimit-unified-*`, ChatGPT's `x-codex-*`. The request log keeps them with every request (`rate_limits`), so the hub reads windows from them without a login and without calling anyone.
_Avoid_: rate-limit headers, limit headers

**Quota reader**:
What asks a provider's usage endpoint for a pool's quota windows: one per provider (Anthropic, ChatGPT, Z.ai, OpenCode Go), with the pool's held key or its quota login. In code it is the `QuotaReader` port and its adapters.
_Avoid_: poller, fetcher, limits reader, reader alone outside the quota module's code (a reader is a key's scope)

**Quota reading**:
What one call of a quota reader got: the pool's windows and plan as the provider reported them, and when. The hub keeps the last good one per pool in memory, and reads again on demand once it is older than its period.
_Avoid_: reading alone outside the quota module (a reading is also what the relay's protocol reader makes of an answer), snapshot, poll, sample

**Plan**:
The name of a subscription's plan as its provider gives it (`Max 20x`, `Pro`, `Lite`): in a quota reading, in the `x-codex-plan-type` quota header, or from a Claude quota login's plan facts. A pool has at most one, the API's `plan`; a window of the whole plan is one whose **window scope** is none.
_Avoid_: tier (Claude's `rateLimitTier` is one of the facts a plan is named from), subscription (the pool is the subscription), plan for the pool itself

**Refresh**:
Replacing a quota login's access token, and the refresh token the provider rotates with it, by asking the provider's token endpoint as its own client would. One refresh at a time per quota login.
_Avoid_: renew, rotate (the provider rotates the refresh token; the hub refreshes), re-login, reset (a reset ends a quota window)

**Expired**:
A quota login whose refresh the provider refused. The hub stops using it and says so until the owner gives a new one. An access token that has merely ended is not expired: it is refreshed.
_Avoid_: lapsed, revoked (a sign-in is revoked), invalid, dead, logged out

**Pace**:
Where usage stands against time: the share of the allowance used compared with the share of the window gone.
_Avoid_: burn rate, velocity, trend

**Reserve**:
How far usage is under pace, in percentage points.
_Avoid_: headroom, slack, buffer

## The dashboard

**Dashboard**:
The owner's browser app (`apps/web`): static files the hub serves at its own address, beside the API they read. The files are public; what they show comes from the API, behind a sign-in.
_Avoid_: web UI, frontend, admin, console (the SQL console is one of its screens)

**Block meter**:
A quota window drawn as twenty blocks of 5% of its allowance each, so many full, at most one partly full and the rest empty, in the pool's hue, with a **pace marker** across them. It turns amber from 80% used and red at 100%.
_Avoid_: progress bar, gauge, usage bar

**Pace marker**:
The mark on a block meter at the share of the window that has passed: where the fill would be if the allowance were used evenly until the reset.
_Avoid_: pace line, now marker, needle

**Block mix**:
The parts of a total drawn as fifty blocks of 2% each, every part given whole blocks, with a legend of each part's value and share.
_Avoid_: stacked bar, pie, donut, waffle

**Block columns**:
Traffic over time drawn as one column per bucket, each a stack of blocks of one unit for the whole chart, so a column's height can be counted.
_Avoid_: bar chart, histogram, stones (the prototype's name)

**Command palette**:
The dashboard's way to anywhere, opened over every screen with `⌘K`, `Ctrl+K` or `/`: it finds the screens, the pools, the values the sessions list filters by and, with the hub's **search**, sessions, and opens what is chosen. Its button in the sidebar says "Search".
_Avoid_: quick open, spotlight, omnibox, search alone (search is the request log's, which the palette asks)

## Relationships

- A **request** comes from one **client** on one **machine**, for one **project**, and bills one **pool**.
- A **route** turns a **project** into a **pool** for one **client**: a **launch** bills the pool of the first of its client's routes whose **project pattern** matches, else the client's **default pool**, unless an **override** names another.
- A **machine** is **joined** to one **hub**. A launch to a subscription pool spends the client's **own login** when the pool is the client's own pool on that machine, the machine's **machine login** for the pool otherwise, and nothing when the machine has neither: it stops.
- A client's **login** is its own, a machine's, or the hub's: an **own login** and a **machine login** live on a machine and reach the hub only inside the requests they make; a **kept login** (a fallback pool's, or a **quota login**) lives on the hub.
- A subscription **pool** is spent with a **login**; an API or local pool is spent with a key the **hub** holds.
- A **refusal** parks one **login** and one model until the **reset**. A **parked** login's requests are **diverted** to the **fallback pool**.
- A **pool** has zero or more **quota windows**; each has one **window scope** and one **window source**, and is the newest observation of its scope and length.
- A **quota reader** reads a pool's windows into a **quota reading**, with the pool's **held key** or its **quota login**. The **quota headers** of the pool's latest answers give windows without either.
- A **quota login** is **refreshed** by the hub, one refresh at a time, and is **expired** once the provider refuses to refresh it. It never forwards a request.
- A **pool** is a **subscription pool** or a **keyed pool**, and speaks one **protocol**. A **hub key** opens the pools of its **scope**.
- A **request** has one **operation** and one **outcome**; when it answers a conversation it has **usage**, a **cost** if its model has a price, and **conversation items**.
- A reading endpoint counts a **selection** of **traffic**: in total, by a **dimension**, in **buckets**, as **facets**, or as **error groups**.
- A **session** is one or more **requests**, each with one **request role**. Its main requests fall into **segments**, split at **compactions**; each segment is read as the **transcript** of its last successful request.
- A **search** looks for the **words** of a **search query** in the **conversation items** of the **sessions** a **selection** holds; each item that holds them all is a **hit**, shown by a **snippet**. A **tolerance** widens each word among **the log's words** to its **completions** and **neighbours**, so a hit holds, for each word, one it was widened to.
- A **session** has at most one **title** shown: the latest **reported title**, else the latest **generated title**.
- The **owner** or an agent with a **reader key** can ask the request log anything in SQL through the **SQL console**, which runs it as the **SQL user**.
- The **owner** reads the request log through a **sign-in**; an agent reads it with a **reader key**. Sign-ins and **display names** live in the **hub store**, beside the request log, not in it.
- A **sign-in** is made with a **way in**: the **owner password** or a **passkey**. A hub with a way in is **set up**, and keeps at least one.
- The **archiver** writes each **day** of the request log to the **archive** as **verified** files, which its **manifest** names, and archives a day again when it changed and the request log still **holds** every row of its archive. A **restore** adds back the archived rows the request log does not hold. Nothing ever leaves the request log.
- A **deployment** runs one **hub image** by its **Compose file**, over one **hub directory** and ClickHouse's volume. An **upgrade** keeps the previous image's name and a copy of the hub store, and a **rollback** starts that image on that copy; neither touches the request log.
- An **import** reads an **import source** day by day and adds the rows the request log does not **hold**: **imported requests**, whose items stay in their **source form**, each billing the pool its **pool map** names, with titles and display names. A **dry run** says what an import would add and what it would leave **not carried**, and adds nothing.
- An agent with the **memory skill** reads the request log only through `cota memory`, which sends the machine's **reader key** for it, and reads a **transcript** a **transcript page** at a time. A **memory eval** asks an **answerer** each **question** against the request log of a **memory world**, and gives each answer a **verdict** by its **facts**.

## Flagged ambiguities

- **Request** is used loosely for what a client sends. In the request log it is exact: one exchange with a provider. A client's request that is refused and diverted is two.
- **Session** is a client's conversation (a run of requests sharing a session id) and also the name providers give the 5-hour quota window, and, in most web software, what a browser holds after signing in. In code and copy, the quota window is the "5-hour window" (the plan's window 5 hours long), the browser's proof is a **sign-in**, and `session` alone means the client's session.
- **Reader** is a hub key's scope (a **reader key**), inside the relay what reads an answer's stream as it passes (a protocol's reader, whose result is a reading), in the request log the port its reading queries read through (`RequestLogReader`), and in the quota module what reads a provider's usage endpoint (a **quota reader**). In copy, reader means the key; in the relay's code, the stream's reader; in the request log's code, `RequestLogReader` and its adapters, always by that name, while `reader` alone in its API definition is the key's scope; in the quota module's code, `QuotaReader` is the port and its adapters, and reader alone (`Readers.Reader`, `readerOf`, a read's `reader`) is a quota reader: which one a pool has, with its credential and period; in the quota API, as in every API definition, `reader` alone is the key's scope.
- **Reading** is what the relay's protocol reader makes of an answer (`modules/relay/03-domain/reading.ts`), and what a quota reader got from a usage endpoint (a **quota reading**). In the relay's code reading alone is the protocol's; in the quota module's code and in the quota API (a window's `source: "reading"`, a pool's `reading`), reading alone is a quota reading; in copy and in other modules, say quota reading.
- **Plan** is a subscription's plan as its provider names it (a pool's `plan`; `03-domain/plan.ts` in the quota module), and in the relay's code what the query `PlanCredential` decides for a request: which pool it bills, with which credential, and what its refusal sets off (`Plan` in `modules/relay/03-domain/credential.ts`). In the relay's code `Plan` alone is that decision; in the quota module, the quota API and copy, plan alone is the subscription's.
- **Scope** is a hub key's (`subscription`, `keyed`, `reader`) and a quota window's (a **window scope**: the whole plan or one model). In the quota module and in a window's fields `scope` is the window's; everywhere else it is the hub key's.
- **Expired** is said of a sign-in 30 days after it was made, and of a quota login whose refresh the provider refused. A quota login's access token is never said to expire: it **ends** (`endsAt`) and is refreshed.
- **Window** is a **quota window** and also the stretch `[from, to)` a reading endpoint counts traffic in, whose previous window is as long and ends where it starts. In copy and in the quota module, window alone is a quota window; in the request log's traffic, `Window` is the reading window. They never meet in one module.
- **Role** is a conversation item's own field (`user`, `assistant`, `system`, `tool`), as the protocol has it, and loosely what a request is to its session. The second is always a **request role**, in code `requestRole`.
- **Name** is loose. A session's name is its **title**; the owner's name for an id is a **display name**; a hub key's and a pool's `name` and `id` are configuration.
- **Limit** is an allowance (what a quota window holds) and, loosely, the event of running out. The event is a **refusal**. Never write "hit the limit" in code or copy; say which window is full, or that the provider refused.
- **Account** is the owner's word for a subscription. It appears in copy where the owner expects it ("your work account"). The concept is a **pool**. A route names a pool, and a machine login is kept per pool, because today a pool is one subscription; when load balancing makes a pool a group of subscriptions, a route still names the pool, and a machine login belongs to one subscription of the group.
- **Client** is a coding tool. `cota` is the **CLI**, never a client, though the milestone that ships it is "Client and install" and the roadmap's parity rows call the machine's side "Client".
- **Check** is one of doctor's (a **check** of a machine), and also the repository's gate, `bun run check`. In the CLI's code and copy, check alone is doctor's; the gate is always named by its command.
- **Own** and **default** meet in one place: a client's **own pool** on a machine is the pool its own login spends, and is the client's **default pool** only when the machine's configuration does not name another. A launch to the default pool on a machine whose client is signed in elsewhere needs a machine login like any other.
- **Pool** is also the owner's word for a group of accounts that share requests. Today a pool is one subscription, and the only grouping is a pool with its **fallback pool**. When load balancing is planned (`docs/roadmap.md`), an account becomes the single subscription and a pool the group, and this file changes first.
- **Message** and **room** are kept for agents talking to each other through the hub (`docs/roadmap.md`). Nothing in a conversation is called a message: it is a **conversation item**.
- **Day** in the archive is a calendar day in UTC. The traffic API's buckets of a day begin at midnight in the time zone the caller gives (`tz`). They never meet: the archive has no time zone.
- **Archived** is said of a **day** whose manifest is in the archive, and is also a document's status (ADR-0005). In docs' front matter it is the status; everywhere else, the day.
- **Protocol** is the wire format a pool's provider speaks, and the request log's `protocol` column says how to read a request's items. For a request the hub forwarded they are the same; for an **imported request** the column holds its **source form** (`bifrost-responses`, `bifrost-chat`), which no pool speaks. A pool's protocol is never a source form.
- **Source** is a quota window's (a **window source**: a quota reading or the quota headers) and an import's (an **import source**: the prototype's log). Neither is ever source alone outside its module: say window source or import source.
- **Image** is a picture (a transcript's image part, a model's **image input**) and the container image a deployment runs. The second is always the **hub image**, or ClickHouse's image by that name.
- **Set aside** is the writer's (a request a declined batch left alone, `docs/specs/request-log/spec.md`); what an import cannot bring over is **not carried**. **Dropped** is also the writer's.
- **Memory** alone is not a term: the request log is the record, and the **memory skill** is how an agent reads it as its memory. `cota memory` is the CLI's command for that reading.
- **Import** is an import's alone. Putting archived rows back is a **restore**; going back to a previous hub image is a **rollback**; the hub store's own changes are its migrations' steps.
