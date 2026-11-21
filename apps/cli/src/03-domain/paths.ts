import { Result, Schema } from "effect";
import type { KeptScope } from "./machine.ts";
import type { System, Variables } from "./system.ts";

/** Where the machine's files are (ADR-0022), in the system's own form. */
export interface Paths {
  readonly separator: "/" | "\\";
  /** The configuration's directory, which also holds the hub keys and the machine logins. */
  readonly configuration: string;
  readonly configurationFile: string;
  readonly hubKeys: string;
  readonly logins: string;
  /** The state's directory: the last route answers, and the title reporter's. */
  readonly state: string;
  readonly shims: string;
}

/** A directory of the machine's files that no variable of the environment gives. */
export class DirectoryUnknown extends Schema.TaggedError<
  DirectoryUnknown,
  { readonly brand: unique symbol }
>()("DirectoryUnknown", { variable: Schema.String }) {}

const trailingSeparators = {
  "/": /\/+$/,
  "\\": /[\\/]+$/,
} as const;

const directoryIn = (
  variables: Variables,
  name: string,
  isUsable: (value: string) => boolean,
): string | undefined => {
  const value = variables[name];
  return value !== undefined && value !== "" && isUsable(value)
    ? value
    : undefined;
};

const pathsIn = (
  separator: Paths["separator"],
  configuration: string,
  state: string,
  shims: string,
): Paths => {
  const join = (...parts: ReadonlyArray<string>) =>
    parts
      .map((part, index) =>
        index === 0 ? part.replace(trailingSeparators[separator], "") : part,
      )
      .join(separator);
  const configurationDirectory = join(configuration, "cota");
  return {
    separator,
    configuration: configurationDirectory,
    configurationFile: join(configurationDirectory, "config.toml"),
    hubKeys: join(configurationDirectory, "hub-keys"),
    logins: join(configurationDirectory, "logins"),
    state: join(state, ...(separator === "\\" ? ["cota", "state"] : ["cota"])),
    shims: join(shims, "cota", "bin"),
  };
};

/**
 * Where the machine's files are on a system, from its environment alone. On
 * macOS and Linux an `XDG_*` directory is used when it is set to an absolute
 * path, as the XDG specification says, else its default under `HOME`, which
 * must be absolute too; on
 * Windows the configuration is under `APPDATA`, the state and the shims under
 * `LOCALAPPDATA`.
 */
export const pathsOf = (
  system: System,
  variables: Variables,
): Result.Result<Paths, DirectoryUnknown> => {
  if (system === "win32") {
    const roaming = directoryIn(variables, "APPDATA", () => true);
    if (roaming === undefined) {
      return Result.fail(new DirectoryUnknown({ variable: "APPDATA" }));
    }
    const local = directoryIn(variables, "LOCALAPPDATA", () => true);
    if (local === undefined) {
      return Result.fail(new DirectoryUnknown({ variable: "LOCALAPPDATA" }));
    }
    return Result.succeed(pathsIn("\\", roaming, local, local));
  }
  const absolute = (value: string) => value.startsWith("/");
  const home = directoryIn(variables, "HOME", absolute);
  const xdg = (name: string, underHome: string) => {
    const set = directoryIn(variables, name, absolute);
    if (set !== undefined) return set;
    return home === undefined
      ? undefined
      : `${home.replace(trailingSeparators["/"], "")}/${underHome}`;
  };
  const configuration = xdg("XDG_CONFIG_HOME", ".config");
  const state = xdg("XDG_STATE_HOME", ".local/state");
  const data = xdg("XDG_DATA_HOME", ".local/share");
  if (
    configuration === undefined ||
    state === undefined ||
    data === undefined
  ) {
    return Result.fail(new DirectoryUnknown({ variable: "HOME" }));
  }
  return Result.succeed(pathsIn("/", configuration, state, data));
};

export const hubKeyFile = (paths: Paths, scope: KeptScope): string =>
  `${paths.hubKeys}${paths.separator}${scope}`;

/** The reader key `cota memory` reads with, kept beside the other hub keys only by `cota memory key`. */
export const readerKeyFile = (paths: Paths): string =>
  `${paths.hubKeys}${paths.separator}reader`;

/** The last route answers, `routes.json`, in the state's directory. */
export const keptAnswersFile = (paths: Paths): string =>
  `${paths.state}${paths.separator}routes.json`;

export const loginFile = (paths: Paths, pool: string): string =>
  `${paths.logins}${paths.separator}${pool}`;

/** The title reporter's state, `titles.json`, in the state's directory. */
export const titlesFile = (paths: Paths): string =>
  `${paths.state}${paths.separator}titles.json`;

/** Why the title reporter's last run failed, `titles.error`, in the state's directory. */
export const titlesErrorFile = (paths: Paths): string =>
  `${paths.state}${paths.separator}titles.error`;
