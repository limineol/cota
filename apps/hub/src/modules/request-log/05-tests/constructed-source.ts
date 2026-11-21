import { BunHttpClient } from "@effect/platform-bun";
import { Context, Effect, Layer, Redacted } from "effect";
import type * as Import from "#modules/request-log/03-domain/import.ts";
import * as ClickHouse from "#modules/request-log/04-infrastructure/persistence/clickhouse/client.ts";
import { PoolId } from "#shared/03-domain/ids.ts";
import { connectionTo, server } from "./scratch.ts";

/**
 * A constructed import source (`docs/specs/import/spec.md`, Laws): scratch
 * databases of the prototype's shapes, `logs` of the types its columns check
 * names and `messages` and `request_items` as `hub.sql` makes them, filled
 * with synthetic rows of three UTC days.
 */

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const ids = {
  r1: uuid(1),
  r2: uuid(2),
  r3: uuid(3),
  r4: uuid(4),
  r5: uuid(5),
  r6: uuid(6),
  r7: uuid(7),
  r8: uuid(8),
  r9: uuid(9),
  r10: uuid(10),
  r11: uuid(11),
  r12: uuid(12),
  r13: uuid(13),
  gone: uuid(99),
};

export const days = ["2026-10-27", "2026-10-28", "2026-10-29"] as const;

/** A hash past what a double holds exactly. */
export const bigHash = "18446744073709551557";

/** Each item's content by its hash: the responses form, the chat form, and tool definitions. */
export const contents: Readonly<Record<string, string>> = {
  "11": '{"type":"message","role":"user","content":[{"type":"input_text","text":"Fix the build"}]}',
  "12": '{"type":"reasoning","summary":[{"type":"summary_text","text":"Looking at the log"}]}',
  "13": '{"type":"function_call","name":"shell","arguments":"{\\"cmd\\":\\"bun test\\"}","call_id":"c1"}',
  "14": '{"type":"function_call_output","call_id":"c1","output":"3 failed"}',
  "15": '{"type":"additional_tools","tools":[{"type":"function","name":"read"}]}',
  "16": '{"type":"configuration_update","model":"gpt-5.5"}',
  "17": '{"type":"function","name":"shell","parameters":{"type":"object","properties":{"cmd":{"type":"string"}}}}',
  "18": '{"type":"message","role":"assistant","content":[{"type":"output_text","text":"On it 😀"}]}',
  "19": '{"type":"message","role":"user","content":"Seen first by a request the log lost"}',
  "20": '{"type":"message","role":"user","content":"Named by no request of the log"}',
  [bigHash]:
    '{"type":"message","role":"developer","content":[{"type":"input_text","text":"Be careful"}]}',
  "21": '{"role":"system","content":"Be brief"}',
  "22": '{"role":"user","content":"Hi"}',
  "23": '{"role":"assistant","content":"","tool_calls":[{"id":"t1","type":"function","function":{"name":"add","arguments":"{}"}}]}',
  "24": '{"role":"tool","tool_call_id":"t1","content":"42"}',
  "25": '{"type":"function","function":{"name":"add","parameters":{}}}',
  "31": '{"type":"message","role":"user","content":[{"type":"input_text","text":"Plan the release"}]}',
  "32": '{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Here is a plan"}]}',
  "33": '{"type":"message","role":"user","content":[{"type":"input_text","text":"Shorter"}]}',
};

interface Row {
  readonly id: string;
  readonly at: string;
  readonly session: string | null;
  readonly account?: string;
  readonly provider?: string;
  readonly fallback?: string;
  readonly objectType: string;
  readonly path?: string;
  readonly status?: string;
  readonly usage?: string;
  readonly prompt?: number;
  readonly read?: number;
  readonly completion?: number;
  readonly cost?: number | null;
  readonly latency?: number | null;
  readonly errorDetails?: string;
  readonly model?: string;
  readonly items?: {
    readonly input: ReadonlyArray<string>;
    readonly output: ReadonlyArray<string>;
    readonly tools: ReadonlyArray<string>;
  };
}

