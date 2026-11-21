import { Arbitrary, DateTime, Option, Schema } from "effect";
import * as Archive from "#modules/request-log/03-domain/archive.ts";
import type * as Import from "#modules/request-log/03-domain/import.ts";
import { PoolId } from "#shared/03-domain/ids.ts";
import type * as Price from "#shared/03-domain/price.ts";
import { compareText } from "#shared/03-domain/text.ts";
import { pick } from "./sessions.ts";

const int = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

/** The day a generated source is imported on, and the days beside it its sessions cross into. */
export const day = Archive.Day.make("2026-10-28");
const dayStart = Date.UTC(2026, 9, 28);
const hour = 3_600_000;

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
        provider: "openai",
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

const price: Price.Price = {
  base: {
    input: 3_000_000n,
    cacheRead: 300_000n,
    cacheWriteShort: 3_750_000n,
    cacheWriteLong: 6_000_000n,
    output: 15_000_000n,
  },
  tiers: [],
};

/** Every pool's price for every model but `unpriced`. */
export const priceOf: Import.PriceOf = (_pool, model) =>
  model === "unpriced" ? Option.none() : Option.some(price);

/** Items in both source forms, two of which differ only in their keys' order, and one that is not JSON. */
const contents = [
  '{"type":"message","role":"user","content":[{"type":"input_text","text":"Hello"}]}',
  '{"role":"user","type":"message","content":[{"text":"Hello","type":"input_text"}]}',
  '{"type":"reasoning","summary":[{"type":"summary_text","text":"Thinking"}]}',
  '{"type":"function_call","name":"shell","arguments":"{\\"cmd\\":\\"ls\\"}","call_id":"c1"}',
  '{"type":"function_call_output","call_id":"c1","output":"a.txt"}',
  '{"role":"assistant","content":"Done: 😀"}',
  '{"role":"tool","tool_call_id":"t1","content":"42"}',
  '{"type":"function","name":"shell","parameters":{"type":"object"}}',
  '{"type":"additional_tools","tools":[]}',
  "{not JSON",
] as const;

export interface GeneratedRequest {
  readonly request: Import.SourceRequest;
  /** Its `request_items` row's hashes, when the source has one. */
  readonly row: Option.Option<{
    readonly input: ReadonlyArray<number>;
    readonly output: ReadonlyArray<number>;
    readonly tools: ReadonlyArray<number>;
  }>;
}

/** A generated source: requests of the day and of the days beside it, and request items with no request. */
export interface GeneratedSource {
  readonly requests: ReadonlyArray<GeneratedRequest>;
  readonly orphans: ReadonlyArray<Import.SourceRequestItems>;
}

const hashes = Arbitrary.array(int(0, contents.length - 1), {
  minLength: 0,
  maxLength: 5,
});

const usages = [
  "",
  "{}",
  '{"prompt_tokens":1000}',
  '{"prompt_tokens_details":{"cached_write_tokens":200}}',
  '{"prompt_tokens_details":{"cached_write_tokens":300,"cached_write_token_details":{"cached_write_tokens_5m":100,"cached_write_tokens_1h":200}},"completion_tokens_details":{"reasoning_tokens":7}}',
  '{"prompt_tokens_details":{"cached_write_tokens":300,"cached_write_token_details":{"cached_write_tokens_5m":100,"cached_write_tokens_1h":100}}}',
  '{"prompt_tokens_details":{"cached_write_token_details":{"cached_write_tokens_5m":50,"cached_write_tokens_1h":25}}}',
  '{"prompt_tokens_details":{"cached_write_tokens":-5}}',
] as const;

