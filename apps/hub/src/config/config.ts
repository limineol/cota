import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Config,
  Duration,
  Effect,
  HashMap,
  Option,
  Redacted,
  Result,
  Schema,
  SchemaIssue,
} from "effect";
import * as Admission from "#modules/admission/03-domain/admission.ts";
import * as Sha256HubKeyHasher from "#modules/admission/04-infrastructure/sha256-hub-key-hasher.ts";
import type * as Fallback from "#modules/relay/03-domain/fallback.ts";
import { Limits } from "#modules/relay/03-domain/limits.ts";
import * as Sql from "#modules/request-log/03-domain/sql.ts";
import * as Prices from "#modules/request-log/04-infrastructure/prices/prices.ts";
import { HubKeyDigest, HubKeyName, PoolId } from "#shared/03-domain/ids.ts";
import { Pool } from "#shared/03-domain/pool.entity.ts";
import type * as Price from "#shared/03-domain/price.ts";
import { ProtocolName } from "#shared/03-domain/protocol-name.ts";

export class ConfigInvalid extends Schema.TaggedError<
  ConfigInvalid,
  { readonly brand: unique symbol }
>()("ConfigInvalid", { file: Schema.String, problems: Schema.String }) {
  override get message(): string {
    return `${this.file} is not a valid configuration:\n${this.problems}`;
  }
}

const SecretSource = Schema.Union([
  Schema.Struct({ env: Schema.NonEmptyString }),
  Schema.Struct({ file: Schema.NonEmptyString }),
]);
type SecretSource = typeof SecretSource.Type;

const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0));

const isHttpUrl = (text: string): boolean => {
  if (!URL.canParse(text)) return false;
  const url = new URL(text);
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    url.search === "" &&
    url.hash === "" &&
    url.username === "" &&
    url.password === ""
  );
};

const HttpUrl = Schema.String.check(
  Schema.makeFilter(
    (text) =>
      isHttpUrl(text) ||
      "an http or https URL without a query, a fragment or credentials",
  ),
);

const poolSegment = /^[A-Za-z0-9][A-Za-z0-9._~-]*$/;

const Dollars = Prices.RateFromDollars;

const RatesEntry = Schema.Struct({
  input: Dollars,
  output: Dollars,
  cache_read: Schema.optionalKey(Dollars),
  cache_write_short: Schema.optionalKey(Dollars),
  cache_write_long: Schema.optionalKey(Dollars),
});
type RatesEntry = typeof RatesEntry.Type;

const ModelPriceEntry = Schema.Struct({
  ...RatesEntry.fields,
  tiers: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        over: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
        ...RatesEntry.fields,
      }),
    ),
  ),
});
type ModelPriceEntry = typeof ModelPriceEntry.Type;

const PoolEntry = Schema.Struct({
  protocol: ProtocolName,
  provider: Schema.optionalKey(Schema.NonEmptyString),
  base_url: Schema.optionalKey(HttpUrl),
  key: Schema.optionalKey(SecretSource),
  kept_login: Schema.optionalKey(SecretSource),
  fallback: Schema.optionalKey(PoolId),
  prices: Schema.optionalKey(Schema.NonEmptyString),
  model_prices: Schema.optionalKey(
    Schema.Record(Schema.String, ModelPriceEntry),
  ),
});
type PoolEntry = typeof PoolEntry.Type;

const HubKeyEntry = Schema.Struct({
  name: HubKeyName,
  scope: Admission.Scope,
  secret: SecretSource,
});

const isKeyed = (pool: PoolEntry): boolean =>
  pool.key !== undefined || pool.protocol === "openai-chat";

interface Problem {
  readonly path: ReadonlyArray<PropertyKey>;
  readonly issue: string;
}

const hubKeyProblems = (
  hubKeys: ReadonlyArray<typeof HubKeyEntry.Type>,
): ReadonlyArray<Problem> =>
  hubKeys.flatMap(({ name }, index) =>
    hubKeys.findIndex((other) => other.name === name) < index
      ? [
          {
            path: ["hub_keys", index, "name"],
            issue: `another hub key is already named "${name}"`,
          },
        ]
      : [],
  );

