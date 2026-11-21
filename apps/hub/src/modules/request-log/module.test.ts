import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import * as ArchiveDays from "#modules/request-log/02-application/commands/archive-days.command.ts";
import * as RequestLog from "#modules/request-log/module.ts";

describe("the archiver's schedule", () => {
  it.effect(
    "runs a minute after it starts, then an hour after each run ended, never two at once, and stops when its layer is released",
    () =>
      Effect.gen(function* () {
        let runs = 0;
        let running = 0;
        let overlapped = false;
        const scripted = Layer.succeed(
          ArchiveDays.ArchiveDays,
          ArchiveDays.ArchiveDays.of({
            execute: Effect.gen(function* () {
              running += 1;
              overlapped ||= running > 1;
              runs += 1;
              yield* Effect.sleep(Duration.minutes(10));
              running -= 1;
              return { _tag: "Ran", days: [] } as const;
            }),
          }),
        );
        const runsSoFar = Effect.sync(() => runs);
        yield* Effect.gen(function* () {
          yield* Layer.build(RequestLog.archiver.pipe(Layer.provide(scripted)));
          yield* TestClock.adjust(Duration.seconds(59));
          expect(yield* runsSoFar).toBe(0);
          yield* TestClock.adjust(Duration.seconds(1));
          expect(yield* runsSoFar).toBe(1);
          yield* TestClock.adjust(Duration.minutes(69));
          expect(yield* runsSoFar).toBe(1);
          yield* TestClock.adjust(Duration.minutes(1));
          expect(yield* runsSoFar).toBe(2);
        }).pipe(Effect.scoped);
        yield* TestClock.adjust(Duration.hours(5));
        expect(yield* runsSoFar).toBe(2);
        expect(overlapped).toBe(false);
      }),
  );
});
