---
status: active
scope: apps/web
owner: limineol
last_verified: 2026-11-23
review_by: 2027-02-23
supersedes: []
code:
  - apps/web/src/shared/domain
  - packages/ui/src/components/block-meter.tsx
  - packages/ui/src/components/block-mix.tsx
  - packages/ui/src/components/block-columns.tsx
  - packages/ui/src/components/pool-mark.tsx
  - packages/ui/src/components/provider-logo.tsx
  - apps/web/src/shared/providers.tsx
  - apps/web/src/shared/transcript
  - apps/web/src/screens/sessions/rows.tsx
  - apps/web/src/screens/session/timeline.tsx
  - apps/web/src/screens/session/requests.tsx
  - apps/web/src/screens/session/search.ts
  - apps/web/src/screens/errors/causes.tsx
  - packages/ui/src/components/context-columns.tsx
  - packages/ui/src/components/session-table.tsx
  - packages/ui/src/components/table.tsx
  - packages/ui/src/components/list-panel.tsx
  - packages/ui/src/components/pager.tsx
  - packages/ui/src/components/transcript.tsx
  - packages/ui/src/components/prose.tsx
  - packages/ui/src/components/error-cause.tsx
  - packages/ui/src/components/code-editor.tsx
  - packages/ui/src/components/data-grid.tsx
  - apps/web/src/screens/sql
  - apps/web/src/screens/settings
  - packages/ui/src/components/confirm.tsx
  - packages/ui/src/components/table-more.tsx
  - apps/web/src/app/palette.tsx
  - packages/ui/src/components/palette.tsx
  - apps/web/src/screens/sign-in
  - apps/web/src/screens/setup
  - apps/web/src/shared/passkeys.ts
  - packages/ui/src/components/field-rule.tsx
  - packages/ui/src/components/or-rule.tsx
  - packages/ui/src/components/guide.tsx
  - packages/ui/src/components/steps.tsx
  - packages/ui/src/components/log-line.tsx
  - packages/ui/src/components/select.tsx
  - packages/ui/src/components/route-fields.tsx
  - apps/web/src/shared/reported.tsx
  - apps/web/src/screens/request
  - apps/web/src/screens/session/header.tsx
  - apps/web/src/screens/session/conversation.tsx
  - apps/web/src/screens/session/figures.tsx
  - apps/web/src/screens/overview/reported.tsx
  - packages/ui/src/components/reported-through.tsx
---

# The dashboard's own rules

The dashboard draws what the hub answers. A few things it decides for itself: how a total is shared out in blocks, how a quota window fills its block meter, the unit and stacking of block columns, how a span of time, a count of tokens, a cost, a share, a delta and how long ago are written, which hue each pool takes, which words of a snippet are marked, how a list is paged, how a session's main requests are drawn as context columns, which tool result goes with which call, how a transcript's text is cut into what it shows, which line of an error's message heads it, in the SQL console, how SQL is cut for its tones, which SQL a run sends, which rows of an answer are drawn and how an answer is copied as TSV, in Settings, which ids the display names' list holds, how a sign-in's user agent is written and which ways in may be removed, and how a client's routes are edited, sent and refused, and which pools each select offers, what the command palette finds and in what order, which sessions and requests it marks reported and what a reported request's missing fields say, and, before anyone is signed in, which ways in the sign-in screen offers and how Setup reads a setup code and counts a new owner password. This spec covers those, and nothing the hub computes: a window's used percentage, standing and pace are the hub's (`docs/specs/quota-windows/spec.md`), and the dashboard draws them as they come.