const generatedRequest = (index: number) =>
  Arbitrary.all({
    at: int(-6 * hour, 30 * hour - 1),
    session: pick(["s1", "s1", "s2", "s3", ""]),
    account: pick(["claude-max", "codex-plus", ""]),
    provider: pick(["anthropic", "zai"]),
    fallback: pick(["", "", "codex-plus"]),
    host: pick(["old-laptop", "workstation", ""]),
    objectType: pick([
      "responses_stream",
      "responses",
      "chat_completion_stream",
      "passthrough",
      "count_tokens",
      "list_models",
      "image_generation",
    ]),
    path: pick(["/backend-api/codex/models", "/alpha/search", "/v1/other"]),
    status: pick(["success", "success", "error", "cancelled", "processing"]),
    model: pick(["claude-opus-5-5", "gpt-5.5", "unpriced"]),
    prompt: pick([0, 1000, 5000, 4_294_967_296]),
    read: pick([0, 100, 400]),
    completion: pick([0, 50, 900]),
    usage: pick(usages),
    cost: pick([Option.none<number>(), Option.some(0), Option.some(12.5)]),
    latency: pick([Option.none<number>(), Option.some(-1), Option.some(812.4)]),
    errorDetails: pick([
      "",
      '{"status_code":429,"error":{"type":"rate_limit","message":"slow down"}}',
      '{"error":{"code":529,"error":{"message":"overloaded"}}}',
      "not JSON",
    ]),
    input: hashes,
    output: hashes,
    tools: hashes,
    hasRow: pick([true, true, true, false]),
  }).pipe(
    Arbitrary.map((seed): GeneratedRequest => {
      const metadata = JSON.stringify({
        ...(seed.account === "" ? {} : { account: seed.account }),
        host: seed.host,
        project: "cota",
        ...(seed.fallback === "" ? {} : { "fallback-from": seed.fallback }),
      });
      return {
        request: {
          id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          startedAt: DateTime.makeUnsafe(dayStart + seed.at),
          session: seed.session,
          metadata,
          userAgent: "codex_cli_rs/0.80.0",
          provider: seed.provider,
          model: seed.model,
          objectType: seed.objectType,
          params: JSON.stringify({
            path: seed.path,
            tools: [1],
            effort: "low",
          }),
          status: seed.status,
          stream: true,
          stopReason: "stop",
          promptTokens: seed.prompt,
          completionTokens: seed.completion,
          cachedReadTokens: seed.read,
          tokenUsage: seed.usage,
          cost: seed.cost,
          latency: seed.latency,
          errorDetails: seed.errorDetails,
        },
        row: seed.hasRow
          ? Option.some({
              input: seed.input,
              output: seed.output,
              tools: seed.tools,
            })
          : Option.none(),
      };
    }),
  );

/** Up to 14 requests from six hours before the day to six hours after it, and up to two request items with no request. */
export const source: Arbitrary.Arbitrary<GeneratedSource> = Arbitrary.all({
  count: int(0, 14),
  orphans: Arbitrary.array(
    Arbitrary.all({ at: int(-6 * hour, 30 * hour - 1), input: hashes }),
    { maxLength: 2 },
  ),
}).pipe(
  Arbitrary.flatMap(({ count, orphans }) =>
    Arbitrary.all(
      Array.from({ length: count }, (_, index) => generatedRequest(index)),
    ).pipe(
      Arbitrary.map(
        (requests): GeneratedSource => ({
          requests,
          orphans: orphans.map((orphan, index) => ({
            requestId: `gone-${index}`,
            sessionKey: "s1",
            startedAt: DateTime.makeUnsafe(dayStart + orphan.at),
            input: orphan.input.map(String),
            output: [],
            tools: [],
          })),
        }),
      ),
    ),
  ),
);

const sessionKeyOf = ({ request }: GeneratedRequest) =>
  request.session === "" ? `request:${request.id}` : request.session;

const keyOf = (sessionKey: string, hash: string) => `${sessionKey}/${hash}`;

const dayOfTime = (at: DateTime.Utc) => DateTime.formatIsoDateUtc(at);

