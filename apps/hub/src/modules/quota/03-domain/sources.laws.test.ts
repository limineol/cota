import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, DateTime, Duration, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import * as QuotaLog from "#modules/quota/05-tests/quota-log.ts";
import * as Quota from "./quota.ts";
import * as Sources from "./sources.ts";

const millis = DateTime.toEpochMillis;
const nowMs = millis(QuotaLog.now);
const { int, pick, step } = QuotaLog;

const fiveHours = Quota.Length.make(Duration.hours(5));
const sevenDays = Quota.Length.make(Duration.days(7));
const thirtyDays = Quota.Length.make(Duration.days(30));

/** A window on the grid: observed a few steps before `now`, often at the same instant as another, its reset around `now`. */
const reported = (source: "reading" | "headers", observedAt: number) =>
  Arbitrary.all({
    scope:
      source === "reading"
        ? pick([Option.none(), Option.none(), Option.some("Claude Opus")])
        : pick([Option.none()]),
    length: pick([fiveHours, fiveHours, sevenDays, thirtyDays]),
    used: int(0, 200),
    reset: Arbitrary.all({
      given: pick([true, true, false]),
      steps: int(-2, 12),
    }),
  }).pipe(
    Arbitrary.map(({ scope, length, used, reset }): Quota.Window => {
      const resetMs = nowMs + reset.steps * step;
      return {
        length,
        scope,
        source,
        used: used / 2,
        ...(reset.given
          ? {
              span: {
                start: DateTime.makeUnsafe(resetMs - Duration.toMillis(length)),
                reset: DateTime.makeUnsafe(resetMs),
              },
            }
          : {}),
        observedAt: DateTime.makeUnsafe(observedAt),
      };
    }),
  );

const observedAt = int(0, 3).pipe(
  Arbitrary.map((steps) => nowMs - steps * step),
);

const scene = Arbitrary.all({
  readingAt: observedAt,
  reading: pick([true, true, false]),
  readingWindows: Arbitrary.array(int(0, 0), { maxLength: 4 }),
  headersAt: Arbitrary.array(observedAt, { maxLength: 3 }),
  at: int(-1, 12).pipe(Arbitrary.map((steps) => nowMs + steps * step)),
}).pipe(
  Arbitrary.flatMap((generated) =>
    Arbitrary.all({
      readingWindows: Arbitrary.array(
        reported("reading", generated.readingAt),
        {
          minLength: generated.readingWindows.length,
          maxLength: generated.readingWindows.length,
        },
      ),
      headerWindows: Arbitrary.all(
        generated.headersAt.map((at) => reported("headers", at)),
      ),
    }).pipe(
      Arbitrary.map(({ readingWindows, headerWindows }) => ({
        at: DateTime.makeUnsafe(generated.at),
        sources: {
          reading: generated.reading
            ? Option.some({ windows: readingWindows, plan: Option.none() })
            : Option.none(),
          headers: { windows: headerWindows, plan: Option.none() },
          loginPlan: Option.none(),
        } satisfies Sources.Sources,
      })),
    ),
  ),
);

const quotaAt = (sources: Sources.Sources, at: DateTime.Utc) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(millis(at));
    return yield* Sources.quotaOf(sources);
  });

const isCurrent = (window: Quota.Window, at: number) =>
  window.span !== undefined
    ? millis(window.span.reset) > at
    : at - millis(window.observedAt) < Duration.toMillis(window.length);

const keyOf = (window: Quota.Window) =>
  `${Option.getOrElse(window.scope, () => "")}/${Duration.toMillis(window.length)}`;

/** The reading's windows, then the headers', current at `at`, the latest of each scope and length, the earlier in that order on a tie. */
const winners = (sources: Sources.Sources, at: number) => {
  const kept = new Map<string, Quota.Window>();
  for (const window of [
    ...Option.match(sources.reading, {
      onNone: () => [],
      onSome: ({ windows }) => windows,
    }),
    ...sources.headers.windows,
  ]) {
    if (!isCurrent(window, at)) continue;
    const held = kept.get(keyOf(window));
    if (
      held === undefined ||
      millis(window.observedAt) > millis(held.observedAt)
    ) {
      kept.set(keyOf(window), window);
    }
  }
  return kept;
};

