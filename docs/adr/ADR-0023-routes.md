---
status: accepted
scope: apps/hub
owner: limineol
last_verified: 2026-11-17
review_by: 2027-02-17
supersedes: []
code:
  - apps/hub/src/modules/routes
---

# ADR-0023: Routes are an ordered list per client on the hub, and a launch asks which pool its project bills

## Context

A request bills the pool its path names (ADR-0006), so whatever starts a client chooses the pool. In the prototype that was a `case` in the shim on each machine, for Claude Code only: an employer's repositories (`<organisation>/*`) to that employer's subscription, everything else to the owner's own. Changing it meant editing a shell script and copying it to every machine. Codex, OpenCode and Pi had no route at all: the client and its hub key decided.

The roadmap gives milestone 4 "routes kept on the hub, so every machine agrees on which project bills which pool", and records a decided feature, **subscriptions by purpose**: some subscriptions are for one kind of work (an employer's projects) and one is general. ADR-0009 put settings the hub changes while running in the hub store, routes among them. Admission (the admission spec's A1 to A6) and the hub key scopes hold whatever routes say.

The owner was asked on 2026-11-17 how a project is scoped to the subscriptions it may bill, with three answers: **A**, the hub keeps an ordered list of routes, a project pattern to a pool, per client, ending in a default pool, and a machine asks the hub at launch; **B**, a pool's purpose is a setting of the pool in the configuration file (the projects it is for), with no list of routes; **C**, A with load balancing in the same milestone, a route naming a group of pools. The question was open when this was written.

## Decision

**This decision was taken by default, and is the owner's to change.** It records answer A, the default of the question asked on 2026-11-17. Routes are built in milestone 4a; until it is merged, choosing B or C costs this record and the routes spec, and nothing built.

**A route is a project pattern and a pool, in an ordered list per client, and each client has at most one default pool.** A client's routes are numbered from 1 in the order they are tried. The clients with routes are Claude Code (`claude-code`) and Codex (`codex`), the two whose pool the launcher chooses. OpenCode and Pi choose a pool by the model the person picks, among one provider per keyed pool (ADR-0022), so they have none: a route for them could only fight the person's choice. A client's pools are those of its protocol: `anthropic-messages` for Claude Code, subscription or keyed; `chatgpt-codex` for Codex.

**A project pattern is a project, or the start of one followed by `*`.** `acme/api` matches that project alone; `acme/*` matches every project that starts `acme/`; `acme*` also matches `acme-tools/site`. A pattern is 1 to 200 code points, the length of a tag, stored lowercased, with at most one `*`, and only at its end. `*` alone is not a pattern: that is what the default pool is for. A project is compared lowercased, so case never matters. Nothing more: the prototype's routes were an organisation's projects or one project, and a prefix covers both. With only exact patterns and prefixes, which route wins is visible in the list, and whether a route can ever win is decided by comparing prefixes (below). Globs inside a pattern, character classes, negation and regular expressions would each make both questions hard to answer by reading.

**Matching is the first route whose pattern matches, else the default pool, else no route.** It is total (every client and project has exactly one of the three answers) and depends on the list and the project alone. A route is never skipped: when the first route that matches names a pool the configuration no longer has, or one that no longer speaks the client's protocol, the answer is that problem, never a later route or the default, which would bill a pool the owner did not choose for that project. The same holds for a default pool that is gone.

**A list is checked when it is stored.** The owner replaces one client's list and default pool at once, and the hub refuses the whole when any of these holds, naming the route and why: a pool the configuration does not have; a pool that does not speak the client's protocol; a pattern that is not one; two routes with one pattern; a route that an earlier one **shadows**, so that it can never be the first match (an earlier `acme/*` before `acme/api`, an earlier `acme*` before `acme/*`); a default pool that is unknown or of another protocol. A stored list is therefore one in which every route is the first match of some project. The configuration can change after a list is stored: the hub starts all the same, says at start which routes name a pool that is gone or no longer fits, and Settings shows each.

