import { Context, Effect, Layer, Option } from "effect";
import {
  RequestLogReader,
  type Wanted,
} from "#modules/request-log/02-application/interfaces/request-log-reader.ts";
import { SessionTitles } from "#modules/request-log/02-application/interfaces/session-titles.ts";
import * as FirstPrompt from "#modules/request-log/03-domain/first-prompt.ts";
import { rolesOf } from "#modules/request-log/03-domain/request-role.ts";
import type * as Search from "#modules/request-log/03-domain/search.ts";
import * as Session from "#modules/request-log/03-domain/session.ts";
import * as Title from "#modules/request-log/03-domain/title.ts";
import * as Traffic from "#modules/request-log/03-domain/traffic.ts";
import type { RequestLogUnavailable } from "#shared/03-domain/request-log.ts";
import { ReadSnippets } from "./read-snippets.query.ts";

export interface ListedSession extends Session.SessionRow {
  readonly title: Option.Option<Title.Shown>;
  readonly firstPrompt: Option.Option<string>;
}

/** A listed session, with the snippet of its newest hit when the list was searched. */
export interface SearchedSession extends ListedSession {
  readonly snippet: Option.Option<Search.Snippet>;
}

export interface SessionList {
  readonly sessions: ReadonlyArray<SearchedSession>;
  readonly total: number;
}

export class ListSessions extends Context.Service<
  ListSessions,
  {
    /**
     * One page of the sessions the selection holds, each with its title and
     * first prompt; given a search, only those with a hit, each with the
     * snippet of its newest.
     */
    readonly execute: (
      asked: Traffic.Asked,
      order: Session.SessionOrder,
      page: Session.Page,
      search: Option.Option<Search.Asked>,
    ) => Effect.Effect<
      SessionList,
      Traffic.EmptyWindow | RequestLogUnavailable
    >;
  }
>()("@cota/hub/request-log/ListSessions") {}

export const layer: Layer.Layer<
  ListSessions,
  never,
  RequestLogReader | SessionTitles | ReadSnippets
> = Layer.effect(
  ListSessions,
  Effect.gen(function* () {
    const reader = yield* RequestLogReader;
    const titles = yield* SessionTitles;
    const readSnippets = yield* ReadSnippets;
    return ListSessions.of({
      execute: Effect.fn("ListSessions.execute")(function* (
        asked: Traffic.Asked,
        order: Session.SessionOrder,
        page: Session.Page,
        search: Option.Option<Search.Asked>,
      ) {
        const selection = yield* Traffic.selectionOf(asked);
        const { rows, total } = yield* reader.sessions(
          selection,
          order,
          page,
          search,
        );
        const ids = rows.map(({ id }) => id);
        const reports = yield* titles.latest(ids);
        const requests = yield* reader.sessionRequests(
          ids,
          Session.read,
          Session.mostListedRequests,
        );
        const read = rows.map((row) => {
          const roled = rolesOf(requests.get(row.id) ?? []);
          const reported = Option.fromUndefinedOr(reports.get(row.id));
          const hasReported = Option.exists(
            reported,
            ({ title }) => title !== "",
          );
          return {
            row,
            reported,
            firstMain: FirstPrompt.firstMainRequestOf(roled),
            titleRequests: hasReported ? [] : Title.titleRequestsOf(roled),
          };
        });
        const items = yield* reader.items(
          read.flatMap(({ row, firstMain, titleRequests }) => [
            ...Option.toArray(firstMain).map(
              (request): Wanted => ({
                session: row.id,
                id: request.id,
                parts: ["input"],
              }),
            ),
            ...titleRequests.map(
              (request): Wanted => ({
                session: row.id,
                id: request.id,
                parts: ["output"],
              }),
            ),
          ]),
        );
        const listed = read.map(
          ({ row, reported, firstMain, titleRequests }): ListedSession => {
            const generated = Title.generatedAmong(
              titleRequests,
              (request) => items.get(request.id)?.output ?? [],
            );
            return {
              ...row,
              title: Title.shownOf(reported, generated),
              firstPrompt: Option.flatMap(firstMain, (request) =>
                FirstPrompt.firstPromptOf(
                  request.protocol,
                  items.get(request.id)?.input ?? [],
                ),
              ),
            };
          },
        );
        if (Option.isNone(search)) {
          return {
            sessions: listed.map((session) => ({
              ...session,
              snippet: Option.none(),
            })),
            total,
          };
        }
        const newest = yield* reader.newestHits(ids, search.value);
        const found = yield* readSnippets.execute(
          [...newest.values()],
          search.value,
        );
        return {
          sessions: listed.map((session) => ({
            ...session,
            snippet: Option.map(
              Option.fromUndefinedOr(
                found.find((hit) => hit.session === session.id),
              ),
              ({ snippet }) => snippet,
            ),
          })),
          total,
        };
      }),
    });
  }),
);
