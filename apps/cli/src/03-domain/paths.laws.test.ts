import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Result, Schema } from "effect";
import * as Paths from "./paths.ts";
import { System } from "./system.ts";

const names = [
  "XDG_CONFIG_HOME",
  "XDG_STATE_HOME",
  "XDG_DATA_HOME",
  "HOME",
  "APPDATA",
  "LOCALAPPDATA",
] as const;

/** Each variable unset, empty, relative, or an absolute path of either system, with and without a trailing separator. */
const value = Arbitrary.schema(
  Schema.Literals([
    "unset",
    "",
    "relative/dir",
    "/home/me",
    "/home/me/",
    "/",
    "/x/ä b",
    "C:\\Users\\me\\AppData\\Roaming",
    "C:\\Users\\me\\AppData\\Local\\",
  ]),
);

const variables = Arbitrary.all(
  Object.fromEntries(names.map((name) => [name, value])),
).pipe(
  Arbitrary.map((drawn) =>
    Object.fromEntries(
      Object.entries(drawn).filter(([, each]) => each !== "unset"),
    ),
  ),
);

/** ADR-0022's table, read directly: a directory, or the variable it lacks. */
const tableOf = (
  system: System,
  variables: Readonly<Record<string, string>>,
) => {
  const set = (name: string) => {
    const each = variables[name];
    return each === undefined || each === "" ? undefined : each;
  };
  if (system === "win32") {
    const appData = set("APPDATA");
    const localAppData = set("LOCALAPPDATA");
    if (appData === undefined) return "APPDATA";
    if (localAppData === undefined) return "LOCALAPPDATA";
    const bare = (path: string) => path.replace(/[\\/]+$/, "");
    return {
      configuration: `${bare(appData)}\\cota`,
      state: `${bare(localAppData)}\\cota\\state`,
      shims: `${bare(localAppData)}\\cota\\bin`,
    };
  }
  const home = set("HOME")?.startsWith("/") ? set("HOME") : undefined;
  const xdg = (name: string, underHome: string) => {
    const each = set(name);
    if (each?.startsWith("/")) return each.replace(/\/+$/, "");
    return home === undefined
      ? undefined
      : `${home.replace(/\/+$/, "")}/${underHome}`;
  };
  const configuration = xdg("XDG_CONFIG_HOME", ".config");
  const state = xdg("XDG_STATE_HOME", ".local/state");
  const data = xdg("XDG_DATA_HOME", ".local/share");
  if (
    configuration === undefined ||
    state === undefined ||
    data === undefined
  ) {
    return "HOME";
  }
  return {
    configuration: `${configuration}/cota`,
    state: `${state}/cota`,
    shims: `${data}/cota/bin`,
  };
};

describe("paths laws", () => {
  it.effect.prop(
    "J15: For every system and every combination of `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `XDG_DATA_HOME`, `HOME`, `APPDATA` and `LOCALAPPDATA` set, empty or unset, the configuration's, the state's and the shims' directories are those of ADR-0022's table, and a directory no variable gives names the variable that would.",
    { system: Arbitrary.schema(System), variables },
    ({ system, variables }) =>
      Effect.sync(() => {
        const found = Paths.pathsOf(system, variables);
        const table = tableOf(system, variables);
        if (typeof table === "string") {
          expect(Result.isFailure(found) && found.failure.variable).toBe(table);
          return;
        }
        expect(Result.isSuccess(found)).toBe(true);
        if (Result.isFailure(found)) return;
        const separator = system === "win32" ? "\\" : "/";
        expect({
          configuration: found.success.configuration,
          state: found.success.state,
          shims: found.success.shims,
        }).toEqual(table);
        expect(found.success).toMatchObject({
          configurationFile: `${table.configuration}${separator}config.toml`,
          hubKeys: `${table.configuration}${separator}hub-keys`,
          logins: `${table.configuration}${separator}logins`,
        });
        expect(Paths.hubKeyFile(found.success, "keyed")).toBe(
          `${table.configuration}${separator}hub-keys${separator}keyed`,
        );
      }),
    { arbitrary: { runs: 1000 } },
  );

  it("puts the files where ADR-0022's table says on a Mac with nothing set but HOME", () => {
    expect(Paths.pathsOf("darwin", { HOME: "/Users/me" })).toEqual(
      Result.succeed({
        separator: "/",
        configuration: "/Users/me/.config/cota",
        configurationFile: "/Users/me/.config/cota/config.toml",
        hubKeys: "/Users/me/.config/cota/hub-keys",
        logins: "/Users/me/.config/cota/logins",
        state: "/Users/me/.local/state/cota",
        shims: "/Users/me/.local/share/cota/bin",
      }),
    );
  });
});
