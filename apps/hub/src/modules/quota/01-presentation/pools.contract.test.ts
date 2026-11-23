import { expect, layer } from "@effect/vitest";
import { Arbitrary, DateTime, Duration, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import * as QuotaLog from "#modules/quota/05-tests/quota-log.ts";
import * as QuotaLogins from "#modules/quota/05-tests/quota-logins.ts";
import * as UsageAnswers from "#modules/quota/05-tests/usage-answers.ts";
import { InMemoryRequests } from "#modules/request-log/05-tests/fakes/in-memory-requests.repository.ts";
import { LoginFingerprint, PoolId } from "#shared/03-domain/ids.ts";
import type * as Request from "#shared/03-domain/request.entity.ts";
import * as FakeProvider from "#shared/05-tests/fake-provider.ts";
import * as Harness from "#shared/05-tests/harness.ts";

const reader = { "x-cota-key": Harness.secrets.readerHubKey };

const at = (iso: string) => DateTime.makeUnsafe(iso);
const unixSeconds = (iso: string) =>
  String(DateTime.toEpochMillis(at(iso)) / 1000);

const seeded = (fields: Partial<Harness.RequestFields>) => ({
  request: Harness.requestOf({
    loginFingerprint: Option.some(LoginFingerprint.make("fingerprint")),
    ...fields,
  }),
  cost: Option.none(),
});

const asJson = (headers: Record<string, string>) =>
  Effect.gen(function* () {
    const answer = yield* Harness.send("/api/pools", { headers });
    return {
      status: answer.status,
      body: JSON.parse(yield* Harness.textOf(answer)),
    };
  });

const usagePath = "/api/monitor/usage/quota/limit";

/** The fake provider answering the `work` pool's Z.ai usage endpoint as given, and anything else with `{}`. */
const usageAnswers = (script: FakeProvider.Script) =>
  Effect.gen(function* () {
    const fake = yield* FakeProvider.FakeProvider;
    fake.answer((seen) =>
      seen.target === usagePath ? script : { chunks: ["{}"] },
    );
  });

/** Z.ai's answer for the `work` pool: a 5-hour window resetting at 03:00 on the harness's first day, and a week not yet started. */
const zaiAnswer: FakeProvider.Script = {
  headers: [["content-type", "application/json"]],
  chunks: [
    JSON.stringify({
      data: {
        level: "lite",
        limits: [
          {
            type: "TOKENS_LIMIT",
            unit: 3,
            number: 5,
            percentage: 40,
            nextResetTime: 1794452400000,
          },
          { type: "TOKENS_LIMIT", unit: 6, number: 1, percentage: 3 },
        ],
      },
    }),
  ],
};

/** A quota login a subscription pool is given in a scene: none, one kept, or one whose access token has ended and whose refresh is refused. */
const quotaLoginOf = QuotaLog.pick(["none", "active", "active", "refused"]);

/** The quota login state of a pool that takes one of `provider` and has none. */
const noLogin = (provider: "anthropic" | "chatgpt") => ({
  provider,
  state: "none",
  givenAt: null,
  refreshedAt: null,
  endsAt: null,
  expiredAt: null,
});

/** A pool of the harness's configuration that nothing reports on. */
const quiet = (
  id: string,
  kind: "subscription" | "keyed",
  protocol: Request.Forwarded["protocol"],
  provider: string,
) => ({
  id,
  kind,
  protocol,
  provider,
  plan: null,
  windows: [],
  observedAt: null,
  reading: null,
  quotaLogin:
    kind === "keyed"
      ? null
      : noLogin(protocol === "chatgpt-codex" ? "chatgpt" : "anthropic"),
});

/** How the `work` pool's usage endpoint answers a read: with a reading, every failure, or never. */
const usageAnswer: Arbitrary.Arbitrary<FakeProvider.Script> = Arbitrary.all({
  which: QuotaLog.pick([
    "reading",
    "reading",
    "unreadable",
    "refused",
    "rate-limited",
    "failed",
    "never",
  ]),
  used: QuotaLog.int(0, 120),
  resetHours: QuotaLog.int(-2, 6),
}).pipe(
  Arbitrary.map(({ which, used, resetHours }): FakeProvider.Script => {
    if (which === "reading") {
      return {
        headers: [["content-type", "application/json"]],
        chunks: [
          JSON.stringify({
            data: {
              limits: [
                {
                  type: "TOKENS_LIMIT",
                  unit: 3,
                  number: 5,
                  percentage: used,
                  nextResetTime:
                    DateTime.toEpochMillis(Harness.start) +
                    resetHours * 3_600_000,
                },
              ],
            },
          }),
        ],
      };
    }
    if (which === "unreadable") {
      return { chunks: [JSON.stringify(UsageAnswers.openCodeGoConstructed)] };
    }
    if (which === "refused") return { status: 401 };
    if (which === "rate-limited") {
      return { status: 429, headers: [["retry-after", String(used * 5)]] };
    }
    if (which === "failed") return { status: 500 + (used % 5) };
    return { headersAfterMs: "never" };
  }),
);

layer(Harness.layer())("the pools group", (it) => {
  it.effect(
    "answers each pool with the windows its quota headers and its quota reading give, their standing at the answer's time in every pace, and the plan, to a reader key and to the owner alike",
    () =>
      Effect.gen(function* () {
        const memory = yield* InMemoryRequests;
        yield* usageAnswers(zaiAnswer);
        memory.requests.push(
          seeded({
            pool: PoolId.make("claude"),
            startedAt: at("2026-11-11T22:00:00Z"),
            rateLimits: {
              "anthropic-ratelimit-unified-7d-utilization": "0.25",
              "anthropic-ratelimit-unified-7d-reset": unixSeconds(
                "2026-11-18T03:00:00Z",
              ),
              "anthropic-ratelimit-unified-7d-status": "allowed",
            },
          }),
          seeded({
            pool: PoolId.make("codex"),
            protocol: "chatgpt-codex",
            provider: "chatgpt",
            startedAt: at("2026-11-11T23:30:00Z"),
            rateLimits: {
              "x-codex-primary-used-percent": "12",
              "x-codex-primary-window-minutes": "10080",
              "x-codex-primary-reset-at": unixSeconds("2026-11-18T03:00:00Z"),
              "x-codex-secondary-used-percent": "0",
              "x-codex-secondary-window-minutes": "0",
              "x-codex-secondary-reset-at": "",
              "x-codex-plan-type": "pro",
            },
          }),
          seeded({
            pool: PoolId.make("personal"),
            outcome: "refused",
            startedAt: at("2026-11-11T20:00:00Z"),
            rateLimits: {
              "anthropic-ratelimit-unified-7d-utilization": "0.05",
              "anthropic-ratelimit-unified-7d-reset": unixSeconds(
                "2026-11-18T03:00:00Z",
              ),
            },
          }),
          seeded({
            pool: PoolId.make("solo"),
            outcome: "refused",
            startedAt: at("2026-11-11T22:00:00Z"),
            rateLimits: {
              "anthropic-ratelimit-unified-5h-utilization": "0.4",
              "anthropic-ratelimit-unified-7d-utilization": "1",
              "anthropic-ratelimit-unified-7d-reset": unixSeconds(
                "2026-11-18T03:00:00Z",
              ),
            },
          }),
        );
        const answers = [
          yield* asJson(reader),
          yield* asJson(yield* Harness.signIn()),
        ];
        memory.requests.length = 0;

        const expected = {
          status: 200,
          body: {
            pools: [
              {
                id: "claude",
                kind: "subscription",
                protocol: "anthropic-messages",
                provider: "anthropic",
                plan: null,
                windows: [
                  {
                    lengthMs: 604_800_000,
                    scope: null,
                    source: "headers",
                    usedPercent: 25,
                    startsAt: "2026-11-11T03:00:00.000Z",
                    resetsAt: "2026-11-18T03:00:00.000Z",
                    observedAt: "2026-11-11T22:00:00.000Z",
                    standing: {
                      elapsed: 0.125,
                      resetsInMs: 529_200_000,
                      pace: "ahead-of-pace",
                      points: 12.5,
                      emptiesInMs: 226_800_000,
                    },
                  },
                ],
                observedAt: "2026-11-11T22:00:00.000Z",
                reading: null,
                quotaLogin: noLogin("anthropic"),
              },
              {
                id: "codex",
                kind: "subscription",
                protocol: "chatgpt-codex",
                provider: "chatgpt",
                plan: "Pro 20x",
                windows: [
                  {
                    lengthMs: 604_800_000,
                    scope: null,
                    source: "headers",
                    usedPercent: 12,
                    startsAt: "2026-11-11T03:00:00.000Z",
                    resetsAt: "2026-11-18T03:00:00.000Z",
                    observedAt: "2026-11-11T23:30:00.000Z",
                    standing: {
                      elapsed: 0.125,
                      resetsInMs: 529_200_000,
                      pace: "on-pace",
                      points: null,
                      emptiesInMs: null,
                    },
                  },
                ],
                observedAt: "2026-11-11T23:30:00.000Z",
                reading: null,
                quotaLogin: noLogin("chatgpt"),
              },
              quiet("console", "keyed", "anthropic-messages", "anthropic"),
              quiet("gone", "keyed", "openai-chat", "gone"),
              quiet("open", "keyed", "openai-chat", "open"),
              {
                ...quiet(
                  "personal",
                  "subscription",
                  "anthropic-messages",
                  "anthropic",
                ),
                windows: [
                  {
                    lengthMs: 604_800_000,
                    scope: null,
                    source: "headers",
                    usedPercent: 5,
                    startsAt: "2026-11-11T03:00:00.000Z",
                    resetsAt: "2026-11-18T03:00:00.000Z",
                    observedAt: "2026-11-11T20:00:00.000Z",
                    standing: {
                      elapsed: 0.125,
                      resetsInMs: 529_200_000,
                      pace: "in-reserve",
                      points: 7.5,
                      emptiesInMs: null,
                    },
                  },
                ],
                observedAt: "2026-11-11T20:00:00.000Z",
              },
              {
                ...quiet(
                  "solo",
                  "subscription",
                  "anthropic-messages",
                  "anthropic",
                ),
                windows: [
                  {
                    lengthMs: 18_000_000,
                    scope: null,
                    source: "headers",
                    usedPercent: 40,
                    startsAt: null,
                    resetsAt: null,
                    observedAt: "2026-11-11T22:00:00.000Z",
                    standing: null,
                  },
                  {
                    lengthMs: 604_800_000,
                    scope: null,
                    source: "headers",
                    usedPercent: 100,
                    startsAt: "2026-11-11T03:00:00.000Z",
                    resetsAt: "2026-11-18T03:00:00.000Z",
                    observedAt: "2026-11-11T22:00:00.000Z",
                    standing: {
                      elapsed: 0.125,
                      resetsInMs: 529_200_000,
                      pace: "full",
                      points: null,
                      emptiesInMs: null,
                    },
                  },
                ],
                observedAt: "2026-11-11T22:00:00.000Z",
              },
              {
                ...quiet("work", "keyed", "openai-chat", "zai"),
                plan: "Lite",
                windows: [
                  {
                    lengthMs: 18_000_000,
                    scope: null,
                    source: "reading",
                    usedPercent: 40,
                    startsAt: "2026-11-11T22:00:00.000Z",
                    resetsAt: "2026-11-12T03:00:00.000Z",
                    observedAt: "2026-11-12T00:00:00.000Z",
                    standing: {
                      elapsed: 0.4,
                      resetsInMs: 10_800_000,
                      pace: "on-pace",
                      points: null,
                      emptiesInMs: null,
                    },
                  },
                  {
                    lengthMs: 604_800_000,
                    scope: null,
                    source: "reading",
                    usedPercent: 3,
                    startsAt: null,
                    resetsAt: null,
                    observedAt: "2026-11-12T00:00:00.000Z",
                    standing: null,
                  },
                ],
                observedAt: "2026-11-12T00:00:00.000Z",
                reading: {
                  at: "2026-11-12T00:00:00.000Z",
                  failure: null,
                  nextAttemptAt: "2026-11-12T00:01:00.000Z",
                },
              },
            ],
          },
        };
        expect(answers).toEqual([expected, expected]);
        const fake = yield* FakeProvider.FakeProvider;
        expect(
          fake
            .seen()
            .filter(({ target }) => target === usagePath)
            .map(({ headers }) => new Map(headers).get("authorization")),
        ).toEqual([`Bearer ${Harness.secrets.heldKey}`]);
      }),
  );

  it.effect(
    "keeps a pool's last good quota reading beside a failed read, waits its backoff before reading again, and logs the failure without the held key",
    () =>
      Effect.gen(function* () {
        const logs = yield* Harness.Logs;
        const fake = yield* FakeProvider.FakeProvider;
        yield* TestClock.setTime(
          DateTime.toEpochMillis(at("2026-11-12T01:00:00Z")),
        );
        yield* usageAnswers(zaiAnswer);
        yield* asJson(reader);
        yield* TestClock.adjust(Duration.seconds(61));
        logs.forget();
        fake.forget();
        yield* usageAnswers({ status: 503, chunks: [Harness.secrets.heldKey] });
        const failed = yield* asJson(reader);
        yield* TestClock.adjust(Duration.seconds(59));
        const waiting = yield* asJson(reader);
        const work = (answer: typeof failed) =>
          answer.body.pools.find(({ id }: { id: string }) => id === "work");
        expect(
          [work(failed), work(waiting)].map((pool) => ({
            windows: pool.windows.map(
              ({
                source,
                usedPercent,
              }: {
                source: string;
                usedPercent: number;
              }) => ({ source, usedPercent }),
            ),
            plan: pool.plan,
            reading: pool.reading,
          })),
        ).toEqual(
          Array.from({ length: 2 }, () => ({
            windows: [
              { source: "reading", usedPercent: 40 },
              { source: "reading", usedPercent: 3 },
            ],
            plan: "Lite",
            reading: {
              at: "2026-11-12T01:00:00.000Z",
              failure: {
                at: "2026-11-12T01:01:01.000Z",
                kind: "failed",
                status: 503,
                detail: "Z.ai's usage endpoint answered 503.",
              },
              nextAttemptAt: "2026-11-12T01:02:01.000Z",
            },
          })),
        );
        expect(
          fake.seen().filter(({ target }) => target === usagePath),
        ).toHaveLength(1);
        const logged = logs
          .lines()
          .map((line) => JSON.parse(line))
          .filter(({ message }) => message === "quota reading failed");
        expect(
          logged.map(({ level, annotations }) => ({ level, annotations })),
        ).toEqual([
          {
            level: "WARN",
            annotations: {
              pool: "work",
              provider: "zai",
              kind: "failed",
              status: 503,
            },
          },
        ]);
        expect(logs.lines().join("\n")).not.toContain(Harness.secrets.heldKey);
      }),
  );

  it.effect.prop(
    "W7: GET /api/pools answers each pool of the configuration exactly once, in order of id, whatever the request log, the readings and the quota logins hold",
    {
      log: QuotaLog.quotaLog(60),
      usage: usageAnswer,
      logins: Arbitrary.array(quotaLoginOf, { minLength: 4, maxLength: 4 }),
    },
    ({ log, usage, logins }) =>
      Effect.gen(function* () {
        const memory = yield* InMemoryRequests;
        memory.requests.push(...log);
        yield* TestClock.adjust(Duration.minutes(16));
        const owner = yield* Harness.signIn();
        const now = DateTime.toEpochMillis(yield* DateTime.now);
        const given = (["claude", "personal", "solo", "codex"] as const).map(
          (pool, index) => [pool, logins[index] ?? "none"] as const,
        );
        const fake = yield* FakeProvider.FakeProvider;
        const refusing = new Set(
          given.flatMap(([pool, login]) => (login === "refused" ? [pool] : [])),
        );
        fake.answer((seen) => {
          if (seen.target === usagePath) return usage;
          if (
            seen.target.startsWith("/quota/") &&
            seen.target.endsWith("/token")
          ) {
            return refusing.size > 0
              ? {
                  status: 400,
                  headers: [["content-type", "application/json"]],
                  chunks: ['{"error":"invalid_grant"}'],
                }
              : { chunks: ["{}"] };
          }
          if (seen.target === Harness.quotaPaths.anthropicUsage) {
            return {
              headers: [["content-type", "application/json"]],
              chunks: [JSON.stringify(UsageAnswers.anthropicConstructed)],
            };
          }
          if (seen.target === Harness.quotaPaths.chatgptUsage) {
            return {
              headers: [["content-type", "application/json"]],
              chunks: [JSON.stringify(UsageAnswers.chatGptConstructed)],
            };
          }
          return { chunks: ["{}"] };
        });
        for (const [pool, login] of given) {
          if (login === "none") continue;
          const endsAt = now + (login === "active" ? 86_400_000 : -60_000);
          yield* Harness.send(`/api/pools/${pool}/quota-login`, {
            method: "PUT",
            headers: { "content-type": "application/json", ...owner },
            body: JSON.stringify(
              pool === "codex"
                ? {
                    provider: "chatgpt",
                    accessToken: QuotaLogins.jwt(
                      Option.some(Math.floor(endsAt / 1000)),
                      `w7-${login}`,
                    ),
                    refreshToken: `w7-refresh-${pool}`,
                    accountId: "account-w7",
                  }
                : {
                    provider: "anthropic",
                    accessToken: `w7-access-${pool}`,
                    refreshToken: `w7-refresh-${pool}`,
                    endsAt: new Date(endsAt).toISOString(),
                    subscriptionType: "pro",
                    rateLimitTier: null,
                  },
            ),
          });
        }
        const client = yield* Harness.api(reader);
        const { pools } = yield* Harness.withTheClockRunning(
          client.pools.list(),
        );
        memory.requests.length = 0;
        for (const [pool, login] of given) {
          if (login === "none") continue;
          yield* Harness.send(`/api/pools/${pool}/quota-login`, {
            method: "DELETE",
            headers: owner,
          });
        }
        expect(
          pools.flatMap(({ id, quotaLogin }) =>
            quotaLogin === null ? [id] : [],
          ),
        ).toEqual(["console", "gone", "open", "work"]);
        expect(pools.map(({ id }) => id)).toEqual([
          "claude",
          "codex",
          "console",
          "gone",
          "open",
          "personal",
          "solo",
          "work",
        ]);
      }),
    { arbitrary: { runs: 20 } },
  );

  it.effect(
    "leaves out a window whose length is not a whole number of milliseconds the hub can hold, from the quota headers and from each reader, and still answers",
    () =>
      Effect.gen(function* () {
        const memory = yield* InMemoryRequests;
        const fake = yield* FakeProvider.FakeProvider;
        yield* TestClock.adjust(Duration.minutes(16));
        const now = DateTime.toEpochMillis(yield* DateTime.now);
        memory.requests.push(
          seeded({
            pool: PoolId.make("codex"),
            protocol: "chatgpt-codex",
            provider: "chatgpt",
            startedAt: DateTime.makeUnsafe(now - 60_000),
            rateLimits: {
              "x-codex-primary-used-percent": "12",
              "x-codex-primary-window-minutes": "200000000000",
            },
          }),
        );
        const json = (value: unknown): FakeProvider.Script => ({
          headers: [["content-type", "application/json"]],
          chunks: [JSON.stringify(value)],
        });
        fake.answer((seen) => {
          if (seen.target === usagePath) {
            return json({
              data: {
                limits: [
                  {
                    type: "TOKENS_LIMIT",
                    unit: 6,
                    number: 2e10,
                    percentage: 5,
                  },
                  { type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: 40 },
                ],
              },
            });
          }
          if (seen.target === Harness.quotaPaths.chatgptUsage) {
            return json({
              rate_limit: {
                primary_window: {
                  used_percent: 22,
                  limit_window_seconds: 1e13,
                  reset_at: 0,
                },
                secondary_window: {
                  used_percent: 9,
                  limit_window_seconds: 604_800,
                  reset_at: 0,
                },
              },
            });
          }
          return { chunks: ["{}"] };
        });
        const owner = yield* Harness.signIn();
        yield* Harness.send("/api/pools/codex/quota-login", {
          method: "PUT",
          headers: { "content-type": "application/json", ...owner },
          body: JSON.stringify({
            provider: "chatgpt",
            accessToken: QuotaLogins.jwt(
              Option.some(Math.floor(now / 1000) + 86_400),
              "huge",
            ),
            refreshToken: "huge-refresh",
            accountId: "account-huge",
          }),
        });
        const answer = yield* asJson(reader);
        memory.requests.length = 0;
        yield* Harness.send("/api/pools/codex/quota-login", {
          method: "DELETE",
          headers: owner,
        });
        const windowsOf = (id: string) =>
          answer.body.pools
            ?.find((pool: { id: string }) => pool.id === id)
            .windows.map(
              ({ lengthMs, source }: { lengthMs: number; source: string }) => ({
                lengthMs,
                source,
              }),
            );
        expect({
          status: answer.status,
          work: windowsOf("work"),
          codex: windowsOf("codex"),
        }).toEqual({
          status: 200,
          work: [{ lengthMs: 18_000_000, source: "reading" }],
          codex: [{ lengthMs: 604_800_000, source: "reading" }],
        });
      }),
  );

  it.effect(
    "answers 503 when the request log cannot be read, saying so without what ClickHouse said",
    () =>
      Effect.gen(function* () {
        const memory = yield* InMemoryRequests;
        memory.readingFails = true;
        const answer = yield* Harness.problemOf(
          yield* Harness.send("/api/pools", { headers: reader }),
        );
        memory.readingFails = false;
        expect(answer).toEqual({
          status: 503,
          contentType: "application/problem+json",
          body: {
            type: "urn:cota:request-log-unavailable",
            status: 503,
            title: "The request log is unavailable.",
            detail:
              "ClickHouse could not be reached, or did not answer within 30 seconds.",
          },
        });
      }),
  );
});
