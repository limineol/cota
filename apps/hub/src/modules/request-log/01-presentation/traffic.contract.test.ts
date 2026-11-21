import { expect, layer } from "@effect/vitest";
import { DateTime, Effect } from "effect";
import { TestClock } from "effect/testing";
import { InMemoryRequests } from "#modules/request-log/05-tests/fakes/in-memory-requests.repository.ts";
import * as Generated from "#modules/request-log/05-tests/traffic.ts";
import * as FakeProvider from "#shared/05-tests/fake-provider.ts";
import * as Harness from "#shared/05-tests/harness.ts";

const fleet = { "x-cota-key": Harness.secrets.fleetHubKey };
const reader = { "x-cota-key": Harness.secrets.readerHubKey };

const chat = (session: string) =>
  Harness.send("/pools/work/chat/completions", {
    method: "POST",
    headers: {
      ...fleet,
      "content-type": "application/json",
      "x-session-affinity": session,
      "x-cota-machine": "workstation",
      "x-cota-project": "cota",
      "user-agent": "opencode/1.2.3",
    },
    body: JSON.stringify({
      model: "glm-5.2",
      messages: [{ role: "user", content: "hi" }],
    }),
  }).pipe(Effect.andThen(Harness.textOf));

const answered = (prompt: number, completion: number) => ({
  headers: [["content-type", "application/json"]] as const,
  chunks: [
    JSON.stringify({
      id: "chatcmpl-1",
      model: "glm-5.2",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "hello" },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: prompt,
        completion_tokens: completion,
        total_tokens: prompt + completion,
      },
    }),
  ],
});

/** Two answers, a failure and a model listing through the `work` pool, then a minute passes. */
const traffic = Effect.gen(function* () {
  const fake = yield* FakeProvider.FakeProvider;
  fake.answer(answered(12, 3));
  yield* chat("session-1");
  fake.answer(answered(30, 5));
  yield* chat("session-2");
  fake.answer({
    status: 500,
    headers: [["content-type", "application/json"]],
    chunks: [
      '{"error":{"message":"The provider broke.","type":"server_error"}}',
    ],
  });
  yield* chat("session-2");
  fake.answer({
    headers: [["content-type", "application/json"]],
    chunks: ['{"object":"list","data":[]}'],
  });
  yield* Harness.send("/pools/work/models", { headers: fleet }).pipe(
    Effect.andThen(Harness.textOf),
  );
  const recorded = yield* Harness.recorded(4);
  yield* TestClock.adjust("1 minute");
  return recorded;
});

const usage = {
  input: 42,
  cacheRead: 0,
  cacheWriteShort: 0,
  cacheWriteLong: 0,
  output: 8,
  reasoning: 0,
};

const none = {
  input: 0,
  cacheRead: 0,
  cacheWriteShort: 0,
  cacheWriteLong: 0,
  output: 0,
  reasoning: 0,
};

const facet = (value: string) => [{ value, requests: 3 }];

