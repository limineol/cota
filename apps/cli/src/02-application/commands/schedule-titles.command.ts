import { Context, Effect, Layer, Result } from "effect";
import { Environment } from "#02-application/interfaces/environment.ts";
import { StepFailed } from "#02-application/interfaces/machine-steps.ts";
import { Scheduler } from "#02-application/interfaces/scheduler.ts";
import { PlanSchedule } from "#02-application/queries/plan-schedule.query.ts";
import type { Paths } from "#03-domain/paths.ts";
import * as Schedule from "#03-domain/schedule.ts";

export class ScheduleTitles extends Context.Service<
  ScheduleTitles,
  {
    /**
     * Installs the title reporter's schedule, replacing one already there
     * only when it differs, or with `remove` removes it; it gives what it
     * did, one line each, and nothing when there was nothing to remove.
     */
    readonly execute: (
      paths: Paths,
      remove: boolean,
    ) => Effect.Effect<ReadonlyArray<string>, StepFailed>;
  }
>()("@cota/cli/ScheduleTitles") {}

export const layer: Layer.Layer<
  ScheduleTitles,
  never,
  Environment | Scheduler | PlanSchedule
> = Layer.effect(
  ScheduleTitles,
  Effect.gen(function* () {
    const { program } = yield* Environment;
    const scheduler = yield* Scheduler;
    const plan = yield* PlanSchedule;
    return ScheduleTitles.of({
      execute: Effect.fn("ScheduleTitles.execute")(function* (
        paths: Paths,
        remove: boolean,
      ) {
        const planned = yield* Effect.result(plan.execute(paths));
        if (Result.isFailure(planned)) {
          return yield* new StepFailed({
            problem: `where the schedule goes cannot be known: ${planned.failure.variable} is not set`,
          });
        }
        const schedule = planned.success;
        const where = Schedule.definitionsOf(schedule)
          .map(({ path }) => path)
          .join(" and ");
        const done = yield* Effect.result(
          Effect.gen(function* () {
            if (remove) {
              const removed = yield* scheduler
                .remove(schedule)
                .pipe(
                  Effect.catchTag("SchedulerUnavailable", () =>
                    Effect.succeed(false),
                  ),
                );
              return removed
                ? [`cota: removed the title reporter's schedule, ${where}.`]
                : [];
            }
            if ((yield* scheduler.installed(schedule)) === "as given") {
              return [
                `cota: the title reporter is scheduled every ${Schedule.intervalSeconds} seconds already, by ${where}; nothing changed.`,
              ];
            }
            yield* scheduler.install(schedule);
            return [
              `cota: scheduled the title reporter every ${Schedule.intervalSeconds} seconds, by ${where}.`,
            ];
          }),
        );
        if (Result.isSuccess(done)) return done.success;
        const error = done.failure;
        return yield* new StepFailed({
          problem:
            error._tag === "SchedulerUnavailable"
              ? `this system has no scheduler cota can use (${error.reason}); have your own run cota titles report every 30 seconds, or every minute with cron: ${Schedule.cronLineOf(program)}`
              : `the title reporter's schedule could not be ${remove ? "removed" : "installed"}: ${error.reason}`,
        });
      }),
    });
  }),
);
