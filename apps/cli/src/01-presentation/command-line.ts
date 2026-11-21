import { Option, Result } from "effect";
import type { TranscriptOf } from "#02-application/interfaces/hub.ts";
import * as Client from "#03-domain/client.ts";
import * as Memory from "#03-domain/memory.ts";

/** What a command line asks `cota` to do (`docs/specs/cli/spec.md`, Commands). */
export type Invocation =
  | { readonly _tag: "Version" }
  | { readonly _tag: "Help" }
  | {
      readonly _tag: "Join";
      readonly hub: string;
      readonly machine: Option.Option<string>;
      readonly shims: boolean;
      readonly allowPlainHttp: boolean;
    }
  | { readonly _tag: "Leave" }
  | {
      readonly _tag: "Launch";
      readonly client: Client.Command;
      readonly pool: Option.Option<string>;
      /** Every argument after the client's command, untouched. */
      readonly args: ReadonlyArray<string>;
    }
  | {
      readonly _tag: "Route";
      readonly client: Client.RoutedCommand;
      readonly pool: Option.Option<string>;
    }
  | {
      readonly _tag: "Routes";
      readonly action: "show" | "set";
      readonly client: Client.RoutedCommand;
    }
  | { readonly _tag: "Login"; readonly pool: string }
  | { readonly _tag: "Logout"; readonly pool: string }
  | { readonly _tag: "Configure" }
  | { readonly _tag: "Shims"; readonly remove: boolean }
  | { readonly _tag: "TitlesReport" }
  | { readonly _tag: "TitlesSchedule"; readonly remove: boolean }
  | { readonly _tag: "Doctor"; readonly json: boolean }
  | { readonly _tag: "HubKey" }
  | { readonly _tag: "MemoryKey" }
  | {
      readonly _tag: "MemoryGet";
      readonly path: string;
      readonly query: ReadonlyArray<readonly [string, string]>;
    }
  | { readonly _tag: "MemorySql" }
  | {
      readonly _tag: "MemoryTranscript";
      readonly of: TranscriptOf;
      readonly page: Memory.PageAsked;
    };

export const usage = `Usage:
  cota join <hub> [--machine <name>] [--no-shims] [--allow-plain-http]
  cota leave
  cota [--pool <pool>] <claude|codex|opencode|pi> [args…]
  cota route [<claude|codex>] [--pool <pool>]
  cota routes show <claude|codex>
  cota routes set <claude|codex>
  cota login <pool>
  cota logout <pool>
  cota configure
  cota shims [--remove]
  cota titles report
  cota titles schedule [--remove]
  cota doctor [--json]
  cota hub-key keyed
  cota memory key
  cota memory get <path> [<name>=<value>…]
  cota memory sql
  cota memory transcript <session> [--from <n>] [--entries <n>] [--cut <n>]
  cota memory transcript --request <id> [--from <n>] [--entries <n>] [--cut <n>]
  cota --version
  cota --help
`;

type Flags = Readonly<Record<string, "switch" | "value">>;

interface Parsed {
  readonly positionals: ReadonlyArray<string>;
  readonly switches: ReadonlySet<string>;
  readonly values: ReadonlyMap<string, string>;
}

/** Reads a command's arguments: its flags anywhere, `--name value` or `--name=value`, and its positionals in order. */
const argumentsOf = (
  command: string,
  args: ReadonlyArray<string>,
  flags: Flags,
  positionals: number,
): Result.Result<Parsed, string> => {
  const found: Array<string> = [];
  const switches = new Set<string>();
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (!arg.startsWith("-") || arg === "-") {
      found.push(arg);
      continue;
    }
    const long = arg.startsWith("--");
    const equals = arg.indexOf("=");
    const name = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
    const inline = equals === -1 ? undefined : arg.slice(equals + 1);
    const kind = long && Object.hasOwn(flags, name) ? flags[name] : undefined;
    if (kind === undefined) {
      return Result.fail(`cota ${command} has no option ${arg.split("=")[0]}`);
    }
    if (switches.has(name) || values.has(name)) {
      return Result.fail(`--${name} is given twice`);
    }
    if (kind === "switch") {
      if (inline !== undefined) return Result.fail(`--${name} takes no value`);
      switches.add(name);
      continue;
    }
    const value = inline ?? args[++index];
    if (value === undefined || value === "") {
      return Result.fail(`--${name} needs a value`);
    }
    values.set(name, value);
  }
  if (found.length > positionals) {
    return Result.fail(
      `cota ${command} was given ${found.slice(positionals).join(" ")}, which it does not take`,
    );
  }
  return Result.succeed({ positionals: found, switches, values });
};

