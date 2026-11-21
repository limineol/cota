import { expect, layer } from "@effect/vitest";
import { Arbitrary, DateTime, Effect, Layer, Option, Schema } from "effect";
import { RequestLogReader } from "#modules/request-log/02-application/interfaces/request-log-reader.ts";
import type { PricedRequest } from "#modules/request-log/02-application/interfaces/requests.repository.ts";
import * as Search from "#modules/request-log/03-domain/search.ts";
import * as Traffic from "#modules/request-log/03-domain/traffic.ts";
import * as RenderedTranscripts from "#modules/request-log/04-infrastructure/transcripts/transcripts.ts";
import * as InMemoryRequestLogReader from "#modules/request-log/05-tests/fakes/in-memory-request-log-reader.ts";
import {
  boundAsked,
  boundLog,
  boundSearches,
  everyPage,
  flips,
  holdsWithin,
  keyOf,
  logWordsOf,
  matchesWithin,
  matchingIn,
  matchingWithin,
  recased,
  selectedSessions,
  smallBounds,
} from "#modules/request-log/05-tests/search.ts";
import * as Sessions from "#modules/request-log/05-tests/sessions.ts";
import * as Generated from "#modules/request-log/05-tests/traffic.ts";
import * as Request from "#shared/03-domain/request.entity.ts";
import { compareText } from "#shared/03-domain/text.ts";
import * as ReadSnippets from "./read-snippets.query.ts";
import * as SearchItems from "./search-items.query.ts";

let held: InMemoryRequestLogReader.Held = {
  requests: [],
  requestItems: [],
  items: [],
};

const overHeldWith = (bounds: Search.Bounds) =>
  SearchItems.layer.pipe(
    Layer.provide(ReadSnippets.layer),
    Layer.provide([
      Layer.succeed(
        RequestLogReader,
        InMemoryRequestLogReader.make(
          () => held,
          () => false,
          bounds,
        ),
      ),
      RenderedTranscripts.layer,
    ]),
  );

const overHeld = overHeldWith(Search.bounds);

const holding = (log: ReadonlyArray<PricedRequest>) =>
  Effect.sync(() => {
    held = Sessions.heldOf(log);
  });

const int = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

const itemOf = ({ session, item }: Search.Hit) =>
  held.items.find((each) => each.session === session && each.digest === item);

const asked = Generated.selection.pipe(Arbitrary.map(Generated.askedOf));

/** Model listings, with ids no generated request log has. */
const modelListings = Generated.requestLog(20).pipe(
  Arbitrary.map((log) =>
    log.map(
      ({ request }): PricedRequest => ({
        request: {
          ...request,
          id: Request.RequestId.make(
            `${request.id.slice(0, 19)}9${request.id.slice(20)}`,
          ),
          operation: "models",
        },
        cost: Option.none(),
      }),
    ),
  ),
);