const byKey = (windows: Iterable<Quota.Window>) =>
  [...windows].sort((one, other) => keyOf(one).localeCompare(keyOf(other)));

const runs = { arbitrary: { runs: 500 } };

const at = (steps: number) => DateTime.makeUnsafe(nowMs + steps * step);

const window = (
  source: "reading" | "headers",
  fields: Partial<Quota.Window> = {},
): Quota.Window => ({
  length: fiveHours,
  scope: Option.none(),
  source,
  used: source === "reading" ? 30 : 40,
  span: { start: at(-6), reset: at(4) },
  observedAt: at(-1),
  ...fields,
});

const withoutSpan = ({ span: _, ...window }: Quota.Window): Quota.Window =>
  window;

const sourcesOf = (
  reading: ReadonlyArray<Quota.Window>,
  headers: ReadonlyArray<Quota.Window>,
): Sources.Sources => ({
  reading: Option.some({ windows: reading, plan: Option.none() }),
  headers: { windows: headers, plan: Option.none() },
  loginPlan: Option.none(),
});

describe("which observation wins", () => {
  it.effect.prop(
    "W1: for any quota reading and quota headers of a pool, each scope and length that some current observation gives appears exactly once among the pool's windows, as the current one observed last, a reading winning a tie; no other window appears",
    { scene },
    ({ scene }) =>
      Effect.gen(function* () {
        const { windows } = yield* quotaAt(scene.sources, scene.at);
        expect(byKey(windows)).toEqual(
          byKey(winners(scene.sources, millis(scene.at)).values()),
        );
      }),
    runs,
  );

  it.effect(
    "W1: a reading and headers observed at the same instant give the reading's window, headers observed after the reading give theirs, and a reading after the headers gives its own",
    () =>
      Effect.gen(function* () {
        const reading = window("reading");
        const answers = [];
        for (const headers of [
          window("headers"),
          window("headers", { observedAt: at(0) }),
          window("headers", { observedAt: at(-2) }),
        ]) {
          answers.push(
            (yield* quotaAt(sourcesOf([reading], [headers]), at(0))).windows,
          );
        }
        expect(answers.map((each) => each.map(({ source }) => source))).toEqual(
          [["reading"], ["headers"], ["reading"]],
        );
      }),
  );

  it.effect.prop(
    "W2: every window has a used percentage, and it is the number the provider gave in that one observation",
    { scene },
    ({ scene }) =>
      Effect.gen(function* () {
        const { windows } = yield* quotaAt(scene.sources, scene.at);
        const given = [
          ...Option.match(scene.sources.reading, {
            onNone: () => [],
            onSome: ({ windows }) => windows,
          }),
          ...scene.sources.headers.windows,
        ];
        for (const window of windows) {
          expect(given).toContainEqual(window);
        }
      }),
    runs,
  );

  it.effect.prop(
    "W4: no window answered resets at or before the answer's time, and a window without a reset was observed less than its length before it, readings included",
    { scene },
    ({ scene }) =>
      Effect.gen(function* () {
        const { windows } = yield* quotaAt(scene.sources, scene.at);
        for (const window of windows) {
          if (window.span !== undefined) {
            expect(millis(window.span.reset)).toBeGreaterThan(millis(scene.at));
          } else {
            expect(millis(scene.at) - millis(window.observedAt)).toBeLessThan(
              Duration.toMillis(window.length),
            );
          }
        }
      }),
    runs,
  );

  it.effect(
    "W4: a window that resets at the answer's time, or that has no reset and was observed exactly its length before it, is not answered",
    () =>
      Effect.gen(function* () {
        const { windows } = yield* quotaAt(
          sourcesOf(
            [window("reading", { span: { start: at(-10), reset: at(0) } })],
            [
              withoutSpan(
                window("headers", {
                  length: sevenDays,
                  observedAt: DateTime.subtract(at(0), { days: 7 }),
                }),
              ),
            ],
          ),
          at(0),
        );
        expect(windows).toEqual([]);
      }),
  );
});
