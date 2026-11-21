import { Context, type Effect, Schema } from "effect";
import type { Configuration } from "#03-domain/configuration.ts";
import type { Paths } from "#03-domain/paths.ts";

/** A machine just joined: its configuration as written, where its files are, and whether it asked for the shims. */
export interface Joined {
  readonly configuration: Configuration;
  readonly paths: Paths;
  readonly shims: boolean;
}

export class StepFailed extends Schema.TaggedError<
  StepFailed,
  { readonly brand: unique symbol }
>()("StepFailed", { problem: Schema.String }) {}

/** A step of joining after the machine's files are written; it says what it did, or why it could not, and the join goes on. */
export interface JoinStep {
  readonly name: string;
  readonly run: (joined: Joined) => Effect.Effect<void>;
}

/** A step of leaving before the state and the configuration are removed. */
export interface LeaveStep {
  readonly name: string;
  readonly run: (paths: Paths) => Effect.Effect<void, StepFailed>;
}

/**
 * The steps of joining and leaving that are not the machine's own files, in
 * the order the spec runs them: on joining, the shims, configuring the
 * clients and the title reporter's schedule (`docs/specs/cli/spec.md`,
 * Joining, steps 5 to 7); on leaving, the same undone in the opposite order.
 */
export class MachineSteps extends Context.Service<
  MachineSteps,
  {
    readonly join: ReadonlyArray<JoinStep>;
    readonly leave: ReadonlyArray<LeaveStep>;
  }
>()("@cota/cli/MachineSteps") {}
