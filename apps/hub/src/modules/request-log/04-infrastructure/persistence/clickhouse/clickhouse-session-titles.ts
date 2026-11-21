import { Effect, Layer, Schema } from "effect";
import { SessionTitles } from "#modules/request-log/02-application/interfaces/session-titles.ts";
import type * as Title from "#modules/request-log/03-domain/title.ts";
import { unavailable } from "./clickhouse-request-log-reader.ts";
import * as ClickHouse from "./client.ts";
import { Param } from "./client.ts";
import { titleRowOf } from "./mappers/title.mapper.ts";

// The same order as `Title.latestReports`: the greatest time, then machine,
// title and reporter, compared as bytes, which for UTF-8 is by code point.
const latestSql = `SELECT session,
     argMax(title, key) AS title,
     max(reported_at) AS reported_at,
     argMax(machine, key) AS machine,
     argMax(reported_by, key) AS reported_by
   FROM (
     SELECT session, title, reported_at, toString(machine) AS machine, toString(reported_by) AS reported_by,
       (reported_at, machine, title, reported_by) AS key
     FROM session_titles WHERE session IN {sessions:Array(String)}
   )
   GROUP BY session`;

const LatestRow = Schema.Struct({
  session: Schema.String,
  title: Schema.String,
  reported_at: Schema.DateTimeUtcFromString,
  machine: Schema.String,
  reported_by: Schema.String,
});

/** The titles machines report, in ClickHouse's `session_titles`. */
export const layer: Layer.Layer<SessionTitles, never, ClickHouse.ClickHouse> =
  Layer.effect(
    SessionTitles,
    Effect.gen(function* () {
      const clickHouse = yield* ClickHouse.ClickHouse;

      const store = Effect.fn("ClickHouseSessionTitles.store")(
        function* (reports: ReadonlyArray<Title.Report>) {
          if (reports.length === 0) return;
          yield* clickHouse.insert("session_titles", reports.map(titleRowOf));
        },
        Effect.catchTag("ClickHouseError", unavailable),
      );

      const latest = Effect.fn("ClickHouseSessionTitles.latest")(
        function* (sessions: ReadonlyArray<string>) {
          const found = new Map<string, Title.Report>();
          if (sessions.length === 0) return found;
          const rows = yield* clickHouse.select(latestSql, LatestRow, {
            sessions: Param.strings(sessions),
          });
          for (const row of rows) {
            found.set(row.session, {
              session: row.session,
              title: row.title,
              reportedAt: row.reported_at,
              machine: row.machine,
              reportedBy: row.reported_by,
            });
          }
          return found;
        },
        Effect.catchTag("ClickHouseError", unavailable),
      );

      return SessionTitles.of({ store, latest });
    }),
  );
