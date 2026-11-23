import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "@effect/vitest";
import {
  Context,
  DateTime,
  Duration,
  Effect,
  Exit,
  Layer,
  Logger,
  Metric,
  Option,
  Schema,
  Scope,
} from "effect";
import { TestClock } from "effect/testing";
import * as Copy from "#lib/copy.ts";
import * as RecordRequest from "#modules/request-log/02-application/commands/record-request.command.ts";
import { Prices } from "#modules/request-log/02-application/interfaces/prices.ts";
import {
  type Batch,
  RequestsRepository,
} from "#modules/request-log/02-application/interfaces/requests.repository.ts";
import * as RebuildConversation from "#modules/request-log/02-application/queries/rebuild-conversation.query.ts";
import * as StoredItems from "#modules/request-log/03-domain/stored-items.ts";
import * as PriceLists from "#modules/request-log/04-infrastructure/prices/prices.ts";
import * as Scratch from "#modules/request-log/05-tests/scratch.ts";
import { LoginFingerprint, PoolId } from "#shared/03-domain/ids.ts";
import type { ProtocolName } from "#shared/03-domain/protocol-name.ts";
import * as Request from "#shared/03-domain/request.entity.ts";
import * as Harness from "#shared/05-tests/harness.ts";
import * as Replay from "#shared/05-tests/replay/replay.ts";
import * as ClickHouseRequests from "./clickhouse-requests.repository.ts";
import * as ClickHouse from "./client.ts";
import * as ItemMapper from "./mappers/item.mapper.ts";
import * as RequestMapper from "./mappers/request.mapper.ts";
import * as RequestItemsMapper from "./mappers/request-items.mapper.ts";
import * as Tables from "./schema.ts";

const replayed: ReadonlyArray<Replay.Replay> = await Effect.runPromise(
  Effect.gen(function* () {
    const all: Array<Replay.Replay> = [];
    for (const loaded of Replay.load()) {
      all.push(yield* Replay.replay(loaded, "whole"));
    }
    return all;
  }).pipe(Effect.provide(Layer.provideMerge(Replay.layer, TestClock.layer()))),
);

const listOf: Readonly<Record<ProtocolName, string>> = {
  "anthropic-messages": "anthropic",
  "chatgpt-codex": "openai",
  "openai-chat": "zai",
};

const prices = Layer.succeed(
  Prices,
  Prices.of({
    of: (asked) =>
      PriceLists.priceOf(
        { prices: Option.some(listOf[asked.protocol]), ownPrices: {} },
        asked,
      ),
  }),
);

/** The command over the ClickHouse repository, with the batches it handed the repository. */
const started = (options: Partial<RecordRequest.Options> = {}) =>
  Effect.gen(function* () {
    const stored: Array<Batch> = [];
    const capturing = Layer.effect(
      RequestsRepository,
      Effect.map(RequestsRepository, (repository) =>
        RequestsRepository.of({
          ...repository,
          store: (batch, token) =>
            Effect.andThen(
              Effect.sync(() => stored.push(batch)),
              repository.store(batch, token),
            ),
        }),
      ),
    ).pipe(Layer.provide(ClickHouseRequests.layer));
    const scope = yield* Scope.make();
    yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
    const context = yield* Layer.buildWithScope(
      RecordRequest.layer({
        ...RecordRequest.defaults,
        firstPause: Duration.millis(20),
        longestPause: Duration.millis(200),
        ...options,
      }).pipe(Layer.provide([capturing, prices])),
      scope,
    );
    return {
      recordRequest: Context.get(context, RecordRequest.RecordRequest),
      stored,
      close: Scope.close(scope, Exit.void),
    };
  });

const rowsOf = <A, I>(sql: string, schema: Schema.Codec<A, I>) =>
  Effect.flatMap(ClickHouse.ClickHouse, (clickHouse) =>
    clickHouse.select(sql, schema).pipe(Effect.orDie),
  );

const Count = Schema.Struct({ count: Schema.String });

const countOf = (table: string) =>
  Effect.map(
    rowsOf(`SELECT toString(count()) AS count FROM ${table}`, Count),
    ([row]) => Number(row?.count ?? 0),
  );

/** Waits until a table has `count` rows, or exists, for up to five seconds. */
const until = (table: string, count: number) =>
  Effect.gen(function* () {
    for (let step = 0; step < 250; step++) {
      const now = yield* countOf(table).pipe(
        Effect.catchDefect(() => Effect.succeed(0)),
      );
      if (now >= count) return;
      yield* Effect.sleep(Duration.millis(20));
    }
  });

