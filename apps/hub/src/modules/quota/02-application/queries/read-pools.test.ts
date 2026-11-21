import { expect, layer } from "@effect/vitest";
import { Duration, Effect, Fiber, HashMap, Layer, Option } from "effect";
import { TestClock } from "effect/testing";
import * as ReadQuota from "#modules/quota/02-application/commands/read-quota.command.ts";
import * as RefreshQuotaLogin from "#modules/quota/02-application/commands/refresh-quota-login.command.ts";
import * as Readings from "#modules/quota/03-domain/readings.ts";
import * as Refreshes from "#modules/quota/03-domain/refreshes.ts";
import * as InMemoryQuotaLogins from "#modules/quota/05-tests/fakes/in-memory-quota-logins.ts";
import * as ScriptedQuotaReader from "#modules/quota/05-tests/fakes/scripted-quota-reader.ts";
import * as ScriptedTokenEndpoints from "#modules/quota/05-tests/fakes/scripted-token-endpoints.ts";
import * as UsageAnswers from "#modules/quota/05-tests/usage-answers.ts";
import { RequestLogReader } from "#modules/request-log/02-application/interfaces/request-log-reader.ts";
import * as InMemoryRequestLogReader from "#modules/request-log/05-tests/fakes/in-memory-request-log-reader.ts";
import * as RequestLog from "#modules/request-log/module.ts";
import { RequestLogUnavailable } from "#shared/03-domain/request-log.ts";
import { ReadPools, layer as readPools } from "./read-pools.query.ts";

const pool = UsageAnswers.keyedPool(
  "zai",
  "https://api.z.ai/api/coding/paas/v4",
);

let logFails = false;
let usageCalls = 0;

const inMemory = InMemoryRequestLogReader.make(() => ({
  requests: [],
  requestItems: [],
  items: [],
}));

const slowlyFailing = Layer.succeed(
  RequestLogReader,
  RequestLogReader.of({
    ...inMemory,
    latestQuotaHeaders: (asked, since) =>
      logFails
        ? Effect.sleep(Duration.millis(20)).pipe(
            Effect.andThen(
              Effect.fail(
                new RequestLogUnavailable({ reason: "unreachable", code: "" }),
              ),
            ),
          )
        : inMemory.latestQuotaHeaders(asked, since),
  }),
);

const slowReading = ScriptedQuotaReader.layer(() =>
  Effect.gen(function* () {
    usageCalls++;
    yield* Effect.sleep(Duration.millis(200));
    return { windows: [], plan: Option.some("Pro") };
  }),
);

layer(
  readPools(HashMap.make([pool.id, pool])).pipe(
    Layer.provide(ReadQuota.layer),
    Layer.provide(RefreshQuotaLogin.layer),
    Layer.provide([
      RequestLog.quotaSources,
      slowReading,
      ScriptedTokenEndpoints.layer(),
      InMemoryQuotaLogins.layer,
      Readings.layer,
      Refreshes.layer,
    ]),
    Layer.provide(slowlyFailing),
  ),
)("reading the pools", (it) => {
  it.effect(
    "a request log that fails while a pool is read leaves the read running: five asks during the failure make one usage call, whose reading is kept",
    () =>
      Effect.gen(function* () {
        const query = yield* ReadPools;
        logFails = true;
        const failures = [];
        for (let ask = 0; ask < 5; ask++) {
          const asked = yield* Effect.forkChild(Effect.flip(query.execute));
          yield* TestClock.adjust(Duration.millis(20));
          failures.push((yield* Fiber.join(asked))._tag);
        }
        logFails = false;
        const asked = yield* Effect.forkChild(query.execute);
        yield* TestClock.adjust(Duration.millis(200));
        const [answer] = yield* Fiber.join(asked);
        expect({
          failures,
          usageCalls,
          plan: Option.flatMap(
            Option.flatMap(
              answer?.reading ?? Option.none(),
              ({ last }) => last,
            ),
            ({ reading }) => reading.plan,
          ),
        }).toEqual({
          failures: Array.from({ length: 5 }, () => "RequestLogUnavailable"),
          usageCalls: 1,
          plan: Option.some("Pro"),
        });
      }),
  );
});