layer(overHeld)("search over the in-memory reader", (it) => {
  it.effect.prop(
    "K1: every hit is an item that matches the search query",
    {
      log: Sessions.sessionLog(60),
      asked,
      search: Sessions.search,
      limit: int(1, 5),
    },
    ({ log, asked, search, limit }) =>
      Effect.gen(function* () {
        yield* holding(log);
        const logWords = logWordsOf(held.items);
        for (const hit of yield* everyPage(asked, search, limit)) {
          const item = itemOf(hit);
          expect(item, keyOf(hit)).toBeDefined();
          expect(
            [
              holdsWithin(item?.text ?? "", search, logWords),
              matchesWithin(item?.text ?? "", search),
            ],
            keyOf(hit),
          ).toEqual([true, true]);
        }
      }),
    { timeout: 30_000 },
  );

  it.effect.prop(
    "K2: every item of a selected session that matches the search query is a hit on some page",
    {
      log: Sessions.sessionLog(60),
      asked,
      search: Sessions.search,
      limit: int(1, 5),
    },
    ({ log, asked, search, limit }) =>
      Effect.gen(function* () {
        yield* holding(log);
        const sessions = yield* selectedSessions(asked, held.requests);
        const found = new Set(
          (yield* everyPage(asked, search, limit)).map(keyOf),
        );
        const expected = matchingWithin(held.items, sessions, search);

        expect(expected.filter((key) => !found.has(key))).toEqual([]);
      }),
    { timeout: 30_000 },
  );

  it.effect(
    "K2: every item of a selected session that matches the search query is a hit on some page, for fetch in fetch_user_id",
    () =>
      Effect.gen(function* () {
        const [log] = yield* Arbitrary.sampleEffect(Sessions.sessionLog(60), {
          count: 1,
          seed: "K2",
        });
        yield* holding(log ?? []);
        const asked: Traffic.Asked = {
          from: Option.some(DateTime.makeUnsafe(Generated.span.from)),
          to: Option.some(DateTime.makeUnsafe(Generated.span.to)),
          filters: Traffic.noFilters,
        };
        const query = Search.SearchQuery.make("fetch");
        const sessions = yield* selectedSessions(asked, held.requests);
        const found = new Set((yield* everyPage(asked, query, 5)).map(keyOf));
        const expected = matchingIn(held.items, sessions, query);

        expect(expected.length).toBeGreaterThan(0);
        expect(expected.filter((key) => !found.has(key))).toEqual([]);
      }),
  );

  it.effect(
    "K2: every item of a selected session that matches the search query is a hit on some page, for relau within an edit and rel as a prefix",
    () =>
      Effect.gen(function* () {
        const [log] = yield* Arbitrary.sampleEffect(Sessions.sessionLog(60), {
          count: 1,
          seed: "K2",
        });
        yield* holding(log ?? []);
        const asked: Traffic.Asked = {
          from: Option.some(DateTime.makeUnsafe(Generated.span.from)),
          to: Option.some(DateTime.makeUnsafe(Generated.span.to)),
          filters: Traffic.noFilters,
        };
        const sessions = yield* selectedSessions(asked, held.requests);
        for (const search of [
          {
            query: Search.SearchQuery.make("relau"),
            tolerance: { prefix: false, fuzzy: 0.2 },
          },
          {
            query: Search.SearchQuery.make("rel"),
            tolerance: { prefix: true, fuzzy: 0 },
          },
        ]) {
          const found = new Set(
            (yield* everyPage(asked, search, 5)).map(keyOf),
          );
          const expected = matchingWithin(held.items, sessions, search);

          expect(expected.length, search.query).toBeGreaterThan(0);
          expect(expected.filter((key) => !found.has(key))).toEqual([]);
        }
      }),
  );

  it.effect.prop(
    "K3: every hit's session has a traffic request in the window that matches the filters",
    {
      log: Sessions.sessionLog(60),
      asked,
      search: Sessions.search,
      limit: int(1, 5),
    },
    ({ log, asked, search, limit }) =>
      Effect.gen(function* () {
        yield* holding(log);
        const sessions = yield* selectedSessions(asked, held.requests);
        for (const hit of yield* everyPage(asked, search, limit)) {
          expect(sessions.has(hit.session), keyOf(hit)).toBe(true);
        }
      }),
    { timeout: 30_000 },
  );

  it.effect.prop(
    "K4: reading every page from the first, by next, gives every hit once, in order",
    {
      log: Sessions.sessionLog(60),
      asked,
      search: Sessions.search,
      limit: int(1, 5),
    },
    ({ log, asked, search, limit }) =>
      Effect.gen(function* () {
        yield* holding(log);
        const sessions = yield* selectedSessions(asked, held.requests);
        const logWords = logWordsOf(held.items);
        const first = new Map<string, (typeof held.items)[number]>();
        for (const item of held.items) {
          const key = keyOf({ session: item.session, item: item.digest });
          if (
            sessions.has(item.session) &&
            holdsWithin(item.text, search, logWords) &&
            !first.has(key)
          ) {
            first.set(key, item);
          }
        }
        const expected = [...first.values()]
          .sort(
            (one, other) =>
              DateTime.toEpochMillis(other.firstSeen) -
                DateTime.toEpochMillis(one.firstSeen) ||
              compareText(one.session, other.session) ||
              compareText(one.digest, other.digest),
          )
          .map((item) => keyOf({ session: item.session, item: item.digest }));

        expect((yield* everyPage(asked, search, limit)).map(keyOf)).toEqual(
          expected,
        );
      }),
    { timeout: 30_000 },
  );

  it.effect.prop(
    "K5: two search queries that lowercase to the same text have the same hits",
    {
      log: Sessions.sessionLog(60),
      asked,
      search: Sessions.search,
      flips,
      limit: int(1, 5),
    },
    ({ log, asked, search, flips, limit }) =>
      Effect.gen(function* () {
        yield* holding(log);
        const other = recased(search.query, flips);
        const hits = (yield* everyPage(asked, search, limit)).map(
          ({ snippet: _, ...hit }) => hit,
        );

        expect(
          Generated.plain(
            (yield* everyPage(
              asked,
              { query: other, tolerance: search.tolerance },
              limit,
            )).map(({ snippet: _, ...hit }) => hit),
          ),
          `${search.query} and ${other}`,
        ).toEqual(Generated.plain(hits));
      }),
    // A recasing that reaches a word before punctuation is rare enough that
    // a hundred runs can miss it.
    { timeout: 30_000, arbitrary: { runs: 400 } },
  );

  it.effect(
    "K5: two search queries that lowercase to the same text have the same hits, for RELAY hang and relay hang",
    () =>
      Effect.gen(function* () {
        const [log] = yield* Arbitrary.sampleEffect(Sessions.sessionLog(60), {
          count: 1,
          seed: "K5",
        });
        yield* holding(log ?? []);
        const asked: Traffic.Asked = {
          from: Option.some(DateTime.makeUnsafe(Generated.span.from)),
          to: Option.some(DateTime.makeUnsafe(Generated.span.to)),
          filters: Traffic.noFilters,
        };
        const hitsOf = (query: string) =>
          everyPage(asked, Search.SearchQuery.make(query), 5).pipe(
            Effect.map((hits) => hits.map(({ snippet: _, ...hit }) => hit)),
          );
        const lower = yield* hitsOf("relay hang");
        expect(lower.length).toBeGreaterThan(0);
        expect(Generated.plain(yield* hitsOf("RELAY hang"))).toEqual(
          Generated.plain(lower),
        );
      }),
  );

  it.effect.prop(
    "K9: a hit of a search is a hit of the same search query with prefix on, or with a larger fuzziness",
    {
      log: Sessions.sessionLog(60),
      asked,
      search: Sessions.search,
      prefix: Arbitrary.schema(Schema.Boolean),
      more: int(0, 1_000),
      limit: int(1, 5),
    },
    ({ log, asked, search, prefix, more, limit }) =>
      Effect.gen(function* () {
        yield* holding(log);
        const wider = {
          query: search.query,
          tolerance: {
            prefix: search.tolerance.prefix || prefix,
            fuzzy:
              search.tolerance.fuzzy +
              ((1 - search.tolerance.fuzzy) * more) / 1_000,
          },
        };
        const widened = new Set(
          (yield* everyPage(asked, wider, limit)).map(keyOf),
        );

        expect(
          (yield* everyPage(asked, search, limit))
            .map(keyOf)
            .filter((key) => !widened.has(key)),
          JSON.stringify(wider.tolerance),
        ).toEqual([]);
      }),
    { timeout: 30_000 },
  );

  it.effect(
    "K9: a hit of a search is a hit of the same search query with prefix on, or with a larger fuzziness, for relau at 0.2, 0.5 and with prefix",
    () =>
      Effect.gen(function* () {
        const [log] = yield* Arbitrary.sampleEffect(Sessions.sessionLog(60), {
          count: 1,
          seed: "K2",
        });
        yield* holding(log ?? []);
        const asked: Traffic.Asked = {
          from: Option.some(DateTime.makeUnsafe(Generated.span.from)),
          to: Option.some(DateTime.makeUnsafe(Generated.span.to)),
          filters: Traffic.noFilters,
        };
        const keysOf = (prefix: boolean, fuzzy: number) =>
          everyPage(
            asked,
            {
              query: Search.SearchQuery.make("relau"),
              tolerance: { prefix, fuzzy },
            },
            5,
          ).pipe(Effect.map((hits) => hits.map(keyOf)));
        const near = yield* keysOf(false, 0.2);
        const wider = [
          new Set(yield* keysOf(false, 0.5)),
          new Set(yield* keysOf(true, 0.2)),
        ];

        expect(near.length).toBeGreaterThan(0);
        expect(
          wider.map((keys) => near.filter((key) => !keys.has(key))),
        ).toEqual([[], []]);
      }),
  );

  it.effect(
    "K10: a word of the search query is widened to itself, its first completions by length and then text, and its first neighbours by edits and then text, up to the bounds",
    () =>
      Effect.gen(function* () {
        yield* holding(boundLog);
        const wordsOf = (search: Search.Asked) =>
          everyPage(boundAsked, search, 5).pipe(
            Effect.map((hits) =>
              hits.map((hit) => itemOf(hit)?.text ?? "").sort(compareText),
            ),
            Effect.provide(Layer.fresh(overHeldWith(smallBounds))),
          );
        const found = [];
        for (const { search } of boundSearches) {
          found.push(yield* wordsOf(search));
        }

        expect(found).toEqual(boundSearches.map(({ words }) => words));
      }),
  );

  it.effect.prop(
    "H4: adding model-listing requests to any request log changes no answer of search",
    {
      log: Sessions.sessionLog(40),
      listings: modelListings,
      asked,
      search: Sessions.search,
      limit: int(1, 4),
    },
    ({ log, listings, asked, search, limit }) =>
      Effect.gen(function* () {
        yield* holding(log);
        const without = Generated.plain(yield* everyPage(asked, search, limit));
        yield* holding([...listings, ...log]);

        expect(Generated.plain(yield* everyPage(asked, search, limit))).toEqual(
          without,
        );
      }),
    { timeout: 30_000 },
  );
});
