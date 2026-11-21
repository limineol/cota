import { describe, expect, it } from "@effect/vitest";
import { DateTime, Duration, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import * as Quota from "./quota.ts";
import * as Sources from "./sources.ts";

const at = (time: string) => DateTime.makeUnsafe(`2026-11-13T${time}Z`);

const reported = (
  length: Duration.Duration,
  scope: string | undefined,
  observedAt: string,
): Quota.Window => ({
  length: Quota.Length.make(length),
  scope: Option.fromUndefinedOr(scope),
  source: "reading",
  used: 10,
  observedAt: at(observedAt),
});

const noSources: Sources.Sources = {
  reading: Option.none(),
  headers: { windows: [], plan: Option.none() },
  loginPlan: Option.none(),
};

const quotaAt = (sources: Sources.Sources, time: string) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(DateTime.toEpochMillis(at(time)));
    return yield* Sources.quotaOf(sources);
  });

describe("a pool's quota", () => {
  it.effect(
    "orders the plan's windows first, then by scope, and within a scope shortest first, and is observed when its latest window was",
    () =>
      Effect.gen(function* () {
        const quota = yield* quotaAt(
          {
            ...noSources,
            reading: Option.some({
              windows: [
                reported(Duration.days(7), "Claude Opus", "11:00:00"),
                reported(Duration.days(7), undefined, "11:00:00"),
                reported(Duration.days(7), "Claude Fable", "11:00:00"),
                reported(Duration.days(1), "Claude Opus", "11:00:00"),
              ],
              plan: Option.none(),
            }),
            headers: {
              windows: [
                {
                  ...reported(Duration.hours(5), undefined, "11:30:00"),
                  source: "headers",
                },
              ],
              plan: Option.none(),
            },
          },
          "12:00:00",
        );
        expect({
          windows: quota.windows.map(({ scope, length, source }) => [
            Option.getOrNull(scope),
            Duration.toMillis(length) / 3_600_000,
            source,
          ]),
          observedAt: Option.map(quota.observedAt, DateTime.formatIso),
        }).toEqual({
          windows: [
            [null, 5, "headers"],
            [null, 168, "reading"],
            ["Claude Fable", 168, "reading"],
            ["Claude Opus", 24, "reading"],
            ["Claude Opus", 168, "reading"],
          ],
          observedAt: Option.some("2026-11-13T11:30:00.000Z"),
        });
      }),
  );

  it.effect(
    "names the plan from the quota login, else the quota reading, else the headers",
    () =>
      Effect.gen(function* () {
        const plans = [];
        for (const [login, reading, headers] of [
          ["Max 20x", "Max", "Pro"],
          [undefined, "Max", "Pro"],
          [undefined, undefined, "Pro"],
          [undefined, undefined, undefined],
        ] as const) {
          const { plan } = yield* quotaAt(
            {
              ...noSources,
              reading: Option.some({
                windows: [],
                plan: Option.fromUndefinedOr(reading),
              }),
              headers: { windows: [], plan: Option.fromUndefinedOr(headers) },
              loginPlan: Option.fromUndefinedOr(login),
            },
            "12:00:00",
          );
          plans.push(Option.getOrNull(plan));
        }
        expect(plans).toEqual(["Max 20x", "Max", "Pro", null]);
      }),
  );
});