const poolProblems = (
  id: string,
  pool: PoolEntry,
  pools: Readonly<Record<string, PoolEntry>>,
): ReadonlyArray<Problem> => {
  const at = (field: string) => ["pools", id, field];
  const problems: Array<Problem> = [];
  if (!poolSegment.test(id)) {
    problems.push({
      path: ["pools", id],
      issue:
        "a pool id is one path segment: letters, digits, '.', '_', '~' and '-', starting with a letter or digit",
    });
  }
  if (pool.prices !== undefined && !Prices.listNames.includes(pool.prices)) {
    problems.push({
      path: at("prices"),
      issue: `there is no price list "${pool.prices}"; the hub ships ${Prices.listNames.join(", ")}`,
    });
  }
  for (const [model, price] of Object.entries(pool.model_prices ?? {})) {
    const tiers = price.tiers ?? [];
    tiers.forEach(({ over }, index) => {
      const below = tiers[index - 1];
      if (below !== undefined && below.over >= over) {
        problems.push({
          path: ["pools", id, "model_prices", model, "tiers", index, "over"],
          issue: "tiers are listed with rising thresholds",
        });
      }
    });
  }
  const keyed = isKeyed(pool);
  if (pool.protocol === "openai-chat" && pool.base_url === undefined) {
    problems.push({
      path: at("base_url"),
      issue: `a pool that speaks ${pool.protocol} needs a base_url`,
    });
  }
  if (pool.protocol === "chatgpt-codex" && pool.key !== undefined) {
    problems.push({
      path: at("key"),
      issue:
        "a pool that speaks chatgpt-codex cannot hold a key; only anthropic-messages and openai-chat pools can",
    });
  }
  if (keyed && pool.kept_login !== undefined) {
    problems.push({
      path: at("kept_login"),
      issue: "only a subscription pool has a kept login",
    });
  }
  if (keyed && pool.fallback !== undefined) {
    problems.push({
      path: at("fallback"),
      issue: "only a subscription pool has a fallback pool",
    });
  }
  if (!keyed && pool.fallback !== undefined) {
    const fallback = pools[pool.fallback];
    if (pool.protocol !== "anthropic-messages") {
      problems.push({
        path: at("fallback"),
        issue: `a pool that speaks ${pool.protocol} cannot have a fallback pool yet; only anthropic-messages pools can`,
      });
    } else if (pool.fallback === id) {
      problems.push({
        path: at("fallback"),
        issue: "a pool cannot be its own fallback pool",
      });
    } else if (fallback === undefined) {
      problems.push({
        path: at("fallback"),
        issue: `there is no pool "${pool.fallback}"`,
      });
    } else if (fallback.protocol !== pool.protocol) {
      problems.push({
        path: at("fallback"),
        issue: `the fallback pool "${pool.fallback}" speaks ${fallback.protocol}, not ${pool.protocol}`,
      });
    } else if (isKeyed(fallback)) {
      problems.push({
        path: at("fallback"),
        issue: `the fallback pool "${pool.fallback}" holds a key; a fallback pool is a subscription pool`,
      });
    } else if (fallback.kept_login === undefined) {
      problems.push({
        path: at("fallback"),
        issue: `the fallback pool "${pool.fallback}" has no kept_login`,
      });
    }
  }
  return problems;
};

const between = (minimum: number, maximum: number) =>
  Schema.Int.check(Schema.isBetween({ minimum, maximum }));

const longestQueryTime = Duration.minutes(10);

const QueryTime = Schema.DurationFromString.check(
  Schema.makeFilter((duration) => {
    const millis = Duration.toMillis(duration);
    return (
      (millis % 1000 === 0 &&
        millis >= 1000 &&
        millis <= Duration.toMillis(longestQueryTime)) ||
      "a whole number of seconds, from 1 second to 10 minutes"
    );
  }),
);

