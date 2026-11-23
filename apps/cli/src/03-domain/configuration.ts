import { Duration, Result, Schema } from "effect";
import * as HubAddress from "./hub-address.ts";

const isAbsolute = (path: string) =>
  path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);

/** The longest machine name, in characters (code points). */
export const longestMachineName = 200;

export const isMachineName = (name: string): boolean => {
  const length = [...name].length;
  return length >= 1 && length <= longestMachineName;
};

const MachineName = Schema.String.check(
  Schema.makeFilter((name) => isMachineName(name), {
    expected: `a name of 1 to ${longestMachineName} characters`,
  }),
);

const ClientSettings = Schema.Struct({
  own_pool: Schema.optionalKey(Schema.NonEmptyString),
});

/** A data folder of a reported client this machine reports, and the observed pool its model calls bill. */
const ReportedFolder = Schema.Struct({
  folder: Schema.String.check(
    Schema.makeFilter((folder) => isAbsolute(folder), {
      expected: "an absolute path",
    }),
  ),
  pool: Schema.NonEmptyString,
});
export type ReportedFolder = typeof ReportedFolder.Type;

/** A reported client's settings: its data folders, and no setting of a launched client's. */
const ReportedSettings = Schema.Struct({
  reported: Schema.Array(ReportedFolder),
});

/** `config.toml` as it is written: no secret, and only what the owner or a join chose (`docs/specs/cli/spec.md`). */
const File = Schema.Struct({
  hub: Schema.String,
  machine: MachineName,
  allow_plain_http: Schema.optionalKey(Schema.Boolean),
  shims: Schema.optionalKey(Schema.Boolean),
  launch: Schema.optionalKey(
    Schema.Struct({
      wait: Schema.optionalKey(Schema.DurationFromString),
      wait_routed: Schema.optionalKey(Schema.DurationFromString),
    }),
  ),
  clients: Schema.optionalKey(
    Schema.Struct({
      "claude-code": Schema.optionalKey(ClientSettings),
      codex: Schema.optionalKey(ClientSettings),
      antigravity: Schema.optionalKey(ReportedSettings),
    }),
  ),
});

export type Configuration = Omit<typeof File.Type, "hub"> & {
  readonly hub: HubAddress.HubAddress;
};

/** The machine has not joined a hub: its configuration's file does not exist. */
export class NotJoined extends Schema.TaggedError<
  NotJoined,
  { readonly brand: unique symbol }
>()("NotJoined", { file: Schema.String }) {}

export class ConfigurationInvalid extends Schema.TaggedError<
  ConfigurationInvalid,
  { readonly brand: unique symbol }
>()("ConfigurationInvalid", { file: Schema.String, problems: Schema.String }) {}

/**
 * Decodes the configuration's TOML, read as a value, giving every problem
 * with its key; an `http` hub that is not loopback is one unless
 * `allow_plain_http` is true.
 */
export const decode = (read: unknown): Result.Result<Configuration, string> => {
  const decoded = Schema.decodeUnknownResult(File)(read, {
    errors: "all",
    onExcessProperty: "error",
  });
  if (Result.isFailure(decoded)) {
    return Result.fail(decoded.failure.message);
  }
  const file = decoded.success;
  const hub = HubAddress.read(file.hub, file.allow_plain_http === true);
  if (Result.isFailure(hub)) {
    return Result.fail(`${hub.failure}\n  at ["hub"]`);
  }
  return Result.succeed({ ...file, hub: hub.success });
};

/** A TOML basic string of a text: JSON's escapes are TOML's, but for DEL, which TOML does not take bare. */
export const tomlString = (text: string) =>
  JSON.stringify(text).replace(/\u007f/g, "\\u007f");

const waitText = (wait: Duration.Duration) => {
  const millis = Duration.toMillis(wait);
  return tomlString(
    millis % 1000 === 0 ? `${millis / 1000} seconds` : `${millis} millis`,
  );
};

/** The configuration as TOML, in the order the spec gives its keys, with a final line break. */
export const textOf = (configuration: Configuration): string => {
  const lines = [
    `hub = ${tomlString(configuration.hub)}`,
    `machine = ${tomlString(configuration.machine)}`,
  ];
  if (configuration.allow_plain_http !== undefined) {
    lines.push(`allow_plain_http = ${configuration.allow_plain_http}`);
  }
  if (configuration.shims !== undefined) {
    lines.push(`shims = ${configuration.shims}`);
  }
  const { launch, clients } = configuration;
  if (launch !== undefined) {
    lines.push("", "[launch]");
    if (launch.wait !== undefined) {
      lines.push(`wait = ${waitText(launch.wait)}`);
    }
    if (launch.wait_routed !== undefined) {
      lines.push(`wait_routed = ${waitText(launch.wait_routed)}`);
    }
  }
  for (const client of ["claude-code", "codex"] as const) {
    const settings = clients?.[client];
    if (settings === undefined) continue;
    lines.push("", `[clients.${client}]`);
    if (settings.own_pool !== undefined) {
      lines.push(`own_pool = ${tomlString(settings.own_pool)}`);
    }
  }
  for (const { folder, pool } of clients?.antigravity?.reported ?? []) {
    lines.push(
      "",
      "[[clients.antigravity.reported]]",
      `folder = ${tomlString(folder)}`,
      `pool = ${tomlString(pool)}`,
    );
  }
  return `${lines.join("\n")}\n`;
};
