import { Context, type Effect } from "effect";
import type { FilesFailed } from "./files.ts";

/** A lock file holding the process id of the run that took it. */
export class RunLock extends Context.Service<
  RunLock,
  {
    /** Takes the lock without waiting, taking over one whose process is gone; false when a live process holds it. */
    readonly take: (path: string) => Effect.Effect<boolean, FilesFailed>;
    readonly release: (path: string) => Effect.Effect<void>;
  }
>()("@cota/cli/RunLock") {}
