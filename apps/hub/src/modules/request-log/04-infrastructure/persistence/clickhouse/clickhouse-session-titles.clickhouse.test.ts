import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Layer } from "effect";
import * as ReportSessionTitles from "#modules/request-log/02-application/commands/report-session-titles.command.ts";
import { SessionTitles } from "#modules/request-log/02-application/interfaces/session-titles.ts";
import * as Scratch from "#modules/request-log/05-tests/scratch.ts";
import * as Sessions from "#modules/request-log/05-tests/sessions.ts";
import * as Generated from "#modules/request-log/05-tests/traffic.ts";
import * as ClickHouseSessionTitles from "./clickhouse-session-titles.ts";
import * as ClickHouse from "./client.ts";
import * as Tables from "./schema.ts";

describe("the titles in ClickHouse", () => {
  it.live(
    "T9: storing the same reports in any order, and any of them twice, gives every session the same reported title, in ClickHouse",
    () =>
      Effect.gen(function* () {
        const clickHouse = yield* ClickHouse.ClickHouse;
        const titles = yield* SessionTitles;
        yield* Tables.prepare().pipe(Effect.orDie);
        const samples = yield* Arbitrary.sampleEffect(Sessions.storing, {
          count: 12,
        }).pipe(Effect.orDie);
        for (const storing of samples) {
          yield* clickHouse
            .command("TRUNCATE TABLE session_titles")
            .pipe(Effect.orDie);
          const { found, expected } = yield* Sessions.latestStored(
            titles,
            storing,
          );

          expect(Generated.plain(found)).toEqual(Generated.plain(expected));
        }
      }).pipe(
        Effect.scoped,
        Effect.provide(
          ClickHouseSessionTitles.layer.pipe(Layer.provideMerge(Scratch.layer)),
        ),
      ),
    60_000,
  );

  it.live(
    "keeps a reported title whose session, title and machine hold lone surrogates, each made U+FFFD",
    () =>
      Effect.gen(function* () {
        const titles = yield* SessionTitles;
        const report = yield* ReportSessionTitles.ReportSessionTitles;
        yield* Tables.prepare().pipe(Effect.orDie);
        yield* report
          .execute({
            titles: { "half \ud800": "Fix the \udc00 relay" },
            machine: "box \ud800",
            reportedBy: "clients",
          })
          .pipe(Effect.orDie);

        const latest = yield* titles.latest(["half \ufffd"]).pipe(Effect.orDie);
        expect(
          [...latest.values()].map(({ session, title, machine }) => ({
            session,
            title,
            machine,
          })),
        ).toEqual([
          {
            session: "half \ufffd",
            title: "Fix the \ufffd relay",
            machine: "box \ufffd",
          },
        ]);
      }).pipe(
        Effect.scoped,
        Effect.provide(
          ReportSessionTitles.layer.pipe(
            Layer.provideMerge(ClickHouseSessionTitles.layer),
            Layer.provideMerge(Scratch.layer),
          ),
        ),
      ),
  );
});
