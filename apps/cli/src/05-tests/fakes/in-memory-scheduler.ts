import { Effect, Layer } from "effect";
import {
  Scheduler,
  SchedulerUnavailable,
} from "#02-application/interfaces/scheduler.ts";
import type { Schedule } from "#03-domain/schedule.ts";

/** A scheduler that keeps the one schedule it was given in memory, or a system that has none `cota` can use. */
export const make = (
  options: {
    readonly installed?: Schedule;
    readonly unavailable?: boolean;
  } = {},
): {
  readonly held: { installed: Schedule | undefined };
  readonly layer: Layer.Layer<Scheduler>;
} => {
  const held = { installed: options.installed };
  const unavailable = Effect.fail(
    new SchedulerUnavailable({
      reason: "systemctl --user has no user session",
    }),
  );
  const layer = Layer.succeed(
    Scheduler,
    Scheduler.of({
      installed: (schedule) =>
        options.unavailable === true
          ? unavailable
          : Effect.sync(() =>
              held.installed === undefined
                ? "absent"
                : JSON.stringify(held.installed) === JSON.stringify(schedule)
                  ? "as given"
                  : "otherwise",
            ),
      install: (schedule) =>
        options.unavailable === true
          ? unavailable
          : Effect.sync(() => {
              held.installed = schedule;
            }),
      remove: () =>
        options.unavailable === true
          ? unavailable
          : Effect.sync(() => {
              const was = held.installed !== undefined;
              held.installed = undefined;
              return was;
            }),
    }),
  );
  return { held, layer };
};