/**
 * Runs a test in a database of its own; what it starts is stopped before the
 * database is dropped.
 */
const inScratch = <A, E>(
  test: Effect.Effect<
    A,
    E,
    Scope.Scope | Scratch.Scratch | ClickHouse.ClickHouse
  >,
) => test.pipe(Effect.scoped, Effect.provide(Scratch.layer));

const sentTo = (prefix: string) =>
  Effect.map(Scratch.Scratch, ({ faults }) =>
    faults.sent.filter((query) => query.startsWith(prefix)),
  );

const byKey =
  <A>(key: (row: A) => string) =>
  (rows: ReadonlyArray<A>) =>
    [...rows].sort((one, other) => key(one).localeCompare(key(other)));

const requestsInOrder = byKey<RequestMapper.RequestRow>(({ id }) => id);
const requestItemsInOrder = byKey<RequestItemsMapper.RequestItemsRow>(
  ({ request_id }) => request_id,
);
const itemsInOrder = byKey<ItemMapper.ItemRow>(
  ({ session, digest }) => `${session}\u0000${digest.padStart(39, "0")}`,
);

/** The rows of what the command handed the repository, as the mappers make them. */
const rowsStored = (stored: ReadonlyArray<Batch>) => ({
  items: stored.flatMap(({ items }) => items.map(ItemMapper.itemRowOf)),
  requestItems: stored.flatMap(({ requestItems }) =>
    requestItems.map(RequestItemsMapper.requestItemsRowOf),
  ),
  requests: stored.flatMap(({ requests }) =>
    requests.map(({ request, cost }) =>
      RequestMapper.requestRowOf({
        request: StoredItems.storedOf(request),
        cost,
      }),
    ),
  ),
});

const rebuild = (id: Request.RequestId) =>
  Effect.flatMap(RebuildConversation.RebuildConversation, ({ execute }) =>
    execute(id),
  ).pipe(
    Effect.provide(
      RebuildConversation.layer.pipe(Layer.provide(ClickHouseRequests.layer)),
    ),
    Effect.orDie,
  );

const bodyOf = (said: ReadonlyArray<string>) => ({
  model: "claude-opus-5-5",
  system: [
    {
      type: "text",
      text: "Be brief.",
      cache_control: { type: "ephemeral" },
    },
  ],
  messages: said.map((content, at) => ({
    role: at % 2 === 0 ? "user" : "assistant",
    content,
  })),
});

const turn = (session: string, said: ReadonlyArray<string>) =>
  Harness.requestOf({
    session,
    conversation: Harness.anthropicConversation(bodyOf(said)),
  });

const droppedSoFar = Effect.map(
  Metric.value(RecordRequest.dropped),
  ({ count }) => Number(count),
);

const PerRequest = Schema.Struct({ id: Schema.String, count: Schema.String });

/** How many rows a table has of each request, by the column that holds its id. */
const perRequest = (table: string, column: string) =>
  Effect.map(
    rowsOf(
      `SELECT toString(${column}) AS id, toString(count()) AS count FROM ${table} GROUP BY ${column}`,
      PerRequest,
    ),
    (rows) =>
      Object.fromEntries(rows.map(({ id, count }) => [id, Number(count)])),
  );

/** One for each request given, as `perRequest` counts them. */
const onceEach = (requests: ReadonlyArray<Request.ForwardedRequest>) =>
  Object.fromEntries(requests.map(({ id }) => [id, 1]));

const odd =
  "it's a \\ session\twith\nodd 'chars', ✓, \u0000 and halves of pairs, \ud800 and \udc00";
const oddWellFormed =
  "it's a \\ session\twith\nodd 'chars', ✓, \u0000 and halves of pairs, \ufffd and \ufffd";

