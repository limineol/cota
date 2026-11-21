import { describe, it } from "@effect/vitest";
import { Arbitrary, DateTime, Duration, Effect, Option, Schema } from "effect";
import { TestClock } from "effect/testing";
import * as Quota from "./quota.ts";

const int = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

const nineOClock = DateTime.toEpochMillis(
  DateTime.makeUnsafe("2026-11-11T09:00:00Z"),
);
const fiveMinutes = 5 * 60_000;
const instant = Arbitrary.all({ step: int(0, 12), nudge: int(-1, 1) }).pipe(
  Arbitrary.map(({ step, nudge }) =>
    DateTime.makeUnsafe(nineOClock + step * fiveMinutes + nudge),
  ),
);

const windowAt = (scene: {
  readonly start: DateTime.Utc;
  readonly steps: number;
  readonly percentGone: number;
  readonly used: number;
}) => {
  const spanMillis = scene.steps * fiveMinutes;
  const window: Quota.Window = {
    length: Quota.Length.make(Duration.millis(spanMillis)),
    scope: Option.none(),
    source: "headers",
    used: scene.used,
    span: Quota.Span.make({
      start: scene.start,
      reset: DateTime.add(scene.start, { milliseconds: spanMillis }),
    }),
    observedAt: scene.start,
  };
  const now = DateTime.add(scene.start, {
    milliseconds: (spanMillis * scene.percentGone) / 100,
  });
  return { window, now };
};

const placed = Arbitrary.all({
  start: instant,
  steps: int(1, 12),
  percentGone: int(-20, 120),
  used: int(0, 200).pipe(Arbitrary.map((halfPoints) => halfPoints / 2)),
}).pipe(Arbitrary.map(windowAt));

const nearPace = Arbitrary.all({
  start: instant,
  steps: int(1, 12),
  percentGone: int(0, 100),
  halfPointsAhead: int(-8, 8),
}).pipe(
  Arbitrary.map(({ halfPointsAhead, ...scene }) =>
    windowAt({
      ...scene,
      used: Math.min(Math.max(scene.percentGone + halfPointsAhead / 2, 0), 100),
    }),
  ),
);

const setClock = (time: DateTime.Utc) =>
  TestClock.setTime(DateTime.toEpochMillis(time));

const placedStanding = (scene: ReturnType<typeof windowAt>) =>
  Effect.gen(function* () {
    yield* setClock(scene.now);
    const standing = yield* Quota.standing(scene.window);
    if (standing._tag === "Placed") return standing;
    return yield* Effect.die("a window with a span is placed");
  });

const runs = { arbitrary: { runs: 1000 } };

describe("quota window laws", () => {
  it.effect.prop(
    "Q1: elapsed is between 0 and 1, and resets-in is never negative, for any now, before the span or after it",
    { placed },
    ({ placed }) =>
      Effect.gen(function* () {
        const { elapsed, resetsIn } = yield* placedStanding(placed);
        return elapsed >= 0 && elapsed <= 1 && !Duration.isNegative(resetsIn);
      }),
    runs,
  );

  it.effect.prop(
    "Q3: when pace gives an emptying time, it is shorter than resets-in",
    { placed },
    ({ placed }) =>
      Effect.gen(function* () {
        const { pace, resetsIn } = yield* placedStanding(placed);
        if (pace._tag !== "AheadOfPace" || pace.emptiesIn === undefined) {
          return true;
        }
        return Duration.isLessThan(pace.emptiesIn, resetsIn);
      }),
    runs,
  );

  it.effect.prop(
    "Q4: in reserve and ahead of pace are always by at least 2 points",
    { nearPace },
    ({ nearPace }) =>
      Effect.gen(function* () {
        const { pace } = yield* placedStanding(nearPace);
        if (pace._tag !== "InReserve" && pace._tag !== "AheadOfPace") {
          return true;
        }
        return pace.points >= 2;
      }),
    runs,
  );
});
