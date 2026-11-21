import { Context, DateTime, Effect, Layer } from "effect";
import { SessionTitles } from "#modules/request-log/02-application/interfaces/session-titles.ts";
import * as Title from "#modules/request-log/03-domain/title.ts";
import type { RequestLogUnavailable } from "#shared/03-domain/request-log.ts";

export interface Reported {
  /** Each session's title, as the machine sent it; an empty one clears it. */
  readonly titles: Readonly<Record<string, string>>;
  /** The `x-cota-machine` tag of the request that reported them. */
  readonly machine: string;
  /** The hub key's name, or `owner`. */
  readonly reportedBy: string;
}

export class ReportSessionTitles extends Context.Service<
  ReportSessionTitles,
  {
    /** Keeps one report per session, stamped with now: its session with each lone surrogate made U+FFFD, and its title and the machine as `Title.keptOf` keeps them. */
    readonly execute: (
      reported: Reported,
    ) => Effect.Effect<void, RequestLogUnavailable>;
  }
>()("@cota/hub/request-log/ReportSessionTitles") {}

export const layer: Layer.Layer<ReportSessionTitles, never, SessionTitles> =
  Layer.effect(
    ReportSessionTitles,
    Effect.gen(function* () {
      const titles = yield* SessionTitles;
      return ReportSessionTitles.of({
        execute: Effect.fn("ReportSessionTitles.execute")(function* (
          reported: Reported,
        ) {
          const reportedAt = yield* DateTime.now;
          const machine = Title.keptOf(reported.machine);
          yield* titles.store(
            Object.entries(reported.titles).map(([session, title]) => ({
              session: session.toWellFormed(),
              title: Title.keptOf(title),
              reportedAt,
              machine,
              reportedBy: reported.reportedBy,
            })),
          );
        }),
      });
    }),
  );