layer(Harness.layer())("the traffic group", (it) => {
  it.effect(
    "reads back what the pool routes sent, model listings left out, through the typed client with a reader key",
    () =>
      Effect.gen(function* () {
        const [, , failed] = yield* traffic;
        // `recorded` moves the clock on while it waits, so the default window is read from the clock, not assumed.
        const now = yield* DateTime.now;
        const daysAgo = (days: number) =>
          DateTime.formatIso(DateTime.subtract(now, { days }));
        const client = yield* Harness.api(reader);
        const answers = Generated.plain({
          overview: yield* client.traffic.overview({ query: {} }),
          series: yield* client.traffic.series({ query: {} }),
          breakdown: yield* client.traffic.breakdown({
            query: { by: "machine" },
          }),
          facets: yield* client.traffic.facets({ query: {} }),
          errors: yield* client.traffic.errors({ query: {} }),
        });

        expect(answers).toEqual({
          overview: {
            window: { from: daysAgo(7), to: daysAgo(0) },
            previous: { from: daysAgo(14), to: daysAgo(7) },
            totals: {
              requests: 3,
              sessions: 2,
              outcomes: { ok: 2, error: 1, refused: 0, cancelled: 0 },
              usage,
              usageUnreported: 1,
              costUsd: "0",
              unpricedRequests: 2,
              durationMs: { p50: 0, p95: 0 },
              firstByteMs: { p50: 0, p95: 0 },
            },
            previousTotals: {
              requests: 0,
              sessions: 0,
              outcomes: { ok: 0, error: 0, refused: 0, cancelled: 0 },
              usage: none,
              usageUnreported: 0,
              costUsd: "0",
              unpricedRequests: 0,
              durationMs: null,
              firstByteMs: null,
            },
            firstRequestAt: "2026-11-12T00:00:00.000Z",
          },
          series: {
            bucket: "3h",
            keys: ["work"],
            points: [
              {
                at: "2026-11-12T00:00:00.000Z",
                key: "work",
                requests: 3,
                errors: 1,
                usage,
                costUsd: "0",
                unpricedRequests: 2,
              },
            ],
          },
          breakdown: {
            rows: [
              {
                key: "workstation",
                requests: 3,
                sessions: 2,
                errors: 1,
                usage,
                costUsd: "0",
                unpricedRequests: 2,
                lastAt: "2026-11-12T00:00:00.000Z",
              },
            ],
            distinctKeys: 1,
          },
          facets: {
            pool: facet("work"),
            model: facet("glm-5.2"),
            client: facet("opencode"),
            machine: facet("workstation"),
            project: facet("cota"),
            provider: facet("zai"),
            hub_key: facet("fleet"),
            outcome: [
              { value: "ok", requests: 2 },
              { value: "error", requests: 1 },
            ],
          },
          errors: {
            groups: [
              {
                provider: "zai",
                model: "glm-5.2",
                outcome: "error",
                upstreamStatus: 500,
                errorType: "server_error",
                message: "The provider broke.",
                requests: 1,
                firstAt: "2026-11-12T00:00:00.000Z",
                lastAt: "2026-11-12T00:00:00.000Z",
                pools: ["work"],
                clients: ["opencode"],
                latestRequest: failed?.id,
              },
            ],
            requests: 1,
            distinctGroups: 1,
          },
        });
      }),
  );

  it.effect(
    "writes money as dollars with 12 decimals, and takes a filter's values repeated in the query",
    () =>
      Effect.gen(function* () {
        const owner = yield* Harness.signIn();
        const answer = yield* Harness.send(
          "/api/breakdown?by=outcome&pool=nowhere&pool=work&outcome=error&outcome=ok&limit=1",
          { headers: owner },
        );
        const { rows, distinctKeys } = JSON.parse(
          yield* Harness.textOf(answer),
        );

        expect([answer.status, rows, distinctKeys]).toEqual([
          200,
          [
            {
              key: "ok",
              requests: 2,
              sessions: 2,
              errors: 0,
              usage,
              costUsd: "0.000000000000",
              unpricedRequests: 2,
              lastAt: "2026-11-12T00:00:00.000Z",
            },
          ],
          2,
        ]);
      }),
  );

  it.effect(
    "starts a series' buckets at whole multiples of their length since midnight in the time zone asked for",
    () =>
      Effect.gen(function* () {
        const client = yield* Harness.api(reader);
        const series = yield* client.traffic.series({
          query: {
            tz: DateTime.zoneMakeNamedUnsafe("Asia/Kolkata"),
            by: "outcome",
          },
        });

        expect(
          Generated.plain(series.points.map(({ at, key }) => [at, key])),
        ).toEqual([
          ["2026-11-11T21:30:00.000Z", "ok"],
          ["2026-11-11T21:30:00.000Z", "error"],
        ]);
      }),
  );

  it.effect(
    "counts a filter value's characters, not its UTF-16 units: 255 crabs are a value, 256 are a 400",
    () =>
      Effect.gen(function* () {
        const statuses = [];
        for (const count of [255, 256]) {
          const crabs = encodeURIComponent("\u{1F980}".repeat(count));
          statuses.push(
            (yield* Harness.send(`/api/overview?project=${crabs}`, {
              headers: reader,
            })).status,
          );
        }
        expect(statuses).toEqual([200, 400]);
      }),
  );

  it.effect(
    "answers a window whose from is not before its to, a time zone that is no IANA name, and too many values, with a 400 problem",
    () =>
      Effect.gen(function* () {
        const at = "2026-11-10T00:00:00.000Z";
        const answers = [];
        for (const query of [
          `from=${at}&to=${at}`,
          "tz=%2B05:30",
          "tz=Mars/Olympus_Mons",
          Array.from({ length: 51 }, (_, index) => `pool=p${index}`).join("&"),
          "limit=501&by=pool",
        ]) {
          const path = query.includes("by=") ? "breakdown" : "series";
          const { status, body } = yield* Harness.problemOf(
            yield* Harness.send(`/api/${path}?${query}`, { headers: reader }),
          );
          answers.push([status, Object(body).type, Object(body).detail]);
        }

        expect(answers).toEqual([
          [
            400,
            "urn:cota:empty-window",
            "The window from 2026-11-10T00:00:00.000Z to 2026-11-10T00:00:00.000Z holds no instant.",
          ],
          [400, "about:blank", expect.any(String)],
          [400, "about:blank", expect.any(String)],
          [400, "about:blank", expect.any(String)],
          [400, "about:blank", expect.any(String)],
        ]);
      }),
  );

  it.effect(
    "answers 503 when the request log cannot be read, saying so without what ClickHouse said",
    () =>
      Effect.gen(function* () {
        const memory = yield* InMemoryRequests;
        memory.readingFails = true;
        const answers = [];
        for (const path of [
          "overview",
          "series",
          "breakdown?by=pool",
          "facets",
          "errors",
        ]) {
          answers.push(
            yield* Harness.problemOf(
              yield* Harness.send(`/api/${path}`, { headers: reader }),
            ),
          );
        }
        memory.readingFails = false;

        expect(answers).toEqual(
          Array.from({ length: 5 }, () => ({
            status: 503,
            contentType: "application/problem+json",
            body: {
              type: "urn:cota:request-log-unavailable",
              status: 503,
              title: "The request log is unavailable.",
              detail:
                "ClickHouse could not be reached, or did not answer within 30 seconds.",
            },
          })),
        );
      }),
  );
});
