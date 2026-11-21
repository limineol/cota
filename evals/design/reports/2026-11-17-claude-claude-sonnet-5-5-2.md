# Design eval, 2026-11-17

Commit `41d60c38c688ca42f2318f7dfbf234f1a91a0422`. Runs made by claude 2.1.326 (Claude Code) with claude-sonnet-5-5, at most 20 minutes each; judged by claude 2.1.326 (Claude Code) with claude-sonnet-5-5, blind to the arm, in an order drawn from seed 17. Tasks: `keys`, `machine`, `pool`, `price`; arms: with, without; 1 repetition of each. The patch each run made, and every figure below as JSON (`runs.json`), are in the folder of this report's name beside it; the transcripts and the scratch copies are not kept.

With the document: 4 runs, 4 done, 0 timed out, 0 failed; 4 judged.
Without it: 4 runs, 4 done, 0 timed out, 0 failed; 4 judged.

Judging: 8 calls, 3.9 minutes, $1.65, as the judge's client reported them.

## Runs

### `keys`

| Arm | Repetition | Status | Minutes | Cost | Check | Lint findings | Story | Rules broken |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| with | 1 | done | 17.1 | $1.94 | passes | 0 | passed | 2: a-list-is-a-table, the-url-is-the-screen |
| without | 1 | done | 6.3 | $1.09 | passes | 0 | passed | 8: the-hub-decides, figures-are-written-once, names-not-ids, screens-compose, a-list-is-a-table, a-filter-is-a-button, every-state-is-designed, the-url-is-the-screen |

### `machine`

| Arm | Repetition | Status | Minutes | Cost | Check | Lint findings | Story | Rules broken |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| with | 1 | done | 17.5 | $2.69 | passes | 0 | passed | 2: same-slots, roles-are-words |
| without | 1 | done | 4.3 | $0.78 | fails | 0 | failed | 2: names-not-ids, a-list-is-a-table |

Where a gate failed, the first line it printed that says so (the last 60 lines are in `runs.json`):

- machine-without-1, check: `× Formatter would have printed the following content:`
- machine-without-1, stories: `❯ \|stories-dark (chromium)\| src/screens/machine/machine.stories.tsx (6 tests \| 1 failed) 527ms`

### `pool`

| Arm | Repetition | Status | Minutes | Cost | Check | Lint findings | Story | Rules broken |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| with | 1 | done | 9.2 | $1.49 | passes | 0 | passed | 7: hue-follows-the-pool, red-is-an-error, the-hub-decides, names-not-ids, same-slots, every-state-is-designed, the-url-is-the-screen |
| without | 1 | done | 9.9 | $1.58 | passes | 0 | passed | 4: screens-compose, a-list-is-a-table, every-state-is-designed, the-url-is-the-screen |

### `price`

| Arm | Repetition | Status | Minutes | Cost | Check | Lint findings | Story | Rules broken |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| with | 1 | done | 3.7 | $0.69 | passes | 0 | passed | 4: the-hub-decides, never-invent-a-number, figures-are-written-once, names-not-ids |
| without | 1 | done | 2.3 | $0.56 | passes | 0 | passed | 3: never-invent-a-number, figures-are-written-once, names-not-ids |

## Rules

Each cell is the runs that broke the rule, of the judged runs it applied to (followed or broken); — where it applied to none.

