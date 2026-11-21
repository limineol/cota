import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, Layer, Option, Redacted, Schema, Stream } from "effect";
import { HttpClient, HttpClientResponse, UrlParams } from "effect/http";
import { TestClock } from "effect/testing";
import { RequestLogArchive } from "#modules/request-log/02-application/interfaces/request-log-archive.ts";
import * as Archive from "#modules/request-log/03-domain/archive.ts";
import * as Scratch from "#modules/request-log/05-tests/scratch.ts";
import * as ClickHouseRequestLogArchive from "./clickhouse-request-log-archive.ts";
import * as ClickHouse from "./client.ts";

interface Sent {
  readonly query: string;
  readonly maxExecutionTime: string | undefined;
}

/** A ClickHouse whose inserts and exports begin and never end: an insert never answers, and an export sends a few bytes and then nothing. */
const stalled = (sent: Array<Sent>) =>
  HttpClient.make((request) => {
    const query = Scratch.queryOf(request);
    sent.push({
      query,
      maxExecutionTime: Option.getOrUndefined(
        UrlParams.getFirst(request.urlParams, "max_execution_time"),
      ),
    });
    if (/^\s*INSERT/.test(query)) return Effect.never;
    const answer = (
      body: string | ReadableStream<Uint8Array>,
      headers: Record<string, string> = {},
    ) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(request, new Response(body, { headers })),
      );
    if (query.includes("FORMAT JSONEachRow") && query.startsWith("SELECT *")) {
      return answer(
        new ReadableStream({
          start: (controller) => controller.enqueue(new Uint8Array([40, 181])),
        }),
        { "content-encoding": "zstd" },
      );
    }
    if (query.includes("system.columns")) return answer('{"name":"id"}\n');
    return answer('{"rows":"1"}\n');
  });

const over = (sent: Array<Sent>) =>
  ClickHouseRequestLogArchive.layer.pipe(
    Layer.provide(
      ClickHouse.layer({
        url: "http://clickhouse",
        database: "cota",
        user: "cota",
        password: Redacted.make("secret"),
      }),
    ),
    Layer.provide(Layer.succeed(HttpClient.HttpClient, stalled(sent))),
  );

const day = Schema.decodeSync(Archive.Day)("2026-11-10");

describe("the archive's long statements over ClickHouse", () => {
  it.effect(
    "the restore's insert is stopped by ClickHouse at 10 minutes and waited on for 11",
    () => {
      const sent: Array<Sent> = [];
      return Effect.gen(function* () {
        const session = yield* (yield* RequestLogArchive).session;
        const adding = yield* Effect.forkChild(
          Effect.result(session.add("requests", ["id"])),
        );
        yield* TestClock.adjust("10 minutes");
        expect(adding.pollUnsafe()).toBeUndefined();
        expect(
          sent
            .filter(({ query }) => /^\s*INSERT INTO requests/.test(query))
            .map(({ maxExecutionTime }) => maxExecutionTime),
        ).toEqual(["600"]);
        yield* TestClock.adjust("1 minute");
        const added = yield* Fiber.join(adding);
        expect(added._tag === "Failure" && added.failure.detail).toBe(
          "ClickHouse failed (no answer): no answer within 11m",
        );
      }).pipe(Effect.provide(over(sent)));
    },
  );

  it.effect(
    "an export that sends some bytes and then nothing fails 11 minutes after it began",
    () => {
      const sent: Array<Sent> = [];
      return Effect.gen(function* () {
        const session = yield* (yield* RequestLogArchive).session;
        const exporting = yield* Effect.forkChild(
          Effect.result(Stream.runDrain(session.export(day, "requests"))),
        );
        yield* TestClock.adjust("10 minutes");
        expect(exporting.pollUnsafe()).toBeUndefined();
        yield* TestClock.adjust("1 minute");
        const exported = yield* Fiber.join(exporting);
        expect(exported._tag === "Failure" && exported.failure.detail).toBe(
          "ClickHouse failed (no answer): no end within 11m",
        );
      }).pipe(Effect.provide(over(sent)));
    },
  );
});