**Routes are kept in the hub store**, by a new `routes` module: a table of the clients' lists (each client's default pool, a revision and when it changed) and a table of routes (client, position, pattern, pool), made by the step `routes/0001-routes`. They are settings the owner changes, not facts about requests, so not ClickHouse (ADR-0013's test), and they change while the hub runs, so not the configuration (ADR-0009). A change replaces one client's list in one transaction, and names the revision it was made from: of two changes made from the same revision, one is stored and the other is refused, so an edit in one browser never silently undoes another's.

**Who may read and change them:**

- The **owner** reads and changes them: in Settings → Routes, through the API, and with `cota routes`, which signs in with the owner password as the connect script does.
- A **reader key** reads the list, as it reads every other setting, and changes nothing.
- A **subscription or keyed hub key**, the keys a machine holds, asks only for one launch's answer: which pool a client in a project bills. Never the list: those keys sit in the environment of every command a client runs (ADR-0012), and the list names every pattern the owner routes, an employer's among them. One answer names one pool, the one that launch's own requests will name in their path anyway.

**A machine gets its route with one call**, `GET /api/route?client=<client>&project=<project>`, with any hub key or as the owner. The answer is the pool (its id, kind, protocol and provider), why (`route` with its position and pattern, `default`, or `override`), and the client's default pool, from which a machine whose configuration names no own pool learns it (ADR-0022). `&pool=<pool>` asks for an override: the answer is that pool, when the hub has it and it speaks the client's protocol. No route is a 404 `no-route`, a matched route or default whose pool is gone a 409 `route-pool-gone`. The answer depends on the routes, the configuration and the question, never on the key that asked. Whether the machine can spend the pool (a keyed hub key for a keyed pool, a login for a subscription pool) is the machine's to know and the launcher's to check.

**Caching, and when the hub cannot be reached.** A machine keeps the latest answer for each client and project it launched in, the latest 1,000, with no expiry. It uses one only when the hub cannot answer at launch, and ADR-0022 says what a launch does then; any answer from the hub replaces it. A route changed on the hub reaches a machine at its next launch in that project that reaches the hub.

**A route chooses a pool; it opens nothing.** Admission does not read routes, and A1 to A6 stand: a subscription hub key still cannot reach a keyed pool, so a route to a keyed pool works only on a machine that holds a keyed hub key, and a reader key still opens no pool. The relay does not read routes either: the pool stays in the path, and a request that names a pool other than its route's is forwarded as any request is. Routes are how a machine chooses, not a rule the hub enforces on traffic, and a tag still never decides who pays.

**Subscriptions by purpose is a pool only some routes name.** An employer's subscription is the pool of the routes of that employer's projects, and no default pool names it. Nothing else marks a pool's purpose.

**Load balancing fits later without changing a stored route.** A route names a pool by its id and records nothing else of it. When load balancing makes a pool a group of subscriptions (`CONTEXT.md`, the flagged ambiguity of "account"), a route still names the pool, and the hub, not the route, shares that pool's requests among its subscriptions. What changes then is the machine login, which belongs to one subscription of the group, and is decided with load balancing.

## Alternatives weighed

- **Each machine keeps its own routes**, the prototype's `case` made a file. A launch needs no round trip, and works offline in a project the machine has not seen. But each machine has its own copy, which is what "every machine agrees" was decided to remove, and adding an employer's projects means editing every machine.
- **The hub chooses the pool for each request** from its project tag, with clients pointed at one address that names no pool. Nothing to ask at launch, and a route change reaches a running session. But a tag, which a client states, would decide who pays, which admission and the vocabulary forbid; the pool would leave the path, against ADR-0006; the login a client sends is chosen when it starts and cannot follow a pool the hub picks per request, so a session would bill one subscription with another's login; and the provider Codex saves with a session would no longer say which pool it billed.
- **The hub's list, matched on the machine** (A's list with B's matching). Offline launches in new projects would find their route. The whole list would be fetched with a key every command a client runs holds, and kept in a file every such command can read.
- **B: a pool's projects in the configuration file**, beside the pool. One file to read, and a pool says what it is for where it is defined. But a change would mean a restart, Settings could not make one (ADR-0009), two pools that claim one project need a rule for which wins, which is an order again, and one setting would have to speak for Claude Code and Codex alike.
- **A route of the pattern `*` for the default.** One kind of row instead of two. A `*` route could stand anywhere in the list and shadow every route after it, and the default would not be last by construction.
- **Routes per machine or per hub key.** Machines differ in which subscription their client is signed in to, not in which pool a project bills; that difference is the machine's own pool (ADR-0022), kept on the machine.
- **Skipping a route whose pool is gone.** Launches would keep working, on a pool the owner did not choose for those projects.
- **C: load balancing now**, as a list of pools per route. The decided feature makes a pool the group (`CONTEXT.md`), so a route's single pool already is where a group goes. It is not in this milestone.

## Consequences

- Milestone 4a builds the `routes` module (its domain is the pattern, matching, shadowing and checking a list, held by the routes spec's laws), its store step, `GET /api/routes`, `PUT /api/routes/{client}` and `GET /api/route`, and Settings → Routes, which edits a client's list in order and tries a project against it. The sign-in spec's table gains the three endpoints; the hub store spec gains the two tables; the dashboard spec gains Settings → Routes; the relay spec's "Routes on the hub" is answered here, without the relay changing.
- Every launch of Claude Code and Codex makes one call to the hub before the client starts, and a project the machine has never launched in has no route while the hub is unreachable.
- A route whose pool leaves the configuration stops its projects' launches, with a problem that names it, until the owner changes the route.
- If the owner chooses B later, each stored route is a pattern in its pool's setting, and the order is what B must decide anew; C adds to a route and takes nothing from it.