/** A request with every field the request log keeps set, and set oddly. */
const everyField = (): Request.ForwardedRequest => {
  const said = { role: "user", content: [{ type: "text", text: odd }] };
  return Harness.requestOf({
    firstByteMs: Option.some(12),
    durationMs: 3456,
    session: odd,
    sessionSource: "x-claude-code-session-id",
    machine: "workstation",
    project: "cota",
    client: "claude-code",
    clientVersion: "2.3.1",
    userAgent: "claude-cli/2.3.1 (external, cli)",
    divertedFrom: Option.some(PoolId.make("solo")),
    follows: Option.some(Request.RequestId.make(Bun.randomUUIDv7())),
    loginFingerprint: Option.some(LoginFingerprint.make("fp_5e2a")),
    refusalReset: Option.some(DateTime.makeUnsafe("2026-11-12T05:00:00.123Z")),
    purpose: "title",
    model: "claude-opus-5-5",
    servedModel: "claude-opus-5-5-20261001",
    stream: true,
    outcome: "refused",
    upstreamStatus: 429,
    errorType: "rate_limit_error",
    errorMessage: `limit "reached"\n${odd}`,
    stopReason: "end_turn",
    usage: Option.some({
      tokens: {
        input: 123_456_789,
        cacheRead: 3,
        cacheWriteShort: 0,
        cacheWriteLong: 0,
        output: 7,
      },
      reasoning: 2,
      reported: '{"input_tokens":123456789,"cache_read_input_tokens":3}',
    }),
    serviceTier: "fast",
    providerRequestId: "req_011",
    rateLimits: { "anthropic-ratelimit-unified-reset": "1794459600", odd },
    clientHeaders: { "anthropic-beta": "fast-mode-2026-02-01" },
    conversation: Harness.anthropicConversation(
      { model: "claude-opus-5-5", messages: [said] },
      [{ role: "assistant", content: [{ type: "text", text: "✓" }] }],
    ),
    errorBody: '{"type":"error"}',
    requestBytes: 4_000_000_000,
    responseBytes: 456,
    readingComplete: false,
  });
};

const asJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.JsonObject),
);

const replayedBodyOf = (replay: Replay.Replay) =>
  Copy.decodedBody(
    replay.sent,
    replay.exchange.request.headers["content-encoding"],
    Number.MAX_SAFE_INTEGER,
  ).pipe(
    Effect.map((bytes) => asJson(new TextDecoder().decode(bytes))),
    Effect.orDie,
  );

