import { describe, expect, it } from "@effect/vitest";
import {
  Arbitrary,
  DateTime,
  Effect,
  Layer,
  Option,
  Schema,
  type Scope,
} from "effect";
import * as QuotaHeaders from "#modules/quota/03-domain/quota-headers.ts";
import * as QuotaLog from "#modules/quota/05-tests/quota-log.ts";
import {
  type QuotaHeaderAsked,
  RequestLogReader,
  type Wanted,
} from "#modules/request-log/02-application/interfaces/request-log-reader.ts";
import type { PricedRequest } from "#modules/request-log/02-application/interfaces/requests.repository.ts";
import * as Search from "#modules/request-log/03-domain/search.ts";
import * as Session from "#modules/request-log/03-domain/session.ts";
import type * as StoredItems from "#modules/request-log/03-domain/stored-items.ts";
import * as Traffic from "#modules/request-log/03-domain/traffic.ts";
import * as InMemoryRequestLogReader from "#modules/request-log/05-tests/fakes/in-memory-request-log-reader.ts";
import * as Scratch from "#modules/request-log/05-tests/scratch.ts";
import * as Sessions from "#modules/request-log/05-tests/sessions.ts";
import * as Generated from "#modules/request-log/05-tests/traffic.ts";
import * as RequestLog from "#modules/request-log/module.ts";
import type * as Conversation from "#shared/03-domain/conversation.ts";
import { PoolId } from "#shared/03-domain/ids.ts";
import { compareText } from "#shared/03-domain/text.ts";
import * as Harness from "#shared/05-tests/harness.ts";
import * as ClickHouseRequestLogReader from "./clickhouse-request-log-reader.ts";
import * as ClickHouse from "./client.ts";
import * as Tables from "./schema.ts";

// `words` too: a word of an earlier log would take a place among the nearest
// 100 that the in-memory reader, holding this log only, gives to another.
const emptied = Effect.gen(function* () {
  const clickHouse = yield* ClickHouse.ClickHouse;
  for (const table of ["items", "request_items", "requests", "words"]) {
    yield* clickHouse.command(`TRUNCATE TABLE IF EXISTS ${table}`);
  }
}).pipe(Effect.orDie);

const inScratch = <A, E>(
  test: Effect.Effect<
    A,
    E,
    | Scope.Scope
    | Scratch.Scratch
    | ClickHouse.ClickHouse
    | RequestLogReader
    | RequestLog.Traffic
  >,
) =>
  test.pipe(
    Effect.scoped,
    Effect.provide(
      Layer.provideMerge(
        RequestLog.traffic,
        ClickHouseRequestLogReader.layer,
      ).pipe(Layer.provideMerge(Scratch.layer)),
    ),
  );

const int = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

const asked = Arbitrary.all({
  selection: Generated.selection,
  previous: Generated.window,
  by: Generated.dimension,
  bucket: Generated.bucket,
  zone: Generated.zone,
  keys: int(1, 5),
  limit: int(1, 6),
  order: Sessions.pick(Session.SessionOrder.literals),
  offset: int(0, 8),
  search: Sessions.search,
});

type Asked = typeof asked extends Arbitrary.Arbitrary<infer A> ? A : never;

const inOrder = (points: ReadonlyArray<Traffic.Point>) =>
  [...points].sort(
    (one, other) =>
      DateTime.toEpochMillis(one.at) - DateTime.toEpochMillis(other.at) ||
      compareText(
        Option.getOrElse(one.key, () => "\u{10FFFF}"),
        Option.getOrElse(other.key, () => "\u{10FFFF}"),
      ),
  );

