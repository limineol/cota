import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Context, Effect, Layer, Schema } from "effect";
import * as ReportRequests from "#modules/request-log/02-application/commands/report-requests.command.ts";
import { RequestLogReader } from "#modules/request-log/02-application/interfaces/request-log-reader.ts";
import { RequestsRepository } from "#modules/request-log/02-application/interfaces/requests.repository.ts";
import * as Report from "#modules/request-log/03-domain/report.ts";
import { rolesOf } from "#modules/request-log/03-domain/request-role.ts";
import { segmentsOf } from "#modules/request-log/03-domain/segment.ts";
import * as Session from "#modules/request-log/03-domain/session.ts";
import * as PriceLists from "#modules/request-log/04-infrastructure/prices/prices.ts";
import * as InMemoryReportedThrough from "#modules/request-log/05-tests/fakes/in-memory-reported-through.ts";
import * as InMemoryRequestLogReader from "#modules/request-log/05-tests/fakes/in-memory-request-log-reader.ts";
import * as Reports from "#modules/request-log/05-tests/reports.ts";
import * as Scratch from "#modules/request-log/05-tests/scratch.ts";
import * as Conversation from "#shared/03-domain/conversation.ts";
import { HubKeyName } from "#shared/03-domain/ids.ts";
import * as ClickHouseRequestLogReader from "./clickhouse-request-log-reader.ts";
import * as ClickHouseRequests from "./clickhouse-requests.repository.ts";
import * as ClickHouse from "./client.ts";
import { Param } from "./client.ts";
import * as RequestItemsMapper from "./mappers/request-items.mapper.ts";

const reporter: Report.Reporter = {
  _tag: "HubKey",
  name: HubKeyName.make("fleet"),
};

/** `ReportRequests` over the ClickHouse repository, in a scratch database of its own. */
const world = Effect.gen(function* () {
  const pools = Reports.poolsById();
  const context = yield* Layer.build(
    ReportRequests.layer(pools).pipe(
      Layer.provideMerge(ClickHouseRequests.layer),
      Layer.provide([PriceLists.layer(pools), InMemoryReportedThrough.layer]),
      Layer.merge(ClickHouseRequestLogReader.layer),
      Layer.provideMerge(Scratch.layer),
    ),
  );
  yield* Context.get(context, RequestsRepository).prepare.pipe(Effect.orDie);
  return {
    clickHouse: Context.get(context, ClickHouse.ClickHouse),
    faults: Context.get(context, Scratch.Scratch).faults,
    reportRequests: Context.get(context, ReportRequests.ReportRequests),
    reader: Context.get(context, RequestLogReader),
  };
});

type World = Effect.Success<typeof world>;

const Row = Schema.Record(Schema.String, Schema.Unknown);

/** Every row of the request log's three tables, merged or not, in an order of their own. */
const rowsOf = ({ clickHouse }: World) =>
  Effect.gen(function* () {
    const all = (sql: string) => clickHouse.select(sql, Row);
    return {
      requests: yield* all("SELECT * FROM requests ORDER BY id"),
      requestItems: yield* all(
        "SELECT * FROM request_items ORDER BY request_id",
      ),
      items: yield* all("SELECT * FROM items ORDER BY session, digest"),
    };
  }).pipe(Effect.orDie);

const Count = Schema.Struct({ held: Schema.FiniteFromString });

const heldIn = ({ clickHouse }: World, calls: ReadonlyArray<Report.Call>) =>
  Effect.gen(function* () {
    const ids = calls.map((call) =>
      Report.idOf("antigravity", call.call, call.startedAt),
    );
    const counted = (table: string, column: string) =>
      clickHouse.select(
        `SELECT count() AS held FROM ${table} WHERE ${column} IN {ids:Array(UUID)}`,
        Count,
        { ids: Param.strings(ids) },
      );
    const [requests] = yield* counted("requests", "id");
    const [requestItems] = yield* counted("request_items", "request_id");
    return { requests: requests?.held, requestItems: requestItems?.held };
  }).pipe(Effect.orDie);

/** Faults each met once, by the first query its pattern matches; gives how many are still to meet. */
const once = (
  w: World,
  faults: ReadonlyArray<readonly [RegExp, Scratch.Fault]>,
) => {
  const left = [...faults];
  w.faults.faultOf = (query) => {
    const at = left.findIndex(([pattern]) => pattern.test(query));
    const fault = left[at]?.[1];
    if (fault !== undefined) left.splice(at, 1);
    return fault;
  };
  return () => left.length;
};

/** Sends a report until it is answered 200, and how much of it the log then held. */
const delivered = (w: World, calls: ReadonlyArray<Report.Call>) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 10; attempt++) {
      const answer = yield* Effect.result(
        w.reportRequests.execute(Reports.reportOf(calls), {
          reporter,
          machine: "studio",
        }),
      );
      if (answer._tag === "Success") return yield* heldIn(w, calls);
      expect(answer.failure._tag).toBe("RequestLogUnavailable");
    }
    return yield* Effect.die("a report was never stored");
  });

/** Each session's segments as a reader's requests give them: why each began, and how many requests it holds. */
const segmentsIn = (
  reader: RequestLogReader["Service"],
  sessions: ReadonlyArray<string>,
) =>
  Effect.map(
    reader.sessionRequests(sessions, Session.read, Session.mostListedRequests),
    (found) =>
      sessions.map((session) =>
        segmentsOf(rolesOf(found.get(session) ?? [])).map(
          ({ startedBy, requests }) => ({
            startedBy,
            requests: requests.length,
          }),
        ),
      ),
  ).pipe(Effect.orDie);