const specColumns = (() => {
  const spec = readFileSync(
    fileURLToPath(
      new URL(
        "../../../../../../../../docs/specs/request-log/spec.md",
        import.meta.url,
      ),
    ),
    "utf8",
  );
  const tables: Record<string, Array<readonly [string, string]>> = {};
  let table = "";
  for (const line of spec.split("\n")) {
    const heading = line.match(/^### `(\w+)`$/);
    if (heading?.[1] !== undefined) table = heading[1];
    const row = line.match(/^\| (`\w+`(?:, `\w+`)*) \| `(.+?)` \|/);
    if (row?.[1] === undefined || row[2] === undefined || table === "")
      continue;
    for (const name of row[1].matchAll(/`(\w+)`/g)) {
      tables[table] = [...(tables[table] ?? []), [name[1] ?? "", row[2]]];
    }
  }
  return tables;
})();

const Column = Schema.Struct({
  table: Schema.String,
  name: Schema.String,
  type: Schema.String,
});

const TableRow = Schema.Struct({
  name: Schema.String,
  engine: Schema.String,
  partition_key: Schema.String,
  sorting_key: Schema.String,
  create_table_query: Schema.String,
});

const tablesNow = Effect.gen(function* () {
  const { database } = yield* Scratch.Scratch;
  return yield* rowsOf(
    `SELECT name, engine, partition_key, sorting_key, create_table_query FROM system.tables WHERE database = '${database}' ORDER BY name`,
    TableRow,
  );
});

/** What `prepare` logs, as JSON lines. */
const loggedByPrepare = Effect.gen(function* () {
  const lines: Array<string> = [];
  yield* Tables.prepare().pipe(
    Effect.orDie,
    Effect.provide(
      Logger.layer([
        Logger.map(Logger.formatJson, (line) => {
          lines.push(line);
        }),
      ]),
    ),
  );
  return lines;
});

describe("the request log in ClickHouse", () => {
  it.live(
    "says in one log line, every time it prepares, that an items table made without its version keeps an item's latest copy, and leaves the table as it is",
    () =>
      Effect.gen(function* () {
        const clickHouse = yield* ClickHouse.ClickHouse;
        yield* clickHouse
          .command(
            Tables.items
              .replace(/\n\s*version [^\n]*/, "")
              .replace("ReplacingMergeTree(version)", "ReplacingMergeTree"),
          )
          .pipe(Effect.orDie);
        const made = yield* tablesNow;

        const logged = [yield* loggedByPrepare, yield* loggedByPrepare];

        expect(
          logged.map((lines) =>
            lines.map((line) => {
              const { message, level } = JSON.parse(line);
              return { message, level };
            }),
          ),
        ).toEqual(
          Array.from({ length: 2 }, () => [
            { message: Tables.unversionedItems, level: "WARN" },
          ]),
        );
        expect((yield* tablesNow).find(({ name }) => name === "items")).toEqual(
          made.find(({ name }) => name === "items"),
        );
        yield* clickHouse.command("DROP TABLE items SYNC").pipe(Effect.orDie);
        expect(yield* loggedByPrepare).toEqual([]);
      }).pipe(inScratch),
  );

  it.live(
    "creates the tables the spec gives, column by column, and creating them again changes nothing",
    () =>
      Effect.gen(function* () {
        const { database } = yield* Scratch.Scratch;
        yield* Tables.prepare().pipe(Effect.orDie);
        const columns = yield* rowsOf(
          `SELECT table, name, type FROM system.columns WHERE database = '${database}' ORDER BY table, position`,
          Column,
        );
        const created = yield* tablesNow;
        const { recordRequest, close } = yield* started();
        yield* recordRequest.execute(everyField());
        yield* close;
        yield* Tables.prepare().pipe(Effect.orDie);

        expect(
          Object.fromEntries(
            [
              "items",
              "request_items",
              "requests",
              "session_titles",
              "words",
            ].map((table) => [
              table,
              columns
                .filter((column) => column.table === table)
                .map(({ name, type }) => [name, type]),
            ]),
          ),
        ).toEqual(specColumns);
        expect(
          created.map(({ name, engine, partition_key, sorting_key }) => [
            name,
            engine,
            partition_key,
            sorting_key,
          ]),
        ).toEqual([
          ["items", "ReplacingMergeTree", "", "session, digest"],
          [
            "request_items",
            "MergeTree",
            "toYYYYMM(started_at)",
            "session, started_at, request_id",
          ],
          ["requests", "MergeTree", "toYYYYMM(started_at)", "started_at, id"],
          ["session_titles", "MergeTree", "", "session, reported_at"],
          ["words", "ReplacingMergeTree", "", "word"],
          ["words_writer", "MaterializedView", "", ""],
        ]);
        expect(yield* tablesNow).toEqual(created);
        expect(yield* countOf("requests")).toBe(1);
      }).pipe(inScratch),
  );

  it.live(
    "writes the request of every exchange, and one with every field set, and reads each column back as it was written",
    () =>
      Effect.gen(function* () {
        const { recordRequest, stored, close } = yield* started();
        const odd = everyField();
        for (const { logged } of replayed) yield* recordRequest.execute(logged);
        yield* recordRequest.execute(odd);
        yield* close;

        const requests = yield* rowsOf(
          "SELECT * FROM requests",
          RequestMapper.RequestRow,
        );
        expect(requestsInOrder(requests)).toEqual(
          requestsInOrder(rowsStored(stored).requests),
        );
        expect(requests).toHaveLength(replayed.length + 1);
        const written = requests.find(({ id }) => id === odd.id);
        expect([
          written?.cost_usd,
          written?.session,
          written?.rate_limits.odd,
        ]).toEqual(["987.654593200000", oddWellFormed, oddWellFormed]);
        expect(
          requests.filter(({ cost_usd }) => cost_usd !== null).length,
        ).toBeGreaterThan(5);
        expect(
          requestItemsInOrder(
            yield* rowsOf(
              "SELECT * FROM request_items",
              RequestItemsMapper.RequestItemsRow,
            ),
          ),
        ).toEqual(requestItemsInOrder(rowsStored(stored).requestItems));
        expect(
          itemsInOrder(
            yield* rowsOf("SELECT * FROM items", ItemMapper.ItemRow),
          ),
        ).toEqual(itemsInOrder(rowsStored(stored).items));
      }).pipe(inScratch),
  );

  it.live(
    "L1: For every JSON object a protocol can split, joining what it was split into gives the same JSON value. Rebuilt from ClickHouse's three tables, for every exchange and a request with odd text.",
    () =>
      Effect.gen(function* () {
        const { recordRequest, close } = yield* started();
        const odd = everyField();
        for (const { logged } of replayed) yield* recordRequest.execute(logged);
        yield* recordRequest.execute(odd);
        yield* close;

        let rebuilt = 0;
        for (const replay of replayed) {
          const body = yield* replayedBodyOf(replay);
          const again = yield* rebuild(replay.logged.id);
          if (Option.isNone(replay.logged.conversation)) {
            expect(again, replay.file).toEqual(Option.none());
            continue;
          }
          rebuilt++;
          expect(
            Option.isSome(body) &&
              Option.exists(again, (each) =>
                Harness.sameJson(each, body.value),
              ),
            replay.file,
          ).toBe(true);
        }
        expect(rebuilt).toBeGreaterThan(10);
        expect(yield* rebuild(odd.id)).toEqual(
          Option.some({
            model: "claude-opus-5-5",
            messages: [
              { role: "user", content: [{ type: "text", text: odd.session }] },
            ],
          }),
        );
      }).pipe(inScratch),
  );

  it.live(
    "asks ClickHouse which items a session has whatever its id holds, once per session the writer has not seen",
    () =>
      Effect.gen(function* () {
        const sessions = [odd, "'", "\\", "\\'", "", "plain"];
        const first = yield* started();
        for (const session of sessions) {
          yield* first.recordRequest.execute(turn(session, ["hello"]));
        }
        yield* first.close;

        const { recordRequest, close } = yield* started();
        for (const session of sessions) {
          yield* recordRequest.execute(turn(session, ["hello", "hi"]));
        }
        yield* until("requests", sessions.length * 2);
        for (const session of sessions) {
          yield* recordRequest.execute(turn(session, ["hello", "hi", "again"]));
        }
        yield* close;

        const asked = yield* sentTo("SELECT session, digest FROM items");
        expect(asked).toHaveLength(2);
        const stored = yield* rowsOf("SELECT * FROM items", ItemMapper.ItemRow);
        expect(stored).toHaveLength(sessions.length * 4);
        expect(new Set(stored.map(({ session }) => session))).toEqual(
          new Set([oddWellFormed, ...sessions.slice(1)]),
        );
      }).pipe(inScratch),
  );

  it.live(
    "L2: Two items of one session that are the same JSON value once the overlay is out have the same digest, and are stored once. Written to ClickHouse across batches and across a writer started again.",
    () =>
      Effect.gen(function* () {
        const first = yield* started();
        yield* first.recordRequest.execute(turn("one", ["hello"]));
        yield* until("requests", 1);
        yield* first.recordRequest.execute(
          turn("one", ["hello", "hi", "again"]),
        );
        yield* until("requests", 2);
        yield* first.recordRequest.execute(
          turn("one", ["hello", "hi", "again", "x"]),
        );
        yield* first.close;
        const second = yield* started();
        yield* second.recordRequest.execute(
          turn("one", ["hello", "hi", "again", "x", "y"]),
        );
        yield* second.close;

        const stored = yield* rowsOf("SELECT * FROM items", ItemMapper.ItemRow);
        expect(stored.map(({ content }) => content).sort()).toEqual(
          [
            '{"text":"Be brief.","type":"text"}',
            '{"content":"hello","role":"user"}',
            '{"content":"hi","role":"assistant"}',
            '{"content":"again","role":"user"}',
            '{"content":"x","role":"assistant"}',
            '{"content":"y","role":"user"}',
          ].sort(),
        );
        expect(yield* sentTo("SELECT session, digest FROM items")).toHaveLength(
          2,
        );
      }).pipe(inScratch),
  );
  it.live(
    "inserts a batch's new items, then its request_items, then its requests",
    () =>
      Effect.gen(function* () {
        const { recordRequest, close } = yield* started();
        yield* recordRequest.execute(turn("s", ["hello"]));
        yield* recordRequest.execute(turn("s", ["hello", "hi", "again"]));
        yield* close;

        expect(yield* sentTo("INSERT INTO")).toEqual([
          "INSERT INTO items FORMAT JSONEachRow",
          "INSERT INTO request_items FORMAT JSONEachRow",
          "INSERT INTO requests FORMAT JSONEachRow",
        ]);
      }).pipe(inScratch),
  );

  it.live(
    "tries a batch again after each of its inserts was stored and its answer lost, and stores it once, across months",
    () =>
      Effect.gen(function* () {
        const { faults } = yield* Scratch.Scratch;
        const lost = new Set<string>();
        faults.faultOf = (query) => {
          if (!query.startsWith("INSERT INTO") || lost.has(query)) {
            return undefined;
          }
          lost.add(query);
          return "answerLost";
        };
        const { recordRequest, close } = yield* started();
        const months = ["2026-10-31T23:59:59.999Z", "2026-11-01T00:00:00.000Z"];
        for (const [at, startedAt] of months.entries()) {
          for (const session of ["one", "two"]) {
            yield* recordRequest.execute({
              ...turn(session, at === 0 ? ["hello"] : ["hello", "hi"]),
              startedAt: DateTime.makeUnsafe(startedAt),
            });
          }
        }
        yield* close;

        expect(lost).toHaveLength(3);
        expect((yield* sentTo("INSERT INTO")).length).toBeGreaterThan(3);
        expect([
          yield* countOf("items"),
          yield* countOf("request_items"),
          yield* countOf("requests"),
        ]).toEqual([6, 4, 4]);
        expect(
          (yield* rowsOf(
            "SELECT DISTINCT _partition_id AS partition FROM requests ORDER BY partition",
            Schema.Struct({ partition: Schema.String }),
          )).map(({ partition }) => partition),
        ).toEqual(["202610", "202611"]);
      }).pipe(inScratch),
  );

  it.live(
    "keeps requests while ClickHouse is down, and writes each once when it is back",
    () =>
      Effect.gen(function* () {
        const { faults } = yield* Scratch.Scratch;
        faults.faultOf = () => "down";
        const { recordRequest, close } = yield* started();
        yield* recordRequest.execute(turn("s", ["hello"]));
        yield* Effect.sleep(Duration.millis(300));
        yield* recordRequest.execute(turn("s", ["hello", "hi"]));
        yield* Effect.sleep(Duration.millis(300));
        const triedWhileDown = faults.sent.length;
        faults.faultOf = () => undefined;
        yield* until("requests", 2);
        yield* recordRequest.execute(turn("s", ["hello", "hi", "again"]));
        yield* close;

        expect(triedWhileDown).toBeGreaterThan(2);
        expect([
          yield* countOf("items"),
          yield* countOf("request_items"),
          yield* countOf("requests"),
        ]).toEqual([4, 3, 3]);
      }).pipe(inScratch),
  );

  it.live(
    "drops the oldest requests when its queue is full while ClickHouse is down",
    () =>
      Effect.gen(function* () {
        const { faults } = yield* Scratch.Scratch;
        faults.faultOf = () => "down";
        const { recordRequest, close } = yield* started({ capacity: 3 });
        for (const at of [1, 2, 3, 4, 5]) {
          yield* recordRequest.execute(Harness.requestOf({ model: `m${at}` }));
        }
        faults.faultOf = () => undefined;
        yield* close;

        expect(
          (yield* rowsOf("SELECT * FROM requests", RequestMapper.RequestRow))
            .map(({ model }) => model)
            .sort(),
        ).toEqual(["m3", "m4", "m5"]);
      }).pipe(inScratch),
  );

  it.live(
    "L4: The rows written for a request are its rows as sent with each lone surrogate in a text made U+FFFD, so that every text is well-formed; an item's content and a request's layout, overlay and params, which write one as its escape, are as sent. Written to ClickHouse: a request whose body holds a lone surrogate is written, and so are the requests after it.",
    () =>
      Effect.gen(function* () {
        const body = JSON.parse(
          '{"model":"claude-opus-5-5","messages":[{"role":"user","content":"half a pair: \\ud800"}]}',
        );
        const lone = Harness.requestOf({
          session: "lone",
          conversation: Harness.anthropicConversation(body),
        });
        const { recordRequest, close } = yield* started({
          drainTimeout: Duration.seconds(3),
        });
        yield* recordRequest.execute(lone);
        yield* recordRequest.execute(turn("after", ["hello"]));
        yield* close;

        expect(yield* countOf("requests")).toBe(2);
        expect(
          yield* rowsOf(
            "SELECT text FROM items WHERE session = 'lone'",
            Schema.Struct({ text: Schema.String }),
          ),
        ).toEqual([{ text: "half a pair: �" }]);
        expect(yield* rebuild(lone.id)).toEqual(Option.some(body));
      }).pipe(inScratch),
  );

  it.live(
    "L5: When the repository declines every batch that holds certain requests and stores every other batch, each other request is stored once, with a body that comes back, and, once one of them is stored, each of those requests is dropped and counted once. Written to ClickHouse, whose items decline a marked request: the requests of its batch and of a later one, of its session and another, are each written once and rebuilt, and it is dropped once.",
    () =>
      Effect.gen(function* () {
        const clickHouse = yield* ClickHouse.ClickHouse;
        yield* Tables.prepare().pipe(Effect.orDie);
        yield* clickHouse
          .command(
            "ALTER TABLE items ADD CONSTRAINT marked CHECK position(content, 'marked') = 0",
          )
          .pipe(Effect.orDie);
        const first = [
          { session: "a", said: ["hello"] },
          { session: "b", said: ["hello"] },
          { session: "a", said: ["hello", "hi", "marked"] },
          { session: "a", said: ["hello", "hi", "again"] },
          { session: "b", said: ["hello", "hi"] },
        ];
        const later = [
          { session: "a", said: ["hello", "hi", "again", "more"] },
          { session: "b", said: ["hello", "hi", "bye"] },
        ];
        const sent = [...first, ...later].map(({ session, said }) => ({
          request: turn(session, said),
          body: bodyOf(said),
        }));
        const marked = sent[2]?.request;
        const others = sent.filter(({ request }) => request !== marked);
        const before = yield* droppedSoFar;
        const { recordRequest, stored, close } = yield* started({
          drainTimeout: Duration.seconds(3),
        });
        for (const { request } of sent.slice(0, first.length)) {
          yield* recordRequest.execute(request);
        }
        yield* until("requests", first.length - 1);
        for (const { request } of sent.slice(first.length)) {
          yield* recordRequest.execute(request);
        }
        yield* close;

        expect(stored[0]?.requests).toHaveLength(first.length);
        expect(yield* perRequest("requests", "id")).toEqual(
          onceEach(others.map(({ request }) => request)),
        );
        for (const { request, body } of others) {
          expect(yield* rebuild(request.id)).toEqual(Option.some(body));
        }
        expect((yield* droppedSoFar) - before).toBe(1);
      }).pipe(inScratch),
  );

  it.live(
    "writes each request's request_items row once when ClickHouse declines a batch at its requests, after its items and request_items were written",
    () =>
      Effect.gen(function* () {
        const clickHouse = yield* ClickHouse.ClickHouse;
        yield* Tables.prepare().pipe(Effect.orDie);
        yield* clickHouse
          .command(
            "ALTER TABLE requests ADD CONSTRAINT marked CHECK model != 'marked'",
          )
          .pipe(Effect.orDie);
        const sent = [
          { session: "a", said: ["hello"] },
          { session: "b", said: ["hello"] },
          { session: "a", said: ["hello", "hi", "again"] },
          { session: "b", said: ["hello", "hi"] },
          { session: "a", said: ["hello", "hi", "again", "more"] },
        ].map(({ session, said }, at) => ({
          request: {
            ...turn(session, said),
            model: at === 2 ? "marked" : "claude-opus-5-5",
          },
          body: bodyOf(said),
        }));
        const marked = sent[2]?.request;
        const others = sent.filter(({ request }) => request !== marked);
        const { recordRequest, stored, close } = yield* started({
          drainTimeout: Duration.seconds(3),
        });
        for (const { request } of sent) yield* recordRequest.execute(request);
        yield* close;

        expect(stored[0]?.requests).toHaveLength(sent.length);
        expect(yield* perRequest("request_items", "request_id")).toEqual(
          onceEach(sent.map(({ request }) => request)),
        );
        expect(yield* perRequest("requests", "id")).toEqual(
          onceEach(others.map(({ request }) => request)),
        );
        for (const { request, body } of others) {
          expect(yield* rebuild(request.id)).toEqual(Option.some(body));
        }
      }).pipe(inScratch),
  );

  it.live("writes every request it holds when it is shut down", () =>
    Effect.gen(function* () {
      const { recordRequest, close } = yield* started({ batchSize: 40 });
      for (let at = 0; at < 300; at++) {
        yield* recordRequest.execute(
          turn(`s${at % 7}`, ["hello", `turn ${at}`]),
        );
      }
      yield* close;

      expect([
        yield* countOf("items"),
        yield* countOf("request_items"),
        yield* countOf("requests"),
      ]).toEqual([7 * 2 + 300, 300, 300]);
    }).pipe(inScratch),
  );
});