const isOneOf = <const Names extends ReadonlyArray<string>>(
  names: Names,
  name: string | undefined,
): name is Names[number] => names.some((each) => each === name);

const routedClient = (
  command: string,
  name: string | undefined,
): Result.Result<Client.RoutedCommand, string> => {
  if (isOneOf(Client.routedCommands, name)) return Result.succeed(name);
  return Result.fail(
    name === undefined
      ? `cota ${command} needs a client: claude or codex`
      : `cota ${command} takes claude or codex, not ${name}`,
  );
};

const required = (
  command: string,
  what: string,
  parsed: Parsed,
): Result.Result<string, string> => {
  const value = parsed.positionals[0];
  return value === undefined
    ? Result.fail(`cota ${command} needs ${what}`)
    : Result.succeed(value);
};

const countOf = (
  parsed: Parsed,
  name: string,
  least: number,
  most: number,
  otherwise: number,
): Result.Result<number, string> => {
  const given = parsed.values.get(name);
  if (given === undefined) return Result.succeed(otherwise);
  const count = /^[0-9]+$/.test(given) ? Number(given) : Number.NaN;
  return count >= least && count <= most
    ? Result.succeed(count)
    : Result.fail(`--${name} takes a whole number from ${least} to ${most}`);
};

const memory = (
  args: ReadonlyArray<string>,
): Result.Result<Invocation, string> => {
  const [action, ...rest] = args;
  switch (action) {
    case "key":
      return Result.map(argumentsOf("memory key", rest, {}, 0), () => ({
        _tag: "MemoryKey",
      }));
    case "sql":
      return Result.map(argumentsOf("memory sql", rest, {}, 0), () => ({
        _tag: "MemorySql",
      }));
    case "get":
      return Result.flatMap(
        argumentsOf("memory get", rest, {}, Number.POSITIVE_INFINITY),
        (parsed) => {
          const [path, ...parameters] = parsed.positionals;
          if (path === undefined) {
            return Result.fail("cota memory get needs a path, /api/…");
          }
          return Result.flatMap(Memory.pathOf(path), (checked) =>
            Result.map(
              Result.all(parameters.map(Memory.parameterOf)),
              (query) => ({ _tag: "MemoryGet", path: checked, query }),
            ),
          );
        },
      );
    case "transcript":
      return Result.flatMap(
        argumentsOf(
          "memory transcript",
          rest,
          { request: "value", from: "value", entries: "value", cut: "value" },
          1,
        ),
        (parsed): Result.Result<Invocation, string> => {
          const session = parsed.positionals[0];
          const request = parsed.values.get("request");
          const of: Result.Result<TranscriptOf, string> =
            session !== undefined && request === undefined
              ? Result.succeed({ _tag: "Session", session })
              : session === undefined && request !== undefined
                ? Result.succeed({ _tag: "Request", request })
                : Result.fail(
                    "cota memory transcript needs a session, or --request <id>, and not both",
                  );
          const { entries, cut } = Memory.pageLimits;
          return Result.map(
            Result.all({
              of,
              from: countOf(parsed, "from", 1, Number.MAX_SAFE_INTEGER, 1),
              entries: countOf(
                parsed,
                "entries",
                entries.least,
                entries.most,
                entries.default,
              ),
              cut: countOf(parsed, "cut", cut.least, cut.most, cut.default),
            }),
            ({ of, ...page }) => ({ _tag: "MemoryTranscript", of, page }),
          );
        },
      );
    default:
      return Result.fail("cota memory needs key, get, sql or transcript");
  }
};

