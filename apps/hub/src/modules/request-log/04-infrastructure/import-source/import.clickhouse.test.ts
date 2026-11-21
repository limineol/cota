import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BunHttpClient } from "@effect/platform-bun";
import { afterAll, describe, expect, it } from "@effect/vitest";
import {
  Context,
  DateTime,
  Effect,
  Layer,
  Option,
  Schema,
  type Scope,
} from "effect";
import { HttpClient, UrlParams } from "effect/http";
import * as ImportDays from "#modules/request-log/02-application/commands/import-days.command.ts";
import { Prices } from "#modules/request-log/02-application/interfaces/prices.ts";
import { RequestLogArchive } from "#modules/request-log/02-application/interfaces/request-log-archive.ts";
import * as Archive from "#modules/request-log/03-domain/archive.ts";
import * as Import from "#modules/request-log/03-domain/import.ts";
import * as ClickHouseRequestLogArchive from "#modules/request-log/04-infrastructure/persistence/clickhouse/clickhouse-request-log-archive.ts";
import * as ClickHouse from "#modules/request-log/04-infrastructure/persistence/clickhouse/client.ts";
import * as RequestMapper from "#modules/request-log/04-infrastructure/persistence/clickhouse/mappers/request.mapper.ts";
import * as PriceLists from "#modules/request-log/04-infrastructure/prices/prices.ts";
import * as Constructed from "#modules/request-log/05-tests/constructed-source.ts";
import {
  connectionTo,
  queryOf,
} from "#modules/request-log/05-tests/scratch.ts";
import * as Conversation from "#shared/03-domain/conversation.ts";
import * as ClickHouseImportSource from "./clickhouse-import-source.ts";
import * as ImportFilesReader from "./import-files.ts";

const files = mkdtempSync(join(tmpdir(), "cota-import-"));
afterAll(() => rmSync(files, { recursive: true, force: true }));

const titlesFileOf = (
  name: string,
  titles: ReadonlyArray<readonly [string, string]>,
) => {
  const path = join(files, name);
  const database = new Database(path, { create: true });
  database.run("CREATE TABLE titles (session_id TEXT, title TEXT)");
  for (const [session, title] of titles) {
    database.run("INSERT INTO titles VALUES (?, ?)", [session, title]);
  }
  database.close();
  return path;
};

const titlesFile = titlesFileOf("titles.db", [
  ["sA", "Fixing the build"],
  ["sB", "  "],
  ["sZ", "A session with no request"],
]);

type Hook = (query: string) => Effect.Effect<void>;

/** A client that records every statement it sends, and runs the hook before sending it. */
/** What a statement was sent with: its query, and its settings and parameters. */
interface Carried {
  readonly query: string;
  readonly urlParams: UrlParams.UrlParams;
}

const recording = (
  sent: Array<string>,
  hook: { current: Hook },
  carried: Array<Carried> = [],
) =>
  Layer.effect(
    HttpClient.HttpClient,
    Effect.map(HttpClient.HttpClient, (client) =>
      HttpClient.transform(client, (response, request) =>
        Effect.gen(function* () {
          const query = queryOf(request);
          sent.push(query);
          carried.push({ query, urlParams: request.urlParams });
          yield* hook.current(query);
          return yield* response;
        }),
      ),
    ),
  ).pipe(Layer.provide(BunHttpClient.layer));

const nothing: Hook = () => Effect.void;

class Log extends Context.Service<
  Log,
  {
    readonly database: string;
    readonly sent: Array<string>;
    readonly carried: Array<Carried>;
    readonly hook: { current: Hook };
    readonly client: ClickHouse.Client;
  }
>()("Log") {}

