import {
  answer,
  asked,
  type Fixture,
  never,
  problem,
  unreachable,
} from "./fake-api.ts";
import { displayNames, owner } from "./fixtures.ts";

const shared: ReadonlyArray<Fixture> = [owner, displayNames];

const column = (name: string, type: string, comment = "") => ({
  name,
  type,
  comment,
});

/** `GET /api/schema` of a request log some weeks old. */
export const schema = answer("sql", "schema", {
  database: "cota",
  tables: [
    {
      name: "items",
      engine: "ReplacingMergeTree",
      rows: 1_204_551,
      bytes: 3_651_874_201,
      comment: "",
      columns: [
        column("session", "String"),
        column("digest", "UInt128"),
        column("protocol", "LowCardinality(String)"),
        column("first_seen", "DateTime64(3, 'UTC')"),
        column("request_id", "UUID"),
        column(
          "part",
          "Enum8('system' = 1, 'tools' = 2, 'input' = 3, 'output' = 4)",
        ),
        column("position", "UInt32"),
        column("type", "LowCardinality(String)"),
        column("role", "LowCardinality(String)"),
        column("content", "String"),
        column("text", "String"),
      ],
    },
    {
      name: "request_items",
      engine: "MergeTree",
      rows: 48_213,
      bytes: 96_120_448,
      comment: "",
      columns: [
        column("request_id", "UUID"),
        column("session", "String"),
        column("started_at", "DateTime64(3, 'UTC')"),
        column("system", "Array(UInt128)"),
        column("tools", "Array(UInt128)"),
        column("input", "Array(UInt128)"),
        column("output", "Array(UInt128)"),
        column("layout", "String"),
        column("overlay", "String"),
        column("params", "String"),
      ],
    },
    {
      name: "requests",
      engine: "MergeTree",
      rows: 48_213,
      bytes: 222_301_184,
      comment: "",
      columns: [
        column("id", "UUID"),
        column("started_at", "DateTime64(3, 'UTC')"),
        column("first_byte_ms", "Nullable(UInt32)"),
        column("duration_ms", "UInt32"),
        column("session", "String"),
        column("machine", "LowCardinality(String)"),
        column("project", "LowCardinality(String)"),
        column("client", "LowCardinality(String)"),
        column("hub_key", "LowCardinality(String)"),
        column("pool", "LowCardinality(String)"),
        column("provider", "LowCardinality(String)"),
        column("model", "LowCardinality(String)"),
        column(
          "outcome",
          "Enum8('ok' = 1, 'error' = 2, 'refused' = 3, 'cancelled' = 4)",
        ),
        column("upstream_status", "UInt16"),
        column("error_message", "String"),
        column("input_tokens", "UInt32"),
        column("cache_read_tokens", "UInt32"),
        column("output_tokens", "UInt32"),
        column("cost_usd", "Nullable(Decimal(18, 12))"),
        column("rate_limits", "Map(LowCardinality(String), String)"),
        column("usage", "String"),
        column("prompt_tokens", "UInt64"),
      ],
    },
    {
      name: "session_titles",
      engine: "MergeTree",
      rows: 912,
      bytes: 88_064,
      comment: "",
      columns: [
        column("session", "String"),
        column("title", "String"),
        column("reported_at", "DateTime64(3, 'UTC')"),
        column("machine", "LowCardinality(String)"),
        column("reported_by", "LowCardinality(String)"),
      ],
    },
    {
      name: "words",
      engine: "ReplacingMergeTree",
      rows: 59_102,
      bytes: 1_153_433,
      comment: "the words of every item",
      columns: [
        column("word", "String"),
        column("characters", "UInt32"),
        column("character_bits", "UInt64"),
      ],
    },
    {
      name: "words_writer",
      engine: "MaterializedView",
      rows: null,
      bytes: null,
      comment: "",
      columns: [column("word", "String")],
    },
  ],
});

/** The SQL the mixed answer is the answer to. */
export const mixedSql = `SELECT started_at, pool, requests, cost_usd, error_message, usage, rate_limits
FROM recent
LIMIT 4`;

const usage =
  '{"input_tokens":1204,"cache_read_input_tokens":88213,"cache_creation_input_tokens":0,"output_tokens":512,"service_tier":"standard"}';

const longMessage =
  "The provider of pool \"codex\" sent no answer within 5 minutes, so the hub closed the connection and answered the client 504. Raise relay.first_byte_timeout in the hub's configuration if this model needs longer to start answering, or look at the provider's status page for an outage during this time.";

/** An answer with a number of each kind, strings, a null, an empty string, JSON, a long text and dates. */
export const mixedAnswer = answer("sql", "sql", {
  columns: [
    { name: "started_at", type: "DateTime64(3, 'UTC')" },
    { name: "pool", type: "LowCardinality(String)" },
    { name: "requests", type: "UInt64" },
    { name: "cost_usd", type: "Nullable(Decimal(18, 12))" },
    { name: "error_message", type: "String" },
    { name: "usage", type: "String" },
    { name: "rate_limits", type: "Map(LowCardinality(String), String)" },
  ],
  rows: [
    [
      "2026-11-16 09:12:04.118",
      "work",
      "412",
      "1.204000000000",
      "",
      usage,
      { "anthropic-ratelimit-requests-remaining": "3998" },
    ],
    ["2026-11-16 09:13:51.002", "personal", "38", null, "NULL", "{}", {}],
    [
      "2026-11-16 09:20:17.940",
      "codex",
      "7",
      "0.031500000000",
      longMessage,
      "",
      {},
    ],
    [
      "2026-11-16 09:41:00.513",
      "work",
      "1290",
      "12.880210000000",
      "Overloaded",
      usage,
      { "anthropic-ratelimit-tokens-remaining": "41000" },
    ],
  ],
  truncated: false,
  elapsedMs: 84,
});

