import { expect, layer } from "@effect/vitest";
import { Arbitrary, DateTime, Duration, Effect, HashMap, Layer } from "effect";
import { TestClock } from "effect/testing";
import * as ReadQuota from "#modules/quota/02-application/commands/read-quota.command.ts";
import * as RefreshQuotaLogin from "#modules/quota/02-application/commands/refresh-quota-login.command.ts";
import * as Quota from "#modules/quota/03-domain/quota.ts";
import * as Readings from "#modules/quota/03-domain/readings.ts";
import * as Refreshes from "#modules/quota/03-domain/refreshes.ts";
import * as InMemoryQuotaLogins from "#modules/quota/05-tests/fakes/in-memory-quota-logins.ts";
import * as ScriptedQuotaReader from "#modules/quota/05-tests/fakes/scripted-quota-reader.ts";
import * as ScriptedTokenEndpoints from "#modules/quota/05-tests/fakes/scripted-token-endpoints.ts";
import * as QuotaLog from "#modules/quota/05-tests/quota-log.ts";
import { RequestLogReader } from "#modules/request-log/02-application/interfaces/request-log-reader.ts";
import type { PricedRequest } from "#modules/request-log/02-application/interfaces/requests.repository.ts";
import * as InMemoryRequestLogReader from "#modules/request-log/05-tests/fakes/in-memory-request-log-reader.ts";
import * as RequestLog from "#modules/request-log/module.ts";
import type * as Pool from "#shared/03-domain/pool.entity.ts";
import type * as Request from "#shared/03-domain/request.entity.ts";
import { compareText } from "#shared/03-domain/text.ts";
import {
  type PoolAnswer,
  ReadPools,
  layer as readPools,
} from "./read-pools.query.ts";

let held: ReadonlyArray<PricedRequest> = [];

