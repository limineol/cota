import { readFileSync } from "node:fs";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

const read = (name: string) =>
  readFileSync(new URL(name, import.meta.url), "utf8");

const Mount = Schema.Struct({
  type: Schema.optionalKey(Schema.String),
  source: Schema.optionalKey(Schema.String),
  target: Schema.optionalKey(Schema.String),
  read_only: Schema.optionalKey(Schema.Boolean),
});
type Mount = typeof Mount.Type;

const Service = Schema.Struct({
  image: Schema.optionalKey(Schema.String),
  user: Schema.optionalKey(Schema.String),
  entrypoint: Schema.optionalKey(Schema.Array(Schema.String)),
  command: Schema.optionalKey(
    Schema.Union([Schema.String, Schema.Array(Schema.String)]),
  ),
  environment: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  volumes: Schema.optionalKey(
    Schema.Array(Schema.Union([Mount, Schema.String])),
  ),
  ports: Schema.optionalKey(Schema.Array(Schema.String)),
  network_mode: Schema.optionalKey(Schema.String),
  healthcheck: Schema.optionalKey(
    Schema.Struct({ test: Schema.optionalKey(Schema.Array(Schema.String)) }),
  ),
});
type Service = typeof Service.Type;

const compose = Schema.decodeUnknownSync(
  Schema.Struct({
    name: Schema.String,
    services: Schema.Record(Schema.String, Service),
  }),
)(Bun.YAML.parse(read("compose.yaml")));
const config: unknown = Bun.TOML.parse(read("cota.toml"));
const clickhousePassword = Schema.decodeUnknownSync(
  Schema.Struct({ clickhouse: Schema.Struct({ password: Schema.Unknown }) }),
)(config).clickhouse.password;

const service = (name: "clickhouse" | "hub"): Service => {
  const found = compose.services[name];
  if (found === undefined) throw new Error(`compose.yaml has no ${name}`);
  return found;
};

const mountsOf = (name: "clickhouse" | "hub"): ReadonlyArray<Mount> =>
  (service(name).volumes ?? []).map((volume) =>
    typeof volume === "string" ? { source: volume } : volume,
  );

/** Every `{ file = … }` and `{ env = … }` of a configuration, wherever it is. */
const sourcesOf = (
  value: unknown,
): ReadonlyArray<{ readonly file?: unknown; readonly env?: unknown }> => {
  if (Array.isArray(value)) return value.flatMap(sourcesOf);
  if (typeof value !== "object" || value === null) return [];
  if ("file" in value || "env" in value) return [value];
  return Object.values(value).flatMap(sourcesOf);
};

/** What a service runs or is given, as text: its entrypoint, command, health check and environment. */
const runsWith = (name: "clickhouse" | "hub"): ReadonlyArray<string> => {
  const { entrypoint, command, healthcheck, environment } = service(name);
  return [
    ...(entrypoint ?? []),
    ...(typeof command === "string" ? [command] : (command ?? [])),
    ...(healthcheck?.test ?? []),
    ...Object.entries(environment ?? {}).map(
      ([key, value]) => `${key}=${value}`,
    ),
  ];
};

const secretsFolder = "/etc/cota/secrets";
const throwaway = "throwaway-dev-password";