const ClickHouseEntry = Schema.Struct({
  url: HttpUrl,
  database: Schema.NonEmptyString,
  user: Schema.NonEmptyString,
  password: SecretSource,
});

const File = Schema.Struct({
  hub: Schema.Struct({
    host: Schema.NonEmptyString,
    port: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 65535 })),
  }),
  relay: Schema.optionalKey(
    Schema.Struct({
      max_body_mib: Schema.optionalKey(PositiveInt),
      max_decoded_body_mib: Schema.optionalKey(PositiveInt),
      max_read_answer_mib: Schema.optionalKey(PositiveInt),
      first_byte_timeout: Schema.optionalKey(Schema.DurationFromString),
      copy_capacity: Schema.optionalKey(PositiveInt),
    }),
  ),
  sql: Schema.optionalKey(
    Schema.Struct({
      max_query_time: Schema.optionalKey(QueryTime),
      max_memory_bytes: Schema.optionalKey(
        Schema.Int.check(Schema.isGreaterThanOrEqualTo(100_000_000)),
      ),
      max_threads: Schema.optionalKey(between(1, 256)),
      max_concurrent_queries: Schema.optionalKey(between(1, 64)),
      max_answer_rows: Schema.optionalKey(between(1, 1_000_000)),
      max_answer_mib: Schema.optionalKey(between(1, 256)),
    }),
  ),
  clickhouse: ClickHouseEntry,
  store: Schema.optionalKey(
    Schema.Struct({ path: Schema.optionalKey(Schema.NonEmptyString) }),
  ),
  archive: Schema.optionalKey(
    Schema.Struct({ directory: Schema.NonEmptyString }),
  ),
  dashboard: Schema.optionalKey(
    Schema.Struct({ directory: Schema.optionalKey(Schema.NonEmptyString) }),
  ),
  sign_in: Schema.optionalKey(Schema.Struct({ password: SecretSource })),
  hub_keys: Schema.Array(HubKeyEntry),
  pools: Schema.Record(Schema.String, PoolEntry),
});
type File = typeof File.Type;

const Secret = Schema.Redacted(Schema.String);

export const HubKeyConfig = Schema.Struct({
  name: HubKeyName,
  scope: Admission.Scope,
  digest: HubKeyDigest,
});
export type HubKeyConfig = typeof HubKeyConfig.Type;

export const ClickHouseConfig = Schema.Struct({
  url: Schema.String,
  database: Schema.String,
  user: Schema.String,
  password: Secret,
});
export type ClickHouseConfig = typeof ClickHouseConfig.Type;

export const HubConfig = Schema.Struct({
  hub: Schema.Struct({ host: Schema.String, port: Schema.Int }),
  limits: Limits,
  sql: Sql.Limits,
  clickhouse: ClickHouseConfig,
  store: Schema.Struct({ path: Schema.String }),
  archive: Schema.Option(Schema.Struct({ directory: Schema.String })),
  dashboard: Schema.Struct({ directory: Schema.String }),
  signIn: Schema.Struct({ password: Schema.Option(Secret) }),
  hubKeys: Schema.Array(HubKeyConfig),
  pools: Schema.HashMap(PoolId, Pool),
});
export type HubConfig = typeof HubConfig.Type;

const mebibyte = 1024 * 1024;

/** Where `bun run web:build` writes the dashboard: the repository's `apps/web/dist`, beside the hub's source. */
export const builtDashboard = fileURLToPath(
  new URL("../../../web/dist", import.meta.url),
);

const limitsOf = (relay: File["relay"]): Limits => ({
  maxBodyBytes: (relay?.max_body_mib ?? 128) * mebibyte,
  maxDecodedBodyBytes: (relay?.max_decoded_body_mib ?? 256) * mebibyte,
  maxReadAnswerBytes: (relay?.max_read_answer_mib ?? 16) * mebibyte,
  firstByteTimeout: relay?.first_byte_timeout ?? Duration.minutes(10),
  copyCapacity: relay?.copy_capacity ?? 256,
});