They are pure functions in `apps/web/src/shared/domain`, with no React, no DOM and no IO: `blocks.ts`, `meter.ts`, `columns.ts`, `quantities.ts`, `hues.ts`, `snippet.ts`, `pages.ts`, `context.ts`, `pairs.ts`, `text.ts`, `headline.ts`, `sql.ts`, `grid.ts`, `tsv.ts`, `names.ts`, `user-agent.ts`, `palette.ts` and `routes.ts`. The components in `packages/ui` (`block-meter`, `block-mix`, `block-columns`, `pool-mark`, `context-columns`, `session-table`'s snippet marks, `pager`, `transcript`, `prose`, `error-cause`, `code-editor` and `data-grid`) take what these decide, as plain numbers and pieces of text, and only draw it (ADR-0019, ADR-0020); the screens that hand it to them are `apps/web/src/shared/transcript`, `screens/sessions/rows.tsx`, `screens/session/timeline.tsx`, `screens/session/requests.tsx`, `screens/errors/causes.tsx`, `screens/sql` and `screens/settings`, and the shell's command palette, `app/palette.tsx`, which hands its marks to `palette`.

## Apportioning blocks

A **block mix** shows the parts of a total as fifty blocks of 2% each. `apportion(parts, blocks)` gives each part whole blocks out of `blocks` by largest remainder: each part first gets its exact share (its value over the total, times the blocks) rounded down, and the blocks left over go one each to the parts with the largest remainders, the earlier part first on a tie. So the blocks always add up, no part is more than one block off its exact share, a part of zero gets none, and a larger part never gets fewer than a smaller one. With a total of zero no part gets a block, and the mix is drawn as empty, never as fifty blocks of nothing.

Parts are counts or costs: numbers of zero or more.

## A meter's fill

A **block meter** shows a quota window's used percentage as twenty blocks of 5% each. `meter(window)` takes the window's `usedPercent` and its standing's `elapsed`, as the hub gives them:

- The percentage is held between 0 and 100. Its blocks are so many full, at most one partial with the fraction of its 5% that is used, and the rest empty: 41% is eight full blocks, a ninth one fifth full, and eleven empty.
- A meter is **near its limit** from 80% used and **full** at 100%, which the component draws in amber and in red instead of the pool's hue.
- The **pace marker** stands at the share of the window that has passed, held between 0 and 1 of the track: where the fill would be if the allowance were used evenly until the reset. A window without a standing (an unplaced window, with no span) has no marker.

What the pace is called, and its colour, come from the hub's `pace` and `points`; the meter does not compare the fill with the marker.

## Block columns

**Block columns** show traffic over time as one column per bucket, each a stack of blocks of one unit for the whole chart, so a column's height can be counted.

- **The unit** is the smallest of 1, 2 and 5 × 10ⁿ, no less than a least unit the caller gives, of which the tallest column's total is at most fourteen. A chart of whole things (tokens, requests) gives 1 as the least unit, so a block is never half a request; a chart of dollars gives a cent.
- **A column's blocks** are its total over the unit, rounded to the nearest, and at least one when its total is above zero: traffic under half a unit still shows.
- **A column's parts** are given blocks by rounding their running total: a part's blocks are the running total up to and including it, over the unit and rounded, less the blocks of the parts below it. They sum to the column's blocks, and each part's blocks are its own total over the unit rounded down or up. Running totals were chosen over largest remainder because the boundary between two parts then sits where the running total says, so stacks of the same values look the same in every column. When a column is raised to one block, the block goes to its largest part.
- **Merging to fit.** When the chart's width cannot hold every bucket at its smallest pitch, adjacent buckets are merged in runs of one length (the last run may be shorter), so that no more columns remain than fit; a merged column runs from its first bucket's start to its last bucket's end and holds the sum of each part. The unit is chosen after merging.

## Writing quantities

`quantities.ts` writes numbers the way every screen shows them.

- **A span of time** (`span`): the two largest of days, hours and minutes, rounded down, so it never says more time than there is: `<1m`, `14m`, `2h 14m`, `5d 4h`. A countdown to a reset that says `2h 14m` resets in at least that and less than a minute more.
- **A count of tokens** (`tokens`): whole under a thousand (`950`), and from there in `K`, `M`, `B` or `T` with at most one decimal and no trailing `.0` (`1.2K`, `3.4M`, `12K`). A count that rounds to a thousand of one suffix is written in the next (`999,960` is `1M`, not `1000K`).
- **A cost** (`cost`): `$0` for nothing, `<$0.01` for anything above nothing and below a cent, cents under $100 (`$3.20`), and whole dollars with thousands separated from there (`$1,204`). Whether a cost is under $100 is decided after rounding to the cent, so `$99.996` is `$100`, never `$100.00`.
- **A share** (`share`), a fraction from 0 to 1: a whole percentage, rounded to the nearest, except that a share above nothing that would round to `0%` is `<1%`, and a share below all that would round to `100%` is `99%`.
- **A delta** (`delta`), how a figure changed since the window before it, as the overview's totals show it: `none before` when the window before had nothing (`no change` when this one has nothing too); `no change` when the two are within half a percent of the window before; below double, the change as a share of the window before, up or down (`↑12%`, `↓40%`, so never `↓100%` while anything is left); and from double, the multiple, rounded down so it never says more, to a tenth under ten (`↑3.4×`) and whole from there (`↑12×`).
- **How long ago** (`ago`): `just now` under a minute, and otherwise the span, written as above, followed by `ago` (`14m ago`, `2h 14m ago`).

## Pool hues

A pool owns one hue, which follows it everywhere: its mark, its meter's fill, its blocks in the columns. `poolHues(pools)` gives the pools, in the order given (the configuration's, as `GET /api/pools` lists them), the hues 1 to 8 in turn; a pool beyond the eighth is **neutral**, a grey, and never gets a generated hue (ADR-0020). Red and amber are not among the hues: they mean an error and a window near its limit.

A pool's mark is its provider's logo drawn in its hue, so pools on one provider differ by colour and pools on different providers by shape; a pool whose provider has no logo (`openrouter`, `llama-swap`, a provider the dashboard does not know) is its initial. Which providers have a logo is a lookup, not a rule with a law: `apps/web/src/shared/providers.tsx`.

The hues are tokens of the design system, `pool-1` to `pool-8` and `pool-neutral`, with a value for each theme (`packages/ui/src/styles/tokens.css`, listed in `DESIGN.md`). `tooling/design.test.ts` holds them: every hue, and the neutral one, has at least 3:1 contrast against the card surface in its theme, as a graphic needs (WCAG 1.4.11), and each hue stays apart from the next, the first pool's from the second's and so on, by a CIEDE2000 difference of at least 8 in normal vision and under protanopia, deuteranopia and tritanopia (simulated after Machado, Oliveira and Fernandes, at full severity), in both themes. Neighbours are what is held because the first pools are the ones most often shown together; eight hues cannot all stay apart from each other under every deficiency. Every hue also stays apart from `warn` and from `danger`, the amber and the red a meter turns near and at its limit, by a CIEDE2000 difference of at least 12 in normal vision, in both themes, so that a meter's warning is never taken for a pool's hue.

## Marking a snippet

The sessions list shows, under a session found by a search, the snippet of its newest hit (`docs/specs/search/spec.md`, Hits), with the words of the search query marked. `marks(snippet, query, tolerance)` cuts the snippet into pieces: every word of the snippet that matches a word of the query is a marked piece, and what lies between is unmarked. Words are the search spec's (Words): longest runs of characters that are not ASCII spaces, punctuation or controls, each lowercased whole. A word matches a word of the query as the search's tolerance says (Tolerance): when it is equal, with `prefix` when it starts with it, and with `fuzzy` when it is within the query word's edits. The snippet is not changed: put together, the pieces are the snippet, character for character.

