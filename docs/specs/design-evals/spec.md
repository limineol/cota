---
status: active
scope: evals/design
owner: limineol
last_verified: 2026-11-18
review_by: 2027-02-17
supersedes: []
code:
  - evals/design/harness.ts
  - evals/design/evaluation.ts
  - evals/design/arms.ts
  - evals/design/copy.ts
  - evals/design/clients.ts
  - evals/design/rubric.ts
  - evals/design/scores.ts
  - evals/design/shots.ts
  - evals/design/judge.ts
  - evals/design/report.ts
  - evals/design/runs.ts
  - evals/design/tasks
  - evals/design/reports
  - vitest.evals.config.ts
---

# The design evals

`DESIGN.md` holds the dashboard's rules, each with a Bad and a Good example (ADR-0020). A rule earns its place if an agent that has the document builds a screen that follows it more often than an agent that does not. The design eval measures that: it gives the same task to a coding agent in two copies of the repository, one with the document and one as if it had never been written, scores what each built, and has a judge that does not know which copy a run came from say, for each rule, whether the run followed it. Its report says, rule by rule, what the document changed.

It is run on purpose, with `bun run evals:design`, by a person or an agent with Claude Code or Codex signed in: it spends a subscription, so `bun run verify` never runs it. What can be checked without a client (the arms, the rubric, the judge's blindness, the order of judging, the report's counts, the choice of runner, and the whole path over two kept patches) is checked by the tests: `bun run test` holds the fast ones, and `bun run test:evals`, which `verify` runs as its `evals` gate, those that make scratch copies of the repository (the two arms, and the whole path over two kept patches).

## The arms

An **arm** is one of the two ways the repository is given to a run. The only difference between them is the document.

- **With**: the repository at the commit under test.
- **Without**: the same, as if `DESIGN.md` had never been written. The file is gone, and so is every sentence that points at it: the rows of `AGENTS.md` that name it, the note in `.oxlintrc.json` that the design lint prints after each finding ("See DESIGN.md for the design rules."), the lines of ADR-0020, the roadmap and the dashboard spec that name it or one of its rules by id. The checks that read the file itself are adjusted so that `bun run check` and `bun run test` pass before the run starts: `lint:design` no longer runs `designmd lint DESIGN.md`, and `tooling/design.test.ts` keeps its tests of the pool hues against the theme and loses the two that read the document.

Everything else is in both arms: the design system's components and their stories, the screens, the lint's rules, ADR-0020's decisions and the dashboard spec. So the eval measures what the document adds to the code and the lint, and a rule the lint already holds is expected to show no difference.

