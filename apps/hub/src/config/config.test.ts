import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import {
  ConfigProvider,
  Duration,
  Effect,
  HashMap,
  Option,
  Redacted,
} from "effect";
import * as Sha256HubKeyHasher from "#modules/admission/04-infrastructure/sha256-hub-key-hasher.ts";
import type { Limits } from "#modules/relay/03-domain/limits.ts";
import type * as Sql from "#modules/request-log/03-domain/sql.ts";
import { PoolId } from "#shared/03-domain/ids.ts";
import * as HubConfig from "./config.ts";

const secrets = mkdtempSync(join(tmpdir(), "cota-config-"));
const fleetSecret = join(secrets, "cota-fleet");
writeFileSync(fleetSecret, "fleet-key-from-file\n");
const emptySecret = join(secrets, "empty");
writeFileSync(emptySecret, "\n");

const environment = {
  COTA_CLICKHOUSE_PASSWORD: "clickhouse-password",
  COTA_HUB_KEY_SUBSCRIPTION: "subscription-hub-key",
  COTA_HUB_KEY_AGENTS: "reader-hub-key",
  COTA_PERSONAL_LOGIN: "personal-kept-login",
  ZAI_API_KEY: "zai-held-key",
  COTA_OWNER_PASSWORD: "owner-password",
};

const example = `
[hub]
host = "127.0.0.1"
port = 8080

[clickhouse]
url = "http://127.0.0.1:8123/"
database = "cota"
user = "cota"
password = { env = "COTA_CLICKHOUSE_PASSWORD" }

[sign_in]
password = { env = "COTA_OWNER_PASSWORD" }

[[hub_keys]]
name = "clients"
scope = "subscription"
secret = { env = "COTA_HUB_KEY_SUBSCRIPTION" }

[[hub_keys]]
name = "fleet"
scope = "keyed"
secret = { file = "${fleetSecret}" }

[[hub_keys]]
name = "agents"
scope = "reader"
secret = { env = "COTA_HUB_KEY_AGENTS" }

[pools.personal]
protocol = "anthropic-messages"
kept_login = { env = "COTA_PERSONAL_LOGIN" }

[pools.work]
protocol = "anthropic-messages"
fallback = "personal"

[pools.chatgpt]
protocol = "chatgpt-codex"

[pools.zai]
protocol = "openai-chat"
provider = "zai"
base_url = "https://api.z.ai/api/coding/paas/v4/"
key = { env = "ZAI_API_KEY" }
prices = "zai"

[pools.local]
protocol = "openai-chat"
provider = "llama-swap"
base_url = "http://127.0.0.1:1234/v1"
`;

const minimal = (rest: string) => `
hub_keys = []

[hub]
host = "127.0.0.1"
port = 8080

[clickhouse]
url = "http://127.0.0.1:8123"
database = "cota"
user = "cota"
password = { env = "COTA_CLICKHOUSE_PASSWORD" }

${rest}
`;

const parse = (
  text: string,
  env: Record<string, string> = environment,
  file = "cota.toml",
) =>
  HubConfig.parse(file, text).pipe(
    Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord(env))),
  );

const problemsOf = (text: string, env?: Record<string, string>) =>
  parse(text, env).pipe(
    Effect.flip,
    Effect.map((error) => error.problems),
  );

const examples = join(import.meta.dirname, "../../../../examples");

const plainSql = (limits: Sql.Limits) => ({
  ...limits,
  queryTime: Duration.toMillis(limits.queryTime),
});

const sqlDefaults = {
  queryTime: 30_000,
  memoryBytes: 4_000_000_000,
  threads: 4,
  concurrentQueries: 4,
  rows: 5000,
  rowBytes: 16 * 1024 * 1024,
};