| Rule | Held by the lint | With the document | Without it |
| --- | --- | --- | --- |
| `colour-is-data` | no | 0 of 4 | 0 of 4 |
| `hue-follows-the-pool` | no | 1 of 3 | 0 of 3 |
| `red-is-an-error` | no | 1 of 3 | 0 of 3 |
| `quantities-are-blocks` | no | 0 of 3 | 0 of 3 |
| `the-hub-decides` | no | 2 of 2 | 1 of 3 |
| `never-invent-a-number` | no | 1 of 4 | 1 of 4 |
| `figures-are-written-once` | no | 1 of 4 | 2 of 4 |
| `names-not-ids` | no | 2 of 4 | 3 of 4 |
| `screens-compose` | yes | 0 of 4 | 2 of 4 |
| `tokens-by-role` | no | — | — |
| `one-panel-deep` | no | 0 of 4 | 0 of 4 |
| `a-list-is-a-table` | no | 1 of 3 | 3 of 4 |
| `a-filter-is-a-button` | no | 0 of 1 | 1 of 1 |
| `same-slots` | no | 2 of 4 | 0 of 4 |
| `every-state-is-designed` | no | 1 of 3 | 2 of 3 |
| `the-url-is-the-screen` | no | 2 of 3 | 2 of 3 |
| `words-are-the-products` | no | 0 of 4 | 0 of 4 |
| `type-has-one-scale` | yes | 0 of 4 | 0 of 4 |
| `motion-is-state` | no | 0 of 1 | — |
| `a-level-is-not-summed` | no | 0 of 2 | 0 of 2 |
| `roles-are-words` | no | 1 of 1 | 0 of 1 |
| `readable-without-colour` | no | — | — |

## What the document changed

**Rules that showed a difference.**

- `hue-follows-the-pool`: with the document, broken in 1 of 3; without it, broken in 0 of 3.
- `red-is-an-error`: with the document, broken in 1 of 3; without it, broken in 0 of 3.
- `the-hub-decides`: with the document, broken in 2 of 2; without it, broken in 1 of 3.
- `figures-are-written-once`: with the document, broken in 1 of 4; without it, broken in 2 of 4.
- `names-not-ids`: with the document, broken in 2 of 4; without it, broken in 3 of 4.
- `screens-compose`: with the document, broken in 0 of 4; without it, broken in 2 of 4.
- `a-list-is-a-table`: with the document, broken in 1 of 3; without it, broken in 3 of 4.
- `a-filter-is-a-button`: with the document, broken in 0 of 1; without it, broken in 1 of 1.
- `same-slots`: with the document, broken in 2 of 4; without it, broken in 0 of 4.
- `every-state-is-designed`: with the document, broken in 1 of 3; without it, broken in 2 of 3.
- `roles-are-words`: with the document, broken in 1 of 1; without it, broken in 0 of 1.

**Rules that showed none and that the lint holds,** so the document is not what holds them:

- `type-has-one-scale`: with the document, broken in 0 of 4; without it, broken in 0 of 4.

**Rules that showed none and that the lint does not hold:** in these runs the document changed nothing about them, so each is a candidate to cut or to rewrite.

- `colour-is-data`: with the document, broken in 0 of 4; without it, broken in 0 of 4.
- `quantities-are-blocks`: with the document, broken in 0 of 3; without it, broken in 0 of 3.
- `never-invent-a-number`: with the document, broken in 1 of 4; without it, broken in 1 of 4.
- `one-panel-deep`: with the document, broken in 0 of 4; without it, broken in 0 of 4.
- `the-url-is-the-screen`: with the document, broken in 2 of 3; without it, broken in 2 of 3.
- `words-are-the-products`: with the document, broken in 0 of 4; without it, broken in 0 of 4.
- `a-level-is-not-summed`: with the document, broken in 0 of 2; without it, broken in 0 of 2.

**Rules no run in one of the arms gave a chance to break,** so these runs say nothing about them:

- `tokens-by-role`: with the document, it applied to no run; without it, it applied to no run.
- `motion-is-state`: with the document, broken in 0 of 1; without it, it applied to no run.
- `readable-without-colour`: with the document, it applied to no run; without it, it applied to no run.

## Leaks

These lines of a run's patch quote the document or a rule by its id. The judge read them as they are:

- machine-with-1: docs/specs/dashboard/spec.md: - **A day's figures.** `figuresOf(requests)` counts the requests once by role and once by outcome, adds the output tokens and the cost of the requests that have

## What these numbers cannot carry

8 runs of 4 tasks, by one model, judged by one model reading a patch and screenshots, with no person checking its verdicts: a difference of a run or two is what chance gives, and a rule that showed none may simply not have been tempted hard enough by these tasks. The without arm still has the design system's code, its stories, the lint, ADR-0020 and the dashboard spec, which carry some of the rules on their own, so what is measured is what the document adds to them.
