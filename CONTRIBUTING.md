# Contributing

- **Read [`AGENTS.md`](AGENTS.md) first.** It holds the repository's rules, what to read before changing each part, and the gate each part needs. [`CONTEXT.md`](CONTEXT.md) is the vocabulary: code, copy and docs use its words, and none of those it says to avoid. Decisions are in `docs/adr`, behaviour and laws in `docs/specs`.
- **Run a hub from a checkout** as [`docs/development.md`](docs/development.md) says.
- **Gates.** `bun run check` for every change, then the gate `AGENTS.md`'s Gates table names for what it touches, judged by exit code. Before a pull request, `bun run verify`, which needs Docker, `compose.dev.yaml`'s ClickHouse and Playwright's Chromium. [`docs/verification.md`](docs/verification.md) says what each shows.
- **Conventions.** Conventional Commits. Versions pinned exactly. No comments in code but the kinds `AGENTS.md` lists. A change in behaviour changes its spec in the same commit. Nothing from real traffic, and no real person's, machine's or account's name, in a fixture, an exchange, a test or a document.
- **A vulnerability** goes to [`SECURITY.md`](SECURITY.md), not to an issue.