const pools = ["work", "personal", "codex", "openrouter"];
const models = ["claude-opus-4-5", "gpt-5-codex", "claude-sonnet-4-5"];

/** 5,000 rows, the hub's cap, of a query that had more. */
export const fiveThousand = answer("sql", "sql", {
  columns: [
    { name: "started_at", type: "DateTime64(3, 'UTC')" },
    { name: "pool", type: "LowCardinality(String)" },
    { name: "model", type: "LowCardinality(String)" },
    { name: "duration_ms", type: "UInt32" },
    { name: "output_tokens", type: "UInt32" },
    { name: "cost_usd", type: "Nullable(Decimal(18, 12))" },
    { name: "id", type: "UUID" },
  ],
  rows: Array.from({ length: 5000 }, (_, row) => [
    new Date(Date.UTC(2026, 10, 16, 9, 0, 0) - row * 17_000)
      .toISOString()
      .replace("T", " ")
      .replace("Z", ""),
    pools[row % pools.length] ?? "work",
    models[row % models.length] ?? "claude-opus-4-5",
    800 + ((row * 7919) % 90_000),
    (row * 37) % 4000,
    row % 9 === 0 ? null : (((row * 13) % 400) / 100).toFixed(12),
    `0193a4c2-${(row + 4096).toString(16).padStart(4, "0")}-7000-8000-000000000001`,
  ]),
  truncated: true,
  elapsedMs: 1840,
});

/** An answer with its columns and no rows. */
export const noRows = answer("sql", "sql", {
  columns: [
    { name: "session", type: "String" },
    { name: "title", type: "String" },
    { name: "reported_at", type: "DateTime64(3, 'UTC')" },
  ],
  rows: [],
  truncated: false,
  elapsedMs: 12,
});

/** The console before a run, its tables read. */
export const beforeRun: ReadonlyArray<Fixture> = [...shared, schema];

/** A run whose answer has every kind of value. */
export const mixedRun: ReadonlyArray<Fixture> = [
  ...shared,
  schema,
  mixedAnswer,
];

/** A run the hub cut at 5,000 rows. */
export const truncatedRun: ReadonlyArray<Fixture> = [
  ...shared,
  schema,
  fiveThousand,
];

/** A run that answered no rows. */
export const emptyRun: ReadonlyArray<Fixture> = [...shared, schema, noRows];

/** ClickHouse refused the SQL at a place in it. */
export const failedRun: ReadonlyArray<Fixture> = [
  ...shared,
  schema,
  problem("sql", "sql", {
    type: "urn:cota:query-failed",
    status: 400,
    detail:
      "Code: 62. DB::Exception: Syntax error: failed at position 34 (FORM) (line 2, col 1): FORM requests\nWHERE outcome = 'error'\nLIMIT 20. Expected one of: token, Comma, FROM, WHERE, GROUP BY, ORDER BY, LIMIT, UNION, end of query. (SYNTAX_ERROR)",
  }),
];

/** The SQL `failedRun` refuses: its second line misspells FROM. */
export const misspelledSql = `SELECT pool, count() AS requests
FORM requests
WHERE outcome = 'error'
LIMIT 20`;

/** The hub refused a query that names its own format. */
export const formatRefused: ReadonlyArray<Fixture> = [
  ...shared,
  schema,
  problem("sql", "sql", {
    type: "urn:cota:format-not-allowed",
    status: 400,
  }),
];

const sqlUnavailable = {
  type: "urn:cota:sql-unavailable",
  status: 503,
  detail:
    "The hub could not make the SQL user cota_sql: ClickHouse refused CREATE USER with code 497 (ACCESS_DENIED).",
} as const;

/** A hub without SQL: its ClickHouse user cannot make the SQL user. */
export const unavailable: ReadonlyArray<Fixture> = [
  ...shared,
  problem("sql", "schema", sqlUnavailable),
  problem("sql", "sql", sqlUnavailable),
];

/** A run the hub takes and never answers. */
export const running: ReadonlyArray<Fixture> = [
  ...shared,
  schema,
  never("sql", "sql"),
];

/** A hub whose tables cannot be read, though it answers SQL. */
export const schemaFailed: ReadonlyArray<Fixture> = [
  ...shared,
  unreachable("sql", "schema"),
  mixedAnswer,
];

/** A hub that answers only the SQL given, and dies on any other, so a story knows what was asked. */
export const answersOnly = (
  sql: string,
  answered: Fixture = mixedAnswer,
): ReadonlyArray<Fixture> => [
  ...shared,
  schema,
  asked(
    answered,
    (body) =>
      typeof body === "object" &&
      body !== null &&
      "sql" in body &&
      body.sql === sql,
  ),
];
