import { Context, type Effect } from "effect";
import type * as Title from "#modules/request-log/03-domain/title.ts";
import type { RequestLogUnavailable } from "#shared/03-domain/request-log.ts";

/** Where the request log keeps the titles machines report. */
export class SessionTitles extends Context.Service<
  SessionTitles,
  {
    /** Keeps every report; none is ever changed. */
    readonly store: (
      reports: ReadonlyArray<Title.Report>,
    ) => Effect.Effect<void, RequestLogUnavailable>;
    /** The latest report of each of the sessions that has one (T9). */
    readonly latest: (
      sessions: ReadonlyArray<string>,
    ) => Effect.Effect<
      ReadonlyMap<string, Title.Report>,
      RequestLogUnavailable
    >;
  }
>()("@cota/hub/request-log/SessionTitles") {}