/** A scratch request log, made by `prepare`, dropped after the test. */
const logLayer = Layer.effect(
  Log,
  Effect.gen(function* () {
    const database = `cota_test_${Bun.randomUUIDv7("hex").replaceAll("-", "")}`;
    const admin = yield* Layer.build(
      ClickHouse.layer(connectionTo("default")).pipe(
        Layer.provide(BunHttpClient.layer),
      ),
    ).pipe(
      Effect.map((context) => Context.get(context, ClickHouse.ClickHouse)),
    );
    yield* Effect.acquireRelease(
      admin.command(`CREATE DATABASE ${database}`),
      () =>
        Effect.ignore(
          admin.command(`DROP DATABASE IF EXISTS ${database} SYNC`),
        ),
    ).pipe(Effect.orDie);
    const sent: Array<string> = [];
    const carried: Array<Carried> = [];
    const hook = { current: nothing };
    const client = yield* Layer.build(
      ClickHouse.layer(connectionTo(database)).pipe(
        Layer.provide(recording(sent, hook, carried)),
      ),
    ).pipe(
      Effect.map((context) => Context.get(context, ClickHouse.ClickHouse)),
    );
    return Log.of({ database, sent, carried, hook, client });
  }),
);

const prices = Layer.succeed(
  Prices,
  Prices.of({
    of: (asked) =>
      PriceLists.priceOf(
        { prices: Option.some("anthropic"), ownPrices: {} },
        asked,
      ),
  }),
);

const sourceSent: Array<string> = [];
const sourceHook = { current: nothing };

const everyDay = { from: Option.none(), to: Option.none() };

const run = (
  options: {
    dryRun?: boolean;
    range?: ImportDays.Options["range"];
    titles?: string;
  } = {},
) =>
  Effect.gen(function* () {
    const log = yield* Log;
    const source = yield* Constructed.Source;
    const importDays = yield* ImportDays.ImportDays.pipe(
      Effect.provide(
        ImportDays.layer.pipe(
          Layer.provide(
            ClickHouseImportSource.layer(source.connection).pipe(
              Layer.provide(recording(sourceSent, sourceHook)),
            ),
          ),
          Layer.provide(
            ImportFilesReader.layer({
              titles: Option.some(options.titles ?? titlesFile),
              names: Option.none(),
            }),
          ),
          Layer.provide(ClickHouseRequestLogArchive.layer),
          Layer.provide(Layer.succeed(ClickHouse.ClickHouse, log.client)),
          Layer.provide(prices),
        ),
      ),
    );
    return yield* importDays.execute({
      range: options.range ?? everyDay,
      dryRun: options.dryRun ?? false,
      targets: Constructed.targets,
    });
  });

const inScratch = <A, E>(
  effect: Effect.Effect<A, E, Log | Constructed.Source | Scope.Scope>,
  source: Layer.Layer<Constructed.Source> = Constructed.layer,
) =>
  effect.pipe(
    Effect.scoped,
    Effect.provide(Layer.mergeAll(logLayer, source)),
    Effect.ensuring(
      Effect.sync(() => {
        sourceSent.length = 0;
        sourceHook.current = nothing;
      }),
    ),
  );

const Text = Schema.Struct({ value: Schema.String });

const tables = [
  "items",
  "request_items",
  "requests",
  "session_titles",
] as const;

const countsOf = Effect.gen(function* () {
  const { client } = yield* Log;
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const [row] = yield* client.select(
      `SELECT toString(count()) AS value FROM ${table}`,
      Text,
    );
    counts[table] = Number(row?.value ?? 0);
  }
  return counts;
});

const addedOf = (done: ImportDays.Done) =>
  done.days.map(([day, imported]) => [
    day,
    imported._tag === "Added" ? imported.added : imported._tag,
  ]);

const totalOf = (done: ImportDays.Done) => {
  const total: Record<(typeof tables)[number], number> = {
    items: 0,
    request_items: 0,
    requests: 0,
    session_titles: 0,
  };
  for (const [, imported] of done.days) {
    if (imported._tag !== "Added") continue;
    for (const table of tables) total[table] += imported.added[table];
  }
  return total;
};

const notCarriedOf = (done: ImportDays.Done) =>
  done.days.reduce(
    (sum, [, imported]) =>
      imported._tag === "Added"
        ? {
            requestItems: sum.requestItems + imported.notCarried.requestItems,
            conversations:
              sum.conversations + imported.notCarried.conversations,
            usages: sum.usages + imported.notCarried.usages,
            items: sum.items + imported.notCarried.items,
          }
        : sum,
    { requestItems: 0, conversations: 0, usages: 0, items: 0 },
  );

