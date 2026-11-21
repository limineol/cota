import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import * as Fallback from "#modules/relay/03-domain/fallback.ts";
import * as Relay from "./module.ts";

describe("forgetEveryMinute", () => {
  it.effect("runs Fallback.forget once a minute for as long as it lives", () =>
    Effect.gen(function* () {
      let forgotten = 0;
      const counting = Layer.succeed(
        Fallback.Fallback,
        Fallback.Fallback.of({
          decide: () => Effect.succeed({ _tag: "Keep" }),
          record: () => Effect.void,
          parkedUntil: () => Effect.succeedNone,
          forget: Effect.sync(() => {
            forgotten++;
          }),
        }),
      );
      const counted: Array<number> = [];
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Layer.build(
            Relay.forgetEveryMinute.pipe(Layer.provide(counting)),
          );
          for (const step of ["59 seconds", "1 second", "3 minutes"] as const) {
            yield* TestClock.adjust(step);
            counted.push(forgotten);
          }
        }),
      );
      yield* TestClock.adjust("10 minutes");
      expect([...counted, forgotten]).toEqual([0, 1, 4, 4]);
    }),
  );
});
