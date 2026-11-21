---
status: active
scope: apps/hub
owner: limineol
last_verified: 2026-11-18
review_by: 2027-02-15
supersedes: []
code:
  - apps/hub/src/modules/dashboard
  - apps/hub/src/config/config.ts
  - apps/hub/src/hub.ts
  - Dockerfile
---

# The dashboard's files

The hub serves the dashboard (ADR-0019): the files `bun run web:build` writes, at the hub's own address, beside the API they read. This spec covers how the hub answers for them. What the dashboard decides for itself is `docs/specs/dashboard/spec.md`; the API is `docs/specs/api/spec.md`, the relay `docs/specs/relay/spec.md`.

It is the dashboard module (`apps/hub/src/modules/dashboard`): one route, `01-presentation/dashboard.routes.ts`, which `module.ts` gives and `hub.ts` adds beside the relay's routes and the API. The files are read with Effect's `HttpStaticServer` through the file system and HTTP platform the Bun server provides, so the module has no port of its own.

## Where the files are

- `[dashboard] directory` in the configuration, resolved against the configuration file's directory. By default, the repository's `apps/web/dist`, found from the hub's own source (`config/config.ts`, `builtDashboard`), which is where `bun run web:build` writes.
- **Built or not** is decided once, when the hub starts: the folder is built when it holds a file `index.html`. A hub whose folder is missing, or has no `index.html`, serves none of the folder's files: every path the dashboard would answer is 404 with no body, as it was before the dashboard. It logs one line at start, `the dashboard is not built: <folder>/index.html does not exist; bun run web:build builds it`, and the API, the relay and `/health` work as before. A hub started before the first build serves the dashboard once restarted.
- While the hub runs, every file is read when it is asked for, so a rebuild is served at once.
- **In the hub image** (ADR-0024), the dashboard is built in the image's build stage and copied to `/app/apps/web/dist`, which is `builtDashboard` from the image's `/app/apps/hub/src`: a deployment's configuration has no `[dashboard]`, and the dashboard a hub image serves is the one it was built with (the deployment spec's Y7).

## What is answered

The hub's own paths come first: the API under `/api`, the relay under `/pools/`, and `/health`. Every other `GET` and `HEAD` is the dashboard's. Other methods are 404 with no body, as before.

- **A file.** A path that names a file of the folder answers it, with the content type of its extension (`text/html; charset=utf-8`, `text/javascript; charset=utf-8`, `text/css; charset=utf-8`, `font/woff2`, … as `HttpStaticServer` lists them; any other extension is `application/octet-stream`). `/` is `index.html`.
- **A screen.** A path that names no file and has no extension answers `index.html`, so a reload of `/sessions/abc`, or a link to it, opens the dashboard on that screen. The query is the screen's and is ignored here.
- **Not a screen.** A path with an extension that names no file (`/missing.js`, `/sessions/abc.png`), and any path under `/assets/` that names no file, is 404 with no body: a missing script or font is never answered with HTML.
- **Never the hub's paths.** A path whose first segment, once percent-decoded, is `api`, `pools` or `health` is never answered from the folder: an unknown path under `/api` stays the API's 404 with no body (the api spec's Errors), and an unknown relay path the relay's.
- **Inside the folder.** A path is percent-decoded once and resolved inside the folder (`Path.resolveWithin`); a path that would leave it, by `..` written plainly or encoded, by an absolute path, or by a null byte, reads nothing, and is answered as a path with no file is. A path that cannot be decoded is 404.
- **Caching.** The build's `assets` folder holds files whose names carry a hash of their content (Vite's `index-0xC89QOu.js`): a path under `/assets/` is read from that folder alone and answered with `cache-control: public, max-age=31536000, immutable`. `index.html`, and every other file (`theme.js`, from `apps/web/public`), is answered with `cache-control: no-cache`, so a browser asks again each time and a rebuild is seen at the next load.
- **HEAD, ranges and revalidation** are `HttpStaticServer`'s: `HEAD` answers the headers `GET` would, with no body; a `range` is answered 206 or 416; `if-none-match` and `if-modified-since` against the `etag` and `last-modified` Bun gives a file are answered 304.

**The files are public.** The owner is not signed in when the browser loads them: the sign-in screen is one of them, and nothing in the folder is a secret. No caller middleware runs on these paths, and no file is the owner's alone. What the dashboard shows is behind `/api`, which every endpoint guards as the sign-in spec says.

## Laws

| Id | Law | Held by |
| --- | --- | --- |
| P1 | **Inside the folder.** No path, however written, reads a file outside the dashboard's folder. | property |
| P2 | **A screen reloads.** A path the build has no file for, outside the hub's own paths and without an extension, answers the index. | property |
| P3 | **The hub's paths stay the hub's.** A path under /api, /pools or /health never answers the index, nor any built file. | property |
| P4 | **Hashed for a year, the index never.** A file under /assets is cached for a year, and the index and every other file are asked for again each time. | property |

They are property tests of a whole hub, started by the harness (`shared/05-tests/harness.ts`, its `dashboard` option) over a built folder the test makes in a temporary directory (`05-tests/built-dashboard.ts`), in `01-presentation/dashboard.laws.test.ts`. P1 sends raw requests, so that no client tidies the path first: paths that climb out of the folder with `..` and its encodings, backslashes, encoded slashes and null bytes, absolute paths plain and encoded, under `/` and `/assets`, towards a file beside the folder and one in a sibling folder whose name begins with the folder's. `dashboard.routes.test.ts` beside them holds the examples: content types, 404s, `HEAD`, other methods, and a hub not built. `tooling/web-build.test.ts` serves the real build from a hub it starts.

## Not built, on purpose

- **Compression.** Bun sends the files as they are; the build is small, and a hub on a home network does not need it yet.
- **Watching the folder.** Whether the dashboard is built is read at start; a hub that was not built is restarted after the first build.