const sqlLimitsOf = (sql: File["sql"]): Sql.Limits => ({
  queryTime: sql?.max_query_time ?? Sql.defaults.queryTime,
  memoryBytes: sql?.max_memory_bytes ?? Sql.defaults.memoryBytes,
  threads: sql?.max_threads ?? Sql.defaults.threads,
  concurrentQueries:
    sql?.max_concurrent_queries ?? Sql.defaults.concurrentQueries,
  rows: sql?.max_answer_rows ?? Sql.defaults.rows,
  rowBytes:
    sql?.max_answer_mib === undefined
      ? Sql.defaults.rowBytes
      : sql.max_answer_mib * mebibyte,
});

const withoutTrailingSlash = (url: string): string => url.replace(/\/+$/, "");

const clickHouseOf = (
  entry: typeof ClickHouseEntry.Type,
  password: Redacted.Redacted<string>,
): ClickHouseConfig => ({
  url: withoutTrailingSlash(entry.url),
  database: entry.database,
  user: entry.user,
  password,
});

const formatted = (path: ReadonlyArray<PropertyKey>, issue: string): string =>
  `${issue}\n  at ${path.map((key) => `[${JSON.stringify(key)}]`).join("")}`;

const readSecret = Effect.fn("HubConfig.readSecret")(function* (
  source: SecretSource,
  path: ReadonlyArray<PropertyKey>,
): Effect.fn.Return<Redacted.Redacted<string>, string> {
  const label = path.join(".");
  if ("env" in source) {
    const value = yield* Config.String(source.env).pipe(
      Effect.mapError(() =>
        formatted(path, `the environment variable ${source.env} is not set`),
      ),
    );
    if (value === "") {
      return yield* Effect.fail(
        formatted(path, `the environment variable ${source.env} is empty`),
      );
    }
    return Redacted.make(value, { label });
  }
  const file = Bun.file(source.file);
  const text = yield* Effect.tryPromise({
    try: () => file.text(),
    catch: () => formatted(path, `the file ${source.file} cannot be read`),
  });
  const value = text.replace(/\r?\n$/, "");
  if (value === "") {
    return yield* Effect.fail(
      formatted(path, `the file ${source.file} is empty`),
    );
  }
  return Redacted.make(value, { label });
});

const parseToml = (file: string, text: string) =>
  Effect.try({
    try: (): unknown => Bun.TOML.parse(text),
    catch: (cause) =>
      new ConfigInvalid({
        file,
        problems: cause instanceof Error ? cause.message : String(cause),
      }),
  });

const providerOf = (id: string, protocol: ProtocolName): string => {
  if (protocol === "anthropic-messages") return "anthropic";
  if (protocol === "chatgpt-codex") return "chatgpt";
  return id;
};

const defaultBaseUrlOf = (protocol: ProtocolName): string => {
  if (protocol === "anthropic-messages") return "https://api.anthropic.com";
  if (protocol === "chatgpt-codex") {
    return "https://chatgpt.com/backend-api/codex";
  }
  return "";
};

const ratesOf = (entry: RatesEntry): Price.Rates => ({
  input: entry.input,
  output: entry.output,
  ...(entry.cache_read === undefined ? {} : { cacheRead: entry.cache_read }),
  ...(entry.cache_write_short === undefined
    ? {}
    : { cacheWriteShort: entry.cache_write_short }),
  ...(entry.cache_write_long === undefined
    ? {}
    : { cacheWriteLong: entry.cache_write_long }),
});

const ownPricesOf = (
  entries: Readonly<Record<string, ModelPriceEntry>> | undefined,
): Record<string, Price.Price> =>
  Object.fromEntries(
    Object.entries(entries ?? {}).map(([model, { tiers, ...base }]) => [
      model,
      {
        base: ratesOf(base),
        tiers: (tiers ?? []).map(({ over, ...rates }) => ({
          threshold: over,
          rates: ratesOf(rates),
        })),
      },
    ]),
  );