const named = (
  command: string,
  args: ReadonlyArray<string>,
): Result.Result<Invocation, string> => {
  switch (command) {
    case "join":
      return Result.flatMap(
        argumentsOf(
          command,
          args,
          {
            machine: "value",
            "no-shims": "switch",
            "allow-plain-http": "switch",
          },
          1,
        ),
        (parsed) =>
          Result.map(required(command, "the hub's address", parsed), (hub) => ({
            _tag: "Join",
            hub,
            machine: Option.fromUndefinedOr(parsed.values.get("machine")),
            shims: !parsed.switches.has("no-shims"),
            allowPlainHttp: parsed.switches.has("allow-plain-http"),
          })),
      );
    case "leave":
      return Result.map(argumentsOf(command, args, {}, 0), () => ({
        _tag: "Leave",
      }));
    case "route":
      return Result.flatMap(
        argumentsOf(command, args, { pool: "value" }, 1),
        (parsed) =>
          Result.map(
            routedClient(command, parsed.positionals[0] ?? "claude"),
            (client) => ({
              _tag: "Route",
              client,
              pool: Option.fromUndefinedOr(parsed.values.get("pool")),
            }),
          ),
      );
    case "routes":
      return Result.flatMap(argumentsOf(command, args, {}, 2), (parsed) => {
        const [action, client] = parsed.positionals;
        if (action !== "show" && action !== "set") {
          return Result.fail("cota routes needs show or set");
        }
        return Result.map(routedClient(`routes ${action}`, client), (each) => ({
          _tag: "Routes",
          action,
          client: each,
        }));
      });
    case "login":
    case "logout":
      return Result.flatMap(argumentsOf(command, args, {}, 1), (parsed) =>
        Result.map(required(command, "a pool", parsed), (pool) => ({
          _tag: command === "login" ? "Login" : "Logout",
          pool,
        })),
      );
    case "configure":
      return Result.map(argumentsOf(command, args, {}, 0), () => ({
        _tag: "Configure",
      }));
    case "shims":
      return Result.map(
        argumentsOf(command, args, { remove: "switch" }, 0),
        (parsed) => ({ _tag: "Shims", remove: parsed.switches.has("remove") }),
      );
    case "titles":
      return Result.flatMap(
        argumentsOf(command, args, { remove: "switch" }, 1),
        (parsed): Result.Result<Invocation, string> => {
          const [action] = parsed.positionals;
          if (action === "schedule") {
            return Result.succeed({
              _tag: "TitlesSchedule",
              remove: parsed.switches.has("remove"),
            });
          }
          if (action === "report" && !parsed.switches.has("remove")) {
            return Result.succeed({ _tag: "TitlesReport" });
          }
          return Result.fail(
            action === "report"
              ? "cota titles report has no option --remove"
              : "cota titles needs report or schedule",
          );
        },
      );
    case "doctor":
      return Result.map(
        argumentsOf(command, args, { json: "switch" }, 0),
        (parsed) => ({ _tag: "Doctor", json: parsed.switches.has("json") }),
      );
    case "hub-key":
      return Result.flatMap(argumentsOf(command, args, {}, 1), (parsed) =>
        parsed.positionals[0] === "keyed"
          ? Result.succeed({ _tag: "HubKey" })
          : Result.fail("cota hub-key takes keyed"),
      );
    case "memory":
      return memory(args);
    default:
      return Result.fail(`cota has no command ${command}`);
  }
};

const poolFlag = /^--pool(?:=(.*))?$/;

/**
 * Reads `cota`'s command line, its arguments without the program's own path,
 * or says what is wrong with it. A launch's arguments after the client's
 * command are the client's, passed on untouched, whatever they look like.
 */
export const parse = (
  argv: ReadonlyArray<string>,
): Result.Result<Invocation, string> => {
  const [first, ...rest] = argv;
  if (first === undefined) return Result.fail("cota needs a command");
  if (first === "--help" || first === "help") {
    return rest.length === 0
      ? Result.succeed({ _tag: "Help" })
      : Result.fail(`cota ${first} takes nothing else`);
  }
  if (first === "--version") {
    return rest.length === 0
      ? Result.succeed({ _tag: "Version" })
      : Result.fail("cota --version takes nothing else");
  }
  const pool = first.match(poolFlag);
  if (pool !== null) {
    const value = pool[1] ?? rest[0];
    const [client, ...args] = pool[1] === undefined ? rest.slice(1) : rest;
    if (value === undefined || value === "") {
      return Result.fail("--pool needs a value");
    }
    if (!isOneOf(Client.commands, client)) {
      return Result.fail(
        "--pool is followed by a client: claude, codex, opencode or pi",
      );
    }
    return Result.succeed({
      _tag: "Launch",
      client,
      pool: Option.some(value),
      args,
    });
  }
  if (isOneOf(Client.commands, first)) {
    return Result.succeed({
      _tag: "Launch",
      client: first,
      pool: Option.none(),
      args: rest,
    });
  }
  return named(first, rest);
};