export const rows: ReadonlyArray<Row> = [
  {
    id: ids.r1,
    at: "2026-10-27 23:59:59.500",
    session: "sA",
    account: "codex-plus",
    objectType: "responses_stream",
    usage:
      '{"prompt_tokens":1200,"completion_tokens":50,"prompt_tokens_details":{"cached_tokens":200}}',
    prompt: 1200,
    read: 200,
    completion: 50,
    items: { tools: ["17"], input: ["11"], output: ["18", "12"] },
  },
  {
    id: ids.r2,
    at: "2026-10-28 00:00:01.000",
    session: "sA",
    account: "codex-plus",
    objectType: "responses_stream",
    items: { tools: ["17"], input: ["11", "18", "12"], output: ["13"] },
  },
  {
    id: ids.r3,
    at: "2026-10-28 10:00:00.000",
    session: "sA",
    account: "codex-plus",
    fallback: "claude-max",
    objectType: "responses_stream",
    status: "error",
    errorDetails:
      '{"status_code":429,"error":{"type":"rate_limit_error","message":"slow down"},"is_bifrost_error":false}',
    items: {
      tools: ["17"],
      input: ["11", "18", "12", "13", "14", "19"],
      output: [],
    },
  },
  {
    id: ids.r4,
    at: "2026-10-28 11:00:00.000",
    session: "sA",
    account: "codex-plus",
    objectType: "responses",
    status: "cancelled",
    errorDetails:
      '{"status_code":499,"error":{"type":"request_cancelled","message":"the client went away"}}',
    latency: null,
    items: {
      tools: ["17"],
      input: ["11", "18", "12", "13", "14", "19", "15", "16", bigHash],
      output: [],
    },
  },
  {
    id: ids.r5,
    at: "2026-10-28 12:00:00.000",
    session: "sB",
    provider: "zai",
    objectType: "chat_completion_stream",
    model: "glm-4.6",
    usage:
      '{"prompt_tokens":500,"completion_tokens":20,"prompt_tokens_details":{"cached_write_tokens":100}}',
    prompt: 500,
    completion: 20,
    items: { tools: ["25"], input: ["21", "22", "23", "24"], output: [] },
  },
  {
    id: ids.r6,
    at: "2026-10-28 13:00:00.000",
    session: null,
    account: "codex-plus",
    objectType: "passthrough",
    path: "/backend-api/codex/models",
    cost: null,
  },
  {
    id: ids.r7,
    at: "2026-10-28 13:01:00.000",
    session: null,
    account: "codex-plus",
    objectType: "passthrough",
    path: "/backend-api/codex/alpha/search",
  },
  {
    id: ids.r8,
    at: "2026-10-28 13:02:00.000",
    session: null,
    account: "codex-plus",
    objectType: "list_models",
  },
  {
    id: ids.r9,
    at: "2026-10-28 14:00:00.000",
    session: "sA",
    account: "codex-plus",
    provider: "anthropic",
    objectType: "count_tokens",
  },
  {
    id: ids.r10,
    at: "2026-10-28 15:00:00.000",
    session: null,
    account: "codex-plus",
    objectType: "image_generation",
  },
  {
    id: ids.r11,
    at: "2026-10-29 09:00:00.000",
    session: "sC",
    account: "claude-max",
    objectType: "responses_stream",
    model: "claude-opus-5-5",
    usage:
      '{"prompt_tokens":10000,"completion_tokens":400,"prompt_tokens_details":{"cached_tokens":2000,"cached_write_tokens":3000,"cached_write_token_details":{"cached_write_tokens_5m":1000,"cached_write_tokens_1h":2000}},"completion_tokens_details":{"reasoning_tokens":30}}',
    prompt: 10000,
    read: 2000,
    completion: 400,
    cost: 0.25,
    items: { tools: [], input: ["31"], output: ["32"] },
  },
  {
    id: ids.r12,
    at: "2026-10-29 09:05:00.000",
    session: "sC",
    account: "claude-max",
    objectType: "responses_stream",
    model: "claude-opus-5-5",
    usage: '{"prompt_tokens":100,"completion_tokens":5}',
    prompt: 100,
    read: 200,
    completion: 5,
    items: { tools: [], input: ["31", "32", "33"], output: [] },
  },
  {
    id: ids.r13,
    at: "2026-10-29 10:00:00.000",
    session: "sB",
    provider: "zai",
    objectType: "chat_completion",
    model: "glm-4.6",
  },
];

/** A `request_items` row whose request is not in the log: it first sends item 19 and the only copy of 20. */
export const orphan = {
  request_id: ids.gone,
  session_key: "sA",
  timestamp: "2026-10-28 01:00:00.000",
  input: ["11", "19", "20"],
  output: [] as ReadonlyArray<string>,
  tools: [] as ReadonlyArray<string>,
};

