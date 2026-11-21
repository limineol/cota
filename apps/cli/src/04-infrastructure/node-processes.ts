import { constants } from "node:os";
import { Effect, Layer, Option } from "effect";
import {
  Processes,
  StartFailed,
} from "#02-application/interfaces/processes.ts";
import type { Variables } from "#03-domain/system.ts";

const defined = (variables: Variables): Record<string, string> => {
  const set: Record<string, string> = {};
  for (const [name, value] of Object.entries(variables)) {
    if (value !== undefined) set[name] = value;
  }
  return set;
};

const reasonOf = (cause: unknown): string => {
  const code =
    typeof cause === "object" && cause !== null && "code" in cause
      ? String(cause.code)
      : undefined;
  switch (code) {
    case "EACCES":
      return "permission denied";
    case "ENOENT":
      return "it does not exist";
    case "ENOEXEC":
      return "it is not a program this system runs";
    default:
      return code ?? "it failed";
  }
};

const signalNumber = (signal: number | string): number => {
  if (typeof signal === "number") return signal;
  const numbers: Readonly<Record<string, number | undefined>> =
    constants.signals;
  return numbers[signal] ?? 0;
};

/** The terminal's interrupts, which reach the client from the terminal itself, and the signals passed on to it. */
const ignored = ["SIGINT", "SIGQUIT"] as const;
const passedOn = ["SIGTERM", "SIGHUP"] as const;

/** Starts a client as this process's child, with its standard streams, and gives its status. */
const asChild = (
  command: string,
  args: ReadonlyArray<string>,
  variables: Variables,
) =>
  Effect.callback<number, StartFailed>((resume) => {
    let child: ReturnType<typeof Bun.spawn>;
    const ignore = () => undefined;
    const passOn = (signal: NodeJS.Signals) => () => {
      child.kill(signal);
    };
    const handlers = passedOn.map(
      (signal) => [signal, passOn(signal)] as const,
    );
    const listen = () => {
      for (const signal of ignored) process.on(signal, ignore);
      for (const [signal, handler] of handlers) process.on(signal, handler);
    };
    const stopListening = () => {
      for (const signal of ignored) process.off(signal, ignore);
      for (const [signal, handler] of handlers) process.off(signal, handler);
    };
    try {
      child = Bun.spawn([command, ...args], {
        env: defined(variables),
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
    } catch (cause) {
      resume(
        Effect.fail(new StartFailed({ command, reason: reasonOf(cause) })),
      );
      return;
    }
    listen();
    child.exited.then((code) => {
      stopListening();
      const signal = child.signalCode;
      resume(
        Effect.succeed(signal === null ? code : 128 + signalNumber(signal)),
      );
    });
  });

const canReplace = (replace: boolean) =>
  replace &&
  process.platform !== "win32" &&
  typeof process.execve === "function";

/**
 * Programs started from this process. With `replace`, a client takes this
 * process's place (`execve`) where the system and Bun can, which a compiled
 * Bun program can on macOS; otherwise it is started as a child.
 */
export const layer = (options: {
  readonly replace: boolean;
}): Layer.Layer<Processes> =>
  Layer.succeed(
    Processes,
    Processes.of({
      start: (command, args, variables) =>
        canReplace(options.replace)
          ? Effect.try({
              try: () => {
                process.execve?.(
                  command,
                  [command, ...args],
                  defined(variables),
                );
                return 0;
              },
              catch: (cause) =>
                new StartFailed({ command, reason: reasonOf(cause) }),
            })
          : asChild(command, args, variables),
      output: (command, args, directory, variables) =>
        Effect.promise(async () => {
          try {
            const child = Bun.spawn([command, ...args], {
              cwd: directory,
              env: defined(variables),
              stdin: "ignore",
              stdout: "pipe",
              stderr: "ignore",
            });
            const output = await new Response(child.stdout).text();
            return (await child.exited) === 0
              ? Option.some(output)
              : Option.none<string>();
          } catch {
            return Option.none<string>();
          }
        }),
    }),
  );