const pricesOf = (protocol: ProtocolName): Option.Option<string> => {
  if (protocol === "anthropic-messages") return Option.some("anthropic");
  if (protocol === "chatgpt-codex") return Option.some("openai");
  return Option.none();
};

const poolsOf = Effect.fn("HubConfig.poolsOf")(function* <E>(
  entries: File["pools"],
  secret: (
    source: SecretSource,
    path: ReadonlyArray<PropertyKey>,
  ) => Effect.Effect<Option.Option<Redacted.Redacted<string>>, E>,
) {
  const pools: Array<readonly [PoolId, Pool]> = [];
  for (const [key, entry] of Object.entries(entries)) {
    const id = PoolId.make(key);
    const provider = entry.provider ?? providerOf(id, entry.protocol);
    const prices = Option.orElse(Option.fromUndefinedOr(entry.prices), () =>
      pricesOf(entry.protocol),
    );
    const ownPrices = ownPricesOf(entry.model_prices);
    const baseUrl = withoutTrailingSlash(
      entry.base_url ?? defaultBaseUrlOf(entry.protocol),
    );
    if (
      entry.protocol === "openai-chat" ||
      (entry.protocol === "anthropic-messages" && isKeyed(entry))
    ) {
      const key =
        entry.key === undefined
          ? Option.none()
          : yield* secret(entry.key, ["pools", id, "key"]);
      pools.push([
        id,
        {
          kind: "keyed",
          id,
          protocol: entry.protocol,
          provider,
          baseUrl,
          key,
          prices,
          ownPrices,
        },
      ]);
      continue;
    }
    const keptLogin =
      entry.kept_login === undefined
        ? Option.none()
        : yield* secret(entry.kept_login, ["pools", id, "kept_login"]);
    pools.push([
      id,
      {
        kind: "subscription",
        id,
        protocol: entry.protocol,
        provider,
        baseUrl,
        keptLogin,
        fallback: Option.fromUndefinedOr(entry.fallback),
        prices,
        ownPrices,
      },
    ]);
  }
  return pools;
});

export const read = Effect.fn("HubConfig.read")(function* () {
  const file = yield* Config.String("COTA_CONFIG").pipe(
    Config.withDefault("cota.toml"),
    Effect.orDie,
  );
  const text = yield* Effect.tryPromise({
    try: () => Bun.file(file).text(),
    catch: () =>
      new ConfigInvalid({
        file,
        problems: "the file cannot be read; COTA_CONFIG names another",
      }),
  });
  return { file, text };
});

const decodeProblem = (file: string) => (error: Schema.SchemaError) =>
  new ConfigInvalid({
    file,
    problems: SchemaIssue.makeFormatterDefault()(error.issue),
  });

/**
 * Reads only a configuration's `[clickhouse]` table and its password, for a
 * command that needs ClickHouse and none of the hub's other secrets.
 */
export const parseClickHouse = Effect.fn("HubConfig.parseClickHouse")(
  function* (
    file: string,
    text: string,
  ): Effect.fn.Return<ClickHouseConfig, ConfigInvalid> {
    const raw = yield* parseToml(file, text);
    const { clickhouse } = yield* Schema.decodeUnknownEffect(
      Schema.Struct({ clickhouse: ClickHouseEntry }),
    )(raw, { errors: "all" }).pipe(Effect.mapError(decodeProblem(file)));
    const password = yield* readSecret(clickhouse.password, [
      "clickhouse",
      "password",
    ]).pipe(
      Effect.mapError((problems) => new ConfigInvalid({ file, problems })),
    );
    return clickHouseOf(clickhouse, password);
  },
);

/**
 * Reads a configuration file's text: decodes it, checks the rules between its
 * parts, and reads every secret it names, reporting every problem at once.
 * The hub store's path, the archive directory and the dashboard's directory
 * are read against the directory of `file`.
 */
