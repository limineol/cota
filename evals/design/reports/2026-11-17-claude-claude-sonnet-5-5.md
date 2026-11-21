# Design eval, 2026-11-17

Commit `f4f90713f60faafe654c2cf335a53ce08f453d6b`. Runs made by claude 2.1.325 (Claude Code) with claude-sonnet-5-5, at most 20 minutes each; judged by claude 2.1.325 (Claude Code) with claude-sonnet-5-5, blind to the arm, in an order drawn from seed 17. Tasks: `pool`; arms: with, without; 1 repetition of each. The patch each run made, and every figure below as JSON (`runs.json`), are in the folder of this report's name beside it; the transcripts and the scratch copies are not kept.

With the document: 1 run, 1 done, 0 timed out, 0 failed; 1 judged.
Without it: 1 run, 1 done, 0 timed out, 0 failed; 1 judged.

Judging: 2 calls, 1.3 minutes, $0.51, as the judge's client reported them.

## Runs

### `pool`

| Arm | Repetition | Status | Minutes | Cost | Check | Lint findings | Story | Rules broken |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| with | 1 | done | 7.5 | $1.51 | passes | 0 | failed | 2: screens-compose, the-url-is-the-screen |
| without | 1 | done | 4.5 | $1.00 | passes | 0 | passed | 4: red-is-an-error, the-hub-decides, every-state-is-designed, the-url-is-the-screen |

Where a gate failed, the first line it printed that says so (the last 60 lines are in `runs.json`):

- pool-with-1, stories: `❯ \|stories-dark (chromium)\| src/screens/pool/pool.stories.tsx (7 tests \| 2 failed) 1671ms`

## Rules

Each cell is the runs that broke the rule, of the judged runs it applied to (followed or broken); — where it applied to none.

| Rule | Held by the lint | With the document | Without it |
| --- | --- | --- | --- |
| `colour-is-data` | no | 0 of 1 | 0 of 1 |
| `hue-follows-the-pool` | no | 0 of 1 | 0 of 1 |
| `red-is-an-error` | no | 0 of 1 | 1 of 1 |
| `quantities-are-blocks` | no | 0 of 1 | 0 of 1 |
| `the-hub-decides` | no | 0 of 1 | 1 of 1 |
| `never-invent-a-number` | no | 0 of 1 | 0 of 1 |
| `figures-are-written-once` | no | 0 of 1 | 0 of 1 |
| `names-not-ids` | no | 0 of 1 | 0 of 1 |
| `screens-compose` | yes | 1 of 1 | 0 of 1 |
| `tokens-by-role` | no | — | — |
| `one-panel-deep` | no | 0 of 1 | 0 of 1 |
| `a-list-is-a-table` | no | 0 of 1 | 0 of 1 |
| `a-filter-is-a-button` | no | — | — |
| `same-slots` | no | 0 of 1 | 0 of 1 |
| `every-state-is-designed` | no | — | 1 of 1 |
| `the-url-is-the-screen` | no | 1 of 1 | 1 of 1 |
| `words-are-the-products` | no | 0 of 1 | 0 of 1 |
| `type-has-one-scale` | yes | 0 of 1 | 0 of 1 |
| `motion-is-state` | no | — | — |
| `a-level-is-not-summed` | no | 0 of 1 | 0 of 1 |
| `roles-are-words` | no | — | — |
| `readable-without-colour` | no | — | — |

## What the document changed

**Rules that showed a difference.**

- `red-is-an-error`: with the document, broken in 0 of 1; without it, broken in 1 of 1.
- `the-hub-decides`: with the document, broken in 0 of 1; without it, broken in 1 of 1.
- `screens-compose`: with the document, broken in 1 of 1; without it, broken in 0 of 1.

**Rules that showed none and that the lint holds,** so the document is not what holds them:

- `type-has-one-scale`: with the document, broken in 0 of 1; without it, broken in 0 of 1.

**Rules that showed none and that the lint does not hold:** in these runs the document changed nothing about them, so each is a candidate to cut or to rewrite.

- `colour-is-data`: with the document, broken in 0 of 1; without it, broken in 0 of 1.
- `hue-follows-the-pool`: with the document, broken in 0 of 1; without it, broken in 0 of 1.
- `quantities-are-blocks`: with the document, broken in 0 of 1; without it, broken in 0 of 1.
- `never-invent-a-number`: with the document, broken in 0 of 1; without it, broken in 0 of 1.
- `figures-are-written-once`: with the document, broken in 0 of 1; without it, broken in 0 of 1.
- `names-not-ids`: with the document, broken in 0 of 1; without it, broken in 0 of 1.
- `one-panel-deep`: with the document, broken in 0 of 1; without it, broken in 0 of 1.
- `a-list-is-a-table`: with the document, broken in 0 of 1; without it, broken in 0 of 1.
- `same-slots`: with the document, broken in 0 of 1; without it, broken in 0 of 1.
- `the-url-is-the-screen`: with the document, broken in 1 of 1; without it, broken in 1 of 1.
- `words-are-the-products`: with the document, broken in 0 of 1; without it, broken in 0 of 1.
- `a-level-is-not-summed`: with the document, broken in 0 of 1; without it, broken in 0 of 1.

**Rules no run in one of the arms gave a chance to break,** so these runs say nothing about them:

- `tokens-by-role`: with the document, it applied to no run; without it, it applied to no run.
- `a-filter-is-a-button`: with the document, it applied to no run; without it, it applied to no run.
- `every-state-is-designed`: with the document, it applied to no run; without it, broken in 1 of 1.
- `motion-is-state`: with the document, it applied to no run; without it, it applied to no run.
- `roles-are-words`: with the document, it applied to no run; without it, it applied to no run.
- `readable-without-colour`: with the document, it applied to no run; without it, it applied to no run.

## Leaks

No run's patch quotes the document or a rule by its id, so nothing in what the judge read gave an arm away.

## What these numbers cannot carry

2 runs of 1 task, by one model, judged by one model reading a patch and screenshots, with no person checking its verdicts: a difference of a run or two is what chance gives, and a rule that showed none may simply not have been tempted hard enough by these tasks. The without arm still has the design system's code, its stories, the lint, ADR-0020 and the dashboard spec, which carry some of the rules on their own, so what is measured is what the document adds to them.
