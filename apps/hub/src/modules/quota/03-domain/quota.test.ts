import { describe, expect, it } from "@effect/vitest";
import { DateTime, Duration, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import * as Quota from "./quota.ts";

const at = (time: string) => DateTime.makeUnsafe(`2026-11-11T${time}Z`);

const clockAt = (time: string) =>
  TestClock.setTime(DateTime.toEpochMillis(at(time)));

const tenToTwo = Quota.Span.make({
  start: at("10:00:00"),
  reset: at("14:00:00"),
});

const fourHourWindow = {
  length: Quota.Length.make(Duration.hours(4)),
  scope: Option.none(),
  source: "reading",
  observedAt: at("10:30:00"),
} as const;

const reported = (used: number): Quota.Window => ({
  ...fourHourWindow,
  used,
  span: tenToTwo,
});

const standingAt = (window: Quota.Window, time: string) =>
  Effect.gen(function* () {
    yield* clockAt(time);
    return yield* Quota.standing(window);
  });

const paceAt = (window: Quota.Window, time: string) =>
  Effect.gen(function* () {
    const standing = yield* standingAt(window, time);
    return standing._tag === "Placed" ? standing.pace : undefined;
  });

describe("standing", () => {
  it.effect("leaves a window without a span unplaced", () =>
    Effect.gen(function* () {
      expect(
        yield* standingAt({ ...fourHourWindow, used: 0 }, "11:00:00"),
      ).toEqual({ _tag: "Unplaced" });
    }),
  );

  it.effect(
    "gives the share of the span elapsed and the time until the reset",
    () =>
      Effect.gen(function* () {
        expect(yield* standingAt(reported(25), "11:00:00")).toMatchObject({
          elapsed: 0.25,
          resetsIn: Duration.hours(3),
        });
      }),
  );

  it.effect(
    "holds elapsed at 0 before the span and at 1 after it, and never resets in less than zero",
    () =>
      Effect.gen(function* () {
        expect([
          yield* standingAt(reported(0), "09:00:00"),
          yield* standingAt(reported(100), "15:00:00"),
        ]).toMatchObject([
          { elapsed: 0, resetsIn: Duration.hours(5) },
          { elapsed: 1, resetsIn: Duration.zero },
        ]);
      }),
  );
});

describe("pace", () => {
  it.effect("is full at 100% used, however early", () =>
    Effect.gen(function* () {
      expect(yield* paceAt(reported(100), "10:00:00")).toEqual({
        _tag: "Full",
      });
    }),
  );

  it.effect(
    "is on pace while usage is less than 2 points either side of the time gone",
    () =>
      Effect.gen(function* () {
        expect([
          yield* paceAt(reported(23.5), "11:00:00"),
          yield* paceAt(reported(26.5), "11:00:00"),
        ]).toEqual([{ _tag: "OnPace" }, { _tag: "OnPace" }]);
      }),
  );

  it.effect(
    "is in reserve by as many points as usage trails the time gone, from 2 points on",
    () =>
      Effect.gen(function* () {
        expect([
          yield* paceAt(reported(23), "11:00:00"),
          yield* paceAt(reported(20), "11:00:00"),
        ]).toEqual([
          { _tag: "InReserve", points: 2 },
          { _tag: "InReserve", points: 5 },
        ]);
      }),
  );

  it.effect(
    "is ahead of pace by the lead, and says when the allowance empties at the rate so far",
    () =>
      Effect.gen(function* () {
        expect(yield* paceAt(reported(50), "11:00:00")).toEqual({
          _tag: "AheadOfPace",
          points: 25,
          emptiesIn: Duration.hours(1),
        });
      }),
  );

  it.effect("is ahead of pace from a lead of 2 points", () =>
    Effect.gen(function* () {
      expect(yield* paceAt(reported(27), "11:00:00")).toMatchObject({
        _tag: "AheadOfPace",
        points: 2,
      });
    }),
  );

  it.effect(
    "is ahead of pace without an emptying time before the span has started, or at its start",
    () =>
      Effect.gen(function* () {
        expect([
          yield* paceAt(reported(2), "09:00:00"),
          yield* paceAt(reported(10), "10:00:00"),
        ]).toEqual([
          { _tag: "AheadOfPace", points: 2 },
          { _tag: "AheadOfPace", points: 10 },
        ]);
      }),
  );
});