A snippet starts where the hub cut it, so its first word may be the end of a longer one; it is marked when that end matches.

## Paging

The sessions list is read a page at a time, by `limit` and `offset`, and the hub takes an offset of at most 10,000 (`docs/specs/api/spec.md`, Limits). `pageOf(page, total, limit)` says what a page holds: its rows run from its offset plus one to the lesser of its offset plus the limit and the total (`51–100 of 1,284`), and there are as many pages as the total needs, at least one. The last page offered is the last whose offset the hub takes, so a page asked for past it is held to it, and the screen says on that page that the rest cannot be listed.

## The lists' columns

The sessions list, a session's requests and the errors are each a table in one panel (DESIGN.md, `a-list-is-a-table`). Their columns are fixed here so the three read alike. A column the panel has no room for leaves by the panel's own width, not the window's, and when only one is left its head is kept for assistive technology only; the first column stays and writes what left on a line under its name, the figures with their units.

- **Sessions:** Session (its title, its errors, and its first prompt in `text-3`), Pool (its mark and name, the project under it) from 896px, Model (the first, `+N` for more, the client under it) from 1024px, then Ended, Requests (from 896px), Tokens (with its share of the page's largest as a hairline) and Cost, which order the list when their heads are chosen (`sort` in the URL, `recent` left out), and Lasted from 1024px. A search's snippet is a second row across the table, part of the session's link.
- **A session's requests:** newest first, Time, Role (in words, `main` in ink), Model from 896px, Prompt (with its share of the session's largest prompt as a hairline), Output and Cost from 672px, Lasted from 896px, and how it ended: empty for an answer (its word for assistive technology only), so what did not answer stands out. Two hundred are shown, and two hundred more each time the reader asks. A row leads to the request's inspector.
- **The errors:** Cause (its headline, its provider, model, status and type), Where (its pools and clients, each filtering the list) from 896px, Requests, First seen and Last seen from 672px, and the way to its latest request.

## Context columns

A session's page draws its main requests as **context columns**: one column per main request, oldest left, as tall as the request's prompt size in blocks, so a compaction shows as a drop. `contextColumns(requests, capacity)` takes the session's requests, oldest first, each with its segment (none but for a main request), its prompt size, whether it failed and whether it was diverted, and the columns that fit across the chart.

- **Runs.** When the main requests do not fit, adjacent ones share a column, in runs of one length for the whole chart. Each segment is cut into runs from its first main request, so a segment always starts a column of its own and its last column may hold fewer; between two segments the chart leaves a gap of one column. The run is the smallest length for which the columns and the gaps fit; when even one column per segment does not, each segment is one column and the chart is wider than its place.
- **Stretches.** A column stands for a stretch of the session: from its first main request up to the next column's, the first column from the session's first request. The other requests of a stretch (subagent, title, utility) are counted under its column, and so are its errors and diversions, whatever their role.
- **Height.** A column is as tall as the largest prompt size of its main requests, never their sum: a context is a level, and three requests at 180K are a context of 180K. Its blocks are that size over the unit, rounded, and at least one above zero; the unit is chosen as block columns choose one (V10), for the session's largest prompt size with a least unit of one token, so the tallest column has at most fourteen blocks. A column whose requests reported no prompt size has none.

A click on a column, or Enter on it, opens the session's Requests tab on the column's first request. A session's page has two tabs, Conversation and Requests, the open one in the URL as `tab` (`tab=requests`; Conversation is the default and is left out). The tab's role and outcome filters are in the URL as `role` and `outcome`, each repeated for several values (`role=title&role=utility`, `outcome=error`), left out when nothing is chosen. They stay when they keep that request and are cleared when they would hide it; enough of the list is shown to hold it, and its row is marked and takes the focus. The Errors figure opens the same tab on the failed requests (`outcome=error`).

## Pairing tool calls

A transcript shows a tool call with the result that answered it. `pairCalls(entries)` reads the entries in order: a `tool-result` goes with the nearest earlier `tool-call` of its `callId` that no result has taken, and is shown inside that call's row; a result with no such call, or with no `callId`, is a row of its own, and so is every other entry. A call with no `callId` takes no result.

## Splitting text

A transcript's text is shown with the little markdown it needs, written by the dashboard and never set as HTML. `text.ts` cuts it in four ways, and each keeps every character: the pieces, put together, are the text.

- `fencesOf`: prose and fenced code. A fence opens at a line that begins with three backticks, which may name a language, and closes at the next such line, or at the end of a text that was cut.
- `blocksOf`: prose into blocks at blank lines. A block of one line of one to four `#` is a heading; one whose first line begins with `-`, `*`, `+` or a number and `.` or `)` is a list, a line that begins with no marker continuing the item before it; the rest are paragraphs.
- `inlinesOf`: a block's text into plain text, inline code, bold and links. A link is shown as its words and its address, as text: nothing is fetched.
- `remindersOf`: a user's message into its text and its `<system-reminder>` blocks, which are shown as quiet rows; a block a cut left open runs to the end.

## An error's headline

