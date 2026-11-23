---
version: alpha
name: Cota
description: A graphite console for one person's AI subscriptions, monochrome, with colour kept for data and every quantity drawn as blocks that can be counted.
colors:
  bg: "#f6f6f7"
  rail: "#efeff1"
  surface: "#ffffff"
  surface-2: "#f1f1f3"
  surface-3: "#e6e6ea"
  border: "#e0e0e4"
  border-strong: "#c9c9cf"
  text: "#141416"
  text-2: "#4f4f57"
  text-3: "#63636c"
  on-text: "#ffffff"
  danger: "#c22f2b"
  warn: "#8f5300"
  ok: "#1a7346"
  pool-1: "#c75a14"
  pool-2: "#2f7bd6"
  pool-3: "#14855e"
  pool-4: "#9440a8"
  pool-5: "#1f8a9c"
  pool-6: "#c4436f"
  pool-7: "#7a6ed9"
  pool-8: "#25853a"
  pool-neutral: "#74747c"
  ramp-1: "#d3d8e0"
  ramp-2: "#a7b0be"
  ramp-3: "#76829a"
  ramp-4: "#2c323c"
  bg-dark: "#0c0c0e"
  rail-dark: "#0f0f12"
  surface-dark: "#141416"
  surface-2-dark: "#1a1a1e"
  surface-3-dark: "#222227"
  border-dark: "#25252a"
  border-strong-dark: "#33333a"
  text-dark: "#ececef"
  text-2-dark: "#a3a3ab"
  text-3-dark: "#8a8a93"
  on-text-dark: "#0c0c0e"
  danger-dark: "#f26d6a"
  warn-dark: "#e3a54a"
  ok-dark: "#4cc38a"
  pool-1-dark: "#d95926"
  pool-2-dark: "#3987e5"
  pool-3-dark: "#199e70"
  pool-4-dark: "#ab56c4"
  pool-5-dark: "#2fa3b8"
  pool-6-dark: "#d55181"
  pool-7-dark: "#9085e9"
  pool-8-dark: "#2f9e44"
  pool-neutral-dark: "#7c7c84"
  ramp-1-dark: "#4a5263"
  ramp-2-dark: "#6b778b"
  ramp-3-dark: "#9ca8bc"
  ramp-4-dark: "#e4e8ef"
typography:
  body:
    fontFamily: Geist Variable
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: Geist Variable
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.4
  axis:
    fontFamily: Geist Variable
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.4
  prose:
    fontFamily: Geist Variable
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.65
  h2:
    fontFamily: Geist Variable
    fontSize: 17px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: -0.015em
  h1:
    fontFamily: Geist Variable
    fontSize: 26px
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: -0.025em
  code:
    fontFamily: Geist Mono Variable
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
rounded:
  block: 2px
  control: 6px
  panel: 10px
  card: 14px
  full: 9999px
spacing:
  unit: 4px
  control: 32px
  control-sm: 28px
components:
  page:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
  page-dark:
    backgroundColor: "{colors.bg-dark}"
    textColor: "{colors.text-dark}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.card}"
  card-dark:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.text-dark}"
    rounded: "{rounded.card}"
  sidebar:
    backgroundColor: "{colors.rail}"
    textColor: "{colors.text-2}"
  sidebar-dark:
    backgroundColor: "{colors.rail-dark}"
    textColor: "{colors.text-2-dark}"
  meter-track:
    backgroundColor: "{colors.surface-3}"
    rounded: "{rounded.block}"
  meter-track-dark:
    backgroundColor: "{colors.surface-3-dark}"
    rounded: "{rounded.block}"
  block-pool-1:
    backgroundColor: "{colors.pool-1}"
    rounded: "{rounded.block}"
  block-pool-1-dark:
    backgroundColor: "{colors.pool-1-dark}"
    rounded: "{rounded.block}"
  block-pool-2:
    backgroundColor: "{colors.pool-2}"
    rounded: "{rounded.block}"
  block-pool-2-dark:
    backgroundColor: "{colors.pool-2-dark}"
    rounded: "{rounded.block}"
  block-pool-3:
    backgroundColor: "{colors.pool-3}"
    rounded: "{rounded.block}"
  block-pool-3-dark:
    backgroundColor: "{colors.pool-3-dark}"
    rounded: "{rounded.block}"
  block-pool-4:
    backgroundColor: "{colors.pool-4}"
    rounded: "{rounded.block}"
  block-pool-4-dark:
    backgroundColor: "{colors.pool-4-dark}"
    rounded: "{rounded.block}"
  block-pool-5:
    backgroundColor: "{colors.pool-5}"
    rounded: "{rounded.block}"
  block-pool-5-dark:
    backgroundColor: "{colors.pool-5-dark}"
    rounded: "{rounded.block}"
  block-pool-6:
    backgroundColor: "{colors.pool-6}"
    rounded: "{rounded.block}"
  block-pool-6-dark:
    backgroundColor: "{colors.pool-6-dark}"
    rounded: "{rounded.block}"
  block-pool-7:
    backgroundColor: "{colors.pool-7}"
    rounded: "{rounded.block}"
  block-pool-7-dark:
    backgroundColor: "{colors.pool-7-dark}"
    rounded: "{rounded.block}"
  block-pool-8:
    backgroundColor: "{colors.pool-8}"
    rounded: "{rounded.block}"
  block-pool-8-dark:
    backgroundColor: "{colors.pool-8-dark}"
    rounded: "{rounded.block}"
  block-pool-neutral:
    backgroundColor: "{colors.pool-neutral}"
    rounded: "{rounded.block}"
  block-pool-neutral-dark:
    backgroundColor: "{colors.pool-neutral-dark}"
    rounded: "{rounded.block}"
  block-ramp-1:
    backgroundColor: "{colors.ramp-1}"
    rounded: "{rounded.block}"
  block-ramp-1-dark:
    backgroundColor: "{colors.ramp-1-dark}"
    rounded: "{rounded.block}"
  block-ramp-2:
    backgroundColor: "{colors.ramp-2}"
    rounded: "{rounded.block}"
  block-ramp-2-dark:
    backgroundColor: "{colors.ramp-2-dark}"
    rounded: "{rounded.block}"
  block-ramp-3:
    backgroundColor: "{colors.ramp-3}"
    rounded: "{rounded.block}"
  block-ramp-3-dark:
    backgroundColor: "{colors.ramp-3-dark}"
    rounded: "{rounded.block}"
  block-ramp-4:
    backgroundColor: "{colors.ramp-4}"
    rounded: "{rounded.block}"
  block-ramp-4-dark:
    backgroundColor: "{colors.ramp-4-dark}"
    rounded: "{rounded.block}"
  divider:
    backgroundColor: "{colors.border}"
  divider-dark:
    backgroundColor: "{colors.border-dark}"
  control-edge:
    backgroundColor: "{colors.border-strong}"
  control-edge-dark:
    backgroundColor: "{colors.border-strong-dark}"
  secondary-text:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-2}"
  secondary-text-dark:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.text-2-dark}"
  meta-text:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-3}"
  meta-text-dark:
    backgroundColor: "{colors.surface-2-dark}"
    textColor: "{colors.text-3-dark}"
  button-default:
    backgroundColor: "{colors.text}"
    textColor: "{colors.on-text}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    height: "{spacing.control}"
  button-default-dark:
    backgroundColor: "{colors.text-dark}"
    textColor: "{colors.on-text-dark}"
    rounded: "{rounded.control}"
  button-outline:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
  button-outline-dark:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.text-dark}"
    rounded: "{rounded.control}"
  button-danger:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.danger}"
    rounded: "{rounded.control}"
  button-danger-dark:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.danger-dark}"
    rounded: "{rounded.control}"
  warning:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.warn}"
  warning-dark:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.warn-dark}"
  live:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ok}"
  live-dark:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.ok-dark}"