/** A generated source's rows as the import source would read them for `day`, in one page. */
export const pageRead = (generated: GeneratedSource) => {
  const rowsOf = (each: GeneratedRequest) =>
    Option.map(
      each.row,
      (row): Import.SourceRequestItems => ({
        requestId: each.request.id,
        sessionKey: sessionKeyOf(each),
        startedAt: each.request.startedAt,
        input: row.input.map(String),
        output: row.output.map(String),
        tools: row.tools.map(String),
      }),
    );
  const allRows = [
    ...generated.requests.flatMap((each) => Option.toArray(rowsOf(each))),
    ...generated.orphans,
  ];
  const logged = new Map(
    generated.requests.map(({ request }) => [request.id, request]),
  );
  // `hub.messages`: each item named, first seen by the earliest row naming it.
  const firsts = new Map<
    string,
    {
      sessionKey: string;
      hash: string;
      at: DateTime.Utc;
      requestId: string;
      source: string;
      position: number;
    }
  >();
  for (const row of allRows) {
    for (const [source, list] of [
      ["input", row.input],
      ["output", row.output],
      ["tool", row.tools],
    ] as const) {
      list.forEach((hash, index) => {
        const key = keyOf(row.sessionKey, hash);
        const kept = firsts.get(key);
        const at = DateTime.toEpochMillis(row.startedAt);
        if (
          kept === undefined ||
          at < DateTime.toEpochMillis(kept.at) ||
          (at === DateTime.toEpochMillis(kept.at) &&
            compareText(row.requestId, kept.requestId) < 0)
        ) {
          firsts.set(key, {
            sessionKey: row.sessionKey,
            hash,
            at: row.startedAt,
            requestId: row.requestId,
            source,
            position: index + 1,
          });
        }
      });
    }
  }
  const ofDay = generated.requests.filter(
    ({ request }) => dayOfTime(request.startedAt) === day,
  );
  const dayIds = new Set(ofDay.map(({ request }) => request.id));
  const rows = allRows.filter(
    (row) =>
      dayIds.has(row.requestId) ||
      (!logged.has(row.requestId) && dayOfTime(row.startedAt) === day),
  );
  const named = new Set(
    rows
      .filter((row) => dayIds.has(row.requestId))
      .flatMap((row) =>
        [...row.input, ...row.output, ...row.tools].map((hash) =>
          keyOf(row.sessionKey, hash),
        ),
      ),
  );
  const listed: Array<Import.ListedItem> = [...firsts.entries()]
    .filter(([key, first]) => dayOfTime(first.at) === day || named.has(key))
    .sort(([one], [other]) => compareText(one, other))
    .map(([, first]) => ({
      sessionKey: first.sessionKey,
      hash: first.hash,
      firstSeen: first.at,
      requestId: first.requestId,
      source: first.source,
      position: first.position,
      sentAt: Option.map(
        Option.fromUndefinedOr(logged.get(first.requestId)),
        ({ startedAt }) => startedAt,
      ),
    }));
  const firstNamings: Array<Import.FirstNaming> = listed
    .filter(({ sentAt }) => Option.isNone(sentAt))
    .flatMap((item) => {
      const naming = generated.requests
        .filter((each) =>
          Option.exists(
            rowsOf(each),
            (row) =>
              [...row.input, ...row.output, ...row.tools].includes(item.hash) &&
              row.sessionKey === item.sessionKey,
          ),
        )
        .sort(
          (one, other) =>
            DateTime.toEpochMillis(one.request.startedAt) -
              DateTime.toEpochMillis(other.request.startedAt) ||
            compareText(one.request.id, other.request.id),
        )[0];
      return naming === undefined
        ? []
        : [
            {
              sessionKey: item.sessionKey,
              hash: item.hash,
              requestId: naming.request.id,
              startedAt: naming.request.startedAt,
            },
          ];
    });
  const sourceContents: Array<Import.SourceContent> = listed.map(
    ({ sessionKey, hash }) => ({
      sessionKey,
      hash,
      content: contentOf(hash),
    }),
  );
  return {
    requests: ofDay.map(({ request }) => request),
    rows,
    listed,
    firstNamings,
    contents: sourceContents,
  };
};

/** The content of a generated item's hash. */
export const contentOf = (hash: string): string =>
  contents[Number(hash)] ?? "{not JSON";