Both arms also lose the eval itself (`evals/`, this spec, its section of the README, its row of `AGENTS.md`'s commands and its paragraph of the roadmap), so that no run reads a task's kept patches or learns that it is measured, and with `evals/` the install and memory evals' specs, commands, rows and sections, which would name files the copy no longer has.

The changes are listed in `evals/design/arms.ts` as exact edits. When the repository moves so that one no longer applies, the copy is not made and the harness says which edit to update; and after the changes, the copy is searched for any line still naming the document, `designmd lint`, "Do's and Don'ts" or a rule's id (in the without arm) or the eval (in both), and a copy that holds one is not used.

## The tasks

A **task** is one page in `evals/design/tasks/`: a screen or part of one the dashboard does not have, built in `apps/web` from a stated answer of the API (one the hub does not give yet, so the task adds no endpoint and no route), with stories fed by fixtures written from that answer. A task never names a rule and never asks for more than a colleague would ("build it as the dashboard's other screens are built"); it is the same text in both arms and is the run's whole prompt.

| Task | Builds |
| --- | --- |
| `keys` | The hub keys: a list of keys with their scope, pools, last use and the last 7 days' requests and tokens, narrowed to a scope and sorted |
| `pool` | A pool's page: its quota windows and their standing, its totals over a range against the range before, its models, and the largest prompt size its requests reached |
| `price` | A form that sets or drops a pool's own price for a model, beside the price list's, in every state of reading and saving |
| `machine` | A machine's day: its sessions, their client and pool, their requests by role and outcome, and how large their prompts grew |

Between them, every rule that can be broken on a screen is tempted by at least one task:

| Rule | `keys` | `pool` | `price` | `machine` |
| --- | --- | --- | --- | --- |
| `colour-is-data` | scopes | models | the save button, a saved price | roles |
| `hue-follows-the-pool` | the pools a key opens | the pool | | the sessions' pools |
| `red-is-an-error` | | a fall against the range before | a refusal | refusals and cancellations |
| `quantities-are-blocks` | | windows, models, days | | roles, prompt sizes |
| `the-hub-decides` | | a window's standing beside its raw times | | |
| `never-invent-a-number` | a key never used, tokens unknown, a log younger than 7 days | windows not read, unpriced requests, no range before | no listed price | unknown prompt sizes and costs |
| `figures-are-written-once` | counts, how long ago | counts, costs, spans | prices | counts, times |
| `names-not-ids` | machines, pools | the pool, models | the pool, the model | the machine, clients, pools, projects |
| `screens-compose` | ✓ | ✓ | ✓ | ✓ |
| `tokens-by-role` | ✓ | ✓ | the states' colours | ✓ |
| `one-panel-deep` | | figures, windows, models | the form's parts | sessions |
| `a-list-is-a-table` | the keys | | | the sessions |
| `a-filter-is-a-button` | the scope | | | |
| `same-slots` | keys never used | a pool without windows | | a session without a title |
| `every-state-is-designed` | ✓ | ✓ | named in the task | ✓ |
| `the-url-is-the-screen` | the scope and the sort | the range | | the day |
| `words-are-the-products` | ✓ | "context" in the task | the problems | ✓ |
| `type-has-one-scale` | ids | the figures | prices | ✓ |
| `motion-is-state` | | | saving and saved | |
| `a-level-is-not-summed` | | the largest prompt size over days | | prompt sizes over a session |
| `roles-are-words` | | | | ✓ |
| `readable-without-colour` | | meters, the models' parts | a refused field | outcomes |

## A run

A **run** is one task in one arm, once. It is made in a scratch copy, in the system's temporary directory:

1. `git clone --local` of the repository, checked out at the commit under test.
2. The arm prepared, then the clone's history and remote removed and the tree committed alone in a new repository, so neither `git log` nor a remote holds what the arm left out.
3. `bun install --frozen-lockfile`, every installed file given the present as its times, and `bun run check`, which must pass before anything runs. Bun clones its cache into `node_modules` with the cache's own, older times, and macOS removes the files in the temporary directory older than three days every night at 03:35; the first real run spanned 03:35 and lost the files it had not yet read (Vitest's command line, a module of `@effect/tsgo`), so its check and stories failed for that alone.
4. The runner, without a person, with the task as its prompt and a limit of 20 minutes.
5. The copy's diff from that commit, new files included, kept beside the report as the run's patch.
6. A client ran commands in its copy, and could have changed what the patch does not hold (its own commands, or a dependency fetched by one), so its patch is applied to another fresh copy of the arm, made as in steps 1 to 3, and scored there. A replayed patch is scored in the copy it was applied to, where nothing else ran.
7. The mechanical scores and the screenshots; then the copies are removed.

A run that times out or fails is recorded as such, with what it left, and never dropped.

**Runners.** `claude` (Claude Code in print mode) is the default; `codex` (`codex exec`) is used when `claude` is not on the path, or when `--runner codex` asks for it. The model is `claude-sonnet-5-5` for Claude Code unless `--model` names another, and Codex's own default unless `--model` names one. Both run in the copy and can do nothing outside it without a person, who is never there:

