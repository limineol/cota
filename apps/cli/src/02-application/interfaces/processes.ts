import { Context, type Effect, type Option, Schema } from "effect";
import type { Variables } from "#03-domain/system.ts";

/** A program that could not be started; the reason never holds its environment. */
export class StartFailed extends Schema.TaggedError<
  StartFailed,
  { readonly brand: unique symbol }
>()("StartFailed", { command: Schema.String, reason: Schema.String }) {}

/** The programs `cota` runs: a client it launches, and `git`. */
export class Processes extends Context.Service<
  Processes,
  {
    /**
     * Starts a client with exactly these arguments and environment, and gives
     * its exit status: in this process's place where the system and Bun can
     * (`execve`), so that it never returns; otherwise as a child with this
     * process's standard streams, ignoring the interrupts a terminal sends to
     * both, passing `SIGTERM` and `SIGHUP` on, and giving its status, or 128
     * and the number of the signal that ended it.
     */
    readonly start: (
      command: string,
      args: ReadonlyArray<string>,
      variables: Variables,
    ) => Effect.Effect<number, StartFailed>;
    /** Runs a program to its end in a directory, and gives its standard output, or none when it could not start or did not exit 0. */
    readonly output: (
      command: string,
      args: ReadonlyArray<string>,
      directory: string,
      variables: Variables,
    ) => Effect.Effect<Option.Option<string>>;
  }
>()("@cota/cli/Processes") {}
