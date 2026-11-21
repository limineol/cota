import { expect, layer } from "@effect/vitest";
import { Arbitrary, DateTime, Effect, Layer, Option } from "effect";
import { RequestLogReader } from "#modules/request-log/02-application/interfaces/request-log-reader.ts";
import type { PricedRequest } from "#modules/request-log/02-application/interfaces/requests.repository.ts";
import { ReadOverview } from "#modules/request-log/02-application/queries/read-overview.query.ts";
import * as InMemoryRequestLogReader from "#modules/request-log/05-tests/fakes/in-memory-request-log-reader.ts";
import * as Generated from "#modules/request-log/05-tests/traffic.ts";
import * as RequestLog from "#modules/request-log/module.ts";
import * as Request from "#shared/03-domain/request.entity.ts";

let held: ReadonlyArray<PricedRequest> = [];

const overHeld = RequestLog.traffic.pipe(
  Layer.provide(
    Layer.succeed(
      RequestLogReader,
      InMemoryRequestLogReader.make(() => ({
        requests: held,
        requestItems: [],
        items: [],
      })),
    ),
  ),
);

const holding = (log: ReadonlyArray<PricedRequest>) =>
  Effect.sync(() => {
    held = log;
  });

const asked = Generated.selection.pipe(Arbitrary.map(Generated.askedOf));

/** Model listings, with ids no generated request log has. */
const modelListings = Generated.requestLog(20).pipe(
  Arbitrary.map((log) =>
    log.map(
      ({ request }): PricedRequest => ({
        request: {
          ...request,
          id: Request.RequestId.make(
            `${request.id.slice(0, 19)}9${request.id.slice(20)}`,
          ),
          operation: "models",
        },
        cost: Option.none(),
      }),
    ),
  ),
);

layer(overHeld)("the traffic queries over the in-memory reader", (it) => {
  it.effect.prop(
    "H4: adding model-listing requests to any request log changes no answer of overview, series, breakdown, facets or errors",
    {
      log: Generated.requestLog(60),
      listings: modelListings,
      asked,
      by: Generated.dimension,
      zone: Generated.zone,
    },
    ({ log, listings, asked, by, zone }) =>
      Effect.gen(function* () {
        yield* holding(log);
        const without = yield* Generated.answersOf(asked, by, zone);
        yield* holding([...listings, ...log]);
        const withListings = yield* Generated.answersOf(asked, by, zone);

        expect(withListings).toEqual(without);
      }),
    { timeout: 30_000 },
  );

  it.effect.prop(
    "H5: for any request log and filters, the overview's requests, errors, usage, cost and unpriced count equal their sums over a breakdown by any dimension with no limit, and over the series' points",
    {
      log: Generated.requestLog(80),
      asked,
      zone: Generated.zone,
    },
    ({ log, asked, zone }) =>
      Effect.gen(function* () {
        yield* holding(log);
        const { found, expected } = yield* Generated.sumsBy(asked, zone);

        expect(found).toEqual(expected);
      }),
    { timeout: 30_000 },
  );

  it.effect.prop(
    "H6: the previous window ends where the window starts, and is as long",
    { log: Generated.requestLog(5), asked },
    ({ log, asked }) =>
      Effect.gen(function* () {
        yield* holding(log);
        const { window, previous } = yield* (yield* ReadOverview)
          .execute(asked)
          .pipe(Effect.orDie);

        expect(DateTime.toEpochMillis(previous.to)).toBe(
          DateTime.toEpochMillis(window.from),
        );
        expect(
          DateTime.toEpochMillis(previous.to) -
            DateTime.toEpochMillis(previous.from),
        ).toBe(
          DateTime.toEpochMillis(window.to) -
            DateTime.toEpochMillis(window.from),
        );
      }),
  );

  it.effect.prop(
    "H7: for any request log and filters, each dimension's facet is the non-empty values the overview counts requests for with that value as its dimension's only filter, each with that count",
    { log: Generated.requestLog(60), asked },
    ({ log, asked }) =>
      Effect.gen(function* () {
        yield* holding(log);
        const { facets, counted } = yield* Generated.facetsAndCounts(
          asked,
          log,
        );

        expect(facets).toEqual(counted);
      }),
    { timeout: 30_000 },
  );
});
