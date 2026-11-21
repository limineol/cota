import { Context, Effect, Layer, Result } from "effect";
import { Files } from "#02-application/interfaces/files.ts";
import { MachineSteps } from "#02-application/interfaces/machine-steps.ts";
import { LocateFiles } from "#02-application/queries/locate-files.query.ts";

export interface Left {
  /** The directories removed, in the order they were. */
  readonly removed: ReadonlyArray<string>;
  /** What could not be undone, one sentence each. */
  readonly failed: ReadonlyArray<string>;
}

export class LeaveMachine extends Context.Service<
  LeaveMachine,
  {
    /**
     * Undoes a join, in the spec's order (`docs/specs/cli/spec.md`, Leaving):
     * the steps of `MachineSteps`, then the state, then the configuration
     * with the hub keys and the machine logins. A step that fails is said and
     * the others still run.
     */
    readonly execute: Effect.Effect<Left>;
  }
>()("@cota/cli/LeaveMachine") {}

export const layer: Layer.Layer<
  LeaveMachine,
  never,
  Files | MachineSteps | LocateFiles
> = Layer.effect(
  LeaveMachine,
  Effect.gen(function* () {
    const files = yield* Files;
    const steps = yield* MachineSteps;
    const locate = yield* LocateFiles;
    return LeaveMachine.of({
      execute: Effect.gen(function* () {
        const located = yield* Effect.result(locate.execute);
        if (Result.isFailure(located)) {
          return {
            removed: [],
            failed: [
              `where the machine's files are cannot be known: ${located.failure.variable} is not set`,
            ],
          };
        }
        const paths = located.success;
        const removed: Array<string> = [];
        const failed: Array<string> = [];
        for (const step of steps.leave) {
          const undone = yield* Effect.result(step.run(paths));
          if (Result.isFailure(undone)) {
            failed.push(`${step.name}: ${undone.failure.problem}`);
          }
        }
        for (const directory of [paths.state, paths.configuration]) {
          const removal = yield* Effect.result(files.remove(directory));
          if (Result.isFailure(removal)) {
            failed.push(
              `${removal.failure.path} could not be removed: ${removal.failure.reason}`,
            );
          } else if (removal.success) {
            removed.push(directory);
          }
        }
        return { removed, failed };
      }).pipe(Effect.withSpan("LeaveMachine.execute")),
    });
  }),
);