describe("parse", () => {
  it.effect("reads every configuration in examples/", () =>
    Effect.gen(function* () {
      const pools: Record<string, ReadonlyArray<string>> = {};
      const stores: Record<string, string> = {};
      const archives: Record<string, Option.Option<string>> = {};
      const dashboards: Record<string, string> = {};
      const sql: Record<string, ReturnType<typeof plainSql>> = {};
      for (const name of readdirSync(examples)) {
        const text = readFileSync(join(examples, name), "utf8");
        const env = Object.fromEntries(
          Array.from(text.matchAll(/env = "([A-Z_]+)"/g), ([, variable]) => [
            variable,
            `${variable}-value`,
          ]),
        );
        const config = yield* parse(text, env, join(examples, name));
        pools[name] = Array.from(HashMap.keys(config.pools)).sort();
        stores[name] = config.store.path;
        archives[name] = Option.map(
          config.archive,
          ({ directory }) => directory,
        );
        dashboards[name] = config.dashboard.directory;
        sql[name] = plainSql(config.sql);
      }
      expect(pools).toEqual({
        "cota.dev.toml": ["claude", "codex", "local"],
        "cota.example.toml": [
          "anthropic",
          "chatgpt",
          "local",
          "opencode-go",
          "openrouter",
          "personal",
          "work",
          "zai",
        ],
      });
      expect(stores).toEqual({
        "cota.dev.toml": join(examples, "..", "cota.dev.sqlite"),
        "cota.example.toml": join(examples, "cota.sqlite"),
      });
      expect(archives).toEqual({
        "cota.dev.toml": Option.none(),
        "cota.example.toml": Option.some(join(examples, "archive")),
      });
      expect(dashboards).toEqual({
        "cota.dev.toml": join(examples, "..", "apps", "web", "dist"),
        "cota.example.toml": "/srv/cota/dashboard",
      });
      expect(sql).toEqual({
        "cota.dev.toml": sqlDefaults,
        "cota.example.toml": sqlDefaults,
      });
    }),
  );

  it.effect(
    "reads the hub store's path against the configuration's directory, cota.sqlite by default",
    () =>
      Effect.gen(function* () {
        const paths = [];
        for (const [file, store] of [
          ["/etc/cota/cota.toml", ""],
          ["/etc/cota/cota.toml", '[store]\npath = "state/hub.sqlite"'],
          ["/etc/cota/cota.toml", '[store]\npath = "/var/lib/cota/hub.sqlite"'],
          ["cota.toml", ""],
        ] as const) {
          paths.push(
            (yield* parse(
              minimal(`${store}\n[pools.codex]\nprotocol = "chatgpt-codex"`),
              environment,
              file,
            )).store.path,
          );
        }
        expect(paths).toEqual([
          "/etc/cota/cota.sqlite",
          "/etc/cota/state/hub.sqlite",
          "/var/lib/cota/hub.sqlite",
          join(process.cwd(), "cota.sqlite"),
        ]);
      }),
  );

  it.effect(
    "reads the archive directory against the configuration's directory, and has none without [archive]",
    () =>
      Effect.gen(function* () {
        const directories = [];
        for (const [file, archive] of [
          ["/etc/cota/cota.toml", '[archive]\ndirectory = "archive"'],
          [
            "/etc/cota/cota.toml",
            '[archive]\ndirectory = "/var/lib/cota/archive"',
          ],
          ["/etc/cota/cota.toml", ""],
        ] as const) {
          directories.push(
            Option.map(
              (yield* parse(
                minimal(
                  `${archive}\n[pools.codex]\nprotocol = "chatgpt-codex"`,
                ),
                environment,
                file,
              )).archive,
              ({ directory }) => directory,
            ),
          );
        }
        expect(directories).toEqual([
          Option.some("/etc/cota/archive"),
          Option.some("/var/lib/cota/archive"),
          Option.none(),
        ]);
      }),
  );

  it.effect(
    "reads the dashboard's directory against the configuration's directory, the repository's apps/web/dist by default",
    () =>
      Effect.gen(function* () {
        const directories = [];
        for (const dashboard of [
          '[dashboard]\ndirectory = "web"',
          '[dashboard]\ndirectory = "/srv/cota/dashboard"',
          "[dashboard]",
          "",
        ]) {
          directories.push(
            (yield* parse(
              minimal(
                `${dashboard}\n[pools.codex]\nprotocol = "chatgpt-codex"`,
              ),
              environment,
              "/etc/cota/cota.toml",
            )).dashboard.directory,
          );
        }
        expect(directories).toEqual([
          "/etc/cota/web",
          "/srv/cota/dashboard",
          join(examples, "..", "apps", "web", "dist"),
          join(examples, "..", "apps", "web", "dist"),
        ]);
      }),
  );

  it.effect("needs a directory in [archive]", () =>
    Effect.gen(function* () {
      expect(
        yield* problemsOf(
          minimal('[archive]\n\n[pools.codex]\nprotocol = "chatgpt-codex"'),
        ),
      ).toContain('["archive"]["directory"]');
    }),
  );

  it.effect(
    "reads the example configuration, with each pool's kind, provider, base URL and prices",
    () =>
      Effect.gen(function* () {
        const config = yield* parse(example);
        const pool = (id: string) =>
          Option.getOrThrow(
            HashMap.findFirst(config.pools, (_, key) => key === id),
          )[1];
        expect(
          [pool("personal"), pool("work"), pool("chatgpt")].map(
            ({ kind, protocol, provider, prices }) => [
              kind,
              protocol,
              provider,
              prices,
            ],
          ),
        ).toEqual([
          [
            "subscription",
            "anthropic-messages",
            "anthropic",
            Option.some("anthropic"),
          ],
          [
            "subscription",
            "anthropic-messages",
            "anthropic",
            Option.some("anthropic"),
          ],
          ["subscription", "chatgpt-codex", "chatgpt", Option.some("openai")],
        ]);
        const zai = pool("zai");
        const local = pool("local");
        expect(
          [zai, local].map((each) =>
            each.kind === "keyed"
              ? [
                  each.provider,
                  each.baseUrl,
                  Option.map(each.key, Redacted.value),
                  each.prices,
                ]
              : [],
          ),
        ).toEqual([
          [
            "zai",
            "https://api.z.ai/api/coding/paas/v4",
            Option.some("zai-held-key"),
            Option.some("zai"),
          ],
          [
            "llama-swap",
            "http://127.0.0.1:1234/v1",
            Option.none(),
            Option.none(),
          ],
        ]);
        const work = pool("work");
        const chatgpt = pool("chatgpt");
        expect([
          work.kind === "subscription" ? [work.fallback, work.baseUrl] : [],
          chatgpt.baseUrl,
        ]).toEqual([
          [Option.some("personal"), "https://api.anthropic.com"],
          "https://chatgpt.com/backend-api/codex",
        ]);
        expect(config.clickhouse.url).toBe("http://127.0.0.1:8123");
        expect(Redacted.value(config.clickhouse.password)).toBe(
          "clickhouse-password",
        );
      }),
  );

  it.effect(
    "reads an anthropic-messages pool that holds a key as a keyed pool, with Anthropic's defaults or the owner's own",
    () =>
      Effect.gen(function* () {
        const config = yield* parse(
          minimal(`
[pools.console]
protocol = "anthropic-messages"
key = { env = "ANTHROPIC_KEY" }

[pools.router]
protocol = "anthropic-messages"
provider = "openrouter"
base_url = "https://openrouter.example/api/"
key = { env = "ROUTER_KEY" }
prices = "zai"

[pools.router.model_prices."glm-5.2"]
input = 1
output = 2
`),
          {
            ...environment,
            ANTHROPIC_KEY: "anthropic-held-key",
            ROUTER_KEY: "router-held-key",
          },
        );
        const keyed = ["console", "router"].map((id) => {
          const pool = Option.getOrThrow(
            HashMap.get(config.pools, PoolId.make(id)),
          );
          return pool.kind === "keyed"
            ? [
                pool.protocol,
                pool.provider,
                pool.baseUrl,
                Option.map(pool.key, Redacted.value),
                pool.prices,
                Object.keys(pool.ownPrices),
              ]
            : [pool.kind];
        });
        expect(keyed).toEqual([
          [
            "anthropic-messages",
            "anthropic",
            "https://api.anthropic.com",
            Option.some("anthropic-held-key"),
            Option.some("anthropic"),
            [],
          ],
          [
            "anthropic-messages",
            "openrouter",
            "https://openrouter.example/api",
            Option.some("router-held-key"),
            Option.some("zai"),
            ["glm-5.2"],
          ],
        ]);
        const policy = HubConfig.admissionPolicy(config);
        expect(
          ["console", "router"].map((id) =>
            HashMap.get(policy.pools, PoolId.make(id)),
          ),
        ).toEqual([Option.some("keyed"), Option.some("keyed")]);
      }),
  );

  it.effect(
    "takes the relay's limits from the spec's defaults, or from [relay]",
    () =>
      Effect.gen(function* () {
        const defaults = yield* parse(example);
        const set = yield* parse(`${example}
[relay]
max_body_mib = 1
max_decoded_body_mib = 2
max_read_answer_mib = 3
first_byte_timeout = "30 seconds"
copy_capacity = 16
`);
        const plain = ({
          maxBodyBytes,
          maxDecodedBodyBytes,
          maxReadAnswerBytes,
          firstByteTimeout,
          copyCapacity,
        }: Limits) => [
          maxBodyBytes,
          maxDecodedBodyBytes,
          maxReadAnswerBytes,
          Duration.toMillis(firstByteTimeout),
          copyCapacity,
        ];
        const mebibyte = 1024 * 1024;
        expect([plain(defaults.limits), plain(set.limits)]).toEqual([
          [128 * mebibyte, 256 * mebibyte, 16 * mebibyte, 600_000, 256],
          [mebibyte, 2 * mebibyte, 3 * mebibyte, 30_000, 16],
        ]);
      }),
  );

  it.effect(
    "takes the SQL console's limits from the spec's defaults, or from [sql]",
    () =>
      Effect.gen(function* () {
        const defaults = yield* parse(example);
        const set = yield* parse(`${example}
[sql]
max_query_time = "2 minutes"
max_memory_bytes = 8_000_000_000
max_threads = 8
max_concurrent_queries = 2
max_answer_rows = 100000
max_answer_mib = 64
`);
        expect([plainSql(defaults.sql), plainSql(set.sql)]).toEqual([
          sqlDefaults,
          {
            queryTime: 120_000,
            memoryBytes: 8_000_000_000,
            threads: 8,
            concurrentQueries: 2,
            rows: 100_000,
            rowBytes: 64 * 1024 * 1024,
          },
        ]);
      }),
  );

  it.effect(
    "reports a [sql] limit outside its bounds, each with its path",
    () =>
      Effect.gen(function* () {
        const below = yield* problemsOf(`${example}
[sql]
max_query_time = "1500 millis"
max_memory_bytes = 99_999_999
max_threads = 0
max_concurrent_queries = 0
max_answer_rows = 0
max_answer_mib = 0
`);
        const above = yield* problemsOf(`${example}
[sql]
max_query_time = "601 seconds"
max_threads = 257
max_concurrent_queries = 65
max_answer_rows = 1_000_001
max_answer_mib = 257
`);
        for (const problems of [below, above]) {
          for (const key of [
            "max_query_time",
            "max_threads",
            "max_concurrent_queries",
            "max_answer_rows",
            "max_answer_mib",
          ]) {
            expect(problems).toContain(`["sql"]["${key}"]`);
          }
        }
        expect(below).toContain(`["sql"]["max_memory_bytes"]`);
        expect(below).toContain(
          "a whole number of seconds, from 1 second to 10 minutes",
        );
      }),
  );

  it.effect(
    "gives Admission each hub key, of any of the three scopes, by the SHA-256 of its secret, and each pool's kind",
    () =>
      Effect.gen(function* () {
        const policy = HubConfig.admissionPolicy(yield* parse(example));
        expect([
          HashMap.get(
            policy.hubKeys,
            Sha256HubKeyHasher.digestOf("subscription-hub-key"),
          ),
          HashMap.get(
            policy.hubKeys,
            Sha256HubKeyHasher.digestOf("fleet-key-from-file"),
          ),
          HashMap.get(
            policy.hubKeys,
            Sha256HubKeyHasher.digestOf("reader-hub-key"),
          ),
          HashMap.size(policy.hubKeys),
        ]).toEqual([
          Option.some({ name: "clients", scope: "subscription" }),
          Option.some({ name: "fleet", scope: "keyed" }),
          Option.some({ name: "agents", scope: "reader" }),
          3,
        ]);
        expect(Sha256HubKeyHasher.digestOf("abc")).toBe(
          "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        );
        expect(
          ["personal", "work", "chatgpt", "zai", "local", "nowhere"].map((id) =>
            HashMap.get(policy.pools, PoolId.make(id)),
          ),
        ).toEqual([
          Option.some("subscription"),
          Option.some("subscription"),
          Option.some("subscription"),
          Option.some("keyed"),
          Option.some("keyed"),
          Option.none(),
        ]);
      }),
  );

  it.effect(
    "gives Fallback each pool's fallback pool, and nothing for the others",
    () =>
      Effect.gen(function* () {
        const policy = HubConfig.fallbackPolicy(yield* parse(example));
        expect([...HashMap.toEntries(policy)]).toEqual([["work", "personal"]]);
      }),
  );

  it.effect(
    "reads the owner password as a secret by reference, and none without [sign_in]",
    () =>
      Effect.gen(function* () {
        const withPassword = yield* parse(example);
        const without = yield* parse(
          minimal('[pools.codex]\nprotocol = "chatgpt-codex"'),
        );
        expect([
          Option.map(withPassword.signIn.password, Redacted.value),
          without.signIn.password,
          yield* problemsOf(
            minimal(
              `[sign_in]\npassword = { file = "${emptySecret}" }\n[pools.codex]\nprotocol = "chatgpt-codex"`,
            ),
          ),
        ]).toEqual([
          Option.some("owner-password"),
          Option.none(),
          expect.stringContaining('["sign_in"]["password"]'),
        ]);
      }),
  );

  it.effect("never prints a secret", () =>
    Effect.gen(function* () {
      const config = yield* parse(example);
      const printed = [
        JSON.stringify(config),
        String(config.clickhouse.password),
        Bun.inspect(config),
      ].join("\n");
      for (const secret of [
        ...Object.values(environment),
        "fleet-key-from-file",
      ]) {
        expect(printed).not.toContain(secret);
      }
    }),
  );

  it.effect(
    "reports every problem a Schema finds, each with its path, in one error",
    () =>
      Effect.gen(function* () {
        const problems = yield* problemsOf(`
[hub]
host = "127.0.0.1"
port = "eighty"

[relay]
first_byte_timeout = "soon"

[clickhouse]
url = "ftp://127.0.0.1"
database = "cota"
user = "cota"
password = { vault = "x" }

[[hub_keys]]
name = "clients"
scope = "everything"
secret = { env = "A" }

[store]
path = ""
size = 1

[pools.zai]
protocol = "openai-compatible"
base_ur1 = "https://api.z.ai"
`);
        for (const path of [
          '["hub"]["port"]',
          '["relay"]["first_byte_timeout"]',
          '["clickhouse"]["url"]',
          '["clickhouse"]["password"]',
          '["hub_keys"][0]["scope"]',
          '["store"]["path"]',
          '["store"]["size"]',
          '["pools"]["zai"]["protocol"]',
          '["pools"]["zai"]["base_ur1"]',
        ]) {
          expect(problems).toContain(path);
        }
      }),
  );

  it.effect(
    "reports every rule between pools and hub keys, and every secret it cannot read, at once, each with its path",
    () =>
      Effect.gen(function* () {
        const problems = yield* problemsOf(`
[hub]
host = "127.0.0.1"
port = 8080

[clickhouse]
url = "http://127.0.0.1:8123"
database = "cota"
user = "cota"
password = { env = "COTA_CLICKHOUSE_PASSWORD" }

[[hub_keys]]
name = "clients"
scope = "subscription"
secret = { env = "A" }

[[hub_keys]]
name = "clients"
scope = "keyed"
secret = { env = "B" }

[pools."two/segments"]
protocol = "openai-chat"
base_url = "http://127.0.0.1:1234/v1"

[pools.nourl]
protocol = "openai-chat"
kept_login = { env = "L" }
fallback = "personal"

[pools.codexkey]
protocol = "chatgpt-codex"
key = { env = "K" }

[pools.keyedlogin]
protocol = "anthropic-messages"
key = { env = "K" }
kept_login = { env = "L" }
fallback = "personal"

[pools.tokeyed]
protocol = "anthropic-messages"
fallback = "keyedlogin"

[pools.self]
protocol = "anthropic-messages"
fallback = "self"

[pools.missing]
protocol = "anthropic-messages"
fallback = "nowhere"

[pools.cross]
protocol = "anthropic-messages"
fallback = "chatgpt"

[pools.chatgpt]
protocol = "chatgpt-codex"
kept_login = { env = "L" }
fallback = "other"

[pools.other]
protocol = "chatgpt-codex"
kept_login = { env = "L" }

[pools.loginless]
protocol = "anthropic-messages"
fallback = "personal"

[pools.personal]
protocol = "anthropic-messages"
`);
        expect(problems.split("\n")).toEqual([
          'another hub key is already named "clients"',
          '  at ["hub_keys"][1]["name"]',
          "a pool id is one path segment: letters, digits, '.', '_', '~' and '-', starting with a letter or digit",
          '  at ["pools"]["two/segments"]',
          "a pool that speaks openai-chat needs a base_url",
          '  at ["pools"]["nourl"]["base_url"]',
          "only a subscription pool has a kept login",
          '  at ["pools"]["nourl"]["kept_login"]',
          "only a subscription pool has a fallback pool",
          '  at ["pools"]["nourl"]["fallback"]',
          "a pool that speaks chatgpt-codex cannot hold a key; only anthropic-messages and openai-chat pools can",
          '  at ["pools"]["codexkey"]["key"]',
          "only a subscription pool has a kept login",
          '  at ["pools"]["keyedlogin"]["kept_login"]',
          "only a subscription pool has a fallback pool",
          '  at ["pools"]["keyedlogin"]["fallback"]',
          'the fallback pool "keyedlogin" holds a key; a fallback pool is a subscription pool',
          '  at ["pools"]["tokeyed"]["fallback"]',
          "a pool cannot be its own fallback pool",
          '  at ["pools"]["self"]["fallback"]',
          'there is no pool "nowhere"',
          '  at ["pools"]["missing"]["fallback"]',
          'the fallback pool "chatgpt" speaks chatgpt-codex, not anthropic-messages',
          '  at ["pools"]["cross"]["fallback"]',
          "a pool that speaks chatgpt-codex cannot have a fallback pool yet; only anthropic-messages pools can",
          '  at ["pools"]["chatgpt"]["fallback"]',
          'the fallback pool "personal" has no kept_login',
          '  at ["pools"]["loginless"]["fallback"]',
          "the environment variable A is not set",
          '  at ["hub_keys"][0]["secret"]',
          "the environment variable B is not set",
          '  at ["hub_keys"][1]["secret"]',
          "the environment variable K is not set",
          '  at ["pools"]["keyedlogin"]["key"]',
          "the environment variable L is not set",
          '  at ["pools"]["chatgpt"]["kept_login"]',
          "the environment variable L is not set",
          '  at ["pools"]["other"]["kept_login"]',
        ]);
      }),
  );

  it.effect(
    "reports every secret it cannot read, and hub keys that share a secret, at once",
    () =>
      Effect.gen(function* () {
        const problems = yield* problemsOf(
          minimal(`
[[hub_keys]]
name = "laptop"
scope = "subscription"
secret = { env = "SAME" }

[[hub_keys]]
name = "desk"
scope = "keyed"
secret = { env = "SAME" }

[[hub_keys]]
name = "ci"
scope = "keyed"
secret = { file = "${emptySecret}" }

[pools.zai]
protocol = "openai-chat"
base_url = "https://api.z.ai/api/coding/paas/v4"
key = { file = "${join(secrets, "absent")}" }

[pools.personal]
protocol = "anthropic-messages"
kept_login = { env = "UNSET" }
`).replace("hub_keys = []\n", ""),
          { SAME: "shared-secret" },
        );
        expect(problems.split("\n")).toEqual([
          "the environment variable COTA_CLICKHOUSE_PASSWORD is not set",
          '  at ["clickhouse"]["password"]',
          'the same secret as hub key "laptop"; every hub key needs its own',
          '  at ["hub_keys"][1]["secret"]',
          `the file ${emptySecret} is empty`,
          '  at ["hub_keys"][2]["secret"]',
          `the file ${join(secrets, "absent")} cannot be read`,
          '  at ["pools"]["zai"]["key"]',
          "the environment variable UNSET is not set",
          '  at ["pools"]["personal"]["kept_login"]',
        ]);
        expect(problems).not.toContain("shared-secret");
      }),
  );

  it.effect(
    "reads a pool's own prices for its models, in dollars per million tokens, as exact rates",
    () =>
      Effect.gen(function* () {
        const config = yield* parse(
          minimal(`
[pools.local]
protocol = "openai-chat"
base_url = "http://127.0.0.1:1234/v1"

[pools.local.model_prices."qwen3-coder"]
input = 0.2
output = 0.8
cache_read = 0.02
tiers = [{ over = 200000, input = 0.4, output = 1.6, cache_write_long = 0.000001 }]
`),
        );
        const local = Option.getOrThrow(
          HashMap.get(config.pools, PoolId.make("local")),
        );
        expect([local.prices, local.ownPrices]).toEqual([
          Option.none(),
          {
            "qwen3-coder": {
              base: { input: 200000n, output: 800000n, cacheRead: 20000n },
              tiers: [
                {
                  threshold: 200000,
                  rates: {
                    input: 400000n,
                    output: 1600000n,
                    cacheWriteLong: 1n,
                  },
                },
              ],
            },
          },
        ]);
      }),
  );

  it.effect(
    "reports a price list the hub does not ship, a price finer than a picodollar, and tiers that do not rise",
    () =>
      Effect.gen(function* () {
        const problems = yield* problemsOf(
          minimal(`
[pools.local]
protocol = "openai-chat"
base_url = "http://127.0.0.1:1234/v1"
prices = "nowhere"

[pools.local.model_prices.cheap]
input = 0.0000001
output = -1

[pools.local.model_prices.tiered]
input = 1
output = 2
tiers = [{ over = 200, input = 2, output = 3 }, { over = 100, input = 3, output = 4 }]
`),
        );
        expect(problems).toContain(
          "dollars per million tokens: zero or more, to at most six decimal places",
        );
        expect(problems).toContain(
          '["pools"]["local"]["model_prices"]["cheap"]["input"]',
        );
        expect(problems).toContain(
          '["pools"]["local"]["model_prices"]["cheap"]["output"]',
        );
        const rules = yield* problemsOf(
          minimal(`
[pools.local]
protocol = "openai-chat"
base_url = "http://127.0.0.1:1234/v1"
prices = "nowhere"

[pools.local.model_prices.tiered]
input = 1
output = 2
tiers = [{ over = 200, input = 2, output = 3 }, { over = 100, input = 3, output = 4 }]
`),
        );
        expect(rules.split("\n")).toEqual([
          'there is no price list "nowhere"; the hub ships anthropic, openai, opencode-go, zai',
          '  at ["pools"]["local"]["prices"]',
          "tiers are listed with rising thresholds",
          '  at ["pools"]["local"]["model_prices"]["tiered"]["tiers"][1]["over"]',
        ]);
      }),
  );

  it.effect("reports a TOML syntax error with the file's name", () =>
    Effect.gen(function* () {
      const error = yield* parse("port = \n").pipe(Effect.flip);
      expect(error.message).toMatch(
        /^cota\.toml is not a valid configuration:\n.*TOML/,
      );
    }),
  );
});