const leavesTheLog = (statement: string) =>
  /^\s*(SELECT|WITH)\b/i.test(statement) ||
  /^INSERT INTO (items|request_items|requests|session_titles|(archive|dry_run)_(items|request_items|requests|session_titles)) /.test(
    statement,
  ) ||
  /^CREATE TEMPORARY TABLE (IF NOT EXISTS )?(archive|dry_run)_(items|request_items|requests|session_titles) ENGINE = MergeTree ORDER BY tuple\(\) EMPTY AS SELECT \* FROM (items|request_items|requests|session_titles)$/.test(
    statement,
  ) ||
  /^DROP TEMPORARY TABLE IF EXISTS archive_(items|request_items|requests|session_titles)$/.test(
    statement,
  ) ||
  !/\b(items|request_items|requests|session_titles|words)\b/.test(statement);

const intoTheLog =
  /^INSERT INTO (items|request_items|requests|session_titles|words)\b/;

const expectedAdded = [
  [
    "2026-10-27",
    { items: 4, request_items: 1, requests: 1, session_titles: 0 },
  ],
  [
    "2026-10-28",
    { items: 11, request_items: 4, requests: 9, session_titles: 1 },
  ],
  [
    "2026-10-29",
    { items: 3, request_items: 2, requests: 3, session_titles: 0 },
  ],
];