/** Every answer of a reader to what was asked, as data. */
const answersOf = (
  reader: RequestLogReader["Service"],
  {
    selection,
    previous,
    by,
    bucket,
    zone,
    keys,
    limit,
    order,
    offset,
    search,
  }: Asked,
) =>
  Effect.gen(function* () {
    const hits = yield* reader.hits(selection, search, 100, Option.none());
    const after = Option.fromUndefinedOr(hits[limit - 1]);
    return Generated.plain({
      overview: yield* reader.overview(selection, previous),
      points: inOrder(
        yield* reader.points(selection, { by, bucket, zone, keys }),
      ),
      breakdown: yield* reader.breakdown(selection, by, limit),
      facets: yield* reader.facets(selection, limit),
      errorGroups: yield* reader.errorGroups(selection, limit),
      sessions: yield* reader.sessions(
        selection,
        order,
        { limit, offset },
        Option.none(),
      ),
      searched: yield* reader.sessions(
        selection,
        order,
        { limit, offset },
        Option.some(search),
      ),
      hits,
      page: yield* reader.hits(selection, search, limit, Option.none()),
      next: yield* reader.hits(selection, search, limit, after),
    });
  }).pipe(Effect.orDie);

/** Tolerances that widen by a prefix, by one or two edits, and by both. */
const tolerances: ReadonlyArray<Search.Tolerance> = [
  Search.exact,
  { prefix: true, fuzzy: 0 },
  { prefix: false, fuzzy: 0.2 },
  { prefix: true, fuzzy: 0.5 },
];

const sorted = <A>(map: ReadonlyMap<string, A>) =>
  Generated.plain(
    [...map.entries()].sort(([one], [other]) => compareText(one, other)),
  );

const someParts: ReadonlyArray<ReadonlyArray<Conversation.Part>> = [
  ["input"],
  ["output"],
  ["system", "tools"],
  ["output", "input", "tools", "system"],
];

/**
 * A reader's sessions' rows, their requests as the role rules and as the
 * detail read them, the items of each request in the log, some parts of
 * each, and every request as the inspector reads it, with sessions and a
 * request it does not have, as data.
 */
const sessionsOf = (
  reader: RequestLogReader["Service"],
  log: ReadonlyArray<PricedRequest>,
) =>
  Effect.gen(function* () {
    const sessions = [
      ...new Set(log.map(({ request }) => request.session)),
      "nobody",
    ];
    const wanted = log.map(
      ({ request }, index): Wanted => ({
        session: request.session,
        id: request.id,
        parts: someParts[index % someParts.length] ?? [],
      }),
    );
    const askedElsewhere = log.find(
      ({ request }, index) =>
        index % someParts.length === 0 &&
        Option.exists(
          request.conversation,
          ({ system, output }) => system.length > 0 || output.length > 0,
        ),
    );
    const rows = [];
    const summaries = [];
    for (const session of sessions) {
      rows.push(yield* reader.session(session));
      summaries.push(yield* reader.summaries(session, 3));
      summaries.push(
        yield* reader.summaries(session, Session.mostListedRequests),
      );
    }
    const found = [];
    for (const { request } of [
      ...log,
      { request: { id: Sessions.idOf(4095) } },
    ]) {
      found.push(yield* reader.request(request.id));
    }
    const newest = [];
    for (const [at, query] of [
      ...Sessions.searchQueries,
      ...Sessions.tolerantQueries,
    ].entries()) {
      newest.push(
        sorted(
          yield* reader.newestHits(sessions, {
            query,
            tolerance: tolerances[at % tolerances.length] ?? Search.exact,
          }),
        ),
      );
    }
    // Every other request's items: an item a session holds but is not asked
    // for, while another session is, is left out.
    const contents = yield* reader.contents([
      ...log.flatMap(({ request }, index) =>
        Option.match(index % 2 === 0 ? request.conversation : Option.none(), {
          onNone: () => [],
          onSome: ({ system, input, output }) =>
            [...system, ...input, ...output].map(({ digest }) => ({
              session: request.session,
              item: digest,
            })),
        }),
      ),
      { session: "nobody", item: Sessions.digestOf("e") },
    ]);
    return {
      newest,
      contents: Generated.plain(contents),
      rows: Generated.plain(rows),
      summaries: Generated.plain(summaries),
      found: Generated.plain(found),
      requests: sorted(
        yield* reader.sessionRequests(
          sessions,
          Session.read,
          Session.mostListedRequests,
        ),
      ),
      latestRequests: sorted(
        yield* reader.sessionRequests(sessions, Session.read, 3),
      ),
      items: sorted(
        yield* reader.items([
          ...wanted,
          { session: "s1", id: Sessions.idOf(4095), parts: ["input"] },
          // A request asked for under a session that is not its own gives
          // nothing of the parts asked for there; asked for again under its
          // own, it gives the parts of both.
          ...Option.toArray(Option.fromUndefinedOr(askedElsewhere)).flatMap(
            ({ request }): ReadonlyArray<Wanted> => [
              {
                session: "nobody",
                id: request.id,
                parts: ["system", "output"],
              },
              { session: request.session, id: request.id, parts: ["tools"] },
            ],
          ),
        ]),
      ),
    };
  }).pipe(Effect.orDie);

