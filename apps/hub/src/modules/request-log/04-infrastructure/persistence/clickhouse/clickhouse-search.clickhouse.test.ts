import { BunHttpClient } from "@effect/platform-bun";
import { describe, expect, it } from "@effect/vitest";
import {
  Arbitrary,
  Context,
  DateTime,
  Duration,
  Effect,
  Layer,
  Option,
  Schema,
  type Scope,
} from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { RequestLogReader } from "#modules/request-log/02-application/interfaces/request-log-reader.ts";
import type { PricedRequest } from "#modules/request-log/02-application/interfaces/requests.repository.ts";
import * as ReadSnippets from "#modules/request-log/02-application/queries/read-snippets.query.ts";
import * as SearchItems from "#modules/request-log/02-application/queries/search-items.query.ts";
import * as Search from "#modules/request-log/03-domain/search.ts";
import type * as StoredItems from "#modules/request-log/03-domain/stored-items.ts";
import * as Traffic from "#modules/request-log/03-domain/traffic.ts";
import * as RenderedTranscripts from "#modules/request-log/04-infrastructure/transcripts/transcripts.ts";
import * as InMemoryRequestLogReader from "#modules/request-log/05-tests/fakes/in-memory-request-log-reader.ts";
import * as Scratch from "#modules/request-log/05-tests/scratch.ts";
import {
  anyText,
  boundAsked,
  boundLog,
  boundSearches,
  everyPage,
  flips,
  holdsWithin,
  keyOf,
  logWordsOf,
  matchesWithin,
  matchingWithin,
  nearbyTexts,
  recased,
  selectedSessions,
  smallBounds,
} from "#modules/request-log/05-tests/search.ts";
import * as Sessions from "#modules/request-log/05-tests/sessions.ts";
import * as Generated from "#modules/request-log/05-tests/traffic.ts";
import * as Conversation from "#shared/03-domain/conversation.ts";
import { compareText } from "#shared/03-domain/text.ts";
import * as Harness from "#shared/05-tests/harness.ts";
import * as ClickHouseRequestLogReader from "./clickhouse-request-log-reader.ts";
import * as ClickHouse from "./client.ts";
import * as Tables from "./schema.ts";

const inScratch = <A, E>(
  test: Effect.Effect<
    A,
    E,
    | Scope.Scope
    | Scratch.Scratch
    | ClickHouse.ClickHouse
    | RequestLogReader
    | SearchItems.SearchItems
  >,
) =>
  test.pipe(
    Effect.scoped,
    Effect.provide(
      Layer.provideMerge(
        SearchItems.layer.pipe(Layer.provide(ReadSnippets.layer)),
        Layer.merge(
          ClickHouseRequestLogReader.layer,
          RenderedTranscripts.layer,
        ),
      ).pipe(Layer.provideMerge(Scratch.layer)),
    ),
  );

const int = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

const sample = <A>(arbitrary: Arbitrary.Arbitrary<A>, count: number) =>
  Arbitrary.sampleEffect(arbitrary, { count }).pipe(Effect.orDie);

const asked = Arbitrary.all({
  asked: Generated.selection.pipe(Arbitrary.map(Generated.askedOf)),
  search: Sessions.search,
  limit: int(1, 8),
  flips,
});

/** A generated request log written through `RecordRequest`, and searches of it. */
const searchedLog = Effect.gen(function* () {
  const [log = []] = yield* sample(Sessions.sessionLog(120), 1);
  const stored = yield* Scratch.written(log);
  return { stored, searches: yield* sample(asked, 20) };
});

/** A reader over the scratch database whose every query is sent with `settings`, and whose queries are tagged so `system.query_log` tells them apart. */
const readerWith = (
  settings: Readonly<Record<string, string>>,
  bounds: Search.Bounds = Search.bounds,
) =>
  Effect.gen(function* () {
    const { database } = yield* Scratch.Scratch;
    const context = yield* Layer.build(
      Layer.fresh(ClickHouseRequestLogReader.layerWith(bounds)).pipe(
        Layer.provide(
          Layer.fresh(ClickHouse.layer(Scratch.connectionTo(database))),
        ),
        Layer.provide(
          Layer.effect(
            HttpClient.HttpClient,
            Effect.map(HttpClient.HttpClient, (client) =>
              HttpClient.mapRequest(
                client,
                HttpClientRequest.appendUrlParams(settings),
              ),
            ),
          ),
        ),
        Layer.provide(BunHttpClient.layer),
      ),
    );
    return Context.get(context, RequestLogReader);
  });

