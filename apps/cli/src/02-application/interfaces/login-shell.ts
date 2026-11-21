import { Context, type Effect, type Option } from "effect";
import type { Variables } from "#03-domain/system.ts";

/** A new login shell of the owner's, as a terminal opens one. */
export class LoginShell extends Context.Service<
  LoginShell,
  {
    /** Where a new login shell (`<shell> -lic 'command -v <command>'`) finds a command, or none. */
    readonly find: (
      shell: string,
      command: string,
      variables: Variables,
    ) => Effect.Effect<Option.Option<string>>;
  }
>()("@cota/cli/LoginShell") {}
