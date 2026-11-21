import { Effect, Option } from "effect";
import type { HttpApiBuilder } from "effect/http-api";
import { SearchItems } from "#modules/request-log/02-application/queries/search-items.query.ts";
import * as Search from "#modules/request-log/03-domain/search.ts";
import { requestLogProblem } from "#shared/01-presentation/problems.ts";
import { askedOf, toleranceOf } from "./filters.ts";
import { emptyWindowProblem, StaleCursorProblem } from "./problems.ts";
import type * as SearchApi from "./search.api.ts";

export const build = (
  handlers: HttpApiBuilder.Handlers.FromGroup<typeof SearchApi.group>,
) =>
  Effect.gen(function* () {
    const searchItems = yield* SearchItems;

    return handlers.handle("search", ({ query }) =>
      Effect.gen(function* () {
        const { hits, next } = yield* searchItems.execute(
          askedOf(query),
          { query: query.q, tolerance: toleranceOf(query) },
          query.limit ?? Search.paging.defaultLimit,
          Option.fromUndefinedOr(query.cursor),
        );
        return {
          hits: hits.map((hit) => ({
            session: hit.session,
            item: hit.item,
            request: hit.request,
            part: hit.part,
            role: hit.role,
            at: hit.at,
            snippet: hit.snippet,
          })),
          next: Option.getOrNull(next),
        };
      }).pipe(
        Effect.catchTags({
          EmptyWindow: emptyWindowProblem,
          StaleCursor: () =>
            Effect.fail(
              new StaleCursorProblem({
                detail:
                  "Give a cursor with the same q, prefix, fuzzy and filters as the page it came from, or leave it out to start again.",
              }),
            ),
          RequestLogUnavailable: requestLogProblem,
        }),
      ),
    );
  });