/** A select that never ends by itself, told apart in `system.processes` by `marker`. */
const endless = (marker: string) =>
  `SELECT toString(count()) AS found FROM system.numbers WHERE sipHash64(number) = 1 AND '${marker}' != ''`;

/** How many queries holding `marker` ClickHouse still runs, `within` milliseconds from now or once they are none. */
const runningAfter = (marker: string, within: number) =>
  Effect.gen(function* () {
    const clickHouse = yield* ClickHouse.ClickHouse;
    const until = Date.now() + within;
    for (;;) {
      const [row] = yield* clickHouse
        .select(
          `SELECT toString(count()) AS running FROM system.processes
           WHERE query_id != queryID() AND position(query, {marker:String}) > 0`,
          Schema.Struct({ running: Schema.FiniteFromString }),
          { marker: ClickHouse.Param.string(marker) },
        )
        .pipe(Effect.orDie);
      const running = row?.running ?? 0;
      if (running === 0 || Date.now() >= until) return running;
      yield* Effect.sleep("100 millis");
    }
  });

/**
 * Writes the first half of a log, then the second with the writer's question
 * about a session's items failing, so that it writes again every item its
 * requests carry: later copies, in later requests, of items already stored.
 */
const writtenTwice = (log: ReadonlyArray<PricedRequest>) =>
  Effect.gen(function* () {
    const { faults } = yield* Scratch.Scratch;
    const half = Math.floor(log.length / 2);
    const first = yield* Scratch.written(log.slice(0, half));
    faults.faultOf = (query) =>
      query.startsWith("SELECT session, digest FROM items")
        ? "down"
        : undefined;
    const again = yield* Scratch.written(log.slice(half));
    faults.faultOf = () => undefined;
    return {
      requests: [...first.requests, ...again.requests],
      requestItems: [...first.requestItems, ...again.requestItems],
      items: [...first.items, ...again.items],
    };
  });

/** How many of the items stored are a second copy of an item of their session. */
const copiesIn = (items: ReadonlyArray<StoredItems.StoredItem>) =>
  items.length -
  new Set(items.map(({ session, digest }) => `${session}\u0000${digest}`)).size;

const sample = <A>(arbitrary: Arbitrary.Arbitrary<A>, count: number) =>
  Arbitrary.sampleEffect(arbitrary, { count }).pipe(Effect.orDie);

