---
status: accepted
scope: packages/ui
owner: limineol
last_verified: 2026-11-15
review_by: 2027-02-15
supersedes: []
code:
  - packages/ui
  - DESIGN.md
  - apps/web/.storybook
---

# ADR-0020: The design system is a package, and its rules are checked

## Context

The prototype's dashboard had a look its owner chose over three versions: a graphite console, monochrome, with colour kept for data; every quantity drawn as blocks that can be counted; a quota window as twenty blocks with a marker where even usage would be. It was 3,954 lines of hand-written CSS in one file, dark only, and its rules lived in a document nothing checked.

Cota is public and is meant to be changed by agents as much as by people (the product document's fourth principle). An agent asked for a screen reaches for what it has seen most: a centred hero, cards inside cards, a rounded dark rectangle around every chart, a new shade of grey. A design that is only described drifts with every such change.

## Decision

- **`packages/ui` is the design system; `apps/web` only composes it.** The package holds the tokens, the theme, the components and their stories. A screen imports a component by name (`@cota/ui/components/<name>`), chooses a variant and a size, and adds layout classes only. A new look is a new variant in the package. The package has no data fetching, no router and no copy of its own.
- **shadcn components on Base UI, owned as source.** Components are added with the shadcn CLI into `packages/ui/src/components` and then belong to the repository: they are edited to the tokens, and reviewed like any other code. Base UI gives the behaviour (focus, keyboard, ARIA) that the prototype wrote by hand.
- **Tailwind 4, with only our tokens.** The theme is CSS (`packages/ui/src/styles`): Tailwind's default palette is removed, so a class that names a colour outside the tokens compiles to nothing. Tokens are named for their role (`surface`, `border`, `text-2`, `danger`), never their value.
- **Two themes.** Light and dark, each a set of the same tokens; the system's preference by default, and the owner's choice kept in the browser. Dark keeps the prototype's graphite. Every component and every screen is checked in both.
- **Colour is for data.** The interface is monochrome. A pool owns one hue from a categorical set validated for contrast and for colour-vision deficiency in both themes; pools take hues in the order of the configuration, and a pool beyond the set is neutral. Red is never a pool's hue: it means an error. Amber means a window near its limit.
- **Quantities are blocks.** The block meter (a quota window: twenty blocks of 5%, the last filled in part, and a pace marker), the block mix (fifty blocks of 2%), and the block columns (stacked blocks of one unit per time bucket) are components of the package, drawn as SVG by the package itself. There is no chart library: these three are the charts, and each can be read by counting.
- **A percentage is never invented.** A component that shows a quota draws the hub's number as it is.
- **Type is Geist and Geist Mono, served by the hub.** The fonts are files in the build; a self-hosted hub asks no other host for anything.
- **`DESIGN.md` is the rules, in two parts.** Its front matter and sections follow Google's DESIGN.md format, so `designmd lint` reads it; a test holds its colours equal to the theme's and fails on a pair `designmd` reports below AA, since the tool itself only warns. Its rules follow Vercel's practice: each has an id, a scope, and a **Bad** and a **Good** example taken from this dashboard, and the reflexes above are named and rejected. A correction made twice in review becomes a rule.
- **What can be checked is.** Oxlint with shadcn's rules fails a restyled component, a raw colour, an arbitrary value, an inline style or an unknown class outside the package. The test over `DESIGN.md` (`tooling/design.test.ts`) fails a colour the theme does not have, or has differently, and a pair below its contrast. The lint runs in `bun run check`, the test in `bun run test`.
- **Every story is a test.** Each component has stories for its states; each screen has a story per state that matters (loaded, empty, loading, failed), fed by fixtures (ADR-0019). Storybook's Vitest addon runs every story in a real browser, in light and in dark, and fails on an error, a failed interaction or an accessibility violation (axe). That is the `stories` gate of `bun run verify`, and CI runs it.
- **Motion is for state.** Colour and background changes take 140 ms and transforms 200 ms; the only ambient motion is the mark of a live session, and a skeleton shimmers while its content loads; `prefers-reduced-motion` turns all of it off.

## Considered

- **Keeping the hand-written stylesheet.** It is the look, but not a system: nothing stops the next rule from contradicting the last.
- **Radix as the base.** shadcn's default is Base UI since July 2026, which is where its new components land.
- **Recharts (shadcn's `chart`).** It draws lines, bars and areas; the dashboard's quantities are countable blocks, which it does not draw.
- **Screenshot comparison of every story.** It fails on a sub-pixel and is approved by habit. The stories gate checks behaviour and accessibility; looks are held by the tokens and the lint.

## Consequences

- A screen cannot fix its own looks: a missing variant is a change to `packages/ui`, with its story. That is slower once and cheaper every time after.
- The stories gate needs a browser in CI (Playwright's Chromium).
- Design evals (whether an agent given `DESIGN.md` builds a screen that follows it better than one without) are how the document's rules earn their place; they come at the end of the milestone, once there are screens to build.