The errors screen lists each cause of failure by one line of its message, and shows the whole message only when its row is opened. `headlineOf(message)` takes that line. A provider often writes its message as a JSON object, and the hub keeps only its first 500 characters, which can leave the object unclosed: when the message begins with `{`, the headline is the first line that is not blank of the object's first `"message"` field, its escapes read, found even when the cut left the field or the object unclosed. When there is no such field, or it is blank, and for every other message, the headline is the message's own first line that is not blank. A line ends at a line feed, a carriage return or a Unicode line or paragraph separator, and is trimmed. A message that is blank has a blank headline, which the screen writes as "No message was recorded", or for a hang-up, which has no message, as "The client hung up before the answer ended".

## The SQL console

The SQL console sends the owner's SQL to `POST /api/sql` as it is written (`docs/specs/sql/spec.md`) and draws the answer. Four things it decides for itself:

- **Tones.** `tokensOf(text)` cuts SQL into the pieces its editor tones: keywords, names, quoted names, strings, numbers, comments, punctuation and white space, as ClickHouse reads them. A string (in single quotes, a quote doubled or after a backslash staying inside it), a name in backticks or double quotes, and a comment (from two dashes to the end of the line, or a block from slash-star to star-slash) is one piece from its opening to its closing, or to the end of a text that leaves it open, so a keyword inside it is never toned as one. Put together, the pieces are the text. It reads no further than that: it is not a parser, and a text ClickHouse would refuse is toned all the same.
- **The statement.** `statementOf(text, start, end)` is what a run sends: the selection, when it holds anything but white space, and otherwise the whole text; either without the white space at its ends. A run of nothing but white space sends nothing.
- **The rows drawn.** An answer of up to 5,000 rows is a grid of rows of one height, of which only those near the view are drawn. `drawnRows(view)` takes how far the grid is scrolled, how tall its view is, the rows' height, how many rows there are and an overscan, and gives every row any part of which is in view, and up to the overscan more on each side, never a row the answer does not have.
- **TSV.** `tsvOf(columns, rows)` writes an answer as tab-separated values, escaped as ClickHouse's `TabSeparated` format escapes them, so a value comes back as it was: a line of the column names, then a line per row, each ending in a line feed; within a field a backslash, a tab, a line feed and a carriage return are written `\\`, `\t`, `\n` and `\r`, a null is `\N`, a string is its text, and any other value is its JSON.

## Getting in

How the owner signs in is the hub's (`docs/specs/sign-in/spec.md`); the dashboard asks it and offers only what can work in this browser at this address.

**Passkeys in the browser.** `#shared/passkeys.ts` is the one file that imports `@simplewebauthn/browser` (14.0.0, ADR-0021). It says whether this browser offers passkeys at this page's address (WebAuthn is there, and the page is at `localhost`, or over https at a host name that is not an IP address, as the hub's relying party is: `http://127.0.0.1:…` cannot have one) and runs the two ceremonies, making one and signing in with one, handing the hub's options to the browser and the browser's answer back in the API's shapes. What a refusal means is decided there, once: the owner closed the prompt or it timed out (`NotAllowedError`, or the ceremony aborted) is *cancelled*, which is nothing wrong; a passkey this device holds for the hub already is *exists*; an address the browser will not make one at is *not here*; anything else is *failed*, in the browser's words. Screens take it from a React context, which stories fill with a stand-in, so no story needs an authenticator.

**The sign-in screen** (`/sign-in`, and in place of every screen while nobody is signed in) is one card. It first asks `GET /api/sign-in`, which needs no caller, and `doorOf(ways, passkeysHere)` decides what it shows: a hub that is not set up leads to `/setup`; otherwise the password form when the hub takes a password, "Sign in with a passkey" (with a key) when the hub keeps a passkey and this browser offers passkeys here, a rule with "or" between the two, and the passkey as the one primary button when it is the only way. When a passkey is the only way in and this browser cannot use one here, a sentence says so, what address this page is at and what address a passkey needs; the hub does not say where its passkeys were made, so the sentence cannot name it. The password's states are as they were (wrong, paused until a time, the hub did not answer). A passkey's: waiting for the browser; cancelled, a quiet line and the button again; not accepted (`passkey-refused`), said with Try again, and the password as the other way when there is one; a browser failure in its words. `password-off` and `no-passkeys` mean the ways in changed since the screen asked: it asks again and redraws. Signed in, `/sign-in` leads to the Overview.

**Setup** (`/setup`) is the first screen of a hub that is not set up, outside the shell, in two columns: the words, and a card with the form; one column on a phone, the words first. The words are "Set up this hub", one sentence, and three steps: finding the setup code in the hub's log, with the line the hub prints in a mono inset (`[09:14:02.318] INFO (#1): this hub is not set up: open its dashboard, give it the setup code XXXX-XXXX-XXXX and choose the owner password`, the code never one that looks real) and where a log is; choosing the owner password; and being signed in on this browser for 30 days. A step is ticked when its field is filled as the hub would take it, and the first is marked when the hub refused the code. The setup code's field is read with `setupCodeOf(typed)` as the hub reads one: spaces and hyphens out, upper case, `O` as `0` and `I` and `L` as `1`, at most twelve characters; it shows them in groups of four joined by hyphens and sends them, and a code of fewer than twelve is not sent, with why. The owner password's rule, "12 characters or more", ticks as it is met; `newPasswordOf(text)` counts code points as the hub does, and a password outside 12 to 1,024 is not sent, the rule saying why. The hub's answers: a refused code (`wrong-setup-code`) is said at the field with where the code is and that a restart makes a new one, and the field keeps it; paused (429) until a time; already set up (409), with the way to the sign-in screen; the hub did not answer. Set up, the owner is signed in, on the Overview. A set-up hub's `/setup` leads to `/sign-in`.

## Settings