---

# Cota's design

The tokens above mirror `packages/ui/src/styles/tokens.css` (the light theme, and the dark theme as `-dark`) and the type, radii and sizes of `packages/ui/src/styles/theme.css`. Change them together. The rules are the last section, [Do's and Don'ts](#dos-and-donts): each has an id, a scope, and a **Bad** and a **Good** example from this dashboard.

## Overview

A graphite console: monochrome, with colour kept for data, and every quantity drawn as blocks that can be counted (ADR-0020). Dark keeps the prototype's graphite; light is a first draft of the same roles.

## Colors

Tokens are named for their role, never their value: `bg`, `rail`, `surface` to `surface-3`, `border` and `border-strong`, `text` to `text-3`, `on-text`, and `danger`, `warn` and `ok` for state. Red means an error and amber a window near its limit.

**Pool hues.** `pool-1` to `pool-8` are the categorical set a pool's blocks, meter fill and mark are drawn in; pools take them in the order of the configuration, and a pool beyond the eighth takes `pool-neutral`, a grey (`docs/specs/dashboard/spec.md`, Pool hues). Dark keeps the prototype's hues but the fourth, a purple in place of its amber, which is what a meter turns near its limit; light darkens each to hold its contrast on white. `tooling/design.test.ts` holds the set: every hue, and the neutral one, has at least 3:1 contrast against `surface` in its theme (WCAG 1.4.11, for graphics); each hue stays apart from the next by a CIEDE2000 difference of at least 8 in normal vision and under protanopia, deuteranopia and tritanopia (Machado et al., full severity), in both themes; and every hue stays apart from `warn` and from `danger` by at least 12 in normal vision, in both themes, so a meter's warning never looks like a pool. Red and amber are not in the set: they mean an error and a window near its limit.

**Token ramp.** `ramp-1` to `ramp-4` are one ordinal ramp for the kinds of tokens, cheapest to dearest: cache read, cache write, uncached input, output. The bulk, cache reads, recedes into the surface and output stands out most; the test holds each step at more contrast against `surface` than the one before, in both themes.

**Meters.** A block takes its colour from `--hue`, which the utilities `hue-1` to `hue-8`, `hue-neutral` and `hue-ramp-1` to `hue-ramp-4` set; `bg-hue` and `fill-hue` draw in it. A meter's empty block is `hue-track`, the hue at 16% over `surface-2`. Its fill is the pool's hue, then `warn` from 80% used and `danger` at 100%. The pace marker is `text`, ringed in `surface`.

## Typography

Geist for the interface and Geist Mono for code, ids, model names and SQL, both served from the build. The base is 13px.

## Shapes

Blocks and swatches are 2px, controls 6px, small panels 10px and cards 14px.

## Components

Components live in `packages/ui` and are imported by name. A screen chooses a variant and a size and adds layout classes only.

The quantities are the block components, drawn by the package itself, with no chart library. Each takes numbers the dashboard has already decided (`docs/specs/dashboard/spec.md`) and only draws them:

- `block-meter`: a quota window's twenty blocks, the partial one, the pace marker, and amber or red by `severity`; `size` is `card` or `detail`. It is a `meter` with the value text it is given.
- `block-mix`: a run of fifty blocks in parts, two rows of twenty-five in a narrow container, with a legend of label, value and share, or the `empty` it is given.
- `block-columns`: stacked blocks of one unit per bucket, as SVG at the container's width. It asks `fit` for the columns once it knows how many fit across it, names the unit in its readout, and reads a bucket's total and parts on hover or with the arrow keys.
- `pool-mark`: a pool's mark in its hue, the glyph given or the pool's initial in a rounded square.
- `provider-logo`: a provider's logo in one colour (`currentColor`), the glyph a pool mark is given: Claude, OpenAI, Z.ai, OpenCode and LM Studio, each in a view box that evens out its optical size beside an initial. A pool takes its provider's logo (`#shared/providers.tsx`), so pools on one provider differ by hue and pools on different providers by shape; a pool whose provider has none keeps its initial. The names and logos belong to their owners and identify the provider only.

The shell and its controls:

- `mark`: Cota's mark, a 4×4 pavement whose lit stones (`text`) trace one crest of a wave over unlit ones (`border-strong`); 20px in the sidebar, 28px on the sign-in screen.
- `sidebar`: the shell. From the `wide` breakpoint (761px) a 232px sidebar on `rail` holds the brand, the navigation and, in its footer, the theme, the sidebar's toggle and sign-out; collapsed, it is a 60px rail of icons whose labels show in tooltips. An item may write its `shortcut` quietly at its end, as Search does with the palette's. Below it, a 52px top bar opens the same sidebar as a drawer (`sheet`). The current page is `surface-3`. A skip link leads to `main`.
- `segmented`: one of a few options, as a radio group; with `iconOnly`, each option's label is its name and its tooltip; `sm` is smaller, for a panel or a header's end, and scrolls sideways when its options do not fit; `xs` is smaller still, unbordered on `surface-2`, for the end of a field.
- `alert`: a problem (`danger`) or a notice, announced as it appears, with an optional action such as Try again.
- `card`, `input`, `label`, `tooltip` and `page`: a panel on `surface` with a 14px radius (`compact`, one of several panels in a section), a 32px field, its label, a label beside a control, and a screen's container (at most 1600px, gutters of 32px or 16px) with its `h1`, its header and description, and its sections, each set off by a rule with an `h2`, dimmed to 55% after 150 ms while what it shows is stale.

The overview's parts:

- `switcher`: links to the views of one screen, side by side as a segmented control's options are, the current one filled; it scrolls sideways when they do not fit.
- `badge`: a 20px label beside a name, outlined for a plan, a pool's kind, a reported request or session (`Reported`) and a reported through the hub calls late (`Late`), or `live`, a green pill whose dot pings: the one ambient motion. Late is outlined, not amber: amber is a window near its limit.
- `stat`: a figure with its label, a delta beside it (`text-2`, `text-3` for no change, red when up is worse), a unit, and lines under it; as a `tile` among six, a `panel`, or plain in a card. Given a link by `render`, the whole figure leads to where its requests are listed, its label ends in an arrow, and its border and ground darken on hover.
- `pool-card`: a pool's card in a grid of up to three columns of at least 320px, or a list of one row per pool whose columns line up from card to card; every card has the same slots (mark, name, badge, state, windows, figures). `quota-window` is one window's line on it: name, used, the countdown and its meter, with a foot of its pace in words in `detail`. `reported-through` takes the windows' slot on an observed pool's card, and sits under its sentence in `pool-focus`: a quiet title, then a line per machine and client, its name, a badge beside it and how long ago at its end, larger in `detail`. `pool-focus` is one pool in full.
- `table`, `magnitude-bar` and `rank-list`: a compact table whose first and last columns are flush with its panel, a hairline as long as a row's share of the largest (`from="end"` grows it from the right), and the few largest of something with their figures. A column is `numeric` (right-aligned, with its figures) and shown `from` a width of its `list-panel` (`sm` 512px, `md` 672px, `lg` 896px, `xl` 1024px). A head that orders the rows holds a `table-sort`, a link or button whose arrow sits on the side away from the figures, and says so in `aria-sort`. A `linked` body is one item's rows as one link: its `table-label`'s link is stretched over them and their ground darkens on hover and focus; `marked` sets apart the item the page led the reader to. `table-magnitude` is a numeric cell's share as that hairline, at most 3rem and ending at the figure's right edge, taking no height so the figure keeps the row's line. A `table-header` given `from` keeps its heads for assistive technology only below that width, where a lone head would only push the rows down. `table-secondary` is a quiet line under a cell's value; `table-flag` is a short count that needs attention, such as errors, beside a name.
- `legend`, `empty`, `skeleton` and `updated`: what a chart's colours stand for; what is empty and why; a place held for loading content, shaped like it; and when a screen's answer was read, with a button to read it again.

The parts every list shares (the sessions, a session's requests, the errors):

- `list-panel`: a list as one panel, the only one it sits in: `list-panel-head` holds the list's search and, in `list-panel-filters`, its filter buttons on one line that scrolls sideways below 1024px (it may wrap from there) with their reset beside them, `list-panel-body` its table, inset to the panel's padding and dimmed while stale, and `list-panel-foot` what is shown and the way to more. It is a size container, so its columns leave by its own width, not the window's.
- `filter-menu`: a dimension's filter as a 28px button named for it. With nothing chosen it is dashed, with a plus; once values are chosen it is solid and carries them after a rule, up to two names and then how many. Its menu lists the values, each a `filter-menu-item` ticked while chosen, with its pool mark when it has one, its count and a hairline of its share of the largest, under a heading that says what is counted; it stays open while values are ticked. `filter-menu-note` stands in for the values while they load or when there are none.
- `toggles`: a few settings side by side, each pressed or not on its own (`aria-pressed`), in the shape of a `segmented` `sm`: a pressed one filled as `segmented`'s chosen option, one not pressed with no ground, in `text-3` and its name struck through, so the two differ by more than colour; each with its count.

The sessions list's parts:

- `search-field`: a 32px search form with its icon, whose `onSubmit` is called on Enter, and an `end` for how it matches (a `segmented` `xs`).
- `select`: one of a list of options in a 34px trigger like an outlined button, its popup aligned to the trigger's end; an option may carry a mark, such as a pool's, before its name. `field` is a 32px trigger edged as an `input`, for a row of fields, with a quiet placeholder while nothing is chosen and a `danger` edge when refused, as Settings → Routes' pools are chosen.
- `checkbox`: a 14px box on `text-3` that fills with `text` and a tick when checked. No screen uses it now.
- `chip`: a chosen value as a button that removes it, `Dimension · value ×`, with a `chips-clear` button, underlined like a link, that removes them all. No screen uses it now: a filter button carries its chosen values.
- `session-table`: a session's parts in the sessions table: `session-title`, its title (`prompt` when it has none and the first prompt stands in, `none` when neither does) inside the row's `table-label`; and `session-snippet`, where a search found it, a second row across the table, a quiet inset of two lines at most with its words in `snippet-mark`.
- `pager`: in a list panel's foot, which rows are shown, a `pager-step` link to the newer and the older page (a disabled button where there is none), the page among the pages, and a `pager-note` on why the list stops.

A session's parts:

- `back-link`: a link back to the screen this one was opened from, above its title.
- `identifier`: an id or a command in mono with a button that copies it, wrapped at its spaces before anywhere else.
- `tag`: a value a session was made with, as a link to the sessions it filters: its kind, its mark when it has one, and its name.
- `context-columns`: a session's main requests as columns of blocks of one unit, oldest left, each as tall as the largest prompt it holds (`docs/specs/dashboard/spec.md`, Context columns), in the session's pool's hue or the neutral one; a dashed rule and its words before each new segment, the danger mark over a column with an error, and the other requests as small `text-3` blocks under the baseline. It reads a column on hover or with the arrow keys and calls `onActivate` on a click or Enter. `context-key` is its legend's entry.
- `request-table`: a request's parts in a session's requests table: `request-role`, its role in words (`main` in ink, the others in `text-3`), and `request-ended`, how it ended in words, `danger` only for an error; an answer leaves the cell empty (its word is for assistive technology only), so the eye finds what did not answer, and a diverted answer says so quietly.
- `segment`: a stretch of a conversation under a rule (none for the first, under the tabs' own), its title, what it holds, and `segment-show`, the dashed button that reads a closed segment's transcript.
- `transcript`: a conversation's entries. `transcript-message` is what a participant said, a user's as a filled block on `surface-2` and an assistant's as bare text; `transcript-row` is a quiet row that opens on click (a tool call, reasoning, a system message, a reminder, an image, what cannot be read), one line of its label, a preview and a figure, `danger` for a failed tool result. What is shown is chosen with `toggles` and two icon buttons that open or close every row, in the `end` of a session's tabs.
- `prose`: text with the little markdown a transcript needs (paragraphs, headings, lists, inline code, bold, a link as its words and address), at the prose size and at most 78 characters wide; `code-block` is code in mono, `quiet` for what the model was given.
- `switch`: a setting on or off, ink when on, with its name and a count. No screen uses it now: a transcript's settings are `toggles`.

A request's parts:

- `tabs`: the parts of one subject as links over a rule, the open one underlined in ink and kept in the URL, each with its count in `text-3`; it scrolls sideways when the links do not fit. `end` holds what acts on the open part (a transcript's `toggles`) at the rule's right end, or under the links at the left when the row is narrower than 672px.
- `fields`: what was recorded, as `field-group`s of names in words (`text-3`) and values in mono, two groups side by side from the page's `@3xl`; `field-none` says in words that a value is missing.
- `json-view`: a JSON value set out two spaces a level, keys in ink, strings in `text-2`, numbers and booleans in weight, null and punctuation in `text-3`, and a string over 400 characters clamped with a button for the rest. It draws with tokens only and has no dependency.
- `tool-list`: the tools a request offered, each its name in mono and its description clamped at 240 characters.
- `note`: a quiet line under what it explains, its links underlined.
- `badge`: `danger` is for an error and nothing else; a refusal or a hang-up is outlined.

The errors screen's parts:

- `error-cause`: a cause of failure in the errors table's first cell: `error-cause-title`, its headline (`docs/specs/dashboard/spec.md`, An error's headline) held to two lines and, when the message holds more, a button with a chevron that opens the whole message in `error-cause-detail`; under it, quietly, `error-cause-facts`: the provider and model, each an `error-cause-value` button that filters the list by it, and the status and error type as `error-cause-fact`s. `error-cause-latest` is the icon link to its latest request, named by its tooltip.

The SQL console's parts:

- `code-editor`: code typed into a textarea laid over a toned copy of its text, with line numbers in `text-3`, in mono at the body size. Its tones are ink and weight only: keywords semibold, numbers medium, names in ink, strings in `text-2`, comments italic and punctuation in `text-3`. Tab indents by two spaces unless Escape came just before, so the keyboard can still leave it; ⌘↵ or Ctrl+↵ runs. `code-editor-panel` holds it over `code-editor-bar`, whose run button writes its shortcut in `kbd`, and `code-editor-status`, a quiet figure at the bar's end.
- `data-grid`: an answer's rows under its columns' names and types, drawn only where they are seen, 28px a row, the head and the row numbers sticky. A column is one of five widths; numbers are set right in tabular figures; a null is a quiet `NULL` in small sans capitals, unlike the string `NULL` in mono, and an empty string is an empty cell. A click, or Enter on the cell the arrow keys reached, inspects it in `data-grid-inspector`, `json-view` for JSON and `data-grid-text` for the rest. `data-grid-foot` is a line of its rows and time, with `data-grid-actions` at its end; `data-grid-message` stands in for rows there are none of; `data-grid-panel` is dimmed to 55% after 150 ms while a newer run is on its way.
- `schema-tree`: a database's tables in `schema-rail`, beside what uses them from the page's `@4xl` (896px) and sticky there, above it and opened by `schema-toggle` below that. A `schema-table` is a chevron that opens its columns, its name as a button, and a figure; open, it says what it is above its `schema-column`s, each its name and type in mono and its comment under them. `schema-note` and `schema-skeleton` stand in for the tables.
- `menu`: actions under an outlined button, each a `menu-item` of a title (mono when it is code) and a quiet detail, in `menu-group`s under a quiet label; `menu-note` stands in when there are none.
- `copy-button`: copies a value read when it is pressed, an outlined button with its words or an icon, and says so for a moment.
- `alert-code`: what a machine said in an alert, in mono and wrapped, under the alert's own words.

Settings' parts:

- `field-note`: a line under a field that says what became of it, quiet for what happened (saved, removed) and `danger` for a refusal, announced as it appears; the field keeps what was typed.
- `confirm`: a question asked once, in place, where the control that asked it was: the question, a `danger` button that does it and a ghost one that keeps things as they are, which takes the focus, as Escape does. It is not a dialog: a list's head or an item's row holds it, and no modal is drawn.
- `table-more`: what continues an item's row under it and across the table, such as a `confirm`; `table-item` holds the row and its continuation with no rule between them.
- `field-rule`: a rule a field's value must meet, under the field: a quiet dot until it is met, then a tick, and with the screen-reader words "met" or "not met yet"; `refused` when the form was sent while it was not met, in `danger` and announced, the value not sent.
- `route-fields`: a rule read as a sentence in a table's row, what it matches, an arrow in `text-3`, and what it leads to, such as a route's pattern and its pool; in columns that line up from row to row from the panel's 672px, and below it what it leads to under what it matches, after the arrow. `route-fields-head` heads its two columns.
- `list-panel-head` with `alone` when nothing is listed under it, its padding closing the panel; `list-panel-inset` holds a form in place in a panel, such as changing the owner password, at the head's padding, never a panel inside the panel.

Getting in's parts (the sign-in screen and Setup):

- `or-rule`: a hairline with "or" in its middle, between two ways to do one thing, such as the password and a passkey.
- `guide`: a screen before the dashboard, without the shell, in two columns of at most 56rem: `guide-words`, Cota's mark and name, then `guide-title` (the page's `h1` size) and `guide-lead` (the prose size, `text-2`), and beside them a 22rem `card` with the form, centred on the words; one column below the `wide` breakpoint, the words first.
- `steps`: numbered steps joined by a hairline, each a `step` of a 24px mark, its title and what helps with it. The mark is the number outlined in `border-strong` while ahead, in ink for the current step, filled with ink and a tick once done, and outlined in `danger` with the alert icon when what it asked for was refused; the state is also written for assistive technology ("Step 1, done").
- `log-line`: a line as a program prints it in its log, in mono in an inset on `surface`, wrapped, its prefix (time, level, fiber) in `text-3` and `log-line-mark` on what the owner looks for in ink and weight; `refused` gives the inset a `danger` edge. Its caption says where the log is. An example in it is never a value that looks real: a code is `XXXX-XXXX-XXXX`.
- `input` with `code`: a code the owner copies from elsewhere, such as a setup code, in mono and spaced so each character reads apart.

The command palette's parts:

- `palette`: a dialog near the top of the screen, 640px at most, on `surface` with a `border-strong` edge and the card's radius over a scrim of `bg` at 70%, with no shadow; its field takes the focus and gives it back on close. `palette-field` is its 52px row, a magnifier, the field at the prose size and `esc` as the button that closes it, over a rule. `palette-list` holds the results and scrolls; `palette-group` is a kind of result under a small quiet head (`text-3`, medium, the size of a table's heads) that stays in place while its results scroll, set off from the group before by a hairline. `palette-item` is one result, a link: an icon or a pool's mark, the name, a quiet detail at its end, and under the name a `palette-snippet` (two lines at most) or a `palette-id` in mono; the chosen one is filled with `surface-2` and says `Open ↵`. `palette-mark` marks what the text matched, as `snippet-mark` does. `palette-note` is a group's one quiet line while it reads, when it has nothing, or when its read failed. `palette-foot` writes the keys in `palette-key`s (↑ ↓ to move, ↵ to open, esc to close), from the `wide` breakpoint, and how many results there are.

## Do's and Don'ts

Each rule has an id to cite in a review, the scope it applies to, what holds it, and a **Bad** and a **Good** example. The bad examples are what a screen tends to become when it is built from habit; none of them is in the repository. A correction made twice in review becomes a rule here.

**Rejected on sight**, because they are what every dashboard looks like and none of them says anything about a quota: a hero or a greeting at the top of a screen; a card inside a card; a shadow under a panel; a gradient; an accent colour on a button or a link; an icon in a tinted circle beside every figure; a donut, a pie, a sparkline or a smooth area chart; a spinner in the middle of an empty panel; a pill around every label; an emoji in the interface.

### `colour-is-data`

**Scope:** every screen and component. **Held by:** the theme (there is no accent token to reach for), review.

The interface is monochrome: `text` on `surface`, and the selected state is `text` itself. A hue on screen always answers "which pool?", and `danger`, `warn` and `ok` answer "what state?". Nothing is coloured to look inviting.

**Bad:** an accent that means nothing.

```tsx
<Button className="bg-pool-2 text-on-text">Try again</Button>
<a className="text-pool-2" href="/sessions">3 active sessions</a>
```

**Good:** the button is ink, and the hue belongs to the pool beside it.

```tsx
<Button variant="outline" size="sm">Try again</Button>
<PoolMark hue={hue} name={pool.id} size="md" />
```

### `hue-follows-the-pool`

**Scope:** anything drawn for a pool. **Held by:** law V18, `tooling/design.test.ts` (contrast, and distance between neighbours for colour-vision deficiency), review.

A pool has one hue, the one `poolHues` gives it from its place in the configuration, and that hue follows it everywhere: its mark, its meter, its blocks in a chart, its row's magnitude bar. A screen never picks a hue, and a ninth pool is neutral rather than a generated colour.

**Bad:** a hue chosen where it is drawn.

```tsx
<BlockMeter hue={pool.provider === "openai" ? 2 : 1} … />
```

**Good:** the hue the pool already has, passed down.

```tsx
const hue = poolHues(pools.map((pool) => pool.id)).get(pool.id) ?? "neutral";
<PoolMark hue={hue} name={pool.id} />
<BlockMeter hue={hue} … />
```

### `red-is-an-error`

**Scope:** `danger`, `warn`, `ok`. **Held by:** `tooling/design.test.ts` (no pool hue within reach of `warn` or `danger`), review.

Red means something failed or a window is full. Amber means a window is near its limit or ahead of its pace. Green means live. A figure that merely went down is not red, and a figure that went up is red only where up is worse.

**Bad:** every fall is red and every rise green.

```tsx
<StatDelta direction="down" className="text-danger">↓12%</StatDelta>
```

**Good:** only errors say that more is worse.

```tsx
<StatDelta direction={direction} worse={figure.worse === true}>{text}</StatDelta>
```

### `quantities-are-blocks`

**Scope:** every quantity that is drawn. **Held by:** laws V1 to V15, review; there is no chart library to import.

A quantity is drawn as blocks that can be counted: a quota window is twenty blocks of 5% (`block-meter`), a split is fifty of 2% (`block-mix`), and traffic over time is stacked blocks of one named unit (`block-columns`). A row's size against its neighbours is a hairline (`magnitude-bar`). What the blocks hold is decided by `apps/web/src/shared/domain`, and the component only draws it.

**Bad:** a bar whose length has to be believed.

```tsx
<div className="h-2 rounded-full bg-surface-3">
  <div className="h-2 rounded-full bg-pool-1" style={{ width: `${used}%` }} />
</div>
```

**Good:** twenty blocks, the last one partly filled, and where even use would be.

```tsx
const { blocks, severity, pace } = meter({ usedPercent, elapsed });
<BlockMeter
  blocks={blocks}
  pace={pace}
  severity={severity}
  hue={hue}
  label={name}
  valueText={used}
/>
```

### `the-hub-decides`

**Scope:** screens. **Held by:** review, and the dashboard spec, which lists everything the dashboard does decide.

The dashboard draws what the hub answers. A window's used percentage, its standing and its pace are the hub's, computed by code with laws; a screen that works them out again will one day disagree with the hub.

**Bad:** the pace, worked out a second time.

```tsx
const ahead = window.usedPercent / 100 > elapsed / window.lengthMs;
```

**Good:** the hub's word for it, written out.

```tsx
switch (window.standing.pace) {
  case "in-reserve":
    return { text: `${points}% in reserve`, tone: "ok" };
```

### `never-invent-a-number`

**Scope:** every figure. **Held by:** review.

A figure the hub did not give is not shown: no `0%` for a pool whose windows are unknown, no cost written as complete while a request in it has no price, no "30 days" over a request log that is twelve days old. The slot stays, and says why it is empty.

**Bad:** a nought that looks like a reading, and a sum that looks whole.

```tsx
<QuotaWindowUsed>{pool.windows[0]?.usedPercent ?? 0}% used</QuotaWindowUsed>
<span>{cost(dollars)}</span>
```

**Good:** the reason in the slot, and the sum marked as a lower bound.

```tsx
<PoolCardNote>{noWindows(pool).short}</PoolCardNote>
<span>{costText(dollars, unpricedRequests)}</span>
```

### `figures-are-written-once`

**Scope:** every number, span and share on screen. **Held by:** laws V16 to V20 over `quantities.ts`, review.

A count of tokens, a cost, a share, a span, a delta and "how long ago" are each written by one function of `#shared/domain/quantities.ts`, so `1.2M` is the same everywhere and never `1000K`. Figures are `tabular-nums`, so a countdown does not shake the line it is on.

**Bad:** formatting where the figure happens to be.

```tsx
<span>{(tokens / 1e6).toFixed(1)}M</span>
<span>{Math.round(ms / 60000)} min</span>
```

**Good:**

```tsx
<span>{tokens(total)}</span>
<span>Resets in {span(resetsAt - now)}</span>
```

### `names-not-ids`

**Scope:** pools, models, projects, clients and hosts, anywhere but the SQL console. **Held by:** review.

People see display names; the id is the tooltip and what the URL carries.

**Bad:** `<strong>{pool.id}</strong>`

**Good:** `<Name kind="pool" value={pool.id} />`

### `screens-compose`

**Scope:** `apps/web`. **Held by:** `bun run lint:design` (`shadcn/no-restyle`, `no-raw-colors`, `no-arbitrary-values`, `no-inline-styles`, `no-unknown-classes`).

A screen imports a component, chooses its variant and size, and adds layout classes only: where it sits, how wide it is, the gap around it. Anything that changes how a thing looks is a variant in `packages/ui`, with a story.

**Bad:** a card restyled where it is used.

```tsx
<Card className="rounded-xl bg-surface-2 p-6 text-lg">…</Card>
```

**Good:** the variant, and its place in the grid.

```tsx
<Card size="compact" className="col-span-2">…</Card>
```

### `tokens-by-role`

**Scope:** `packages/ui`. **Held by:** the theme (Tailwind's palette is removed, so `text-zinc-400` compiles to nothing), `tooling/design.test.ts` (this file's colours equal the theme's, and every pair it lists passes AA).

A colour is a token named for its role, with a value in each theme. There is no `dark:` class anywhere: what must differ between the themes is a token that differs. A new token is added to `tokens.css`, to this file's front matter, and to a pair the test can check.

**Bad:** `className="bg-[#1a1a1e] text-zinc-400 dark:text-zinc-500"`

**Good:** `className="bg-surface-2 text-text-3"`

### `one-panel-deep`

**Scope:** layout. **Held by:** review.

There is one way to set something apart: a panel on `surface` with a `border`. A panel never holds another panel, and nothing has a shadow. Inside a panel, parts are separated by space or by one rule.

**Bad:** a card of cards.

```tsx
<Card>
  <Card className="shadow-md">Today</Card>
  <Card className="shadow-md">Since Nov 2</Card>
</Card>
```

**Good:** one card, a rule, and two figures at its edges.

```tsx
<PoolCard>
  <PoolCardWindows>…</PoolCardWindows>
  <PoolCardFoot>
    <PoolCardFigure label="Today">…</PoolCardFigure>
    <PoolCardFigure label={since}>…</PoolCardFigure>
  </PoolCardFoot>
</PoolCard>
```

### `a-list-is-a-table`

**Scope:** every list of like things with figures: the sessions, a session's requests, the errors' causes. **Held by:** review, and the stories that check a list's columns at 1440px and at 414px.

A list is one `list-panel`: its search and filters in the head, a `table` in the body, and what is shown and the way to more in the foot. Its figures are columns under heads, right-aligned so they can be read down; a head that orders the rows is a link, and the order is in the URL. A row that leads somewhere is one link (`linked`), not a card, and a column the panel has no room for leaves by the panel's width (`from`), the row then writing those figures with their units on a line under its name.

**Bad:** a list of cards, each laying out its own figures with their units, beside a rail of filters in a second panel.

```tsx
<div className="flex gap-6">
  <Card>{facets}</Card>
  <div className="flex flex-col gap-2">
    {rows.map((row) => (
      <Card key={row.id}>
        {row.title} · {tokens(row.tokens)} tokens · {cost(row.cost)}
      </Card>
    ))}
  </div>
</div>
```

**Good:** one panel; the filters in its head and the figures in columns.

```tsx
<ListPanel aria-label="Sessions">
  <ListPanelHead>{search}{filters}</ListPanelHead>
  <ListPanelBody>
    <Table aria-label="Sessions">
      <SessionsHead sort={sort} sortLink={sortLink} />
      {rows.map((row) => <SessionItem key={row.id} row={row} … />)}
    </Table>
  </ListPanelBody>
  <ListPanelFoot><Pager>…</Pager></ListPanelFoot>
</ListPanel>
```

### `a-filter-is-a-button`

**Scope:** filters over a list. **Held by:** review, and the play functions that tick a value and reset.

Each dimension a list can be filtered by is one `filter-menu` in the panel's head, the buttons on one line that scrolls sideways when they do not fit, dashed while nothing is chosen and carrying what is chosen once something is, so the filters in force are read where they are changed. The menu counts each value and draws its share. One Reset, shown only while something is chosen, removes every filter. A filter is never a rail beside the list, nor a row of chips under it.

**Bad:** the choices in one place and what is chosen in another.

```tsx
<FacetRail>{dimensions.map((d) => <FacetGroup key={d} … />)}</FacetRail>
<Chips>{chosen.map((c) => <Chip key={c.value} onRemove={…} />)}</Chips>
```

**Good:** each dimension one button that states its choice.

```tsx
<ValuesFilter label="Pool" chosen={chosen.pool} values={facets.pool} … />
{someChosen ? <Button variant="ghost" size="sm" onClick={reset}>Reset <X /></Button> : null}
```

### `same-slots`

**Scope:** any set of like things: pool cards, rows, tiles. **Held by:** review, and the stories that put a full card beside an empty one.

Every member of a set has the same slots in the same places, so the eye can run down one column. A member with nothing for a slot keeps the slot.

**Bad:** a pool without windows gets a shorter card with a different layout.

```tsx
{pool.windows.length > 0 ? <PoolCardWindows>…</PoolCardWindows> : null}
```

**Good:** the slot, saying why.

```tsx
<PoolCardWindows>
  {pool.windows.length === 0 ? <PoolCardNote>{noWindows(pool).short}</PoolCardNote> : lines}
</PoolCardWindows>
```

### `every-state-is-designed`

**Scope:** every read from the API. **Held by:** the stories gate (a screen has a story for loaded, empty, loading and failed, in both themes), review.

A read has four faces, and each is built: while it loads, a skeleton shaped like what is coming; when it is empty, what is empty and why, and what would fill it; when it fails, the problem's own sentence and a way to try again; and while a new range loads, the last answer, dimmed.

**Bad:**

```tsx
if (query.isPending) return <Spinner />;
if (rows.length === 0) return <p>No data</p>;
```

**Good:**

```tsx
<Empty>
  <EmptyTitle>The hub has no pools.</EmptyTitle>
  <EmptyDescription>
    Pools are the subscriptions and keys in the hub's configuration. Add one there and restart the hub.
  </EmptyDescription>
</Empty>
```

### `the-url-is-the-screen`

**Scope:** screens. **Held by:** the play functions that choose a pool and change the range, review.

What a screen was asked to show (the pool, the range, a filter, a tab) is in the URL, with defaults left out, so a link shows the same thing and back goes back. Choosing is a link, not a click handler. Only decoration (grid or list, the collapsed sidebar, the theme) is kept in the browser.

**Bad:** `const [pool, setPool] = useState<string | null>(null);`

**Good:** `<Link to="/" search={(search) => ({ ...search, pool: pool.id })}>`

### `words-are-the-products`

**Scope:** all copy. **Held by:** review against `CONTEXT.md`.

One word for one thing, the one `CONTEXT.md` gives: a pool, a quota window, a quota login, a request, a session. Sentences are plain and in sentence case, say what happened and what to do, and never apologise, exclaim or address the owner by name.

**Bad:** "Oops! We couldn't load your accounts. Please try again later."

**Good:** "The hub did not answer. Check that it is running and reachable from this browser."

### `type-has-one-scale`

**Scope:** type. **Held by:** the theme's scale, `shadcn/no-arbitrary-values`.

Geist for the interface, and Geist Mono only for what is typed or copied: code, ids, model ids, SQL. The sizes are the theme's eight: 11 (axes), 12 (labels), 13 (the base), 14 (prose), 17 (a section), 22 (a figure), 26 (the page) and 34 (a fleet figure). Weight separates a figure from its unit before size does.

**Bad:** `<span className="font-mono text-[15px]">65.3M tokens</span>`

**Good:**

```tsx
<StatValue>65.3M <StatUnit>tokens</StatUnit></StatValue>
```

### `motion-is-state`

**Scope:** motion. **Held by:** the motion tokens, review.

Something moves because its state changed: a colour over 140 ms, a transform over 200 ms. Two things move without being touched, the ping of a live session and a skeleton's shimmer, and both are `motion-safe`. Nothing fades in when a page opens, and nothing lifts on hover unless it is a link.

**Bad:** `<PoolCard className="animate-in fade-in transition-all hover:scale-105">`

**Good:** `<Badge variant="live">2 active sessions</Badge>`

### `a-level-is-not-summed`

**Scope:** every figure drawn from requests. **Held by:** law V27, review.

A prompt size is a level, not an amount: what a context held at one moment. Where requests are merged into one column, one row or one figure, a level is the largest of them, never their sum; only amounts (tokens sent and received, requests, cost) add up.

**Bad:** three requests at 180K drawn as a context of 540K.

**Good:** `const peak = largest(main.map((request) => request.promptSize));`, the column's height in blocks over the unit.

### `roles-are-words`

**Scope:** a request's role and outcome wherever they are shown. **Held by:** review.

A request's role (main, subagent, title, utility, compaction) is written as a word, `main` in ink and the others in `text-3`; it never takes a hue, because the hues are the pools'. The same goes for how a request ended: red only for an error, and a refusal or a hang-up in words.

**Bad:** `<TableCell className={roleHue[request.requestRole]}>`

**Good:** `<RequestRole main={request.requestRole === "main"}>{roleWords[request.requestRole]}</RequestRole>`

### `readable-without-colour`

**Scope:** `packages/ui`. **Held by:** the stories gate (axe, in both themes), `tooling/design.test.ts` (contrast).

Whatever a colour says, words say too: a meter is a `meter` with its value as text, a chart reads its buckets to the keyboard and names its unit, a pace is written out beside its colour, and a pool's mark, a logo or an initial, stands beside the pool's name.

**Bad:** a red bar and nothing else.

**Good:** `<Pace tone="danger">16% ahead of pace · empties in 33m</Pace>` under a meter whose `valueText` is `86% used`.