const overHeld = readPools(
  HashMap.fromIterable(QuotaLog.pools.map((pool) => [pool.id, pool])),
).pipe(
  Layer.provide(ReadQuota.layer),
  Layer.provide(RefreshQuotaLogin.layer),
  Layer.provide([
    RequestLog.quotaSources,
    ScriptedQuotaReader.layer(),
    ScriptedTokenEndpoints.layer(),
    InMemoryQuotaLogins.layer,
    Readings.layer,
    Refreshes.layer,
  ]),
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

/** The clock when the pools are read: around the end of the generated logs, often on the grid's steps. */
const readAt = Arbitrary.all({
  steps: QuotaLog.int(-2, 12),
  nudge: QuotaLog.pick([0, 0, 0, -1, 1]),
}).pipe(
  Arbitrary.map(({ steps, nudge }) =>
    DateTime.makeUnsafe(
      DateTime.toEpochMillis(QuotaLog.now) + steps * QuotaLog.step + nudge,
    ),
  ),
);

const answered = (log: ReadonlyArray<PricedRequest>, at: DateTime.Utc) =>
  Effect.gen(function* () {
    held = log;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    return yield* (yield* ReadPools).execute;
  });

const hour = 60 * 60_000;

/** The quota sources spec's table of header windows, written out again. */
const table: Readonly<
  Record<
    Request.Forwarded["protocol"],
    ReadonlyArray<{
      readonly percentage: string;
      readonly times: number;
      readonly reset: string;
      readonly lengthMs: (
        headers: Readonly<Record<string, string>>,
      ) => number | undefined;
    }>
  >
> = {
  "anthropic-messages": [
    {
      percentage: "anthropic-ratelimit-unified-5h-utilization",
      times: 100,
      reset: "anthropic-ratelimit-unified-5h-reset",
      lengthMs: () => 5 * hour,
    },
    {
      percentage: "anthropic-ratelimit-unified-7d-utilization",
      times: 100,
      reset: "anthropic-ratelimit-unified-7d-reset",
      lengthMs: () => 7 * 24 * hour,
    },
  ],
  "chatgpt-codex": (["primary", "secondary"] as const).map((which) => ({
    percentage: `x-codex-${which}-used-percent`,
    times: 1,
    reset: `x-codex-${which}-reset-at`,
    lengthMs: (headers: Readonly<Record<string, string>>) => {
      const minutes = numberOf(headers[`x-codex-${which}-window-minutes`]);
      return minutes === undefined ? undefined : Math.floor(minutes * 60_000);
    },
  })),
  "openai-chat": [],
};

type Rule = (typeof table)[keyof typeof table][number];

/** A header's number as the spec reads it; undefined for anything else. */
const numberOf = (value: string | undefined): number | undefined => {
  const trimmed = value?.trim() ?? "";
  if (!/^-?[0-9]+(\.[0-9]+)?$/.test(trimmed)) return undefined;
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : undefined;
};

interface Expected {
  readonly lengthMs: number;
  readonly used: number;
  readonly resetMs: number | undefined;
  readonly observedAt: number;
}

/** The window one request's headers give under a rule, as the spec states it. */
const windowIn = (
  rule: Rule,
  request: Request.ForwardedRequest,
): Expected | undefined => {
  const raw = request.origin.rateLimits[rule.percentage];
  const value = numberOf(raw);
  const lengthMs = rule.lengthMs(request.origin.rateLimits);
  if (value === undefined || lengthMs === undefined || !(lengthMs > 0)) {
    return undefined;
  }
  const percentage = rule.times === 100 ? Number(`${raw?.trim()}e2`) : value;
  const reset = numberOf(request.origin.rateLimits[rule.reset]);
  return {
    lengthMs,
    used: Math.min(100, Math.max(0, percentage)),
    resetMs:
      reset !== undefined && reset > 0 ? Math.floor(reset * 1000) : undefined,
    observedAt: DateTime.toEpochMillis(request.startedAt),
  };
};

const isCurrent = (window: Expected, at: number) =>
  window.resetMs !== undefined
    ? window.resetMs > at
    : at - window.observedAt < window.lengthMs;

const millis = DateTime.toEpochMillis;

const latestOf = (requests: ReadonlyArray<Request.ForwardedRequest>) =>
  requests.reduce<Request.ForwardedRequest | undefined>(
    (best, each) =>
      best === undefined ||
      (millis(each.startedAt) - millis(best.startedAt) ||
        compareText(each.id, best.id)) > 0
        ? each
        : best,
    undefined,
  );

/** For each pool, the current header windows the spec says win, worked out from the log alone. */
const expectedOf = (
  log: ReadonlyArray<PricedRequest>,
  pool: Pool.Pool,
  at: number,
): ReadonlyArray<Expected> => {
  const kept = new Map<number, Expected>();
  for (const rule of table[pool.protocol]) {
    const latest = latestOf(
      log
        .map(({ request }) => request)
        .filter(
          (request) =>
            request.pool === pool.id &&
            Object.hasOwn(request.origin.rateLimits, rule.percentage) &&
            DateTime.toEpochMillis(request.startedAt) >= at - 7 * 24 * hour,
        ),
    );
    const window = latest === undefined ? undefined : windowIn(rule, latest);
    if (window === undefined || !isCurrent(window, at)) continue;
    const held = kept.get(window.lengthMs);
    if (held === undefined || window.observedAt > held.observedAt) {
      kept.set(window.lengthMs, window);
    }
  }
  return [...kept.values()].sort((one, other) => one.lengthMs - other.lengthMs);
};

const windowsOf = (answer: PoolAnswer) =>
  answer.windows.map(({ window }) => window);

const asExpected = (window: Quota.Window): Expected => ({
  lengthMs: Duration.toMillis(window.length),
  used: window.used,
  resetMs:
    window.span === undefined
      ? undefined
      : DateTime.toEpochMillis(window.span.reset),
  observedAt: DateTime.toEpochMillis(window.observedAt),
});

/** The windows the quota headers of the pool's requests that started when a window was observed give, by the spec's table. */
const givenBy = (
  log: ReadonlyArray<PricedRequest>,
  pool: Pool.Pool,
  window: Quota.Window,
): ReadonlyArray<Expected> =>
  log.flatMap(({ request }) =>
    request.pool === pool.id &&
    millis(request.startedAt) === millis(window.observedAt)
      ? table[pool.protocol].flatMap((rule) => {
          const given = windowIn(rule, request);
          return given === undefined ? [] : [given];
        })
      : [],
  );

const scenes = { log: QuotaLog.quotaLog(80), at: readAt };
const runs = { arbitrary: { runs: 200 } };

layer(overHeld)("the pools' quota over the in-memory reader", (it) => {
  it.effect.prop(
    "W1: for any quota headers of a pool, each scope and length that some current observation gives appears exactly once among the pool's windows, as the current one observed last",
    scenes,
    ({ log, at }) =>
      Effect.gen(function* () {
        for (const answer of yield* answered(log, at)) {
          expect(windowsOf(answer).map(asExpected), answer.pool.id).toEqual(
            expectedOf(log, answer.pool, DateTime.toEpochMillis(at)),
          );
        }
      }),
    runs,
  );

  it.effect.prop(
    "W2: every window has a used percentage, and it is the number the provider gave in that one observation, as a percentage, clamped to 0 to 100",
    scenes,
    ({ log, at }) =>
      Effect.gen(function* () {
        for (const answer of yield* answered(log, at)) {
          for (const { window } of answer.windows) {
            expect(window.used).toBeGreaterThanOrEqual(0);
            expect(window.used).toBeLessThanOrEqual(100);
            expect(
              givenBy(log, answer.pool, window).map(({ used }) => used),
            ).toContain(window.used);
          }
        }
      }),
    runs,
  );

  it.effect.prop(
    "W4: no window answered resets at or before the answer's time, and a window without a reset was observed less than its length before it",
    scenes,
    ({ log, at }) =>
      Effect.gen(function* () {
        for (const answer of yield* answered(log, at)) {
          for (const { window } of answer.windows) {
            if (window.span !== undefined) {
              expect(millis(window.span.reset)).toBeGreaterThan(millis(at));
            } else {
              expect(millis(at) - millis(window.observedAt)).toBeLessThan(
                Duration.toMillis(window.length),
              );
            }
          }
        }
      }),
    runs,
  );

  it.effect.prop(
    "W5: a window whose source is headers takes its percentage, its reset and its length from the quota headers of one request",
    scenes,
    ({ log, at }) =>
      Effect.gen(function* () {
        for (const answer of yield* answered(log, at)) {
          for (const window of windowsOf(answer)) {
            expect(givenBy(log, answer.pool, window)).toContainEqual(
              asExpected(window),
            );
          }
        }
      }),
    runs,
  );

  it.effect.prop(
    "W6: every window's standing in an answer is what standing gives for that window at the answer's time",
    scenes,
    ({ log, at }) =>
      Effect.gen(function* () {
        for (const answer of yield* answered(log, at)) {
          for (const { window, standing } of answer.windows) {
            expect(standing).toEqual(yield* Quota.standing(window));
          }
        }
      }),
    runs,
  );
});