Settings (`/settings`) shows what the owner keeps in the hub store, in four parts kept in the path, each a list in one panel (`a-list-is-a-table`): `/settings/names`, `/settings/sign-ins`, `/settings/quota-logins` and `/settings/routes`; `/settings` leads to the first.

- **Display names.** One kind at a time (`kind` in the URL, `pool` left out), filtered by a text over ids and names (`filter`). `nameRows(seen, names, whole)` decides the rows: every id the request log has for the kind, from `GET /api/facets` over all time, in its order (most requests first), then every display name of the kind whose id is not among them, in the hub's order; each id once. The facets list at most 100 ids of a dimension, so when 100 came back the ids seen may be cut, and an id that is not among them has an unknown count of requests, never a count of nothing; with fewer, the ids seen are all there are, and such an id has none. A row's name is edited in place and set alone (`PUT /api/display-names/{kind}/{key}`), and Reset removes the owner's (`DELETE`); the key is percent-encoded once in the path by the API's client, so a slash is `%2F` and `%25` is `%2525`. A name the hub would refuse (blank, or over 80 characters, as the display names spec counts them) is said on its row and not sent. After either, the display names are read again, and every screen shows the new name.
- **Sign-ins.** The ways in, in three panels: the owner password, the passkeys and the sign-ins.
  - *Owner password* (`GET /api/owner-password`). Where it is kept, in words: in the configuration (read only: it is changed in the configuration file, and wins over one set here), in this hub since a date (Change; Turn off), or off (Set a password). Change and Set are a form in place, Change asking the current password first; the new one's rule ticks as it is met, and a password the hub would not take is not sent (as Setup counts it). Done, it says every other sign-in was ended, and the sign-ins are read again. Turn off asks once in place and says that the hub is then signed in to with a passkey only. A refusal is said on the form, which keeps what was typed: the current password is wrong, paused until a time, the configuration holds the password now.
  - *Passkeys* (`GET /api/passkeys`). A table: where each was made (the user agent in words, the user agent itself as the quiet second line), the host of the address it works at, when it was made and last used, and Remove at the row's end, asked once in place. "Add a passkey" asks the hub for options, hands them to the browser and sends its answer; the new row appears. While the browser is asked the button waits; cancelled is a quiet line; one this device holds already, and an answer the hub did not take, are said in words. Where this browser has no passkeys, or the hub answers `not-a-passkey-origin`, a sentence takes the button's place: a browser offers passkeys only over https at a host name, or on localhost, and what this page's address is. With none, one line says what a passkey spares: nothing to guess, nothing to pause.
  - The last way in is never offered for removal. `removalsOf(source, passkeys)` decides, as the hub's rule of the last way in has it (`docs/specs/sign-in/spec.md`): Turn off only for a password this hub keeps and while a passkey is kept, with a line that a passkey is wanted first otherwise; Remove on a passkey while another passkey or a password is left, the last one saying it is the only way in. If the hub answers 409 `last-way-in` all the same, another browser changed the ways in: it is said in words, and the panels read again.
  - *Sign-ins:* `GET /api/sign-ins`, the current one first and the others newest first. `userAgentInWords(userAgent)` writes what a sign-in was made from: the first browser and the first system of its lists whose mark the user agent holds (Edge, Opera, Samsung Internet, Firefox, Chrome and Safari; iOS, Android, ChromeOS, Windows, macOS and Linux), `Firefox on macOS`, either alone when only one is known, nothing when neither is, and the connect script (`cota quota:connect`) as itself; the user agent itself is the row's quiet second line. Each other sign-in is ended alone, and all of them at once after one question in place. The current one is ended by signing out.
- **Quota logins.** One row per pool of `GET /api/pools` whose `quotaLogin` is not null, its state in words as the API gives it (kept, with the pool's plan when it has one; expired; or none) with when it was given, refreshed or refused. A kept or expired one is forgotten (`DELETE /api/pools/{pool}/quota-login`) after one question in place that says what it costs. A pool with none or an expired one shows, under its state, the command that gives one, `bun run quota:connect <pool>`, with a button that copies it and where it is run: a Claude login from a Mac with Claude Code (until milestone 4's client), a ChatGPT one from a machine with Codex. Keyed and observed pools are not listed, and the list's foot says why. The dashboard never takes a login, a token or a key: there is no field for one.