/** The pool map of the constructed source's pools. */
export const targets: Import.Targets = {
  pools: new Map([
    [
      "claude-max",
      {
        id: PoolId.make("claude"),
        provider: "anthropic",
        protocol: "anthropic-messages",
      },
    ],
    [
      "codex-plus",
      {
        id: PoolId.make("codex"),
        provider: "chatgpt",
        protocol: "chatgpt-codex",
      },
    ],
    [
      "zai",
      { id: PoolId.make("zai"), provider: "zai", protocol: "openai-chat" },
    ],
  ]),
  machines: new Map([["old-laptop", "laptop"]]),
};

export const sessionKeyOf = (row: Row) => row.session ?? `request:${row.id}`;

const logsRow = (row: Row) => ({
  id: row.id,
  timestamp: row.at,
  session_id: row.session,
  metadata: JSON.stringify({
    ...(row.account === undefined ? {} : { account: row.account }),
    host: "old-laptop",
    project: "cota",
    "user-agent": "codex_cli_rs/0.80.0 (Mac OS 26.1.0; arm64)",
    ...(row.fallback === undefined ? {} : { "fallback-from": row.fallback }),
  }),
  user_agent: "codex_cli_rs/0.80.0 (Mac OS 26.1.0; arm64)",
  provider: row.provider ?? "openai",
  model: row.model ?? "gpt-5.5",
  object_type: row.objectType,
  is_passthrough: row.objectType === "passthrough",
  params: JSON.stringify({
    ...(row.path === undefined ? {} : { method: "GET", path: row.path }),
    reasoning: { effort: "high" },
    tools: [{ type: "function", name: "shell" }],
  }),
  status: row.status ?? "success",
  stream: row.objectType.endsWith("_stream"),
  stop_reason: "stop",
  prompt_tokens: row.prompt ?? 0,
  completion_tokens: row.completion ?? 0,
  cached_read_tokens: row.read ?? 0,
  token_usage: row.usage ?? "",
  cost: row.cost === undefined ? 0.01 : row.cost,
  latency: row.latency === undefined ? 812.4 : row.latency,
  error_details: row.errorDetails ?? "",
  ver: row.at,
});

/** `hub.messages`: each item named by a row, first seen by the earliest; item 18's copy is its second request's, as when the first's row was written late. */
const messagesRows = () => {
  const named = [
    ...rows.flatMap((row) =>
      row.items === undefined
        ? []
        : [
            {
              request_id: row.id,
              session_key: sessionKeyOf(row),
              timestamp: row.at,
              ...row.items,
            },
          ],
    ),
    orphan,
  ];
  const firsts = new Map<string, Record<string, unknown>>();
  for (const row of named) {
    for (const [source, hashes] of [
      ["input", row.input],
      ["output", row.output],
      ["tool", row.tools],
    ] as const) {
      hashes.forEach((hash, index) => {
        const key = `${row.session_key}/${hash}`;
        const kept = firsts.get(key);
        const late = hash === "18" && row.request_id === ids.r1;
        if (late) return;
        if (kept !== undefined && String(kept.first_seen) <= row.timestamp) {
          return;
        }
        const content = contents[hash] ?? "";
        firsts.set(key, {
          session_key: row.session_key,
          hash,
          first_seen: row.timestamp,
          logged_at: row.timestamp,
          request_id: row.request_id,
          source,
          position: index + 1,
          type: "",
          role: "",
          content,
          text: "",
        });
      });
    }
  }
  return [...firsts.values()];
};

const requestItemsRows = () => [
  ...rows.flatMap((row) =>
    row.items === undefined
      ? []
      : [
          {
            request_id: row.id,
            session_key: sessionKeyOf(row),
            timestamp: row.at,
            logged_at: row.at,
            ...row.items,
          },
        ],
  ),
  { ...orphan, logged_at: orphan.timestamp },
];

export class Source extends Context.Service<
  Source,
  {
    readonly bifrost: string;
    readonly hub: string;
    readonly connection: {
      readonly url: string;
      readonly database: string;
      readonly user: string;
      readonly password: Redacted.Redacted<string>;
      readonly bifrostDatabase: string;
      readonly hubDatabase: string;
    };
    /** The server's own user, for a test that changes the source. */
    readonly admin: ClickHouse.Client;
  }
>()("@cota/hub/request-log/ConstructedSource") {}