const TextIndexEvents = Schema.Struct({ events: Schema.FiniteFromString });

/** How many of the queries tagged `comment` that searched, by `hasAllTokens` or by `hasAnyTokens` as `searching` says, read the text index. */
const indexReadsOf = (comment: string, searching = "%hasAllTokens%") =>
  Effect.gen(function* () {
    const clickHouse = yield* ClickHouse.ClickHouse;
    yield* clickHouse.command("SYSTEM FLUSH LOGS");
    const rows = yield* clickHouse.select(
      `SELECT countIf(length(mapFilter((name, count) -> startsWith(name, 'TextIndex') AND count > 0, ProfileEvents)) > 0) AS events
       FROM system.query_log
       WHERE log_comment = {comment:String} AND type = 'QueryFinish' AND query LIKE {searching:String}`,
      TextIndexEvents,
      {
        comment: ClickHouse.Param.string(comment),
        searching: ClickHouse.Param.string(searching),
      },
    );
    return rows[0]?.events ?? 0;
  }).pipe(Effect.orDie);

const hitsOnly = (hits: ReadonlyArray<ReadSnippets.FoundHit>) =>
  Generated.plain(hits.map(({ snippet: _, ...hit }) => hit));

const itemsOf = (stored: { items: ReadonlyArray<StoredItems.StoredItem> }) =>
  new Map(
    stored.items.map((item) => [
      keyOf({ session: item.session, item: item.digest }),
      item,
    ]),
  );

/** A request of the session `twice`, carrying `said` as its input and `answer` as its output. */
const chatOf = (
  id: number,
  minute: number,
  said: ReadonlyArray<Schema.Json>,
  answer: ReadonlyArray<Schema.Json>,
): PricedRequest => ({
  request: Harness.requestOf({
    id: Sessions.idOf(id, minute),
    startedAt: DateTime.makeUnsafe(Date.UTC(2026, 10, 12, 9, minute)),
    session: "twice",
    protocol: "openai-chat",
    conversation: Conversation.read(
      Sessions.rulesOf("openai-chat"),
      { model: "glm-5.2", messages: said },
      answer,
    ),
  }),
  cost: Option.none(),
});

/** The questions of K8 answered by a reader: every hit of the session, and the newest hit of each search query. */
const earliestOf = (reader: RequestLogReader["Service"]) =>
  Effect.gen(function* () {
    const selection = {
      window: {
        from: DateTime.makeUnsafe(Date.UTC(2026, 10, 12)),
        to: DateTime.makeUnsafe(Date.UTC(2026, 10, 13)),
      },
      filters: Traffic.noFilters,
    };
    const searches: ReadonlyArray<Search.Asked> = [
      Search.exactly(Search.SearchQuery.make("relay")),
      Search.exactly(Search.SearchQuery.make("conduit")),
      {
        query: Search.SearchQuery.make("rela"),
        tolerance: { prefix: true, fuzzy: 0 },
      },
      {
        query: Search.SearchQuery.make("condit"),
        tolerance: { prefix: false, fuzzy: 0.2 },
      },
    ];
    const answers = [];
    for (const search of searches) {
      answers.push({
        hits: yield* reader.hits(selection, search, 10, Option.none()),
        newest: [...(yield* reader.newestHits(["twice"], search)).values()],
      });
    }
    return answers;
  }).pipe(Effect.orDie);