- **Routes** (`/settings/routes`, `docs/specs/routes/spec.md`). One routed client at a time, `client` in the URL (`codex`; Claude Code, the first, left out), its name the client's display name.
  - *The list* (`GET /api/routes`, with the pools of `GET /api/pools`) is one panel: in its head the client and a note that routes are tried in order and the first whose pattern matches a launch's project chooses its pool; in its body a table of the routes in order, each row its position, its pattern in a field (held to 200 characters), an arrow, its pool in a select, and Move up, Move down and Remove as icon buttons, Move up off on the first and Move down on the last; under them Add a route, which adds an empty route last and puts the focus in its pattern (off at 200 routes); and last "Any other project", an arrow and the default pool in a select whose first option is None. A pool is shown by its display name and its mark. From the panel's 672px a row is one line in columns; below it the pool goes under the pattern, after the arrow.
  - *Editing.* An edit is the client's own until it is saved or dropped, kept while the other client is shown; the foot says "Edited, not saved." with Drop the edit and Save, and, unedited, how many routes there are and when they were saved. Moving a route keeps the focus on it. `moveUp`, `moveDown`, `removeAt` and `added` (`routes.ts`) are the only changes to the list's order, and each keeps every other route and its order (V43). Which pools a select offers is `offeredPools(client, pools, chosen)`: those of the configuration that speak the client's protocol (`anthropic-messages` for Claude Code, `chatgpt-codex` for Codex), in the configuration's order, and the pool chosen when it is not among them, so a route is never shown with a pool it does not have (V46). A route or the default pool whose pool the hub answers `fits: false` says so on its row, in `danger`: that the configuration no longer has the pool, that it no longer speaks the client's protocol, or that it is an observed pool, which speaks none (read from `GET /api/pools`, since the hub answers only whether it fits; an observed pool is never offered, since it speaks no protocol), and that its launches stop until it is changed.
  - *Saving.* Save sends `PUT /api/routes/{client}` with the whole list as shown and the revision it was read at: `sendingOf(revision, routes, defaultPool)` gives the n-th route shown at position n, with its pattern as typed and its pool, and the default pool as shown (V44). A route with no pool chosen is not sent: nothing is, its select is edged in `danger`, its row says to choose one and the foot names its position. While the hub answers, Save waits ("Saving…"). Stored, the list is read again with every answer of which pool a project bills, and the foot says "Saved.". `routes-refused` keeps the edit and says each refusal in words on the row it names, its field or select edged in `danger`: `placed(refusals, keys)` puts each on the row of the route sent at its position, by the key sent there, so it follows the route if it is moved, and the default pool's on the default pool; a shadowed route names the route that shadows it by its position and pattern as shown now (V45). A row's refusals go once the row is changed, and the foot counts the rows refused. `routes-changed` says another browser changed the routes since they were read, with Read them again, which drops the edit and reads them. Any other failure, such as `hub-store-unavailable`, is said in the foot in the problem's words, and the edit is kept.
  - *Which pool would a project bill?* A second panel: a field for a project and Ask, which puts the project in the URL (`project`); the hub's answer for the client and the project, `GET /api/route` as the owner (or a reader key), from the routes as saved, which the panel says while an edit is not saved. It shows the pool by its name and mark, and the route that answered (its position and pattern) or that the default pool did; `no-route` says no route matches and the client has no default pool, so a launch there stops; `route-pool-gone` says the route that answers names a pool the client cannot bill now, with the hub's detail under it; a failure is said with Try again. The dashboard never matches a project itself.
  - *States.* While the list or the pools are read, a skeleton of three rows shaped like the routes; when either read fails, the problem's sentence and Try again; a client with no routes says what a route is in the table's body, above Add a route and the default pool.

**A reader key.** A caller that is a hub key reads names, pools and routes but changes nothing, and cannot list sign-ins. Each part says so where its controls would be: names as words with no field, quota logins without Forget or the command, the routes as words (each pattern, an arrow and its pool, and the default pool) with no field, select or button, though which pool a project bills is asked as the owner asks it, and the owner password, the passkeys and the sign-ins as an explanation in place of each panel's controls; no control answers 403. The app sends a caller that is not the owner to the sign-in screen, so this is shown in the parts' own stories.

## Reported requests

A reported request (`docs/specs/reported-requests/spec.md`) is read by the `origin` the API gives it, never by its `protocol`; a session is reported when its `origins` is `["reported"]` alone (`onlyReported`, `shared/reported.tsx`).

- **The mark** is one word, `Reported`, an outlined `badge` as a pool's kind is (`ReportedMark`), the same on every screen: beside the title in the sessions list; under a session's title, with a note of what a client's record cannot show; at the head of its conversation, with a note that after a compaction the record still holds every step, so a segment's transcript shows them all though the model was sent less; and in the inspector's row of badges, after the outcome, the role and the segment.
- **The inspector** says, where an imported request says it was imported, that the request was reported by its machine from its client's own record: what the client wrote down, not what it sent; that a record has no system prompt, no tool definitions, no upstream status, no time to first byte and no quota headers; and the note on compaction. Its body opens as "The steps as the client recorded them".
- **What a record does not have is never a reading.** For a reported request the upstream status is "none" and says it is not in the client's record; the duration says it is as the client recorded it, and the first byte that it is not in the record; the Tools tab has no count, and it and Params say the record has none; in Metadata the service tier, streamed, login fingerprint, user agent, first byte, the two body sizes and reading to the end say "not in the client's record", the hub key is "Reported by" (the owner for an empty one), the session id is read from "the client's record", and the quota and client headers say the record has no headers. Its usage is the record's own, every class of it (cache writes and reasoning among them), and is shown as a forwarded request's is: a 0 there is a measured 0. The error type `cota_reported_unfinished` is said in words: the client's step was not finished when its machine reported it, and is kept as it was then. A reported request's operation, `generate`, answers a conversation, so its title is "An answer from" its model.
- **Reported through** is shown on the overview, the one screen that shows pools; no screen lists machines. An observed pool's card holds, in its windows slot (which a pool with windows fills with them), "Reported through" and one line per machine and client that reported to it (`reported-through`): their names, `Late` as an outlined badge when the hub says `late`, and how long ago the `through` was, with its time, the latest report's and the reporter in the line's title. With none it says that nothing has reported to it yet, and the pool in full says how a machine starts (`cota requests add`). The pool in full shows the same lines in `detail` under the sentence on its quota windows. Its read (`GET /api/reported-through`, every 30 seconds, made only while an observed pool is drawn) has a skeleton while it loads and a sentence when it fails. Whether a reported through is late is the hub's (`docs/specs/reported-requests/spec.md`, Late); the dashboard never compares it with its own clock.

## The command palette

