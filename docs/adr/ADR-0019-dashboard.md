---
status: accepted
scope: apps/web
owner: limineol
last_verified: 2026-11-15
review_by: 2027-02-15
supersedes: []
code:
  - apps/web
  - apps/hub/src/api.ts
  - tooling/boundaries.ts
---

# ADR-0019: The dashboard is a static app the hub serves

## Context

Milestone 3 gives the owner a browser: the pools and their quota windows, the sessions and their transcripts, errors, display names, the SQL console, and setup. Everything it shows is already answered by the API (ADR-0011), whose definition, `@cota/hub/api`, was exported for this.

The prototype's dashboard was React on a Bun server of its own, which both bundled the app and answered its API, with a hand-written router, a hand-written fetch cache, one 3,954-line stylesheet and no tests. Its client cast every answer to a type nothing checked. What it got right is what it showed, and how: that is kept (ADR-0020). How it was built is not.

Cota's hub is one process on one port, and installing it must stay one container (the product document's fourth principle). The dashboard has no logic the hub lacks: quota standing and pace, request roles, segments, transcripts and search are all computed by the hub, by code with laws.

## Decision

- **A single-page app, built to static files.** `apps/web` is React 19 built by Vite. `bun run web:build` writes `apps/web/dist`; nothing there needs a server of its own, and there is no server rendering: the dashboard is behind a sign-in and has nothing to index.
- **The hub serves it.** The hub answers `/api`, `/pools/…` and `/health` as before, and every other `GET` from the built files: a file when the path names one, `index.html` otherwise, so a reload of `/sessions/abc` works. Files whose names carry a content hash are served to be cached for a year, `index.html` never. A hub with no built files answers 404 there and says so once at start: the API and the relay do not need the dashboard. In development Vite serves the app and proxies `/api` to a running hub.
- **Routes are files, and the URL is the state.** TanStack Router, each screen's route a file in the screen's own folder (`<screen>.route.tsx`), listed in `vite.config.ts`. Everything a screen can be asked to show (the pool, the range, filters, the sort, the page, the open tab, the SQL) is a search parameter validated by an Effect Schema, so a link reproduces a screen and back and forward work. What only decorates (a collapsed sidebar, grid or list, the theme) is kept in the browser.
- **The API is called through its own definition.** The client is Effect's `HttpApiClient` over `@cota/hub/api`: every answer is decoded by the Schema the hub encoded it with, and every problem arrives as its typed class (ADR-0011). `fetch` appears in one file. A decoded answer that does not fit is a defect the screen shows as one, never a cast.
- **TanStack Query holds what was read.** A query runs one call of the client; a key is the endpoint and its parameters. Polling is a query's interval (the overview, the errors), paused while the tab is hidden. A 401 from any call returns the owner to the sign-in screen.
- **Effect stays at the edges of the app.** The client, the Schemas of search parameters, and the web's own rules (below) are Effect. Components are plain React: no Effect runtime in render, no service in a component's props.
- **The web's own rules are pure, and held like the hub's.** What the browser decides for itself is small: how a span of time, a count of tokens, a cost and a share are written; how a quantity is apportioned to blocks; how a column chart picks its unit. These live in `apps/web/src/shared/domain`, with no React and no IO, and have laws in a spec, property tests and mutants (ADR-0004). The dashboard never recomputes what the hub answers: a window's standing and pace are the hub's.
- **Modules follow the screens.** `apps/web/src/app` is the shell (the router, the client, the providers), `src/shared` what screens share, and `src/screens/<screen>` one folder per screen with its route, its components and its stories. A screen imports itself, `#shared` and `@cota/ui`; never another screen. `src/stories` holds what only stories and tests use, the fake client and the page a story renders, and nothing else imports it. `tooling/boundaries.ts` holds these rows, and `apps/web` may import `@cota/hub` only as `@cota/hub/api`.
- **Fixtures are typed by the API.** Stories and tests answer the client from fixtures built with the API's own Schemas, through a fake `HttpClient` layer, so a fixture that the contract no longer allows fails the type check or its decoding. There is no mock server and no service worker.
- **English only.** Copy is written in the components, in the product document's voice. There is no translation layer until a second language is wanted.

## Considered

- **A Bun server for the dashboard, as the prototype had.** A second process and port, and a second place that reads ClickHouse. The API exists so there is one.
- **Server rendering (TanStack Start, Next.js).** They need a JavaScript server beside the hub, to render pages nobody may read without signing in.
- **React Router.** Its search parameters are untyped strings; the dashboard's state is its search parameters.
- **A client generated from `openapi.json`.** It would type the answers and decode none of them. The definition itself is importable, and decodes.
- **Mock Service Worker for stories.** It intercepts `fetch` with handlers typed by hand. The fake `HttpClient` answers through the same client and Schemas the app uses.
- **Effect in components** (an Effect runtime per screen, atoms). It would put a second state model beside React's for an app whose state is the URL and a cache of answers.

## Consequences

- `@cota/hub/api` is now imported by a browser. The files it reaches (each group's `*.api.ts`, the Schemas of `03-domain` they use, the shared problems and middleware tags) must load without Bun: no `bun:*` or `node:*` import may be reachable from `api.ts`, and no `Bun.*` call may reach the bundle. Vite alone would replace such an import with an empty module and warn, so the build has a plugin that fails on one, and a test in the unit tier builds the dashboard and fails if the bundle names `Bun`. One file is reached that uses Bun where the dashboard never calls it: `shared/03-domain/conversation.ts` hashes with `Bun.CryptoHasher`, and the dashboard declares that one type for the type check until the hub hashes without Bun.
- The dashboard and the API change in the same pull request until the first release (ADR-0011), and the type check holds them together.
- Vite and a build step enter a repository that had none (ADR-0002). The hub still runs from source; only the dashboard is built, and CI builds it.
- A hub upgraded without rebuilding the dashboard serves the old one. Release images (milestone 5) build both together.
