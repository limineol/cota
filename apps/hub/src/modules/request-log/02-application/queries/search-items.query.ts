import { Context, Effect, Layer, Option } from "effect";
import { RequestLogReader } from "#modules/request-log/02-application/interfaces/request-log-reader.ts";
import * as Search from "#modules/request-log/03-domain/search.ts";
import * as Traffic from "#modules/request-log/03-domain/traffic.ts";
import type { RequestLogUnavailable } from "#shared/03-domain/request-log.ts";
import { type FoundHit, ReadSnippets } from "./read-snippets.query.ts";

export interface SearchPage {
  readonly hits: ReadonlyArray<FoundHit>;
  /** Where the next page begins; none on the last page. */
  readonly next: Option.Option<string>;
}

export class SearchItems extends Context.Service<
  SearchItems,
  {
    /**
     * One page of the hits of the sessions the selection holds, newest
     * first, each with its snippet; a cursor continues the search it came
     * from, over the window its first page read.
     */
    readonly execute: (
      asked: Traffic.Asked,
      search: Search.Asked,
      limit: number,
      cursor: Option.Option<string>,
    ) => Effect.Effect<
      SearchPage,
      Traffic.EmptyWindow | Search.StaleCursor | RequestLogUnavailable
    >;
  }
>()("@cota/hub/request-log/SearchItems") {}

export const layer: Layer.Layer<
  SearchItems,
  never,
  RequestLogReader | ReadSnippets
> = Layer.effect(
  SearchItems,
  Effect.gen(function* () {
    const reader = yield* RequestLogReader;
    const readSnippets = yield* ReadSnippets;
    return SearchItems.of({
      execute: Effect.fn("SearchItems.execute")(function* (
        asked: Traffic.Asked,
        search: Search.Asked,
        limit: number,
        cursor: Option.Option<string>,
      ) {
        const key = Search.keyOf(asked, search.query, search.tolerance);
        const from = yield* Option.match(cursor, {
          onNone: () =>
            Effect.map(Traffic.windowOf(asked.from, asked.to), (window) => ({
              window,
              after: Option.none<Search.After>(),
            })),
          onSome: (text) =>
            Option.match(Search.continuing(text, key), {
              onNone: () => Effect.fail(new Search.StaleCursor()),
              onSome: ({ window, after }) =>
                Effect.succeed({ window, after: Option.some(after) }),
            }),
        });
        const read = yield* reader.hits(
          { window: from.window, filters: asked.filters },
          search,
          limit + 1,
          from.after,
        );
        const page = read.slice(0, limit);
        const last = page.at(-1);
        return {
          hits: yield* readSnippets.execute(page, search),
          next:
            read.length > limit && last !== undefined
              ? Option.some(Search.cursorOf(key, from.window, last))
              : Option.none(),
        };
      }),
    });
  }),
);
