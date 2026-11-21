import { Context, type Effect, Schema } from "effect";
import type { Schedule } from "#03-domain/schedule.ts";

/** The system has no scheduler `cota` can use, such as Linux without a systemd user session. */
export class SchedulerUnavailable extends Schema.TaggedError<
  SchedulerUnavailable,
  { readonly brand: unique symbol }
>()("SchedulerUnavailable", { reason: Schema.String }) {}

/** The scheduler, or a file of its definition, refused; the reason is what it said. */
export class SchedulerFailed extends Schema.TaggedError<
  SchedulerFailed,
  { readonly brand: unique symbol }
>()("SchedulerFailed", { reason: Schema.String }) {}

/** Whether a schedule is installed: as given, otherwise (its definition differs, or the scheduler does not have it), or not at all. */
export type Installed = "as given" | "otherwise" | "absent";

/** The system's own scheduler: launchd, systemd's user manager, or Task Scheduler. */
export class Scheduler extends Context.Service<
  Scheduler,
  {
    readonly installed: (
      schedule: Schedule,
    ) => Effect.Effect<Installed, SchedulerUnavailable | SchedulerFailed>;
    /** Writes the schedule's definition and has the scheduler run it, replacing one already there. */
    readonly install: (
      schedule: Schedule,
    ) => Effect.Effect<void, SchedulerUnavailable | SchedulerFailed>;
    /** Stops the schedule and removes its definition, and says whether there was one. */
    readonly remove: (
      schedule: Schedule,
    ) => Effect.Effect<boolean, SchedulerUnavailable | SchedulerFailed>;
  }
>()("@cota/cli/Scheduler") {}
