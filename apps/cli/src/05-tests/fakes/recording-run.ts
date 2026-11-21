import type { Ran, Run } from "#04-infrastructure/system-scheduler.ts";

/**
 * A stand-in for `launchctl`, `systemctl --user` and `schtasks`: it records
 * every command it is given and answers as the system's scheduler would,
 * keeping what is loaded, and runs nothing.
 */
export const make = (
  options: { readonly systemd?: "running" | "no user session" } = {},
): {
  readonly commands: Array<ReadonlyArray<string>>;
  readonly loaded: Set<string>;
  readonly run: Run;
} => {
  const commands: Array<ReadonlyArray<string>> = [];
  const loaded = new Set<string>();
  const ok: Ran = { exitCode: 0, output: "" };
  const no = (output = ""): Ran => ({ exitCode: 1, output });
  const answer = (command: string, args: ReadonlyArray<string>): Ran => {
    const [verb, first, second] = args;
    if (command === "launchctl") {
      switch (verb) {
        case "print":
          return first !== undefined && loaded.has(first) ? ok : no();
        case "bootstrap": {
          if (first === undefined || second === undefined) return no();
          loaded.add(`${first}/cota.titles`);
          return ok;
        }
        case "bootout":
          return first !== undefined && loaded.delete(first)
            ? ok
            : no("Boot-out failed: 3: No such process");
        default:
          return no();
      }
    }
    if (command === "systemctl") {
      if (options.systemd === "no user session") {
        return no("Failed to connect to bus: No medium found");
      }
      const [, action, unit] = args;
      switch (action) {
        case "show-environment":
        case "daemon-reload":
          return ok;
        case "enable":
        case "restart":
          if (unit !== undefined) loaded.add(unit);
          return ok;
        case "is-enabled":
        case "is-active":
          return unit !== undefined && loaded.has(unit) ? ok : no();
        case "disable":
          return loaded.delete(args[3] ?? "") ? ok : no();
        default:
          return no();
      }
    }
    if (command === "schtasks") {
      const name = args[2] ?? "";
      switch (verb) {
        case "/Query":
          return loaded.has(name) ? ok : no();
        case "/Create":
          loaded.add(name);
          return ok;
        case "/Delete":
          return loaded.delete(name) ? ok : no();
        default:
          return no();
      }
    }
    return { exitCode: 127, output: `${command} could not be started` };
  };
  return {
    commands,
    loaded,
    run: async (command, args) => {
      commands.push([command, ...args]);
      return answer(command, args);
    },
  };
};