describe("search in ClickHouse", () => {
  it.live(
    "K8: an item written twice is one hit, whose at, request and part are its earliest copy's, before and after ClickHouse merges the copies, in ClickHouse",
    () =>
      Effect.gen(function* () {
        const clickHouse = yield* ClickHouse.ClickHouse;
        const reader = yield* RequestLogReader;
        const { faults } = yield* Scratch.Scratch;
        const relay = { role: "assistant", content: "The relay hung up." };
        const conduit = { role: "user", content: "Check the conduit." };
        // The writer asks which items the session has; when that fails, it
        // writes every item of the request again.
        const writtenAgain = (log: ReadonlyArray<PricedRequest>) =>
          Effect.gen(function* () {
            faults.faultOf = (query) =>
              query.startsWith("SELECT session, digest FROM items")
                ? "down"
                : undefined;
            const stored = yield* Scratch.written(log);
            faults.faultOf = () => undefined;
            return stored;
          });
        yield* Tables.prepare().pipe(Effect.orDie);
        yield* clickHouse
          .command("SYSTEM STOP MERGES items")
          .pipe(Effect.orDie);
        const first = yield* Scratch.written([
          chatOf(2, 1, [{ role: "user", content: "Why?" }], [relay]),
          chatOf(9, 5, [conduit], []),
        ]);
        const again = yield* writtenAgain([
          chatOf(3, 2, [{ role: "user", content: "Why?" }, relay], []),
          chatOf(1, 5, [conduit], []),
        ]);
        const stored = {
          requests: [...first.requests, ...again.requests],
          requestItems: [...first.requestItems, ...again.requestItems],
          items: [...first.items, ...again.items],
        };
        const copies = () =>
          clickHouse
            .select(
              "SELECT toString(count()) AS rows FROM items",
              Schema.Struct({ rows: Schema.FiniteFromString }),
            )
            .pipe(Effect.orDie);
        const expected = [
          {
            item: relay,
            request: Sessions.idOf(2, 1),
            part: "output",
            minute: 1,
          },
          {
            item: conduit,
            request: Sessions.idOf(1, 5),
            part: "input",
            minute: 5,
          },
        ];
        const fake = yield* earliestOf(
          InMemoryRequestLogReader.make(() => stored),
        );

        const before = yield* earliestOf(reader);
        const rowsBefore = yield* copies();
        yield* clickHouse
          .command("SYSTEM START MERGES items")
          .pipe(Effect.orDie);
        yield* clickHouse
          .command("OPTIMIZE TABLE items FINAL")
          .pipe(Effect.orDie);
        const after = yield* earliestOf(reader);

        expect(
          Generated.plain(
            before.map(({ hits }) =>
              hits.map(({ request, part, at }) => ({ request, part, at })),
            ),
          ),
        ).toEqual(
          [...expected, ...expected].map(({ request, part, minute }) => [
            {
              request,
              part,
              at: Generated.plain(
                DateTime.makeUnsafe(Date.UTC(2026, 10, 12, 9, minute)),
              ),
            },
          ]),
        );
        expect(Generated.plain(fake)).toEqual(Generated.plain(before));
        expect(Generated.plain(after)).toEqual(Generated.plain(before));
        expect([stored.items.length, rowsBefore]).toEqual([6, [{ rows: 6 }]]);
        expect(yield* copies()).toEqual([{ rows: 3 }]);
      }).pipe(inScratch),
    120_000,
  );

  it.live(
    "K1: every hit is an item that matches the search query, in ClickHouse",
    () =>
      Effect.gen(function* () {
        const { stored, searches } = yield* searchedLog;
        const items = itemsOf(stored);
        const logWords = logWordsOf(stored.items);
        let hits = 0;
        for (const { asked, search, limit } of searches) {
          for (const hit of yield* everyPage(asked, search, limit)) {
            hits++;
            const text = items.get(keyOf(hit))?.text ?? "";
            expect(
              [
                holdsWithin(text, search, logWords),
                matchesWithin(text, search),
              ],
              `${JSON.stringify(search)}: ${keyOf(hit)}`,
            ).toEqual([true, true]);
          }
        }
        expect(hits).toBeGreaterThan(0);
      }).pipe(inScratch),
    120_000,
  );

  it.live(
    "K2: every item of a selected session that matches the search query is a hit on some page, in ClickHouse",
    () =>
      Effect.gen(function* () {
        const { stored, searches } = yield* searchedLog;
        let expected = 0;
        for (const { asked, search, limit } of searches) {
          const sessions = yield* selectedSessions(asked, stored.requests);
          const found = new Set(
            (yield* everyPage(asked, search, limit)).map(keyOf),
          );
          const matching = matchingWithin(stored.items, sessions, search);
          expected += matching.length;
          expect(
            matching.filter((key) => !found.has(key)),
            JSON.stringify(search),
          ).toEqual([]);
        }
        expect(expected).toBeGreaterThan(0);
      }).pipe(inScratch),
    120_000,
  );

  it.live(
    "K3: every hit's session has a traffic request in the window that matches the filters, in ClickHouse",
    () =>
      Effect.gen(function* () {
        const { stored, searches } = yield* searchedLog;
        for (const { asked, search, limit } of searches) {
          const sessions = yield* selectedSessions(asked, stored.requests);
          for (const hit of yield* everyPage(asked, search, limit)) {
            expect(sessions.has(hit.session), keyOf(hit)).toBe(true);
          }
        }
      }).pipe(inScratch),
    120_000,
  );

  it.live(
    "K5: two search queries that lowercase to the same text have the same hits, in ClickHouse",
    () =>
      Effect.gen(function* () {
        const { searches } = yield* searchedLog;
        for (const { asked, search, limit, flips } of searches) {
          const other = recased(search.query, flips);
          expect(
            hitsOnly(
              yield* everyPage(
                asked,
                { query: other, tolerance: search.tolerance },
                limit,
              ),
            ),
            `${search.query} and ${other}`,
          ).toEqual(hitsOnly(yield* everyPage(asked, search, limit)));
        }
      }).pipe(inScratch),
    120_000,
  );

  it.live(
    "K6: for every string, the hub's words are the tokens ClickHouse's text index stores for it, splitByNonAlpha's each through lowerUTF8",
    () =>
      Effect.gen(function* () {
        const clickHouse = yield* ClickHouse.ClickHouse;
        const texts = [
          ...Sessions.phrases,
          "ΑΣ'Β ΣΟΦΟΣ. ΣΑ",
          "tab\tnul\u0000del\u007fend",
          ...(yield* sample(anyText, 2_000)),
        ];
        yield* clickHouse
          .command(
            "CREATE TABLE texts (at UInt32, text String) ENGINE = MergeTree ORDER BY at",
          )
          .pipe(Effect.orDie);
        yield* clickHouse
          .insert(
            "texts",
            texts.map((text, at) => ({ at, text })),
          )
          .pipe(Effect.orDie);
        const rows = yield* clickHouse
          .select(
            "SELECT text, arrayMap(word -> lowerUTF8(word), tokens(text, 'splitByNonAlpha')) AS words FROM texts ORDER BY at",
            Schema.Struct({
              text: Schema.String,
              words: Schema.Array(Schema.String),
            }),
          )
          .pipe(Effect.orDie);

        expect(rows.map(({ text }) => text)).toEqual(texts);
        expect(rows.map(({ text }) => Search.wordsOf(text))).toEqual(
          rows.map(({ words }) => words),
        );
      }).pipe(inScratch),
    120_000,
  );

  it.live(
    "K7: for every search query and log, the hits with the index are those of a scan of the text",
    () =>
      Effect.gen(function* () {
        const { searches } = yield* searchedLog;
        const indexed = yield* readerWith({ log_comment: "k7-index" });
        const scanning = yield* readerWith({
          log_comment: "k7-scan",
          use_skip_indexes: "0",
        });
        const queries: ReadonlyArray<Search.Asked> = [
          ...Sessions.searchQueries.map(Search.exactly),
          ...Sessions.tolerantQueries.map((query, at) => ({
            query,
            tolerance: { prefix: at % 2 === 0, fuzzy: at % 3 === 0 ? 0 : 0.5 },
          })),
          ...searches.map(({ search, flips }) => ({
            query: recased(search.query, flips),
            tolerance: search.tolerance,
          })),
        ];
        const answersOf = (reader: RequestLogReader["Service"]) =>
          Effect.gen(function* () {
            const answers = [];
            for (const [at, query] of queries.entries()) {
              const search = searches[at % searches.length];
              if (search === undefined) continue;
              const selection = yield* Effect.orDie(
                Traffic.selectionOf(search.asked),
              );
              answers.push({
                query,
                hits: yield* reader.hits(selection, query, 100, Option.none()),
                sessions: yield* reader.sessions(
                  selection,
                  "recent",
                  { limit: 200, offset: 0 },
                  Option.some(query),
                ),
              });
            }
            return Generated.plain(answers);
          }).pipe(Effect.orDie);

        const expected = yield* answersOf(scanning);
        expect(yield* answersOf(indexed)).toEqual(expected);
        expect(JSON.stringify(expected)).toMatch(/"hits":\[\{/);
        expect(yield* indexReadsOf("k7-index")).toBeGreaterThan(0);
        expect(yield* indexReadsOf("k7-scan")).toBe(0);
        expect(
          yield* indexReadsOf("k7-index", "%hasAnyTokens%"),
        ).toBeGreaterThan(0);
        expect(yield* indexReadsOf("k7-scan", "%hasAnyTokens%")).toBe(0);
      }).pipe(inScratch),
    120_000,
  );

  it.live(
    "adds the text index to an items table made before it, once however often it prepares, and finds the words of rows written before",
    () =>
      Effect.gen(function* () {
        const clickHouse = yield* ClickHouse.ClickHouse;
        const reader = yield* RequestLogReader;
        const { database } = yield* Scratch.Scratch;
        const before: PricedRequest = {
          request: Harness.requestOf({
            session: "before",
            protocol: "openai-chat",
            conversation: Conversation.read(
              Sessions.rulesOf("openai-chat"),
              {
                model: "glm-5.2",
                messages: [
                  { role: "user", content: "The RELAY hung up on Résumé." },
                ],
              },
              [],
            ),
          }),
          cost: Option.none(),
        };
        yield* Scratch.written([before]);
        yield* clickHouse
          .command("ALTER TABLE items DROP INDEX text_words")
          .pipe(Effect.orDie);
        yield* Tables.prepare().pipe(Effect.orDie);
        yield* Tables.prepare().pipe(Effect.orDie);

        const indexes = yield* clickHouse
          .select(
            `SELECT name, type_full, expr FROM system.data_skipping_indices
             WHERE database = {database:String} AND table = 'items'`,
            Schema.Struct({
              name: Schema.String,
              type_full: Schema.String,
              expr: Schema.String,
            }),
            { database: ClickHouse.Param.string(database) },
          )
          .pipe(Effect.orDie);
        const mutations = yield* clickHouse
          .select(
            `SELECT count() AS events FROM system.mutations
             WHERE database = {database:String} AND table = 'items' AND command LIKE '%MATERIALIZE INDEX%'`,
            TextIndexEvents,
            { database: ClickHouse.Param.string(database) },
          )
          .pipe(Effect.orDie);
        const selection = {
          window: {
            from: DateTime.subtractDuration(
              before.request.startedAt,
              Duration.hours(1),
            ),
            to: DateTime.addDuration(
              before.request.startedAt,
              Duration.hours(1),
            ),
          },
          filters: Traffic.noFilters,
        };

        expect(indexes).toEqual([
          {
            name: "text_words",
            type_full:
              "text(tokenizer = splitByNonAlpha, postprocessor = lowerUTF8(text))",
            expr: "text",
          },
        ]);
        expect(mutations).toEqual([{ events: 1 }]);
        expect(
          (yield* reader
            .hits(
              selection,
              Search.exactly(Search.SearchQuery.make("relay résumé")),
              10,
              Option.none(),
            )
            .pipe(Effect.orDie)).map(({ session }) => session),
        ).toEqual(["before"]);
      }).pipe(inScratch),
    120_000,
  );

  it.live(
    "K10: a word of the search query is widened to itself, its first completions by length and then text, and its first neighbours by edits and then text, up to the bounds, in ClickHouse",
    () =>
      Effect.gen(function* () {
        const stored = yield* Scratch.written(boundLog);
        const items = itemsOf(stored);
        const reader = yield* readerWith({}, smallBounds);
        const selection = yield* Effect.orDie(Traffic.selectionOf(boundAsked));
        const found = [];
        for (const { search } of boundSearches) {
          found.push(
            (yield* reader
              .hits(selection, search, 100, Option.none())
              .pipe(Effect.orDie))
              .map((hit) => items.get(keyOf(hit))?.text ?? "")
              .sort(compareText),
          );
        }

        expect(found).toEqual(boundSearches.map(({ words }) => words));
      }).pipe(inScratch),
    120_000,
  );

  it.live(
    "K11: for every two strings that are not empty, the hub's edits between them are ClickHouse's editDistanceUTF8",
    () =>
      Effect.gen(function* () {
        const clickHouse = yield* ClickHouse.ClickHouse;
        const pairs = [
          ["kitten", "sitting"],
          ["ab", "ba"],
          ["😀a", "a"],
          ["x", "日本語"],
          ...(yield* sample(nearbyTexts, 1_500)),
          ...(yield* sample(
            Arbitrary.all({ one: anyText, other: anyText }),
            500,
          )).map(({ one, other }) => [one, other]),
        ].filter(([one, other]) => one !== "" && other !== "");
        yield* clickHouse
          .command(
            "CREATE TABLE pairs (at UInt32, one String, other String) ENGINE = MergeTree ORDER BY at",
          )
          .pipe(Effect.orDie);
        yield* clickHouse
          .insert(
            "pairs",
            pairs.map(([one = "", other = ""], at) => ({ at, one, other })),
          )
          .pipe(Effect.orDie);
        const rows = yield* clickHouse
          .select(
            "SELECT one, other, toString(editDistanceUTF8(one, other)) AS edits FROM pairs ORDER BY at",
            Schema.Struct({
              one: Schema.String,
              other: Schema.String,
              edits: Schema.FiniteFromString,
            }),
          )
          .pipe(Effect.orDie);

        expect(rows.map(({ one, other }) => [one, other])).toEqual(pairs);
        expect(
          rows.map(({ one, other }) => Search.editsBetween(one, other)),
        ).toEqual(rows.map(({ edits }) => edits));
      }).pipe(inScratch),
    120_000,
  );

  it.live(
    "gathers the words of the items written before the log's words were kept, when it prepares, and until then answers a search with a tolerance as not yet gathered",
    () =>
      Effect.gen(function* () {
        const clickHouse = yield* ClickHouse.ClickHouse;
        const stored = yield* Scratch.written(boundLog);
        yield* clickHouse.command("DROP VIEW words_writer").pipe(Effect.orDie);
        yield* clickHouse.command("DROP TABLE words").pipe(Effect.orDie);
        yield* clickHouse.command(Tables.words).pipe(Effect.orDie);
        const selection = yield* Effect.orDie(Traffic.selectionOf(boundAsked));
        const [prefixed] = boundSearches;
        const tolerant =
          prefixed?.search ?? Search.exactly(Search.SearchQuery.make("relay"));
        const before = yield* readerWith({});
        const exactBefore = yield* before
          .hits(selection, Search.exactly(tolerant.query), 100, Option.none())
          .pipe(Effect.orDie);
        const refused = yield* Effect.flip(
          before.hits(selection, tolerant, 100, Option.none()),
        );
        yield* Tables.prepare().pipe(Effect.orDie);
        yield* Tables.prepare().pipe(Effect.orDie);
        const words = yield* clickHouse
          .select(
            "SELECT word FROM words GROUP BY word ORDER BY word",
            Schema.Struct({ word: Schema.String }),
          )
          .pipe(Effect.orDie);
        const copies = yield* clickHouse
          .select(
            "SELECT toString(count()) AS rows FROM words",
            Schema.Struct({ rows: Schema.FiniteFromString }),
          )
          .pipe(Effect.orDie);
        const after = yield* (yield* readerWith({}))
          .hits(selection, tolerant, 100, Option.none())
          .pipe(Effect.orDie);

        expect(exactBefore).toHaveLength(1);
        expect([refused._tag, refused.reason]).toEqual([
          "RequestLogUnavailable",
          "gathering",
        ]);
        expect(words.map(({ word }) => word)).toEqual(
          [...logWordsOf(stored.items)].sort(compareText),
        );
        expect(copies).toEqual([{ rows: words.length }]);
        expect(after).toHaveLength(5);
      }).pipe(inScratch),
    120_000,
  );
});
