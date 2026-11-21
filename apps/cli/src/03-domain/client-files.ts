import { Option } from "effect";
import type { ModelFacts } from "./machine.ts";
import type { System, Variables } from "./system.ts";

/** The clients whose configuration file `cota configure` rewrites. */
export const configuredClients = ["codex", "opencode", "pi"] as const;
export type ConfiguredClient = (typeof configuredClients)[number];

/** The prefix of every provider `cota` writes, and so of every provider that is `cota`'s. */
export const providerPrefix = "cota-";

/** A model's price in dollars per million tokens, as OpenCode and Pi take one: a single cache-write price. */
export interface Cost {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

/** A model as `cota` writes it into OpenCode's and Pi's files. */
export interface WrittenModel {
  readonly id: string;
  readonly name: string;
  readonly context: number | null;
  readonly output: number | null;
  readonly images: boolean | null;
  readonly cost: Cost | null;
}

const dollars = (picodollars: bigint) => Number(picodollars) / 1e12;

/**
 * A model's facts as written: its price is its base rates, whatever its
 * tiers, and its cache-write price the short one, since OpenCode and Pi take
 * one price for each class.
 */
export const writtenModelOf = (facts: ModelFacts): WrittenModel => {
  const { base } = facts.price;
  return {
    id: facts.id,
    name: facts.name,
    context: facts.contextTokens,
    output: facts.outputTokens,
    images: facts.imageInput,
    cost: {
      input: dollars(base.input),
      output: dollars(base.output),
      cacheRead: dollars(base.cacheRead),
      cacheWrite: dollars(base.cacheWriteShort),
    },
  };
};

/** The models a pool's listing named, each with the facts the hub has for it, or its id alone. */
export const listedModels = (
  listed: ReadonlyArray<string>,
  facts: ReadonlyArray<ModelFacts>,
): ReadonlyArray<WrittenModel> =>
  listed.map((id) => {
    const known = facts.find((each) => each.id === id);
    return known === undefined
      ? { id, name: id, context: null, output: null, images: null, cost: null }
      : writtenModelOf(known);
  });

/**
 * A pool's models: those its listing named, or, when the listing failed,
 * those last written for it in the file, else the fallback (its facts').
 */
export type PoolModels =
  | {
      readonly _tag: "Listed";
      readonly models: ReadonlyArray<WrittenModel>;
    }
  | {
      readonly _tag: "Kept";
      readonly fallback: ReadonlyArray<WrittenModel>;
    };

/** A keyed pool's provider in OpenCode's or Pi's file. */
export interface KeyedProvider {
  readonly pool: string;
  /** The pool's display name, else its id. */
  readonly name: string;
  readonly hub: string;
  readonly machine: string;
  readonly models: PoolModels;
}

/** A client's configuration file, and the directory whose presence says the client is installed. */
export interface ClientFile {
  readonly directory: string;
  readonly file: string;
}

const set = (variables: Variables, name: string) => {
  const value = variables[name];
  return value === undefined || value === "" ? undefined : value;
};

/**
 * Where a client's configuration file is: Codex's `config.toml` in
 * `CODEX_HOME`, else `~/.codex`; OpenCode's `opencode.json` in
 * `XDG_CONFIG_HOME/opencode`, else `~/.config/opencode`; Pi's `models.json`
 * in `PI_CODING_AGENT_DIR`, else `~/.pi/agent`. None without a home.
 */
export const clientFileOf = (
  client: ConfiguredClient,
  system: System,
  variables: Variables,
): Option.Option<ClientFile> => {
  const separator = system === "win32" ? "\\" : "/";
  const join = (directory: string, ...parts: ReadonlyArray<string>) =>
    [directory.replace(/[\\/]+$/, "") || directory, ...parts].join(separator);
  const home = set(variables, system === "win32" ? "USERPROFILE" : "HOME");
  const xdgConfig = set(variables, "XDG_CONFIG_HOME");
  const places: Record<
    ConfiguredClient,
    readonly [string | undefined, ReadonlyArray<string>, string]
  > = {
    codex: [set(variables, "CODEX_HOME"), [".codex"], "config.toml"],
    opencode: [
      system !== "win32" && xdgConfig?.startsWith("/")
        ? join(xdgConfig, "opencode")
        : undefined,
      [".config", "opencode"],
      "opencode.json",
    ],
    pi: [
      set(variables, "PI_CODING_AGENT_DIR"),
      [".pi", "agent"],
      "models.json",
    ],
  };
  const [given, underHome, file] = places[client];
  const directory =
    given !== undefined
      ? join(given)
      : home === undefined
        ? undefined
        : join(home, ...underHome);
  return directory === undefined
    ? Option.none()
    : Option.some({ directory, file: join(directory, file) });
};