The command palette is the shell's: `⌘K` or `Ctrl+K` opens it from any screen and closes it again, `/` opens it where no field has the focus, and so does Search, at the top of the sidebar with the shortcut written beside it, and in the top bar below the `wide` breakpoint. It is a dialog: its field takes the focus, which stays inside until Escape, its `esc` button or a click outside closes it and gives the focus back to where it was. The results are a listbox the field drives (`aria-activedescendant`): ↑ and ↓ move the choice and wrap at the ends, Home and End go to the first and the last, Enter opens the choice, and the pointer moves the choice only when it moves. Every result is a link, so a ⌘-click or Ctrl-click opens it in a tab and leaves the palette open; opening one any other way closes it.

- **With nothing typed:** Go to, the screens (Overview, Sessions, Errors, SQL, Settings, and Settings' Display names, Sign-ins, Quota logins and Routes), and Pools, each pool of `GET /api/pools` with its mark, leading to the overview of that pool (`/?pool=`).
- **With text:** the same two groups, holding what the text finds; then Filter sessions by, the projects, models, clients and machines of `GET /api/facets` over the last 7 days (the sessions list's default range), each leading to the sessions list filtered by it, at most 12 with a line that says how many more there are; then Sessions, the hub's search for the text (`GET /api/sessions` with `q`, at most 8), asked once typing has paused for 300 ms, each with its title, or its first prompt, and its snippet, whose words are marked as the sessions list marks them (Marking a snippet), and last "Search sessions for …", the sessions list with `q`. A text the hub would refuse (no word, more than 20, or more than 200 characters) is not sent, and the group says why. A name found by its id alone shows the id under it.
- **Each group's states:** while its answer is read, when there is none, and when the read failed, the group says so in one quiet line and the others still work; a group with nothing to show is left out.

Which screens, pools and values are listed, and in what order, is `found(candidates, text)`: a candidate is an id and the name it is shown by (a screen's path and its name; a pool's id and its display name; a project's, model's, client's or machine's id and its display name), and it is listed when its name or its id holds the text, case ignored, and once. Those whose name starts with the text come first, then those whose name holds it elsewhere, then those whose id alone holds it, each in the order given. Case is ignored code point by code point: a character is compared by its lowercase when that is one character, and as itself otherwise (`İ`, whose lowercase is two), so every place in a name stays where it was. The place the text first holds in a name or an id is marked; the pieces, put together, are the name or the id.

## Laws

| Id | Law | Held by |
| --- | --- | --- |
| V1 | **Every block is given.** When the total is above zero, the parts' blocks sum to the blocks given. | property |
| V2 | **Each part its share.** A part's blocks are its exact share of the blocks rounded down or up, so a part of zero gets none. | property |
| V3 | **Larger, never fewer.** A larger part never gets fewer blocks than a smaller one. | property |
| V4 | **Nothing of nothing.** With a total of zero, no part gets a block. | property |
| V5 | **Twenty blocks in order.** A meter has twenty blocks: full ones, then at most one partial, then empty ones. | property |
| V6 | **The fill is the percentage.** The blocks' fills add up to the used percentage held between 0 and 100, over 5. | property |
| V8 | **Amber, then red.** A meter is near its limit from 80% used and full at 100%. | property |
| V9 | **The marker is on the track.** The pace marker stands at the share of the window gone, held between 0 and 1, and there is none without one. | property |
| V10 | **One unit.** The unit is the smallest of 1, 2 and 5 × 10ⁿ, no less than the least unit given, of which the tallest column's total is at most fourteen. | property |
| V11 | **Countable columns.** A column's blocks are its total over the unit, rounded, and at least one when its total is above zero. | property |
| V12 | **Parts fill the column.** A column's parts' blocks sum to its blocks, and each is the part's own total over the unit rounded down or up. | property |
| V13 | **Merging keeps the traffic.** Merging to fit leaves at most the columns that fit, each over adjacent buckets in runs of one length, and keeps every part's total. | property |
| V14 | **A span never says more.** A span is written in its two largest units, rounded down, so that it never says more than the span nor less by one of its smaller unit. | property |
| V15 | **Compact counts.** A count of tokens under a thousand is written whole, and from there in K, M, B or T with at most one decimal, within half of that decimal. | property |
| V16 | **Costs to the cent.** A cost is $0 for nothing, <$0.01 above nothing and below a cent, within half a cent under $100 and within half a dollar from there. | property |
| V17 | **Shares are never rounded to nothing or to all.** A share is written as a whole percentage within half a point, except that a share above nothing is never 0% and a share below all is never 100%. | property |
| V18 | **Hues in order.** Pools take the hues in the order given, one each, and a pool beyond the set is neutral. | property |
| V19 | **Deltas say how much.** A delta is none before from nothing, no change within half a percent, a share of the previous figure below double, and a multiple rounded down from double. | property |
| V20 | **Ago never says more.** An ago is just now under a minute, and otherwise the span it has been, followed by ago. | property |
| V21 | **Marks keep the snippet.** The marked and unmarked pieces of a snippet, put together, are the snippet unchanged. | property |
| V22 | **Marks are the query's words.** A marked piece is a whole word of the snippet that matches a word of the search query under its tolerance, compared as the search spec compares words, and every such word is marked. | property |
| V23 | **Pages cover the rows.** A page holds the rows from its offset on, at most the limit of them and none past the total; the pages are as many as the total needs, each following the one before, and none is offered past the last whose offset the hub takes. | property |
| V24 | **Columns cover the session.** The columns' stretches are consecutive and cover every request once, in order, each from a main request but the first, which starts with the session; a column's main requests, other requests, errors and diversions are those of its stretch. | property |
| V25 | **A segment starts a column.** A column's main requests are of one segment, and a segment's first main request is the first main request of a column. | property |
| V26 | **Runs of one length.** Within a segment every column but the last holds the run's number of main requests and the last at most that, and the run is the smallest for which the columns and a gap between each two segments fit, or the longest segment's length when none does. | property |
| V27 | **A column is its largest prompt.** A column's blocks are the largest prompt size of its main requests over the unit, rounded, and at least one when above zero, the unit chosen for the session's largest prompt size as block columns choose one. | property |
| V28 | **Each result with its call.** Every entry appears once, in order, and a result is paired with the nearest earlier unpaired call of its call id, standing alone when there is none. | property |
| V29 | **Splitting keeps the text.** The pieces of a text, put together, are the text: its prose and fenced code, a prose's blocks, a line's inline pieces and a message's reminders. | property |
| V30 | **A headline is one line.** A message's headline is one trimmed line, blank only when the message is: the first line that is not blank of the first message field of a message that begins as a JSON object, even one a cut left unclosed, when it has one, and otherwise the message's own. | property |
| V31 | **Tones keep the SQL.** The tokens of a text, put together, are the text, none of them empty; a string, a quoted name or a comment is one token from its opening to its closing or the end of the text, whatever keywords it holds. | property |
| V32 | **A selection runs alone.** The statement run is the selection when it holds anything but white space, and otherwise the whole text, without the white space at either end. | property |
| V33 | **Every row in view is drawn.** Every row in view is drawn, and at most the rows in view and the overscan on each side, all of them rows there are. | property |
| V34 | **TSV keeps the values.** A TSV has a line of the column names and a line per row, each a field per column; a tab or a line break inside a value never makes a field or a line, and a field's escapes read back give the value's text, a null alone written \N. | property |
| V35 | **Every id is one row.** Every id seen and every name of the kind is one row, the ids seen first in their order with their requests, then the names of ids not seen in theirs; a row carries its id's name and where it comes from, and an id not seen has no requests when the ids seen are all there are, and an unknown count otherwise. | property |
| V36 | **A user agent says what it holds.** A user agent is named by the first browser and the first system of the lists whose mark it holds, and by none whose mark it lacks; the connect script is named as itself. | property |
| V37 | **The palette lists what holds the text.** A candidate is listed when its name or its id holds the text, ignoring case, and once: first those whose name starts with it, then those whose name holds it, then those whose id alone does, each in the order given. | property |
| V38 | **Marks keep the name.** A found candidate's name and id, put together from their pieces, are unchanged, and the place the text first holds in each, ignoring case, is its one marked piece. | property |
| V39 | **Only the ways that work here.** A hub that is not set up is led to setup; on one that is, the sign-in screen offers the password exactly when the hub takes one and a passkey exactly when the hub keeps one and this browser offers passkeys here, and says where a passkey works exactly when a passkey is the only way in and this browser cannot use one here. | property |
| V40 | **The last way in stays.** Settings offers turning off the password this hub keeps, and removing a passkey, exactly when the hub would allow it, a password or a passkey being left after it; turning off is offered for no other password, and while the kept password is the last way in, it says a passkey is wanted first. | property |
| V41 | **A code as the hub reads it.** A setup code typed in any case, with any spaces and hyphens, and O for 0 and I or L for 1, sends its first twelve characters as the hub reads them, is written as those in groups of four joined by hyphens, which reads back the same, and is complete only with twelve. | property |
| V42 | **A password as the hub counts it.** A new owner password is counted as the hub counts it, by code points, and fits exactly when it has 12 to 1,024 of them. | property |
| V43 | **Editing keeps the others.** Moving a route up or down takes it one place earlier or later, but at the end it is already at; removing takes out that route alone; adding puts the new route after the last; every other route keeps its order. | property |
| V44 | **What is sent is what is shown.** Save sends the routes as shown, the n-th at position n with its pattern and pool, and the default pool as shown, at the revision read; while a route has no pool nothing is sent, and the positions of those routes are named. | property |
| V45 | **A refusal on its row.** Each refusal is said once, on the row of the route sent at its position, which it follows as the route moves, the default pool's on the default pool, and one at a position nothing was sent at apart from the rows; a shadowed route names the route sent at the position that shadows it. | property |
| V46 | **Only pools that fit are offered.** A select offers every pool of the configuration that speaks the client's protocol and no other, in the configuration's order, and the pool chosen beside them when it is not among them. | property |

V1 to V20 are floating-point arithmetic or formatting, which Bend cannot state usefully (ADR-0004); V21 to V46 are text cut into pieces, a page's arithmetic, a session's requests cut into runs, entries paired, an error's headline, SQL cut for its tones, the statement a run sends, the rows a grid draws, an answer written as TSV, the ids a list of names holds, a user agent read, what the palette finds, the ways in offered and kept, a setup code read, a password counted, and a list of routes edited, sent, refused and offered its pools, small enough that a property test says all they promise. All are property-tested only, in `apps/web/src/shared/domain/*.laws.test.ts`.

## Not built, on purpose

- **Pace, standing and when a window empties.** The hub's (`docs/specs/quota-windows/spec.md`). The dashboard writes them, with `span` and `share`, and never works them out again.
- **Names for windows** ("5-hour", "Weekly", "Opus only"), times of day and dates. They are copy with no promise to hold; they come with the screens that show them.
- **Late, worked out again.** The hub says whether a reported through is late; the dashboard writes the word it is given.
- **Hues the owner chooses.** A pool's hue follows its place in the configuration; a pool moved in the file changes colour.