const plans = Arbitrary.sampleEffect(Reports.reported, {
  count: 4,
  seed: 6,
}).pipe(Effect.orDie);

describe("reported requests in ClickHouse", () => {
  it.live(
    "L9: however a report is delivered again, in part, with others, or after a delivery stored in part, the log holds each call once, with the rows one delivery of each call gives, in ClickHouse",
    () =>
      Effect.gen(function* () {
        for (const plan of yield* plans) {
          const single = yield* world;
          for (const report of plan.reports) yield* delivered(single, report);
          const many = yield* world;
          for (const [at, report] of plan.reports.entries()) {
            const left = once(many, [
              at % 2 === 0
                ? [/^INSERT INTO requests /, "down"]
                : [/^INSERT INTO request_items /, "answerLost"],
            ]);
            yield* delivered(many, report);
            expect(left()).toBe(0);
            yield* delivered(many, report.slice(1));
          }
          yield* delivered(many, plan.calls);
          expect(yield* rowsOf(many)).toEqual(yield* rowsOf(single));
        }
      }).pipe(Effect.scoped),
    120_000,
  );

  it.live(
    "L10: a report answered 200 has every one of its calls held in the log at the moment of the answer, in ClickHouse",
    () =>
      Effect.gen(function* () {
        for (const plan of yield* plans) {
          const w = yield* world;
          for (const report of plan.reports) {
            const left = once(w, [[/^INSERT INTO requests /, "answerLost"]]);
            expect(yield* delivered(w, report)).toEqual({
              requests: report.length,
              requestItems: report.length,
            });
            expect(left()).toBe(0);
          }
        }
      }).pipe(Effect.scoped),
    120_000,
  );

  it.live(
    "begins a reported session's segment at the call after a compaction its record names, though the prompt does not shrink, and once for one that shrinks it, in ClickHouse as in memory",
    () =>
      Effect.gen(function* () {
        const conversations = [
          Reports.compacted(
            "compacted-flat",
            [30_000, 31_000, 32_000, 32_100],
            2,
          ),
          Reports.compacted(
            "compacted-shrunk",
            [90_000, 100_000, 30_000, 31_000],
            1,
          ),
        ];
        const sessions = ["compacted-flat", "compacted-shrunk"];
        const w = yield* world;
        const inMemory = yield* Reports.started();
        for (const calls of conversations) {
          yield* delivered(w, calls);
          yield* inMemory.reportRequests
            .execute(Reports.reportOf(calls), { reporter, machine: "studio" })
            .pipe(Effect.orDie);
        }
        const expected = [
          [
            { startedBy: "start", requests: 3 },
            { startedBy: "compaction", requests: 1 },
          ],
          [
            { startedBy: "start", requests: 2 },
            { startedBy: "compaction", requests: 2 },
          ],
        ];

        expect(yield* segmentsIn(w.reader, sessions)).toEqual(expected);
        expect(
          yield* segmentsIn(
            InMemoryRequestLogReader.make(() => inMemory.memory),
            sessions,
          ),
        ).toEqual(expected);
      }).pipe(Effect.scoped),
    120_000,
  );

  it.live(
    "L12: for any conversation in any cut into reports, each call's input part is every item of the calls before it and its own input, in order, its output part its own, and each item is stored once per session, in ClickHouse",
    () =>
      Effect.gen(function* () {
        for (const plan of yield* plans) {
          const w = yield* world;
          for (const report of plan.reports) yield* delivered(w, report);
          const rows = yield* w.clickHouse
            .select(
              "SELECT request_id, session, started_at, system, tools, input, output, layout, overlay, params FROM request_items",
              RequestItemsMapper.ReadRequestItemsRow,
            )
            .pipe(Effect.orDie);
          const byId = new Map(
            rows
              .map(RequestItemsMapper.requestItemsOf)
              .map((row) => [row.requestId, row]),
          );
          const digestOf = (step: Schema.JsonObject) =>
            Conversation.itemOf(
              { parts: [], takenOut: [], textOf: () => "" },
              step,
            ).digest;
          const sessions = new Map<string, Array<Conversation.Digest>>();
          for (const call of plan.calls) {
            const before = sessions.get(call.session) ?? [];
            const input = call.input.map(digestOf);
            const output = call.output.map(digestOf);
            const row = byId.get(
              Report.idOf("antigravity", call.call, call.startedAt),
            );
            expect(row?.input).toEqual([...before, ...input]);
            expect(row?.output).toEqual(output);
            sessions.set(call.session, [...before, ...input, ...output]);
          }
          const [items] = yield* w.clickHouse
            .select("SELECT count() AS held FROM items", Count)
            .pipe(Effect.orDie);
          const [distinct] = yield* w.clickHouse
            .select(
              "SELECT count() AS held FROM (SELECT DISTINCT session, digest FROM items)",
              Count,
            )
            .pipe(Effect.orDie);
          expect(items?.held).toBe(distinct?.held);
          expect(items?.held).toBe(
            [...sessions.values()].reduce((sum, each) => sum + each.length, 0),
          );
        }
      }).pipe(Effect.scoped),
    120_000,
  );
});
