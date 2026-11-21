import { Context, Effect, Layer } from "effect";
import { Environment } from "#02-application/interfaces/environment.ts";
import type { DirectoryUnknown, Paths } from "#03-domain/paths.ts";
import * as Schedule from "#03-domain/schedule.ts";

export class PlanSchedule extends Context.Service<
  PlanSchedule,
  {
    /** The title reporter's schedule on this system, running the `cota` that is running. */
    readonly execute: (
      paths: Paths,
    ) => Effect.Effect<Schedule.Schedule, DirectoryUnknown>;
  }
>()("@cota/cli/PlanSchedule") {}

export const layer: Layer.Layer<PlanSchedule, never, Environment> =
  Layer.effect(
    PlanSchedule,
    Effect.gen(function* () {
      const { system, variables, program } = yield* Environment;
      return PlanSchedule.of({
        execute: (paths) =>
          Effect.fromResult(
            Schedule.scheduleOf(system, variables, program, paths),
          ),
      });
    }),
  );
