import { Context } from "effect";
import type { System, Variables } from "#03-domain/system.ts";

/** What `cota` was started with: the system, the environment's variables, the machine's host name, the working directory and `cota`'s own path. */
export class Environment extends Context.Service<
  Environment,
  {
    readonly system: System;
    readonly variables: Variables;
    readonly hostName: string;
    readonly workingDirectory: string;
    /** The path of the `cota` that is running, which the shims it writes run. */
    readonly program: string;
  }
>()("@cota/cli/Environment") {}
