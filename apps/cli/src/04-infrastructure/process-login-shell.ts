import { Effect, Layer, Option } from "effect";
import { LoginShell } from "#02-application/interfaces/login-shell.ts";

/** How long doctor waits for a new login shell to say where it finds a command. */
const deadline = 5_000;

/** A new login shell started as a terminal starts one, interactive, with standard input closed. */
export const layer: Layer.Layer<LoginShell> = Layer.succeed(
  LoginShell,
  LoginShell.of({
    find: (shell, command, variables) =>
      Effect.promise(async () => {
        try {
          const child = Bun.spawn([shell, "-lic", `command -v ${command}`], {
            env: variables,
            stdin: "ignore",
            stdout: "pipe",
            stderr: "ignore",
            timeout: deadline,
          });
          const output = await new Response(child.stdout).text();
          if ((await child.exited) !== 0) return Option.none<string>();
          const found = output
            .split(/\r?\n/)
            .map((line) => line.trim())
            .findLast((line) => line.startsWith("/"));
          return Option.fromUndefinedOr(found);
        } catch {
          return Option.none<string>();
        }
      }),
  }),
);
