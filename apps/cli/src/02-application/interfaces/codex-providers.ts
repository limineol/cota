import { Context, type Effect } from "effect";
import type { Joined } from "./machine-steps.ts";

/**
 * Writes Codex's provider table of a pool into its configuration, as
 * `cota configure` does for Codex, when a launch through the hub finds it
 * missing (`docs/specs/cli/spec.md`, Launching, Codex). It says in one line
 * what it did, and the launch goes on either way.
 */
export class CodexProviders extends Context.Service<
  CodexProviders,
  {
    readonly provide: (joined: Joined, pool: string) => Effect.Effect<void>;
  }
>()("@cota/cli/CodexProviders") {}
