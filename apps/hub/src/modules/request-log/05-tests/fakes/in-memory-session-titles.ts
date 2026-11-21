import { Context, Effect, Layer } from "effect";
import { SessionTitles } from "#modules/request-log/02-application/interfaces/session-titles.ts";
import * as Title from "#modules/request-log/03-domain/title.ts";
import { RequestLogUnavailable } from "#shared/03-domain/request-log.ts";

/** Every report kept, in the order stored, and whether keeping or reading them fails as an unreachable ClickHouse would. */
export class InMemorySessionTitles extends Context.Service<
  InMemorySessionTitles,
  { readonly reports: Array<Title.Report>; fails: boolean }
>()("@cota/hub/request-log/InMemorySessionTitles") {}

const answer = <A>(held: InMemorySessionTitles["Service"], compute: () => A) =>
  Effect.suspend(() =>
    held.fails
      ? Effect.fail(
          new RequestLogUnavailable({ reason: "unreachable", code: "" }),
        )
      : Effect.sync(compute),
  );

export const make = (held: InMemorySessionTitles["Service"]) =>
  SessionTitles.of({
    store: (reports) => answer(held, () => void held.reports.push(...reports)),
    latest: (sessions) =>
      answer(held, () =>
        Title.latestReports(
          held.reports.filter(({ session }) => sessions.includes(session)),
        ),
      ),
  });

/** The titles kept in memory, and the memory, for tests to look into. */
export const layer: Layer.Layer<SessionTitles | InMemorySessionTitles> =
  Layer.effectContext(
    Effect.sync(() => {
      const held = InMemorySessionTitles.of({ reports: [], fails: false });
      return Context.make(InMemorySessionTitles, held).pipe(
        Context.add(SessionTitles, make(held)),
      );
    }),
  );
