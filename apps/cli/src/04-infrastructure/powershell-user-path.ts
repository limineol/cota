import { Effect, Layer } from "effect";
import {
  UserPath,
  UserPathFailed,
} from "#02-application/interfaces/user-path.ts";

const valueVariable = "COTA_USER_PATH";

/** Runs a PowerShell command with no profile, the user's `Path` given in the environment, never in the command, and gives its output. */
const powershell = (command: string, value?: string) =>
  Effect.tryPromise({
    try: async () => {
      const child = Bun.spawn(
        [
          "powershell.exe",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          command,
        ],
        {
          env: {
            ...process.env,
            ...(value === undefined ? {} : { [valueVariable]: value }),
          },
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [output, problem, status] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      if (status !== 0) {
        throw new Error(problem.trim().split(/\r?\n/)[0] ?? `exit ${status}`);
      }
      return output;
    },
    catch: (cause) =>
      new UserPathFailed({
        reason: `PowerShell could not ${value === undefined ? "read" : "write"} the user's Path: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });

/**
 * The user's `Path` on Windows, through PowerShell's
 * `[Environment]::GetEnvironmentVariable` and `SetEnvironmentVariable` with
 * the `User` target, which also tells running programs of the change.
 */
export const layer: Layer.Layer<UserPath> = Layer.succeed(
  UserPath,
  UserPath.of({
    read: powershell(
      "[Console]::Out.Write([Environment]::GetEnvironmentVariable('Path', 'User'))",
    ),
    write: (path) =>
      Effect.asVoid(
        powershell(
          `[Environment]::SetEnvironmentVariable('Path', $env:${valueVariable}, 'User')`,
          path,
        ),
      ),
  }),
);