- Claude Code: `claude --print --output-format stream-json --verbose --model <model> --tools Read,Edit,Write,Glob,Grep,Bash --allowedTools <allowed> --disallowedTools <denied> --permission-mode acceptEdits --permission-prompts none --setting-sources project --settings '{"autoMemoryEnabled":false}' --disable-slash-commands --strict-mcp-config --no-session-persistence`, in the copy, with the task on standard input. It has only the file tools and Bash; edits are accepted in its working directory only; anything that would ask a person is refused; the user's own settings, instruction file and MCP servers, Claude Code's skills and slash commands (the built-in ones too) and its auto memory are not loaded (the project's own instructions are), and nothing is kept of the session. Bash runs what Claude Code takes as read-only (`ls`, `grep`, `sed -n` and the like) and `bun run` with one of the repository's scripts a colleague building a screen needs, each `Bash(bun run <script>)` and `Bash(bun run <script> *)`: `check`, `typecheck`, `test`, `stories`, `lint:design`, `boundaries`, `docs:check`, `web:build`, and `biome check` and `biome format` for the formatter's fixes. `bunx`, `bun x`, `bun add`, `bun install`, `bun i`, `bun pm`, `bun remove`, `bun rm`, `bun update`, `bun upgrade`, `bun link`, `bun create`, `bun init` and `bun patch` are denied, with and without arguments, so a run cannot change the dependencies or fetch a package. That nothing of the user's reaches a run was proved with one call of these flags and no tools in an empty folder, asked to list the instruction or memory files it was given: it answered none, and its start listed no skills, no slash commands, no MCP servers and no memory folder.
- Codex: `codex exec --sandbox workspace-write --config sandbox_workspace_write.network_access=false --ignore-user-config --ephemeral --json --cd <copy> --output-last-message <file> [--model <model>]`, with the task on standard input: it writes only in the copy, with no network, and reads no user configuration. Its sandbox has no list of the commands it may run, so it could still change the copy's dependencies from Bun's cache (never fetch one); its patch is scored in a fresh copy, so that reaches no score.
- `replay` applies a kept patch in place of a client. It is how the harness's own tests run without a subscription, and how `--judge-only <report folder>` remakes a report: each kept patch replayed in a fresh copy of its arm at the report's commit, scored and judged again.

The variables that make a process part of the session that started it (Claude Code's own, and T3 Code's thread) are left out of a client's environment, so a run is a session of its own; nothing that says where a client connects is changed. The client, its version, and the model are recorded in the report.

## The scores

**Mechanical**, for each run:

- **Check**: whether `bun run check` passes with the patch (the arm's own check).
- **Lint findings**: how many findings the design lint (Oxlint with shadcn's rules) has in the files the run added or changed.
- **Story**: whether the run's new stories pass the stories gate (`bun run stories` over them: rendering, play functions and axe, in both themes), or that it wrote none.

When the check or the stories gate fails, `runs.json` keeps the last 60 lines it printed and the first line that names a failure, and the report shows that line under the task's runs, so a failure can be read without running the gate again.

**The rubric** is every rule of `DESIGN.md`'s Do's and Don'ts, read from the document of the copy's commit, so it moves with it: its id, scope, text and Bad and Good pair (`evals/design/rubric.ts`). A rule is **held by the lint** when its "Held by" names `lint:design` or one of shadcn's rules.

**The judge** is a separate run of the client (the runner's, or for `replay` the one on the path), with no tools, in an empty folder, kept from the user's own setup as a run is, its answer held to a JSON Schema. It is given the rubric, the task, the run's patch, and screenshots of the run's stories (at most four, so at most sixteen images) in both themes at 1440px and 414px wide, taken from Storybook started in the copy on port 6008. For each rule it answers **followed**, **broken** or **not applicable**, with its evidence: a file and line, or what a screenshot shows. A run whose stories do not render is judged on its patch alone, and the report says so.

The judge is blind. It is never told the arm, a run's id or the order the runs were made in; only runs that finished with a patch are judged, one at a time, in an order drawn from a seed the report records. Its input is built from the task, the patch and the screenshots alone, so two runs that differ only in arm give it the same input. A line the run added that names `DESIGN.md` or a rule by its id would give the arm away: it is not hidden from the judge but reported as a **leak**.

## The report

`evals/design/reports/<date>-<runner>-<model>.md`, committed, with a folder of the same name beside it that holds each run's patch and `runs.json`, every figure of the report. Raw transcripts and screenshots stay in the system's temporary directory and are not kept.

It gives the commit, the client, its version and the model, the judge's, the tasks, arms and repetitions, and the seed; how long the judge took and what it cost, as its client reported them (each judgement's are in `runs.json`); how many runs of each arm were done, timed out, failed and judged; a table per task of each run's check, lint findings, story and the rules it broke; and a table per rule of how many of the judged runs it applied to broke it, with the document and without. From those it lists the rules that showed a difference; the ones that showed none and that the lint holds; the ones that showed none and that the lint does not hold, which are the candidates to cut or to rewrite and the reason the eval exists; and the ones no run in one of the arms had a chance to break. Then the leaks, and what the numbers cannot carry, said once.

## What it does not show

- **Chance.** A full run is four tasks, two arms and as many repetitions as are asked; a difference of a run or two is what chance gives. A rule that showed none may not have been tempted hard enough by these tasks.
- **One model, one judge.** The runs are one model's; the judge is a model too, reading a patch and screenshots, with no person checking its verdicts, and it may misjudge a rule the same way in both arms.
- **The rest of the repository carries rules too.** The without arm keeps the components, their stories, the lint, ADR-0020 and the dashboard spec, which hold some of the rules on their own. The eval measures what the document adds to them, not what the rules are worth.
- **Codex reads outside its copy.** Its sandbox limits what it writes, not what it reads; nothing in the copy points at the repository it came from, but a run that went looking could find it.
- **What Claude Code builds in stays.** Its system prompt, its built-in plugins (one of which reads a project's `AGENTS.md`) and a note it attaches about the signed-in account cannot be turned off without changing how it signs in; they are the same in both arms, and none of them is the dashboard's design.
- **It is not a gate.** A report records what one set of runs did; nothing fails when a rule shows no difference.