describe("the request log's reader in ClickHouse", () => {
  it.live(
    "H9: for generated request logs written by RecordRequest, every reading query answers the same over ClickHouse as over the in-memory reader, search's hits and the sessions a search query selects included",
    () =>
      Effect.gen(function* () {
        const real = yield* RequestLogReader;
        const clickHouse = yield* ClickHouse.ClickHouse;
        let compared = 0;
        let answered = 0;
        let found = 0;
        for (const log of yield* sample(Sessions.sessionLog(240), 2)) {
          yield* emptied;
          const stored = yield* writtenTwice(log);
          const fake = InMemoryRequestLogReader.make(() => stored);
          expect(stored.requests).toHaveLength(log.length);
          expect(copiesIn(stored.items)).toBeGreaterThan(0);
          for (const each of yield* sample(asked, 60)) {
            const expected = yield* answersOf(fake, each);
            expect(
              yield* answersOf(real, each),
              JSON.stringify(Generated.plain(each)),
            ).toEqual(expected);
            compared++;
            if (JSON.stringify(expected).includes('"requests":')) answered++;
            if (/"next":\[\{/.test(JSON.stringify(expected))) found++;
          }
          const expected = yield* sessionsOf(fake, log);
          expect(yield* sessionsOf(real, log)).toEqual(expected);
          expect(JSON.stringify(expected)).toContain('"role":"user"');
          expect(JSON.stringify(expected.found)).toMatch(
            /"followedBy":"[^"]+".*"params":\{"model"/,
          );
          expect(JSON.stringify(expected.summaries)).toMatch(/"cut":[1-9]/);
          expect(expected.latestRequests).not.toEqual(expected.requests);
          expect(JSON.stringify(expected.newest)).toContain('"role":"user"');
          expect(JSON.stringify(expected.found)).toContain("s\\\\8\\tnine");
          yield* clickHouse
            .command("OPTIMIZE TABLE items FINAL")
            .pipe(Effect.orDie);
          for (const each of yield* sample(asked, 10)) {
            expect(
              yield* answersOf(real, each),
              `merged: ${JSON.stringify(Generated.plain(each))}`,
            ).toEqual(yield* answersOf(fake, each));
          }
          expect(yield* sessionsOf(real, log), "merged").toEqual(expected);
        }
        expect(compared).toBe(120);
        expect(answered).toBeGreaterThan(60);
        expect(found).toBeGreaterThan(10);
      }).pipe(inScratch),
    120_000,
  );

  it.live(
    "H9: series buckets start where ClickHouse starts them, every ten minutes around each change of clock in the span and Berlin's falling back, in every time zone",
    () =>
      Effect.gen(function* () {
        const real = yield* RequestLogReader;
        const changes = [
          "2026-03-08T07:00:00Z",
          "2026-03-29T01:00:00Z",
          "2026-04-04T16:30:00Z",
          "2026-10-25T01:00:00Z",
        ].map((at) => Date.parse(at));
        const minutes = 60 * 1000;
        const stored = yield* Scratch.written(
          changes.flatMap((change) =>
            Array.from({ length: 157 }, (_, step) => ({
              request: Harness.requestOf({
                startedAt: DateTime.makeUnsafe(
                  change + (step - 78) * 10 * minutes,
                ),
              }),
              cost: Option.none(),
            })),
          ),
        );
        const fake = InMemoryRequestLogReader.make(() => stored);
        const selection = {
          window: {
            from: DateTime.makeUnsafe(Generated.span.from),
            to: DateTime.makeUnsafe(Date.UTC(2026, 10, 1)),
          },
          filters: Traffic.noFilters,
        };
        for (const id of Generated.zones) {
          for (const bucket of Traffic.Bucket.literals) {
            const series = {
              by: "pool" as const,
              bucket,
              zone: DateTime.zoneMakeNamedUnsafe(id),
              keys: 12,
            };
            expect(
              Generated.plain(inOrder(yield* real.points(selection, series))),
              `${id}, ${bucket}`,
            ).toEqual(
              Generated.plain(inOrder(yield* fake.points(selection, series))),
            );
          }
        }
      }).pipe(inScratch),
    120_000,
  );

  it.live(
    "H9: for generated request logs whose answers carry quota headers, the latest quota headers of the pools and names asked answer the same over ClickHouse as over the in-memory reader",
    () =>
      Effect.gen(function* () {
        const real = yield* RequestLogReader;
        const pools = [
          ...QuotaLog.pools.map(({ id }) => id),
          PoolId.make("nobody"),
        ];
        const names = [
          ...QuotaHeaders.namesOf("anthropic-messages"),
          ...QuotaHeaders.namesOf("chatgpt-codex"),
          "retry-after",
          "anthropic-ratelimit-unified-status",
          "nothing",
        ];
        const pairs = pools.flatMap((pool) =>
          names.map((name): QuotaHeaderAsked => ({ pool, name })),
        );
        const questions = Arbitrary.all({
          since: QuotaLog.startedAt,
          asked: Arbitrary.array(Arbitrary.schema(Schema.Boolean), {
            minLength: pairs.length,
            maxLength: pairs.length,
          }),
        });
        let latest = 0;
        for (const log of yield* sample(QuotaLog.quotaLog(300), 2)) {
          yield* emptied;
          const stored = yield* Scratch.written(log);
          const fake = InMemoryRequestLogReader.make(() => stored);
          const asked = [
            ...(yield* sample(questions, 20)).map((question) => ({
              since: question.since,
              pairs: pairs.filter((_, index) => question.asked[index]),
            })),
            { since: DateTime.makeUnsafe(0), pairs },
            { since: QuotaLog.now, pairs },
            { since: DateTime.makeUnsafe(0), pairs: [] },
          ];
          for (const { since, pairs } of asked) {
            const expected = Generated.plain(
              yield* fake.latestQuotaHeaders(pairs, since),
            );
            expect(
              Generated.plain(yield* real.latestQuotaHeaders(pairs, since)),
              DateTime.formatIso(since),
            ).toEqual(expected);
            if (JSON.stringify(expected).includes('"headers":{"')) latest++;
          }
        }
        expect(latest).toBeGreaterThan(30);
      }).pipe(Effect.orDie, inScratch),
    120_000,
  );

  it.live(
    "H5: for any request log and filters, the overview's requests, errors, usage, cost and unpriced count equal their sums over a breakdown by any dimension with no limit, and over the series' points, in ClickHouse",
    () =>
      Effect.gen(function* () {
        const [log = []] = yield* sample(Generated.requestLog(150), 1);
        yield* Scratch.written(log);
        for (const { selection, zone } of yield* sample(asked, 15)) {
          const { found, expected } = yield* Generated.sumsBy(
            Generated.askedOf(selection),
            zone,
          );
          expect(found).toEqual(expected);
        }
      }).pipe(inScratch),
    120_000,
  );

  it.live(
    "H7: for any request log and filters, each dimension's facet is the non-empty values the overview counts requests for with that value as its dimension's only filter, each with that count, in ClickHouse",
    () =>
      Effect.gen(function* () {
        const [log = []] = yield* sample(Generated.requestLog(150), 1);
        yield* Scratch.written(log);
        for (const { selection } of yield* sample(asked, 32)) {
          const { facets, counted } = yield* Generated.facetsAndCounts(
            Generated.askedOf(selection),
            log,
          );
          expect(facets).toEqual(counted);
        }
      }).pipe(inScratch),
    120_000,
  );

  it.live(
    "adds prompt_tokens, the prompt size, to a requests table made before it",
    () =>
      Effect.gen(function* () {
        const clickHouse = yield* ClickHouse.ClickHouse;
        const { database } = yield* Scratch.Scratch;
        yield* clickHouse
          .command(Tables.requests.replace(/\n\s*prompt_tokens [^\n]*/, ""))
          .pipe(Effect.orDie);
        yield* Tables.prepare().pipe(Effect.orDie);
        yield* Tables.prepare().pipe(Effect.orDie);
        yield* Scratch.written([
          {
            request: Harness.requestOf({
              usage: Option.some({
                tokens: {
                  input: 3,
                  cacheRead: 4_000_000_000,
                  cacheWriteShort: 500,
                  cacheWriteLong: 60,
                  output: 7,
                },
                reasoning: 0,
                reported: "{}",
              }),
            }),
            cost: Option.none(),
          },
        ]);

        expect(
          yield* clickHouse
            .select(
              `SELECT type, default_kind, default_expression FROM system.columns
               WHERE database = {database:String} AND table = 'requests' AND name = 'prompt_tokens'`,
              Schema.Struct({
                type: Schema.String,
                default_kind: Schema.String,
                default_expression: Schema.String,
              }),
              { database: ClickHouse.Param.string(database) },
            )
            .pipe(Effect.orDie),
        ).toEqual([
          {
            type: "UInt64",
            default_kind: "ALIAS",
            default_expression:
              "((input_tokens + cache_read_tokens) + cache_write_short_tokens) + cache_write_long_tokens",
          },
        ]);
        expect(
          yield* clickHouse
            .select(
              "SELECT prompt_tokens FROM requests",
              Schema.Struct({ prompt_tokens: Schema.String }),
            )
            .pipe(Effect.orDie),
        ).toEqual([{ prompt_tokens: "4000000563" }]);
      }).pipe(inScratch),
  );

  it.live(
    "fails as unavailable, saying how but not what ClickHouse said, when ClickHouse is down or fails the query",
    () =>
      Effect.gen(function* () {
        const reader = yield* RequestLogReader;
        const { faults } = yield* Scratch.Scratch;
        const [selection] = yield* sample(Generated.selection, 1);
        if (selection === undefined) return;
        const failure = reader
          .breakdown(selection, "pool", 5)
          .pipe(Effect.flip);

        const withoutTables = yield* failure;
        faults.faultOf = () => "down";
        const down = yield* failure;

        expect(
          [withoutTables, down].map(({ reason, code }) => [reason, code]),
        ).toEqual([
          ["failed", "60"],
          ["unreachable", ""],
        ]);
      }).pipe(inScratch),
  );

  it.live(
    "stops a select of the hub's own user that runs past 30 seconds, in ClickHouse, and fails it as not answered in time",
    () =>
      Effect.gen(function* () {
        const clickHouse = yield* ClickHouse.ClickHouse;
        const marker = `over-time ${Bun.randomUUIDv7()}`;
        const started = Date.now();

        const failed = yield* clickHouse
          .select(endless(marker), Schema.Struct({ found: Schema.String }))
          .pipe(
            Effect.catchTag(
              "ClickHouseError",
              ClickHouseRequestLogReader.unavailable,
            ),
            Effect.flip,
          );

        expect([failed.reason, failed.code]).toEqual(["unreachable", "159"]);
        expect(Date.now() - started).toBeLessThan(34_000);
        expect(yield* runningAfter(marker, 0)).toBe(0);
      }).pipe(inScratch),
    60_000,
  );

  it.live(
    "leaves nothing running in ClickHouse when the hub stops waiting for a select of its own user",
    () =>
      Effect.gen(function* () {
        const clickHouse = yield* ClickHouse.ClickHouse;
        const marker = `abandoned ${Bun.randomUUIDv7()}`;

        yield* clickHouse
          .select(endless(marker), Schema.Struct({ found: Schema.String }))
          .pipe(Effect.timeout("1 second"), Effect.ignore);

        expect(yield* runningAfter(marker, 3_000)).toBe(0);
      }).pipe(inScratch),
    60_000,
  );

  it.live(
    "answers ClickHouse's own failure for a select of the hub's own user that fails after its first rows",
    () =>
      Effect.gen(function* () {
        const clickHouse = yield* ClickHouse.ClickHouse;

        // Rows that do not compress, so that ClickHouse would have begun its
        // answer before the row that fails, a second later.
        const failure = yield* clickHouse
          .select(
            `SELECT number AS n, randomPrintableASCII(200) AS filler,
               throwIf(number = 150000 AND sleep(1) = 0, 'late') AS failed
             FROM numbers(200000)`,
            Schema.Struct({ n: Schema.String }),
          )
          .pipe(Effect.flip);

        expect({ status: failure.status, code: failure.code }).toEqual({
          status: 500,
          code: "395",
        });
      }).pipe(inScratch),
    60_000,
  );

  it.live(
    "reads with the hub's own user read-only, stopped by ClickHouse at 30 seconds and when its connection closes",
    () =>
      Effect.gen(function* () {
        const clickHouse = yield* ClickHouse.ClickHouse;

        expect(
          yield* clickHouse
            .select(
              `SELECT toString(getSetting('readonly')) AS readonly,
                 toString(getSetting('max_execution_time')) AS seconds,
                 toString(getSetting('cancel_http_readonly_queries_on_client_close')) AS cancelled`,
              Schema.Struct({
                readonly: Schema.String,
                seconds: Schema.String,
                cancelled: Schema.String,
              }),
            )
            .pipe(Effect.orDie),
        ).toEqual([{ readonly: "1", seconds: "30", cancelled: "true" }]);
      }).pipe(inScratch),
  );
});