describe("the deployment's files", () => {
  it("Y3: The Compose file names no ClickHouse password; ClickHouse's password is the secret file's.", () => {
    expect(service("clickhouse").environment).toEqual({
      CLICKHOUSE_DB: "cota",
      CLICKHOUSE_USER: "cota",
      CLICKHOUSE_PASSWORD_FILE: `${secretsFolder}/clickhouse`,
      CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: "1",
    });
    expect(read("compose.yaml")).not.toContain(throwaway);
    expect(read("cota.toml")).not.toContain(throwaway);
    expect(clickhousePassword).toEqual({ file: `${secretsFolder}/clickhouse` });
    expect(service("clickhouse").healthcheck?.test?.join(" ")).toContain(
      `--password "$$(cat ${secretsFolder}/clickhouse)"`,
    );
    const [shell, flag, guard, ...rest] =
      service("clickhouse").entrypoint ?? [];
    expect([shell, flag, rest]).toEqual([
      "/bin/sh",
      "-c",
      ["clickhouse-guard"],
    ]);
    expect(guard?.split("\n").filter((line) => line !== "")).toEqual([
      `if [ ! -f ${secretsFolder}/clickhouse ] || [ -z "$$(cat ${secretsFolder}/clickhouse)" ]; then`,
      `  echo "ClickHouse's password file ${secretsFolder}/clickhouse is missing or empty; the install makes it" >&2`,
      "  exit 1",
      "fi",
      'exec /entrypoint.sh "$$@"',
    ]);
  });

  it("Y4: Neither service has a secret as an environment variable or in its command: every secret reaches it as a file mounted read-only.", () => {
    expect(service("hub").environment).toBeUndefined();
    expect(service("hub").command).toBeUndefined();
    expect(service("hub").entrypoint).toBeUndefined();
    for (const name of ["clickhouse", "hub"] as const) {
      for (const text of runsWith(name)) {
        expect(text).not.toMatch(/password=|[0-9a-f]{32}/i);
      }
    }
    const sources = sourcesOf(config);
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(source.env).toBeUndefined();
      expect(source.file).toMatch(new RegExp(`^${secretsFolder}/[\\w-]+$`));
    }
    expect(
      mountsOf("hub").map(({ source, target, read_only }) => ({
        source,
        target,
        readOnly: read_only === true,
      })),
    ).toEqual([
      { source: "./cota.toml", target: "/etc/cota/cota.toml", readOnly: true },
      { source: "./secrets", target: secretsFolder, readOnly: true },
      { source: "./store", target: "/var/lib/cota/store", readOnly: false },
      { source: "./archive", target: "/var/lib/cota/archive", readOnly: false },
    ]);
    expect(
      mountsOf("clickhouse").filter(({ target }) =>
        target?.startsWith("/etc/cota"),
      ),
    ).toEqual([
      expect.objectContaining({
        source: "./secrets/clickhouse",
        target: `${secretsFolder}/clickhouse`,
        read_only: true,
      }),
    ]);
  });

  it("Y5: With `COTA_BIND` unset, the hub is published on 127.0.0.1 alone, and ClickHouse on no port of the host.", () => {
    expect(service("hub").ports).toEqual([
      "${COTA_BIND:-127.0.0.1}:${COTA_PORT:-8080}:8080",
    ]);
    expect(service("clickhouse").ports).toBeUndefined();
    expect(service("hub").network_mode).toBeUndefined();
    expect(service("clickhouse").network_mode).toBeUndefined();
  });

  it("runs the ClickHouse that compose.dev.yaml runs, and builds the hub on the Bun that package.json names, each image by its digest", () => {
    const development = readFileSync(
      new URL("../compose.dev.yaml", import.meta.url),
      "utf8",
    ).match(/image: (clickhouse\/clickhouse-server:\S+)/)?.[1];
    expect(service("clickhouse").image).toBe(development);
    const bun = Schema.decodeUnknownSync(
      Schema.Struct({ packageManager: Schema.String }),
    )(JSON.parse(read("../package.json"))).packageManager.replace("bun@", "");
    const bases = [
      ...read("../Dockerfile").matchAll(/^FROM (?:--platform=\S+ )?(\S+)/gm),
    ].map((match) => match[1]);
    expect(bases).toEqual([
      expect.stringMatching(
        new RegExp(`^oven/bun:${bun}@sha256:[0-9a-f]{64}$`),
      ),
      "manifests",
      "manifests",
      expect.stringMatching(
        new RegExp(`^oven/bun:${bun}-slim@sha256:[0-9a-f]{64}$`),
      ),
    ]);
  });

  it("names the project cota, and runs the hub image and user that .env names, which it requires", () => {
    expect(compose.name).toBe("cota");
    expect(service("hub").user).toMatch(
      /^\$\{COTA_UID:\?[^}]+\}:\$\{COTA_GID:\?[^}]+\}$/,
    );
    expect(service("hub").image).toMatch(/^\$\{COTA_HUB_IMAGE:\?[^}]+\}$/);
  });
});
