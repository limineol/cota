import { Effect, Layer, Option } from "effect";
import { LoginShell } from "#02-application/interfaces/login-shell.ts";

/** A login shell that finds each command where it is told to, and the rest nowhere. */
export const make = (
  found: Readonly<Record<string, string | undefined>> = {},
): Layer.Layer<LoginShell> =>
  Layer.succeed(
    LoginShell,
    LoginShell.of({
      find: (_shell, command) =>
        Effect.succeed(Option.fromUndefinedOr(found[command])),
    }),
  );