const constructed = (profile: string) =>
  Effect.gen(function* () {
    const name = `cota_test_${Bun.randomUUIDv7("hex").replaceAll("-", "")}`;
    const bifrost = `${name}_bifrost`;
    const hub = `${name}_hub`;
    const reader = `${name}_reader`;
    const settings = `${name}_profile`;
    const password = Bun.randomUUIDv7("hex");
    const admin = yield* Layer.build(
      ClickHouse.layer(connectionTo("default")).pipe(
        Layer.provide(BunHttpClient.layer),
      ),
    ).pipe(
      Effect.map((context) => Context.get(context, ClickHouse.ClickHouse)),
    );
    yield* Effect.acquireRelease(
      Effect.all([
        admin.command(`CREATE DATABASE ${bifrost}`),
        admin.command(`CREATE DATABASE ${hub}`),
        admin.command(
          `CREATE SETTINGS PROFILE ${settings} SETTINGS readonly = 2${profile === "" ? "" : `, ${profile}`}`,
        ),
        admin.command(
          `CREATE USER ${reader} IDENTIFIED WITH plaintext_password BY '${password}' SETTINGS PROFILE ${settings}`,
        ),
      ]),
      () =>
        Effect.all([
          Effect.ignore(admin.command(`DROP USER IF EXISTS ${reader}`)),
          Effect.ignore(
            admin.command(`DROP SETTINGS PROFILE IF EXISTS ${settings}`),
          ),
          Effect.ignore(
            admin.command(`DROP DATABASE IF EXISTS ${bifrost} SYNC`),
          ),
          Effect.ignore(admin.command(`DROP DATABASE IF EXISTS ${hub} SYNC`)),
        ]),
    ).pipe(Effect.orDie);
    yield* Effect.all([
      admin.command(`CREATE TABLE ${bifrost}.logs (
          id UUID, timestamp DateTime64(3), session_id Nullable(String), metadata Nullable(String),
          user_agent Nullable(String), provider LowCardinality(String), model String,
          object_type LowCardinality(String), is_passthrough Bool, params String, status String,
          stream Bool, stop_reason Nullable(String), prompt_tokens Int64, completion_tokens Int64,
          cached_read_tokens Int64, token_usage String, cost Nullable(Float64), latency Nullable(Float64),
          error_details String, responses_output String DEFAULT '', ver DateTime64(9)
        ) ENGINE = ReplacingMergeTree(ver) ORDER BY id`),
      admin.command(`CREATE TABLE ${hub}.messages (
          session_key String, hash UInt64, first_seen DateTime64(3), logged_at DateTime64(9),
          request_id String, source LowCardinality(String), position UInt32,
          type LowCardinality(String), role LowCardinality(String),
          content String CODEC(ZSTD(3)), text String CODEC(ZSTD(3))
        ) ENGINE = ReplacingMergeTree PARTITION BY toYYYYMM(first_seen) ORDER BY (session_key, hash)`),
      admin.command(`CREATE TABLE ${hub}.request_items (
          request_id String, session_key String, timestamp DateTime64(3), logged_at DateTime64(9),
          input Array(UInt64) CODEC(ZSTD(3)), output Array(UInt64) CODEC(ZSTD(3)),
          tools Array(UInt64) CODEC(ZSTD(3))
        ) ENGINE = ReplacingMergeTree(logged_at) PARTITION BY toYYYYMM(timestamp) ORDER BY request_id`),
      admin.command(`GRANT SELECT ON ${bifrost}.* TO ${reader}`),
      admin.command(`GRANT SELECT ON ${hub}.* TO ${reader}`),
    ]).pipe(Effect.orDie);
    yield* admin
      .insert(`${bifrost}.logs`, rows.map(logsRow))
      .pipe(Effect.orDie);
    yield* admin.insert(`${hub}.messages`, messagesRows()).pipe(Effect.orDie);
    yield* admin
      .insert(`${hub}.request_items`, requestItemsRows())
      .pipe(Effect.orDie);
    return Source.of({
      bifrost,
      hub,
      connection: {
        url: server.url,
        database: bifrost,
        user: reader,
        password: Redacted.make(password),
        bifrostDatabase: bifrost,
        hubDatabase: hub,
      },
      admin,
    });
  });

/**
 * The constructed source, read through a scratch user that can only select,
 * whose settings profile is `readonly = 2` and the settings given; both
 * databases, the user and its profile are dropped after the test.
 */
export const layerOf = (profile = ""): Layer.Layer<Source> =>
  Layer.effect(Source, constructed(profile));

export const layer: Layer.Layer<Source> = layerOf();

/** A source request of the constructed source, as `logs` holds it, for a test that adds one. */
export const logsRowOf = logsRow;
