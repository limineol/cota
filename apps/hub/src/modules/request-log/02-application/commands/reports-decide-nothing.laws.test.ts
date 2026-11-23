import { describe, expect, it } from "@effect/vitest";
import { DateTime, Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import * as QuotaLog from "#modules/quota/05-tests/quota-log.ts";
import { RequestLogReader } from "#modules/request-log/02-application/interfaces/request-log-reader.ts";
import type { PricedRequest } from "#modules/request-log/02-application/interfaces/requests.repository.ts";
import * as ReadQuotaHeaders from "#modules/request-log/02-application/queries/read-quota-headers.query.ts";
import * as InMemoryRequestLogReader from "#modules/request-log/05-tests/fakes/in-memory-request-log-reader.ts";
import * as Reports from "#modules/request-log/05-tests/reports.ts";

let held: ReadonlyArray<PricedRequest> = [];

const quotaSources = ReadQuotaHeaders.layer.pipe(
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

const since = DateTime.makeUnsafe("2020-01-01T00:00:00Z");

/**
 * What the quota sources answer for every pool, the observed one among them,
 * and every quota header name the generated traffic carries or the quota
 * sources read.
 */
const answersOver = (log: ReadonlyArray<PricedRequest>) =>
  Effect.gen(function* () {
    held = log;
    const names = new Set([
      "anthropic-ratelimit-unified-5h-utilization",
      "anthropic-ratelimit-unified-7d-utilization",
      "x-codex-primary-used-percent",
      "x-codex-secondary-used-percent",
      ...log.flatMap(({ request }) =>
        request.origin._tag === "forwarded"
          ? Object.keys(request.origin.rateLimits)
          : [],
      ),
    ]);
    const asked = [...QuotaLog.pools, ...Reports.pools].flatMap((pool) =>
      [...names].map((name) => ({ pool: pool.id, name })),
    );
    return yield* (yield* ReadQuotaHeaders.ReadQuotaHeaders).execute(
      asked,
      since,
    );
  }).pipe(Effect.provide(quotaSources), Effect.orDie);

describe("a report decides nothing", () => {
  it.effect.prop(
    "L14: storing any report beside any forwarded traffic changes no answer of the quota sources, the only reading of the request log that admission, the fallback or the pools group's windows rest on",
    {
      log: QuotaLog.quotaLog(12),
      plan: Reports.reported,
      reporter: Reports.pick(Reports.reporters),
    },
    ({ log, plan, reporter }) =>
      Effect.gen(function* () {
        yield* TestClock.setTime(DateTime.toEpochMillis(Reports.now));
        const world = yield* Reports.started();
        for (const report of plan.reports) {
          yield* world.reportRequests
            .execute(Reports.reportOf(report), { reporter, machine: "studio" })
            .pipe(Effect.orDie);
        }
        yield* TestClock.setTime(DateTime.toEpochMillis(QuotaLog.now));
        const without = yield* answersOver(log);
        const beside = yield* answersOver([...log, ...world.memory.requests]);
        expect(world.memory.requests).toHaveLength(plan.calls.length);
        expect(beside).toEqual(without);
      }).pipe(Effect.scoped),
    { arbitrary: { runs: 100 } },
  );
});
