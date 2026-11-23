import { Effect, Layer } from "effect";
import {
  Scheduler,
  SchedulerUnavailable,
} from "#02-application/interfaces/scheduler.ts";
import type { Schedule } from "#03-domain/schedule.ts";

/** A scheduler that keeps the schedules it was given in memory, by their names, or a system that has none `cota` can use. */
export const make = (
  options: {
    readonly installed?: ReadonlyArray<Schedule>;
    readonly unavailable?: boolean;
  } = {},
): {
  readonly held: Map<string, Schedule>;
  readonly layer: Layer.Layer<Scheduler>;
} => {
  const held = new Map(
    (options.installed ?? []).map((schedule) => [schedule.name, schedule]),
  );
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
          : Effect.sync(() => {
              const kept = held.get(schedule.name);
              return kept === undefined
                ? "absent"
                : JSON.stringify(kept) === JSON.stringify(schedule)
                  ? "as given"
                  : "otherwise";
            }),
      install: (schedule) =>
        options.unavailable === true
          ? unavailable
          : Effect.sync(() => {
              held.set(schedule.name, schedule);
            }),
      remove: (schedule) =>
        options.unavailable === true
          ? unavailable
          : Effect.sync(() => held.delete(schedule.name)),
    }),
  );
  return { held, layer };
};