export const parse = Effect.fn("HubConfig.parse")(function* (
  file: string,
  text: string,
): Effect.fn.Return<HubConfig, ConfigInvalid> {
  const raw = yield* parseToml(file, text);
  const decoded = yield* Schema.decodeUnknownEffect(File)(raw, {
    errors: "all",
    onExcessProperty: "error",
  }).pipe(Effect.mapError(decodeProblem(file)));

  const problems: Array<string> = [
    ...hubKeyProblems(decoded.hub_keys),
    ...Object.entries(decoded.pools).flatMap(([id, pool]) =>
      poolProblems(id, pool, decoded.pools),
    ),
  ].map(({ path, issue }) => formatted(path, issue));
  const secret = (source: SecretSource, path: ReadonlyArray<PropertyKey>) =>
    readSecret(source, path).pipe(
      Effect.result,
      Effect.map(
        Result.match({
          onSuccess: Option.some,
          onFailure: (problem) => {
            problems.push(problem);
            return Option.none<Redacted.Redacted<string>>();
          },
        }),
      ),
    );

  const password = yield* secret(decoded.clickhouse.password, [
    "clickhouse",
    "password",
  ]);
  const ownerPassword =
    decoded.sign_in === undefined
      ? Option.none()
      : yield* secret(decoded.sign_in.password, ["sign_in", "password"]);
  const hubKeys: Array<HubKeyConfig> = [];
  for (const [index, entry] of decoded.hub_keys.entries()) {
    const value = yield* secret(entry.secret, ["hub_keys", index, "secret"]);
    if (Option.isNone(value)) continue;
    const digest = Sha256HubKeyHasher.digestOf(Redacted.value(value.value));
    const twin = hubKeys.find((other) => other.digest === digest);
    if (twin !== undefined) {
      problems.push(
        formatted(
          ["hub_keys", index, "secret"],
          `the same secret as hub key "${twin.name}"; every hub key needs its own`,
        ),
      );
    }
    hubKeys.push({ name: entry.name, scope: entry.scope, digest });
  }

  const pools = yield* poolsOf(decoded.pools, secret);

  if (problems.length > 0 || Option.isNone(password)) {
    return yield* new ConfigInvalid({ file, problems: problems.join("\n") });
  }
  return {
    hub: decoded.hub,
    limits: limitsOf(decoded.relay),
    sql: sqlLimitsOf(decoded.sql),
    clickhouse: clickHouseOf(decoded.clickhouse, password.value),
    store: {
      path: resolve(dirname(file), decoded.store?.path ?? "cota.sqlite"),
    },
    archive: Option.map(Option.fromUndefinedOr(decoded.archive), (archive) => ({
      directory: resolve(dirname(file), archive.directory),
    })),
    dashboard: {
      directory:
        decoded.dashboard?.directory === undefined
          ? builtDashboard
          : resolve(dirname(file), decoded.dashboard.directory),
    },
    signIn: { password: ownerPassword },
    hubKeys,
    pools: HashMap.fromIterable(pools),
  };
});

/** What an import reads of the hub's configuration: its request log, its store, and its pools without their secrets. */
export interface ImportConfig {
  readonly clickhouse: ClickHouseConfig;
  readonly store: { readonly path: string };
  readonly pools: HashMap.HashMap<PoolId, Pool>;
}

/**
 * Reads `[clickhouse]` and its password, `[store] path` and the pools'
 * ids, protocols, providers and prices of a configuration, and no other
 * secret: a pool's key and kept login are left unread.
 */