describe("an import from a constructed source", () => {
  it.live(
    "Z1: every statement an import or a dry run sends its source is a SELECT, or a read of system.columns",
    () =>
      inScratch(
        Effect.gen(function* () {
          yield* run({ dryRun: true });
          yield* run();
          expect(sourceSent.length).toBeGreaterThan(0);
          expect(
            sourceSent.filter((statement) => !/^\s*SELECT\b/.test(statement)),
          ).toEqual([]);
        }),
      ),
    120_000,
  );

  it.live(
    "Z2: an import sends the log's tables nothing but SELECT and INSERT, apart from prepare and its own temporary tables",
    () =>
      inScratch(
        Effect.gen(function* () {
          const log = yield* Log;
          const archive = yield* Layer.build(
            ClickHouseRequestLogArchive.layer.pipe(
              Layer.provide(Layer.succeed(ClickHouse.ClickHouse, log.client)),
            ),
          ).pipe(
            Effect.map((context) => Context.get(context, RequestLogArchive)),
          );
          yield* Effect.orDie(archive.prepare);
          // What prepare sends once the tables exist, as it does in each run.
          const start = log.sent.length;
          yield* Effect.orDie(archive.prepare);
          const prepared = log.sent.slice(start);
          const before = log.sent.length;
          yield* run({ dryRun: true });
          yield* run();
          const sent = log.sent.slice(before);
          for (const _ of [1, 2]) {
            for (const statement of prepared) {
              const at = sent.indexOf(statement);
              expect(at).toBeGreaterThanOrEqual(0);
              sent.splice(at, 1);
            }
          }
          expect(
            sent.some((statement) =>
              /^INSERT INTO requests \(/.test(statement),
            ),
          ).toBe(true);
          expect(sent.filter((statement) => !leavesTheLog(statement))).toEqual(
            [],
          );
        }),
      ),
    120_000,
  );

  it.live(
    "Z3: an import adds to each table exactly the built rows of the days it adds that the log does not hold",
    () =>
      inScratch(
        Effect.gen(function* () {
          const log = yield* Log;
          const done = yield* run();
          expect(addedOf(done)).toEqual(expectedAdded);
          expect(yield* countsOf).toEqual(totalOf(done));
          const ids = yield* log.client.select(
            "SELECT toString(id) AS value FROM requests ORDER BY value",
            Text,
          );
          expect(ids.map(({ value }) => value)).toEqual(
            Constructed.rows
              .map(({ id, at }) =>
                Import.requestIdOf(
                  id,
                  DateTime.makeUnsafe(`${at.replace(" ", "T")}Z`),
                ),
              )
              .sort(),
          );
          const items = yield* log.client.select(
            "SELECT concat(session, '/', toString(digest)) AS value FROM items FINAL ORDER BY value",
            Text,
          );
          expect(items).toHaveLength(18);
          const titles = yield* log.client.select(
            "SELECT concat(session, '|', title, '|', toString(reported_at), '|', reported_by) AS value FROM session_titles",
            Text,
          );
          expect(titles.map(({ value }) => value)).toEqual([
            "sA|Fixing the build|2026-10-28 14:00:00.000|import",
          ]);
          expect(done.titlesNotCarried).toEqual({
            withoutRequest: 1,
            empty: 1,
          });
        }),
      ),
    120_000,
  );

  it.live(
    "Z4: importing a source that has not changed again, whole or any of its days, adds no row",
    () =>
      inScratch(
        Effect.gen(function* () {
          const log = yield* Log;
          yield* run();
          const counts = yield* countsOf;
          const before = log.sent.length;
          const again = yield* run();
          const one = yield* run({
            range: {
              from: Option.some(Archive.Day.make("2026-10-28")),
              to: Option.some(Archive.Day.make("2026-10-28")),
            },
          });
          expect(addedOf(again)).toEqual(
            Constructed.days.map((day) => [day, "Held"]),
          );
          expect(addedOf(one)).toEqual([["2026-10-28", "Held"]]);
          expect(
            log.sent
              .slice(before)
              .filter((statement) => intoTheLog.test(statement)),
          ).toEqual([]);
          expect(yield* countsOf).toEqual(counts);
        }),
      ),
    120_000,
  );

  it.live(
    "Z6: for every day, each source request is built once, and each source request item is built or counted under one reason not carried",
    () =>
      inScratch(
        Effect.gen(function* () {
          const done = yield* run();
          const total = totalOf(done);
          expect(total.requests).toBe(Constructed.rows.length);
          const notCarried = notCarriedOf(done);
          expect(notCarried).toEqual({
            requestItems: 1,
            conversations: 1,
            usages: 1,
            items: 1,
          });
          const sourceRows =
            Constructed.rows.filter(({ items }) => items !== undefined).length +
            1;
          expect(total.request_items + notCarried.requestItems).toBe(
            sourceRows,
          );
        }),
      ),
    120_000,
  );

  // ClickHouse breaks off an answer only between blocks: blocks of one row
  // make this small source overflow as a large day's 65,536-row blocks do.
  it.live(
    "Z6: a source user whose settings profile caps an answer's rows, with an overflow that breaks, still gives every day whole",
    () =>
      inScratch(
        Effect.gen(function* () {
          const done = yield* run();
          expect(addedOf(done)).toEqual(expectedAdded);
          expect(totalOf(done).requests).toBe(Constructed.rows.length);
          expect(notCarriedOf(done)).toEqual({
            requestItems: 1,
            conversations: 1,
            usages: 1,
            items: 1,
          });
        }),
        Constructed.layerOf(
          "max_result_rows = 3, result_overflow_mode = 'break', max_block_size = 1",
        ),
      ),
    120_000,
  );

  it.live(
    "Z6: a source user whose settings profile caps the rows a query reads, with an overflow that breaks, fails the import loudly and adds nothing",
    () =>
      inScratch(
        Effect.gen(function* () {
          const log = yield* Log;
          const failure = yield* Effect.flip(run());
          expect(failure._tag).toBe("ImportSourceFailed");
          expect(failure.message).toContain("TOO_MANY_ROWS");
          expect(
            log.sent.filter((statement) => intoTheLog.test(statement)),
          ).toEqual([]);
        }),
        Constructed.layerOf(
          "max_rows_to_read = 3, read_overflow_mode = 'break', max_block_size = 1",
        ),
      ),
    120_000,
  );

  it.live(
    "Z7: no request an import adds is held before every item its request_items row names is held by its session",
    () =>
      inScratch(
        Effect.gen(function* () {
          const log = yield* Log;
          const late = yield* run({
            range: {
              from: Option.some(Archive.Day.make("2026-10-28")),
              to: Option.none(),
            },
          });
          expect(late.days[0]).toEqual([
            "2026-10-28",
            {
              _tag: "Failed",
              detail:
                "3 requests carry items the log does not hold; import from 2026-10-27",
            },
          ]);
          expect(yield* countsOf).toEqual({
            items: 0,
            request_items: 0,
            requests: 0,
            session_titles: 0,
          });

          const before = log.sent.length;
          yield* run();
          const adds = log.sent.slice(before).flatMap((statement) => {
            const table =
              /^INSERT INTO (items|request_items|requests|session_titles) \(/.exec(
                statement,
              )?.[1];
            return table === undefined ? [] : [table];
          });
          // Only the tables a day lacks rows of are added to: no titles on the first day or the last.
          expect(adds).toEqual([
            "items",
            "request_items",
            "requests",
            "items",
            "request_items",
            "requests",
            "session_titles",
            "items",
            "request_items",
            "requests",
          ]);
          const [unheld] = yield* log.client.select(
            `SELECT toString(count()) AS value FROM request_items
             ARRAY JOIN arrayConcat(system, tools, input, output) AS named
             WHERE (session, named) NOT IN (SELECT session, digest FROM items)`,
            Text,
          );
          expect(unheld?.value).toBe("0");
        }),
      ),
    120_000,
  );

  it.live(
    "Z8: each imported request's items in order, read from the request log, are the source's items for it, each the same JSON value as the source's content",
    () =>
      inScratch(
        Effect.gen(function* () {
          const log = yield* Log;
          yield* run();
          const Rebuilt = Schema.Struct({
            id: Schema.String,
            part: Schema.String,
            contents: Schema.Array(Schema.String),
          });
          const rebuilt = yield* log.client.select(
            `SELECT toString(r.request_id) AS id, r.part AS part,
               arrayMap(d -> i.contents[indexOf(i.digests, d)], r.digests) AS contents
             FROM (
               SELECT request_id, session, 'tools' AS part, tools AS digests FROM request_items
               UNION ALL SELECT request_id, session, 'input', input FROM request_items
               UNION ALL SELECT request_id, session, 'output', output FROM request_items
             ) AS r
             LEFT JOIN (
               SELECT session, groupArray(digest) AS digests, groupArray(content) AS contents
               FROM items FINAL GROUP BY session
             ) AS i ON i.session = r.session`,
            Rebuilt,
          );
          const bySource = new Map<string, (typeof Constructed.rows)[number]>(
            Constructed.rows.map((row) => [
              Import.requestIdOf(
                row.id,
                DateTime.makeUnsafe(`${row.at.replace(" ", "T")}Z`),
              ),
              row,
            ]),
          );
          expect(rebuilt.length).toBe(7 * 3);
          for (const { id, part, contents } of rebuilt) {
            const source = bySource.get(id);
            expect(source?.items).toBeDefined();
            const hashes =
              part === "tools"
                ? source?.items?.tools
                : part === "input"
                  ? source?.items?.input
                  : source?.items?.output;
            expect(contents.map((content) => JSON.parse(content))).toEqual(
              (hashes ?? []).map((hash) =>
                JSON.parse(Constructed.contents[hash] ?? ""),
              ),
            );
          }
          const [digest] = yield* log.client.select(
            "SELECT toString(digest) AS value FROM items WHERE content LIKE '%Be careful%'",
            Text,
          );
          expect(digest?.value).toBe(
            BigInt(
              `0x${Conversation.digestOf(
                Conversation.canonical(
                  JSON.parse(Constructed.contents[Constructed.bigHash] ?? ""),
                ),
              )}`,
            ).toString(),
          );
        }),
      ),
    120_000,
  );

  it.live(
    "Z10: a dry run sends the request log's tables no INSERT, and the counts it reports are those a real import of the same days adds",
    () =>
      inScratch(
        Effect.gen(function* () {
          const log = yield* Log;
          const dry = yield* run({ dryRun: true });
          expect(
            log.sent.filter((statement) => intoTheLog.test(statement)),
          ).toEqual([]);
          expect(yield* countsOf).toEqual({
            items: 0,
            request_items: 0,
            requests: 0,
            session_titles: 0,
          });
          expect(Option.isSome(dry.tallies)).toBe(true);
          const real = yield* run();
          expect(addedOf(dry)).toEqual(addedOf(real));
        }),
      ),
    120_000,
  );

  it.live(
    "Z11: a day is reported added only when every row built for it is held and the log gained the count and checksum of the rows it lacked",
    () =>
      inScratch(
        Effect.gen(function* () {
          const log = yield* Log;
          const source = yield* Constructed.Source;
          let changed = false;
          sourceHook.current = (query) =>
            changed || !query.includes("AS seen_ms")
              ? Effect.void
              : Effect.gen(function* () {
                  changed = true;
                  yield* Effect.orDie(
                    source.admin.insert(`${source.bifrost}.logs`, [
                      Constructed.logsRowOf({
                        id: "00000000-0000-4000-8000-000000000500",
                        at: "2026-10-27 12:00:00.000",
                        session: "sA",
                        account: "codex-plus",
                        objectType: "responses_stream",
                      }),
                    ]),
                  );
                });
          const moved = yield* run();
          expect(addedOf(moved)).toEqual([["2026-10-27", "Failed"]]);
          expect(moved.days[0]?.[1]).toEqual({
            _tag: "Failed",
            detail: "the source changed while it was read",
          });
          expect(yield* countsOf).toEqual({
            items: 0,
            request_items: 0,
            requests: 0,
            session_titles: 0,
          });

          sourceHook.current = nothing;
          yield* Effect.orDie(
            source.admin.command(
              `ALTER TABLE ${source.bifrost}.logs DELETE WHERE id = '00000000-0000-4000-8000-000000000500' SETTINGS mutations_sync = 2`,
            ),
          );
          const first = Constructed.rows[0];
          if (first === undefined) return;
          const startedAt = DateTime.makeUnsafe(
            `${first.at.replace(" ", "T")}Z`,
          );
          const built = yield* Import.requestOf(
            {
              id: first.id,
              startedAt,
              session: "sA",
              metadata: "{}",
              userAgent: "",
              provider: "openai",
              model: "damaged",
              objectType: "responses_stream",
              params: "{}",
              status: "success",
              stream: true,
              stopReason: "",
              promptTokens: 0,
              completionTokens: 0,
              cachedReadTokens: 0,
              tokenUsage: "",
              cost: Option.none(),
              latency: Option.none(),
              errorDetails: "",
            },
            Constructed.targets,
            () => Option.none(),
          );
          let damaged = false;
          log.hook.current = (query) =>
            damaged || !query.startsWith("INSERT INTO requests (")
              ? Effect.void
              : Effect.gen(function* () {
                  damaged = true;
                  yield* Effect.orDie(
                    log.client.insert("requests", [
                      RequestMapper.requestRowOf(built.record),
                    ]),
                  );
                });
          const raced = yield* run();
          log.hook.current = nothing;
          expect(raced.days[0]).toEqual([
            "2026-10-27",
            {
              _tag: "Failed",
              detail: "the log's requests did not gain the rows it lacked",
            },
          ]);
          expect(raced.days).toHaveLength(1);
        }),
      ),
    120_000,
  );
});

const settingOf = (carried: Carried, name: string) =>
  Option.getOrUndefined(UrlParams.getFirst(carried.urlParams, name));

describe("an import's statements to the request log", () => {
  it.live(
    "every select of the import's session is stopped by ClickHouse after 10 minutes, as its add is, and every other select after 30 seconds",
    () =>
      inScratch(
        Effect.gen(function* () {
          const log = yield* Log;
          yield* run({ dryRun: true });
          yield* run();
          const selects = log.carried.filter(({ query }) =>
            /^\s*(SELECT|WITH)\b/i.test(query),
          );
          const inSession = selects.filter(
            (carried) => settingOf(carried, "session_id") !== undefined,
          );
          const outside = selects.filter(
            (carried) => settingOf(carried, "session_id") === undefined,
          );
          expect(inSession.length).toBeGreaterThan(0);
          expect(outside.length).toBeGreaterThan(0);
          expect(
            new Set(
              inSession.map((carried) =>
                settingOf(carried, "max_execution_time"),
              ),
            ),
          ).toEqual(new Set(["600"]));
          expect(
            new Set(
              outside.map((carried) =>
                settingOf(carried, "max_execution_time"),
              ),
            ),
          ).toEqual(new Set(["30"]));
          expect(
            inSession.some(({ query }) =>
              query.includes("uniqExact(request_id)"),
            ),
          ).toBe(true);
        }),
      ),
    120_000,
  );
});

const dayOnly = (day: string) => ({
  from: Option.some(Archive.Day.make(day)),
  to: Option.some(Archive.Day.make(day)),
});

const largeUuid = (n: number) =>
  `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`;

/** A request of a large page, its `request_items` row naming one item of its own, and that item, first sent by `firstSentBy`. */
const largeRequest = (
  n: number,
  at: string,
  session: string,
  firstSentBy: string,
) => {
  const id = largeUuid(n);
  const hash = String(1_000_000 + n);
  return {
    logs: Constructed.logsRowOf({
      id,
      at,
      session,
      account: "codex-plus",
      objectType: "responses_stream",
    }),
    requestItems: {
      request_id: id,
      session_key: session,
      timestamp: at,
      logged_at: at,
      input: [hash],
      output: [],
      tools: [],
    },
    messages: {
      session_key: session,
      hash,
      first_seen: at,
      logged_at: at,
      request_id: firstSentBy,
      source: "input",
      position: 1,
      type: "",
      role: "",
      content: JSON.stringify({
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: `Step ${n}` }],
      }),
      text: "",
    },
  };
};

