import { Context, Effect, Layer } from "effect";
import { RequestLogReader } from "#modules/request-log/02-application/interfaces/request-log-reader.ts";
import { Transcripts } from "#modules/request-log/02-application/interfaces/transcripts.ts";
import * as Search from "#modules/request-log/03-domain/search.ts";
import type { RequestLogUnavailable } from "#shared/03-domain/request-log.ts";

export interface FoundHit extends Search.Hit {
  readonly snippet: Search.Snippet;
}

export class ReadSnippets extends Context.Service<
  ReadSnippets,
  {
    /**
     * Each hit with its snippet, read from the content of the hits given
     * only, in one read; a hit whose item has gone has an empty snippet.
     */
    readonly execute: (
      hits: ReadonlyArray<Search.Hit>,
      search: Search.Asked,
    ) => Effect.Effect<ReadonlyArray<FoundHit>, RequestLogUnavailable>;
  }
>()("@cota/hub/request-log/ReadSnippets") {}

export const layer: Layer.Layer<
  ReadSnippets,
  never,
  RequestLogReader | Transcripts
> = Layer.effect(
  ReadSnippets,
  Effect.gen(function* () {
    const reader = yield* RequestLogReader;
    const transcripts = yield* Transcripts;
    return ReadSnippets.of({
      execute: Effect.fn("ReadSnippets.execute")(function* (
        hits: ReadonlyArray<Search.Hit>,
        search: Search.Asked,
      ) {
        const contents = yield* reader.contents(
          hits.map(({ session, item }) => ({ session, item })),
        );
        return hits.map((hit): FoundHit => {
          const found = contents.find(
            ({ session, item }) => session === hit.session && item === hit.item,
          );
          const shown =
            found === undefined
              ? ""
              : transcripts.shownOf(found.protocol, hit.part, found.content);
          return {
            ...hit,
            snippet: Search.snippetOf(shown, search.query, search.tolerance),
          };
        });
      }),
    });
  }),
);