export const parseImport = Effect.fn("HubConfig.parseImport")(function* (
  file: string,
  text: string,
): Effect.fn.Return<ImportConfig, ConfigInvalid> {
  const raw = yield* parseToml(file, text);
  const decoded = yield* Schema.decodeUnknownEffect(
    Schema.Struct({
      clickhouse: ClickHouseEntry,
      store: File.fields.store,
      pools: File.fields.pools,
    }),
  )(raw, { errors: "all" }).pipe(Effect.mapError(decodeProblem(file)));
  const password = yield* readSecret(decoded.clickhouse.password, [
    "clickhouse",
    "password",
  ]).pipe(Effect.mapError((problems) => new ConfigInvalid({ file, problems })));
  const pools = yield* poolsOf(decoded.pools, () =>
    Effect.succeed(Option.none<Redacted.Redacted<string>>()),
  );
  return {
    clickhouse: clickHouseOf(decoded.clickhouse, password),
    store: {
      path: resolve(dirname(file), decoded.store?.path ?? "cota.sqlite"),
    },
    pools: HashMap.fromIterable(pools),
  };
});

const DatabaseName = Schema.String.check(
  Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_]*$/, {
    message: "a ClickHouse database name: letters, digits and underscores",
  }),
);

const ImportFileEntry = Schema.Struct({
  source: Schema.Struct({
    clickhouse: Schema.Struct({
      url: HttpUrl,
      user: Schema.NonEmptyString,
      password: SecretSource,
      bifrost_database: Schema.optionalKey(DatabaseName),
      hub_database: Schema.optionalKey(DatabaseName),
    }),
    files: Schema.optionalKey(
      Schema.Struct({
        titles: Schema.optionalKey(Schema.NonEmptyString),
        names: Schema.optionalKey(Schema.NonEmptyString),
      }),
    ),
  }),
  pools: Schema.Record(Schema.String, PoolId),
  machines: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});

/** An import file (`docs/specs/import/spec.md`, The command), its source's password read and its files' paths read against its directory. */
export interface ImportFile {
  readonly source: {
    readonly url: string;
    readonly user: string;
    readonly password: Redacted.Redacted<string>;
    readonly bifrostDatabase: string;
    readonly hubDatabase: string;
  };
  readonly titles: Option.Option<string>;
  readonly names: Option.Option<string>;
  readonly pools: ReadonlyMap<string, PoolId>;
  readonly machines: ReadonlyMap<string, string>;
}

export const parseImportFile = Effect.fn("HubConfig.parseImportFile")(
  function* (
    file: string,
    text: string,
  ): Effect.fn.Return<ImportFile, ConfigInvalid> {
    const raw = yield* parseToml(file, text);
    const decoded = yield* Schema.decodeUnknownEffect(ImportFileEntry)(raw, {
      errors: "all",
      onExcessProperty: "error",
    }).pipe(Effect.mapError(decodeProblem(file)));
    const { clickhouse, files } = decoded.source;
    const password = yield* readSecret(clickhouse.password, [
      "source",
      "clickhouse",
      "password",
    ]).pipe(
      Effect.mapError((problems) => new ConfigInvalid({ file, problems })),
    );
    const pathOf = (path: string | undefined) =>
      Option.map(Option.fromUndefinedOr(path), (given) =>
        resolve(dirname(file), given),
      );
    return {
      source: {
        url: withoutTrailingSlash(clickhouse.url),
        user: clickhouse.user,
        password,
        bifrostDatabase: clickhouse.bifrost_database ?? "bifrost",
        hubDatabase: clickhouse.hub_database ?? "hub",
      },
      titles: pathOf(files?.titles),
      names: pathOf(files?.names),
      pools: new Map(Object.entries(decoded.pools)),
      machines: new Map(Object.entries(decoded.machines ?? {})),
    };
  },
);

export const admissionPolicy = (config: HubConfig): Admission.Policy => ({
  hubKeys: HashMap.fromIterable(
    config.hubKeys.map(({ digest, name, scope }) => [digest, { name, scope }]),
  ),
  pools: HashMap.map(config.pools, ({ kind }) => kind),
});

export const fallbackPolicy = (config: HubConfig): Fallback.Policy =>
  HashMap.filterMap(config.pools, (pool) =>
    pool.kind === "subscription" && Option.isSome(pool.fallback)
      ? Result.succeed(pool.fallback.value)
      : Result.failVoid,
  );