const addToSource = (
  requests: ReadonlyArray<ReturnType<typeof largeRequest>>,
) =>
  Effect.gen(function* () {
    const source = yield* Constructed.Source;
    yield* Effect.orDie(
      Effect.all([
        source.admin.insert(
          `${source.bifrost}.logs`,
          requests.map(({ logs }) => logs),
        ),
        source.admin.insert(
          `${source.hub}.request_items`,
          requests.map(({ requestItems }) => requestItems),
        ),
        source.admin.insert(
          `${source.hub}.messages`,
          requests.map(({ messages }) => messages),
        ),
      ]),
    );
  });

const atSecond = (day: string, second: number) =>
  `${day} ${new Date(second * 1000).toISOString().slice(11, 23)}`;

// ClickHouse refuses a URL field past 128 KiB as sent: about 2,900 request ids,
// or 800 of the session keys below.
describe("an import of pages past what a URL field holds", () => {
  it.live(
    "Z6: a session with 5,000 requests on one day is imported whole, and a second import adds nothing",
    () =>
      inScratch(
        Effect.gen(function* () {
          const day = "2026-10-30";
          yield* addToSource(
            Array.from({ length: 5_000 }, (_, n) =>
              largeRequest(n, atSecond(day, n * 10), "sLong", largeUuid(n)),
            ),
          );
          const done = yield* run({ range: dayOnly(day) });
          expect(addedOf(done)).toEqual([
            [
              day,
              {
                items: 5_000,
                request_items: 5_000,
                requests: 5_000,
                session_titles: 0,
              },
            ],
          ]);
          const again = yield* run({ range: dayOnly(day) });
          expect(addedOf(again)).toEqual([[day, "Held"]]);
          expect(yield* countsOf).toEqual({
            items: 5_000,
            request_items: 5_000,
            requests: 5_000,
            session_titles: 0,
          });
        }),
      ),
    300_000,
  );

  it.live(
    "Z6: a day whose session keys and titles together pass 128 KiB as sent, each session with an item its own request did not send, is imported whole, and a second import adds nothing",
    () =>
      Effect.gen(function* () {
        const day = "2026-10-31";
        const sessions = Array.from(
          { length: 1_000 },
          (_, n) => `s${String(n).padStart(4, "0")}-${"k".repeat(150)}`,
        );
        const titles = titlesFileOf(
          "long-titles.db",
          sessions.map((session, n) => [session, `Session ${n}`]),
        );
        yield* inScratch(
          Effect.gen(function* () {
            yield* addToSource(
              sessions.map((session, n) =>
                largeRequest(
                  10_000 + n,
                  atSecond(day, n * 60),
                  session,
                  largeUuid(90_000 + n),
                ),
              ),
            );
            const done = yield* run({ range: dayOnly(day), titles });
            expect(addedOf(done)).toEqual([
              [
                day,
                {
                  items: 1_000,
                  request_items: 1_000,
                  requests: 1_000,
                  session_titles: 1_000,
                },
              ],
            ]);
            const again = yield* run({ range: dayOnly(day), titles });
            expect(addedOf(again)).toEqual([[day, "Held"]]);
            expect(yield* countsOf).toEqual({
              items: 1_000,
              request_items: 1_000,
              requests: 1_000,
              session_titles: 1_000,
            });
          }),
        );
      }),
    300_000,
  );
});
