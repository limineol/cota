import { describe, expect, it, layer } from "@effect/vitest";
import { DateTime, Effect, Exit, Fiber, Layer, Option, Scope } from "effect";
import { TestClock } from "effect/testing";
import * as StoredItems from "#modules/request-log/03-domain/stored-items.ts";
import { Recorded } from "#modules/request-log/05-tests/fakes/record-request.fake.ts";
import * as FakeProvider from "#shared/05-tests/fake-provider.ts";
import * as Harness from "#shared/05-tests/harness.ts";

const fleet = { "x-cota-key": Harness.secrets.fleetHubKey };

const nextRequest = Effect.flatMap(Recorded, (recorded) => recorded.take);

const nothingMoreRecorded = Effect.gen(function* () {
  expect(yield* Harness.recorded(0)).toEqual([]);
});

const requestOnceTheClockMoves = Effect.gen(function* () {
  const recorded = yield* Harness.recorded(1);
  expect(recorded).toHaveLength(1);
  return yield* Effect.fromNullishOr(recorded[0]);
});

const waitUntil = (condition: () => boolean) =>
  Effect.gen(function* () {
    expect(yield* Harness.waitUntil(condition)).toBe(true);
  });

const hangUp = () => new AbortController();

const sse = (...data: ReadonlyArray<string>) =>
  data.map((each) => `data: ${each}\n\n`);

const chunk = (fields: string) =>
  `{"id":"chatcmpl-1","object":"chat.completion.chunk","model":"glm-5.2",${fields}}`;

const streamed = sse(
  chunk('"choices":[{"index":0,"delta":{"role":"assistant","content":"Hi"}}]'),
  chunk(
    '"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":3,"total_tokens":15}',
  ),
  "[DONE]",
);

const eventStream = [
  ["content-type", "text/event-stream"],
  ["x-request-id", "provider-request-1"],
] as const;

const chat = (stream: boolean) =>
  JSON.stringify({
    model: "glm-5.2",
    stream,
    messages: [{ role: "user", content: "hi" }],
  });

const post = (
  path: string,
  body: RequestInit["body"],
  headers: Record<string, string> = {},
  init: RequestInit = {},
) =>
  Harness.send(path, {
    method: "POST",
    headers: { ...fleet, "content-type": "application/json", ...headers },
    body,
    ...init,
  });

const hubErrorOf = (response: Response) =>
  Effect.gen(function* () {
    const body: unknown = JSON.parse(yield* Harness.textOf(response));
    return {
      status: response.status,
      retry: response.headers.get("x-should-retry"),
      body,
    };
  });

const errorBody = (type: string) => ({
  type: "error",
  error: { type, message: expect.any(String) },
});

const headerNames = (seen: FakeProvider.Seen) =>
  seen.headers.map(([name]) => name);

const headerOf = (seen: FakeProvider.Seen, name: string) =>
  seen.headers.find(([each]) => each === name)?.[1];

layer(Harness.layer())("relay", (it) => {
  it.effect("answers /health without a hub key", () =>
    Effect.gen(function* () {
      const response = yield* Harness.send("/health");
      expect(response.status).toBe(200);
      expect(yield* Harness.textOf(response)).toBe('{"status":"ok"}');
    }),
  );

  describe("forwarding", () => {
    it.effect(
      "sends the method, path, query and body bytes to the pool's base URL",
      () =>
        Effect.gen(function* () {
          const fake = yield* FakeProvider.FakeProvider;
          fake.answer({ chunks: ["{}"] });
          const body = chat(false);
          const response = yield* post(
            "/pools/work/chat/completions?a=1&b=%2F&a=2&empty=",
            body,
          );
          yield* Harness.textOf(response);
          const seen = fake.last();
          expect(seen.method).toBe("POST");
          expect(seen.target).toBe(
            "/api/paas/v4/chat/completions?a=1&b=%2F&a=2&empty=",
          );
          expect(new TextDecoder().decode(seen.body)).toBe(body);
          expect(headerOf(seen, "content-length")).toBe(
            String(new TextEncoder().encode(body).byteLength),
          );
          yield* nextRequest;
        }),
    );

    it.effect(
      "keeps the client's headers but the connection's own, x-cota-* and cookie",
      () =>
        Effect.gen(function* () {
          const fake = yield* FakeProvider.FakeProvider;
          fake.answer({ chunks: ["{}"] });
          const response = yield* post("/pools/work/chat/completions", "{}", {
            "x-cota-project": "cota",
            "x-cota-machine": "workstation",
            "x-cota-client": "opencode",
            "x-stainless-retry-count": "0",
            traceparent:
              "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
            cookie: "session=abc",
            "proxy-authorization": "Basic eDp5",
            "user-agent": "opencode/1.2.3",
            "x-session-affinity": "session-1",
          });
          yield* Harness.textOf(response);
          const seen = fake.last();
          expect(
            headerNames(seen).filter((name) => name.startsWith("x-cota-")),
          ).toEqual([]);
          expect(headerNames(seen)).not.toContain("cookie");
          expect(headerNames(seen)).not.toContain("proxy-authorization");
          expect(headerOf(seen, "traceparent")).toBe(
            "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
          );
          expect(headerOf(seen, "x-stainless-retry-count")).toBe("0");
          expect(headerOf(seen, "user-agent")).toBe("opencode/1.2.3");
          expect(headerOf(seen, "x-session-affinity")).toBe("session-1");
          expect(headerNames(seen)).not.toContain("b3");
          yield* nextRequest;
        }),
    );

    it.effect(
      "asks for an identity answer when the client sent no accept-encoding, and keeps the client's otherwise",
      () =>
        Effect.gen(function* () {
          const fake = yield* FakeProvider.FakeProvider;
          fake.answer({ chunks: ["{}"] });
          const raw = yield* Harness.sendRaw(
            `GET /pools/work/models HTTP/1.1\r\nhost: hub\r\nx-cota-key: ${Harness.secrets.fleetHubKey}\r\nconnection: close\r\n\r\n`,
          );
          expect(raw).toMatch(/^HTTP\/1\.1 200/);
          expect(headerOf(fake.last(), "accept-encoding")).toBe("identity");
          yield* nextRequest;

          const response = yield* Harness.send("/pools/work/models", {
            headers: { ...fleet, "accept-encoding": "gzip, br" },
          });
          yield* Harness.textOf(response);
          expect(headerOf(fake.last(), "accept-encoding")).toBe("gzip, br");
          yield* nextRequest;
        }),
    );

    it.effect(
      "replaces every credential the client sent with the pool's held key, in x-api-key when the client sent one",
      () =>
        Effect.gen(function* () {
          const fake = yield* FakeProvider.FakeProvider;
          fake.answer({ chunks: ["{}"] });
          const response = yield* post("/pools/work/chat/completions", "{}", {
            authorization: "Bearer client-token",
            "x-api-key": "client-x-api-key",
            "api-key": "client-api-key",
            "x-goog-api-key": "client-goog-key",
          });
          yield* Harness.textOf(response);
          const seen = fake.last();
          expect(headerOf(seen, "x-api-key")).toBe(Harness.secrets.heldKey);
          for (const name of ["authorization", "api-key", "x-goog-api-key"]) {
            expect(headerNames(seen)).not.toContain(name);
          }
          expect(JSON.stringify(seen.headers)).not.toMatch(/client-/);
          yield* nextRequest;
        }),
    );

    it.effect("sends no credential to a keyed pool without a held key", () =>
      Effect.gen(function* () {
        const fake = yield* FakeProvider.FakeProvider;
        fake.answer({ chunks: ["{}"] });
        const response = yield* post("/pools/open/chat/completions", "{}", {
          authorization: "Bearer client-token",
          "x-api-key": "client-x-api-key",
        });
        yield* Harness.textOf(response);
        const seen = fake.last();
        expect(seen.target).toBe("/v1/chat/completions");
        expect(headerNames(seen)).not.toContain("authorization");
        expect(headerNames(seen)).not.toContain("x-api-key");
        yield* nextRequest;
      }),
    );

    it.effect(
      "takes a keyed pool's hub key from the bearer token when x-cota-key is missing",
      () =>
        Effect.gen(function* () {
          const fake = yield* FakeProvider.FakeProvider;
          fake.answer({ chunks: ["{}"] });
          const response = yield* Harness.send("/pools/work/models", {
            headers: { authorization: `Bearer ${Harness.secrets.fleetHubKey}` },
          });
          expect(response.status).toBe(200);
          yield* Harness.textOf(response);
          expect(headerOf(fake.last(), "authorization")).toBe(
            `Bearer ${Harness.secrets.heldKey}`,
          );
          const request = yield* nextRequest;
          expect(request.origin.hubKey).toBe("fleet");
        }),
    );
  });

  describe("the response", () => {
    it.effect(
      "passes the status, headers and cookies back, with the request's id",
      () =>
        Effect.gen(function* () {
          const fake = yield* FakeProvider.FakeProvider;
          fake.answer({
            status: 201,
            headers: [
              ["content-type", "application/json"],
              ["x-request-id", "provider-request-7"],
              ["set-cookie", "__cf_bm=abc; Path=/; HttpOnly"],
              ["set-cookie", "other=1; Path=/"],
              [
                "set-cookie",
                "session=xyz; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Max-Age=3600; Domain=example.com; Path=/app; Secure; HttpOnly; SameSite=Lax",
              ],
              ["keep-alive", "timeout=5"],
            ],
            chunks: ['{"ok":true}'],
          });
          const response = yield* Harness.send("/pools/work/models", {
            headers: fleet,
          });
          expect(response.status).toBe(201);
          expect(yield* Harness.textOf(response)).toBe('{"ok":true}');
          expect(response.headers.get("content-type")).toBe("application/json");
          expect(response.headers.get("x-request-id")).toBe(
            "provider-request-7",
          );
          expect(response.headers.getSetCookie()).toEqual([
            "__cf_bm=abc; Path=/; HttpOnly",
            "other=1; Path=/",
            "session=xyz; Max-Age=3600; Domain=example.com; Path=/app; Expires=Wed, 21 Oct 2026 07:28:00 GMT; HttpOnly; Secure; SameSite=Lax",
          ]);
          expect(response.headers.has("keep-alive")).toBe(false);
          const request = yield* nextRequest;
          expect(response.headers.get("x-cota-request")).toBe(request.id);
          expect(request.providerRequestId).toBe("provider-request-7");
        }),
    );

    it.effect("passes a redirect to the client without following it", () =>
      Effect.gen(function* () {
        const fake = yield* FakeProvider.FakeProvider;
        fake.forget();
        fake.answer({
          status: 307,
          headers: [["location", "/elsewhere"]],
          chunks: [],
        });
        const response = yield* Harness.send("/pools/work/models", {
          headers: fleet,
        });
        expect(response.status).toBe(307);
        expect(response.headers.get("location")).toBe("/elsewhere");
        yield* Harness.textOf(response);
        expect(fake.seen()).toHaveLength(1);
        const request = yield* nextRequest;
        expect([request.outcome, request.origin.upstreamStatus]).toEqual([
          "ok",
          307,
        ]);
      }),
    );

    it.effect(
      "passes a compressed answer through compressed, and reads it decompressed",
      () =>
        Effect.gen(function* () {
          const fake = yield* FakeProvider.FakeProvider;
          const answer = Bun.gzipSync(
            new TextEncoder().encode(
              '{"id":"c","model":"glm-5.2","choices":[{"index":0,"message":{"role":"assistant","content":"Hi"},"finish_reason":"stop"}],"usage":{"prompt_tokens":7,"completion_tokens":1,"total_tokens":8}}',
            ),
          );
          fake.answer({
            headers: [
              ["content-type", "application/json"],
              ["content-encoding", "gzip"],
            ],
            chunks: [answer.subarray(0, 10), answer.subarray(10)],
            chunkEveryMs: 2,
          });
          const response = yield* post(
            "/pools/work/chat/completions",
            chat(false),
            { "accept-encoding": "gzip" },
          );
          expect(response.headers.get("content-encoding")).toBe("gzip");
          expect(yield* Harness.bytesOf(response)).toEqual(answer);
          const request = yield* nextRequest;
          expect(request.outcome).toBe("ok");
          expect(request.origin.readingComplete).toBe(true);
          expect(
            Option.map(request.usage, ({ tokens }) => tokens.output),
          ).toEqual(Option.some(1));
        }),
    );

    it.effect(
      "streams each event to the client as it arrives, before the provider has finished",
      () =>
        Effect.gen(function* () {
          const fake = yield* FakeProvider.FakeProvider;
          fake.answer({
            headers: eventStream,
            chunks: streamed.slice(0, 1),
            afterwards: "hold",
          });
          const response = yield* post(
            "/pools/work/chat/completions",
            chat(true),
          );
          const reader = response.body?.getReader();
          const first = yield* Effect.promise(async () => reader?.read());
          expect(new TextDecoder().decode(first?.value)).toBe(streamed[0]);
          yield* Effect.promise(async () => reader?.cancel());
          const request = yield* nextRequest;
          expect(request.outcome).toBe("cancelled");
        }),
    );
  });

  describe("the hub's own errors", () => {
    const rejected = (
      path: string,
      headers: Record<string, string>,
      type: string,
      status: number,
    ) =>
      Effect.gen(function* () {
        const fake = yield* FakeProvider.FakeProvider;
        fake.forget();
        const response = yield* Harness.send(path, { headers });
        expect(yield* hubErrorOf(response)).toEqual({
          status,
          retry: "false",
          body: errorBody(type),
        });
        expect(fake.seen()).toEqual([]);
        yield* nothingMoreRecorded;
      });

    it.effect("rejects a request without a hub key with a 403", () =>
      rejected("/pools/work/models", {}, "cota_hub_key_rejected", 403),
    );

    it.effect("rejects an unknown hub key with a 403, never a 401", () =>
      rejected(
        "/pools/work/models",
        { "x-cota-key": "not-a-hub-key" },
        "cota_hub_key_rejected",
        403,
      ),
    );

    it.effect(
      "does not take a subscription pool's hub key from the bearer token",
      () =>
        rejected(
          "/pools/personal/v1/messages",
          { authorization: `Bearer ${Harness.secrets.clientsHubKey}` },
          "cota_hub_key_rejected",
          403,
        ),
    );

    it.effect("rejects a hub key whose scope does not open the pool", () =>
      rejected(
        "/pools/work/models",
        { "x-cota-key": Harness.secrets.clientsHubKey },
        "cota_hub_key_scope",
        403,
      ),
    );

    it.effect("answers 404 for a pool the hub does not have", () =>
      rejected("/pools/nowhere/models", fleet, "cota_unknown_pool", 404),
    );

    it.effect(
      "rejects a reader key at every pool the hub has as the wrong scope, and answers 404 for one it does not",
      () =>
        Effect.gen(function* () {
          const reader = Harness.secrets.readerHubKey;
          yield* rejected(
            "/pools/work/models",
            { "x-cota-key": reader },
            "cota_hub_key_scope",
            403,
          );
          yield* rejected(
            "/pools/work/models",
            { authorization: `Bearer ${reader}` },
            "cota_hub_key_scope",
            403,
          );
          yield* rejected(
            "/pools/solo/v1/messages",
            { "x-cota-key": reader },
            "cota_hub_key_scope",
            403,
          );
          yield* rejected(
            "/pools/nowhere/models",
            { "x-cota-key": reader },
            "cota_unknown_pool",
            404,
          );
        }),
    );

    it.effect(
      "says the same to an unknown bearer token whether the pool exists or not",
      () =>
        Effect.gen(function* () {
          const headers = { authorization: "Bearer not-a-hub-key" };
          const known = yield* Harness.send("/pools/work/models", { headers });
          const unknown = yield* Harness.send("/pools/nowhere/models", {
            headers,
          });
          expect(yield* hubErrorOf(known)).toEqual(yield* hubErrorOf(unknown));
          yield* nothingMoreRecorded;
        }),
    );

    it.effect("refuses a WebSocket upgrade with a 426", () =>
      rejected(
        "/pools/work/responses",
        { ...fleet, connection: "upgrade", upgrade: "websocket" },
        "cota_no_websocket",
        426,
      ),
    );

    it.effect(
      "answers 502 when the provider cannot be reached, and records it",
      () =>
        Effect.gen(function* () {
          const response = yield* post(
            "/pools/gone/chat/completions",
            chat(false),
          );
          expect(yield* hubErrorOf(response)).toEqual({
            status: 502,
            retry: "false",
            body: errorBody("cota_provider_unreachable"),
          });
          const request = yield* nextRequest;
          expect(response.headers.get("x-cota-request")).toBe(request.id);
          expect([
            request.outcome,
            request.origin.upstreamStatus,
            request.errorType,
            request.model,
          ]).toEqual(["error", 0, "cota_provider_unreachable", "glm-5.2"]);
          yield* nothingMoreRecorded;
        }),
    );

    it.effect(
      "answers 504 when the provider sends no headers within the first-byte limit",
      () =>
        Effect.gen(function* () {
          const fake = yield* FakeProvider.FakeProvider;
          fake.forget();
          fake.answer({ headersAfterMs: "never", chunks: ["{}"] });
          const call = yield* Effect.forkChild(
            post("/pools/work/chat/completions", chat(true)),
          );
          yield* waitUntil(() => fake.seen().length === 1);
          yield* TestClock.adjust("9 minutes");
          yield* Effect.promise(() => Bun.sleep(20));
          expect(fake.last().signal.aborted).toBe(false);
          yield* TestClock.adjust("1 minute");
          const response = yield* Fiber.join(call);
          expect(yield* hubErrorOf(response)).toEqual({
            status: 504,
            retry: "false",
            body: errorBody("cota_provider_timeout"),
          });
          yield* waitUntil(() => fake.last().signal.aborted);
          const request = yield* nextRequest;
          expect(response.headers.get("x-cota-request")).toBe(request.id);
          expect([request.outcome, request.errorType]).toEqual([
            "error",
            "cota_provider_timeout",
          ]);
        }),
    );
  });

  describe("outcomes", () => {
    it.effect(
      "records a streamed chat that reached [DONE] as ok, with what it read",
      () =>
        Effect.gen(function* () {
          const fake = yield* FakeProvider.FakeProvider;
          fake.answer({
            headers: eventStream,
            chunks: streamed,
            chunkEveryMs: 2,
          });
          const response = yield* post(
            "/pools/work/chat/completions",
            chat(true),
            {
              "user-agent": "opencode/1.2.3",
              "x-session-affinity": "session-9",
              "x-cota-project": `  ${"p".repeat(250)}  `,
              "x-cota-machine": " workstation ",
            },
          );
          expect(yield* Harness.textOf(response)).toBe(streamed.join(""));
          const request = yield* nextRequest;
          expect(StoredItems.storedOf(request)).toMatchObject({
            outcome: "ok",
            upstreamStatus: 200,
            errorType: "",
            pool: "work",
            provider: "zai",
            protocol: "openai-chat",
            operation: "chat",
            model: "glm-5.2",
            servedModel: "",
            stream: true,
            stopReason: "stop",
            session: "session-9",
            sessionSource: "x-session-affinity",
            client: "opencode",
            clientVersion: "1.2.3",
            userAgent: "opencode/1.2.3",
            project: "p".repeat(200),
            machine: "workstation",
            hubKey: "fleet",
            providerRequestId: "provider-request-1",
            readingComplete: true,
            requestBytes: new TextEncoder().encode(chat(true)).byteLength,
            responseBytes: new TextEncoder().encode(streamed.join(""))
              .byteLength,
          });
          expect(
            Option.map(request.usage, ({ tokens }) => [
              tokens.input,
              tokens.output,
            ]),
          ).toEqual(Option.some([12, 3]));
        }),
    );

    it.effect(
      "gives the request an id that is a UUIDv7 of the hub's clock",
      () =>
        Effect.gen(function* () {
          const fake = yield* FakeProvider.FakeProvider;
          fake.answer({ chunks: ["{}"] });
          const at = DateTime.makeUnsafe("2026-11-12T09:30:00Z");
          yield* TestClock.setTime(DateTime.toEpochMillis(at));
          const response = yield* Harness.send("/pools/work/models", {
            headers: fleet,
          });
          yield* Harness.textOf(response);
          const request = yield* nextRequest;
          expect(request.id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
          );
          expect(
            Number.parseInt(request.id.replaceAll("-", "").slice(0, 12), 16),
          ).toBe(DateTime.toEpochMillis(at));
          expect(request.startedAt).toEqual(at);
          expect(request.session).toBe(`request:${request.id}`);
        }),
    );

    it.effect(
      "records an answer of 400 or above as an error, with its body",
      () =>
        Effect.gen(function* () {
          const fake = yield* FakeProvider.FakeProvider;
          const body =
            '{"error":{"type":"invalid_request_error","message":"model not found"}}';
          fake.answer({
            status: 404,
            headers: [["content-type", "application/json"]],
            chunks: [body],
          });
          const response = yield* post(
            "/pools/work/chat/completions",
            chat(false),
          );
          expect(response.status).toBe(404);
          expect(yield* Harness.textOf(response)).toBe(body);
          const request = yield* nextRequest;
          expect(StoredItems.storedOf(request)).toMatchObject({
            outcome: "error",
            upstreamStatus: 404,
            errorType: "invalid_request_error",
            errorMessage: "model not found",
            errorBody: body,
          });
        }),
    );

    it.effect(
      "counts the bytes of an answer to an operation the protocol does not read, and reads nothing from it",
      () =>
        Effect.gen(function* () {
          const fake = yield* FakeProvider.FakeProvider;
          const body =
            '{"object":"list","model":"glm-5.2","usage":{"prompt_tokens":1,"completion_tokens":1}}';
          fake.answer({
            headers: [["content-type", "application/json"]],
            chunks: [body],
          });
          const response = yield* Harness.send("/pools/work/models", {
            headers: fleet,
          });
          expect(yield* Harness.textOf(response)).toBe(body);
          const request = yield* nextRequest;
          expect([
            request.operation,
            request.outcome,
            request.usage,
            request.origin.servedModel,
            request.origin.responseBytes,
            request.origin.readingComplete,
          ]).toEqual(["models", "ok", Option.none(), "", body.length, true]);
        }),
    );

    it.effect(
      "keeps the first 64 KiB of an error body, and reads its error from them",
      () =>
        Effect.gen(function* () {
          const fake = yield* FakeProvider.FakeProvider;
          const body = `{"error":{"type":"server_error","message":"${"x".repeat(70 * 1024)}"}}`;
          fake.answer({
            status: 500,
            headers: [["content-type", "application/json"]],
            chunks: [body.slice(0, 1000), body.slice(1000)],
          });
          const response = yield* post(
            "/pools/work/chat/completions",
            chat(false),
          );
          expect(yield* Harness.textOf(response)).toBe(body);
          const request = yield* nextRequest;
          expect([
            request.outcome,
            request.origin.errorBody,
            request.origin.responseBytes,
            request.origin.readingComplete,
          ]).toEqual(["error", body.slice(0, 64 * 1024), body.length, true]);
        }),
    );

    it.effect("records a recognised refusal as refused, with its reset", () =>
      Effect.gen(function* () {
        const fake = yield* FakeProvider.FakeProvider;
        const now = DateTime.makeUnsafe("2026-11-12T10:00:00Z");
        yield* TestClock.setTime(DateTime.toEpochMillis(now));
        fake.answer({
          status: 429,
          headers: [
            ["content-type", "application/json"],
            ["retry-after", "30"],
          ],
          chunks: ['{"error":{"code":"1308","message":"Usage limit reached"}}'],
        });
        const response = yield* post(
          "/pools/work/chat/completions",
          chat(false),
        );
        expect(response.status).toBe(429);
        yield* Harness.textOf(response);
        const request = yield* nextRequest;
        expect(request.outcome).toBe("refused");
        expect(request.origin.refusalReset).toEqual(
          Option.some(DateTime.add(now, { seconds: 30 })),
        );
      }),
    );

    it.effect(
      "records a stream whose own event reports a failure as an error",
      () =>
        Effect.gen(function* () {
          const fake = yield* FakeProvider.FakeProvider;
          fake.answer({
            headers: eventStream,
            chunks: sse(
              '{"error":{"type":"server_error","message":"overloaded"}}',
              "[DONE]",
            ),
          });
          const response = yield* post(
            "/pools/work/chat/completions",
            chat(true),
          );
          yield* Harness.textOf(response);
          const request = yield* nextRequest;
          expect([
            request.outcome,
            request.errorType,
            request.errorMessage,
          ]).toEqual(["error", "server_error", "overloaded"]);
        }),
    );

    it.effect(
      "records a stream that ended before its terminal event as broken",
      () =>
        Effect.gen(function* () {
          const fake = yield* FakeProvider.FakeProvider;
          fake.answer({ headers: eventStream, chunks: streamed.slice(0, 2) });
          const response = yield* post(
            "/pools/work/chat/completions",
            chat(true),
          );
          yield* Harness.textOf(response);
          const request = yield* nextRequest;
          expect([request.outcome, request.errorType]).toEqual([
            "error",
            "cota_stream_broken",
          ]);
        }),
    );

    it.effect(
      "passes on a stream the provider broke, and records it as broken",
      () =>
        Effect.gen(function* () {
          const fake = yield* FakeProvider.FakeProvider;
          fake.answer({
            headers: eventStream,
            chunks: streamed.slice(0, 1),
            chunkEveryMs: 5,
            afterwards: "fail",
          });
          const response = yield* post(
            "/pools/work/chat/completions",
            chat(true),
          );
          const read = yield* Effect.exit(
            Effect.tryPromise(() => response.text()),
          );
          expect(Exit.isFailure(read)).toBe(true);
          const request = yield* nextRequest;
          expect([request.outcome, request.errorType]).toEqual([
            "error",
            "cota_stream_broken",
          ]);
        }),
    );

    it.effect(
      "records a client that hung up mid-stream as cancelled, and aborts the provider",
      () =>
        Effect.gen(function* () {
          const fake = yield* FakeProvider.FakeProvider;
          fake.answer({
            headers: eventStream,
            chunks: streamed.slice(0, 1),
            afterwards: "hold",
          });
          const abort = hangUp();
          const response = yield* post(
            "/pools/work/chat/completions",
            chat(true),
            {},
            { signal: abort.signal },
          );
          const reader = response.body?.getReader();
          yield* Effect.promise(async () => reader?.read());
          abort.abort();
          yield* waitUntil(() => fake.last().signal.aborted);
          const request = yield* nextRequest;
          expect([request.outcome, request.origin.upstreamStatus]).toEqual([
            "cancelled",
            200,
          ]);
        }),
    );

    it.effect(
      "records a client that hung up before the answer as cancelled, and aborts the provider",
      () =>
        Effect.gen(function* () {
          const fake = yield* FakeProvider.FakeProvider;
          fake.forget();
          fake.answer({ headersAfterMs: "never", chunks: ["{}"] });
          const abort = hangUp();
          const pending = yield* Effect.forkChild(
            Harness.send("/pools/work/chat/completions", {
              method: "POST",
              headers: fleet,
              body: chat(true),
              signal: abort.signal,
            }).pipe(Effect.exit),
          );
          yield* waitUntil(() => fake.seen().length === 1);
          abort.abort();
          yield* Fiber.join(pending);
          yield* waitUntil(() => fake.last().signal.aborted);
          const request = yield* nextRequest;
          expect([request.outcome, request.origin.upstreamStatus]).toEqual([
            "cancelled",
            0,
          ]);
        }),
    );

    it.effect(
      "keeps passing bytes after [DONE], and a hang-up then is not a cancellation",
      () =>
        Effect.gen(function* () {
          const fake = yield* FakeProvider.FakeProvider;
          fake.answer({
            headers: eventStream,
            chunks: [...streamed, ": keep-alive\n\n"],
            chunkEveryMs: 5,
            afterwards: "hold",
          });
          const abort = hangUp();
          const response = yield* post(
            "/pools/work/chat/completions",
            chat(true),
            {},
            { signal: abort.signal },
          );
          const reader = response.body?.getReader();
          const decoder = new TextDecoder();
          yield* Effect.promise(async () => {
            let received = "";
            while (!received.endsWith(": keep-alive\n\n")) {
              const next = await reader?.read();
              received += decoder.decode(next?.value, { stream: true });
            }
          });
          abort.abort();
          const request = yield* nextRequest;
          expect(request.outcome).toBe("ok");
          yield* waitUntil(() => fake.last().signal.aborted);
        }),
    );

    it.effect("records an answer without a body from its status", () =>
      Effect.gen(function* () {
        const fake = yield* FakeProvider.FakeProvider;
        for (const [method, status] of [
          ["HEAD", 200],
          ["GET", 204],
          ["GET", 304],
          ["HEAD", 404],
        ] as const) {
          fake.answer({
            status,
            headers: [["etag", '"v1"']],
            ...(method === "HEAD" ? { chunks: ["{}"] } : {}),
          });
          const response = yield* Harness.send("/pools/work/models", {
            method,
            headers: fleet,
          });
          expect(response.status).toBe(status);
          expect(yield* Harness.textOf(response)).toBe("");
          const request = yield* nextRequest;
          expect([request.outcome, request.origin.upstreamStatus]).toEqual([
            status >= 400 ? "error" : "ok",
            status,
          ]);
          expect(response.headers.get("x-cota-request")).toBe(request.id);
        }
      }),
    );
  });

  describe("logs", () => {
    it.effect(
      "name the request, pool and operation, and never a key, a tag or a header",
      () =>
        Effect.gen(function* () {
          const logs = yield* Harness.Logs;
          const fake = yield* FakeProvider.FakeProvider;
          logs.forget();
          fake.answer({ headers: eventStream, chunks: streamed });
          const response = yield* post(
            "/pools/work/chat/completions",
            chat(true),
            {
              authorization: "Bearer client-login-secret",
              "x-cota-project": "secret-project",
            },
          );
          yield* Harness.textOf(response);
          const request = yield* nextRequest;
          yield* Harness.send("/pools/work/models", {
            headers: { "x-cota-key": "unknown-hub-key-secret" },
          }).pipe(Effect.flatMap(Harness.textOf));
          const lines = logs.lines();
          const finished = lines.find((line) =>
            line.includes("request finished"),
          );
          expect(finished).toContain(request.id);
          expect(finished).toContain('"pool":"work"');
          expect(finished).toContain('"operation":"chat"');
          expect(lines.some((line) => line.includes("request rejected"))).toBe(
            true,
          );
          for (const secret of [
            ...Object.values(Harness.secrets),
            "client-login-secret",
            "secret-project",
            "unknown-hub-key-secret",
          ]) {
            expect(lines.join("\n")).not.toContain(secret);
          }
        }),
    );
  });
});

layer(
  Harness.layer({
    relay:
      "max_body_mib = 1\nmax_decoded_body_mib = 1\nmax_read_answer_mib = 1\ncopy_capacity = 4",
    protocols: Harness.sabotageable,
  }),
)("limits", (it) => {
  it.effect("answers 413 to a body over the limit, and forwards nothing", () =>
    Effect.gen(function* () {
      const fake = yield* FakeProvider.FakeProvider;
      fake.forget();
      const response = yield* post(
        "/pools/work/chat/completions",
        new Uint8Array(1024 * 1024 + 1),
      );
      expect(yield* hubErrorOf(response)).toEqual({
        status: 413,
        retry: "false",
        body: errorBody("cota_body_too_large"),
      });
      expect(fake.seen()).toEqual([]);
      yield* nothingMoreRecorded;
    }),
  );

  it.effect(
    "rejects a request without a hub key before reading its body, so a body over the limit gets the 403",
    () =>
      Effect.gen(function* () {
        const fake = yield* FakeProvider.FakeProvider;
        fake.forget();
        const response = yield* Harness.send("/pools/work/chat/completions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: new Uint8Array(1024 * 1024 + 1),
        });
        expect(yield* hubErrorOf(response)).toEqual({
          status: 403,
          retry: "false",
          body: errorBody("cota_hub_key_rejected"),
        });
        expect(fake.seen()).toEqual([]);
        yield* nothingMoreRecorded;
      }),
  );

  it.effect("forwards a body exactly at the limit", () =>
    Effect.gen(function* () {
      const fake = yield* FakeProvider.FakeProvider;
      fake.answer({ chunks: ["{}"] });
      const body = new Uint8Array(1024 * 1024).fill(32);
      const response = yield* post("/pools/work/chat/completions", body);
      expect(response.status).toBe(200);
      yield* Harness.textOf(response);
      expect(fake.last().body).toEqual(body);
      yield* nextRequest;
    }),
  );

  it.effect(
    "forwards a compressed body whose decoded copy is over the limit, described without it",
    () =>
      Effect.gen(function* () {
        const fake = yield* FakeProvider.FakeProvider;
        fake.answer({ chunks: ["{}"] });
        const small = Bun.gzipSync(new TextEncoder().encode(chat(false)));
        const large = Bun.gzipSync(
          new TextEncoder().encode(
            `${chat(false).slice(0, -1)},"padding":"${" ".repeat(2 * 1024 * 1024)}"}`,
          ),
        );
        const models: Array<string> = [];
        for (const body of [small, large]) {
          const response = yield* post("/pools/work/chat/completions", body, {
            "content-encoding": "gzip",
          });
          yield* Harness.textOf(response);
          expect(fake.last().body).toEqual(body);
          expect(headerOf(fake.last(), "content-encoding")).toBe("gzip");
          models.push((yield* nextRequest).model);
        }
        expect(models).toEqual(["glm-5.2", ""]);
      }),
  );

  it.effect(
    "marks the reading of an answer over the read limit incomplete, and still sends everything",
    () =>
      Effect.gen(function* () {
        const fake = yield* FakeProvider.FakeProvider;
        const answer = `{"id":"c","model":"glm-5.2","choices":[{"index":0,"message":{"role":"assistant","content":"${"x".repeat(1024 * 1024)}"},"finish_reason":"stop"}],"usage":{"prompt_tokens":7,"completion_tokens":1}}`;
        fake.answer({
          headers: [["content-type", "application/json"]],
          chunks: [answer],
        });
        const response = yield* post(
          "/pools/work/chat/completions",
          chat(false),
        );
        expect(yield* Harness.textOf(response)).toBe(answer);
        const request = yield* nextRequest;
        expect([
          request.outcome,
          request.origin.readingComplete,
          request.usage,
          request.origin.responseBytes,
        ]).toEqual(["ok", false, Option.none(), answer.length]);
      }),
  );

  it.effect(
    "marks the reading incomplete when the copy falls behind, and still sends everything",
    () =>
      Effect.gen(function* () {
        const fake = yield* FakeProvider.FakeProvider;
        Harness.sabotageReader("slow");
        const many = Array.from({ length: 40 }, (_, index) =>
          sse(chunk(`"choices":[{"index":0,"delta":{"content":"${index}"}}]`)),
        ).flat();
        const chunks = [...many, ...streamed];
        fake.answer({ headers: eventStream, chunks, chunkEveryMs: 1 });
        const response = yield* post(
          "/pools/work/chat/completions",
          chat(true),
        );
        expect(yield* Harness.textOf(response)).toBe(chunks.join(""));
        Harness.sabotageReader("none");
        const request = yield* requestOnceTheClockMoves;
        expect(request.origin.readingComplete).toBe(false);
      }),
  );
});

layer(Harness.layer())(
  "a protocol whose clients' base URL has a prefix",
  (it) => {
    const clients = { "x-cota-key": Harness.secrets.clientsHubKey };

    it.effect("strips the prefix before forwarding", () =>
      Effect.gen(function* () {
        const fake = yield* FakeProvider.FakeProvider;
        fake.answer({ chunks: ['{"models":[]}'] });
        const response = yield* Harness.send(
          "/pools/codex/backend-api/codex/models?client_version=0.167.1",
          { headers: clients },
        );
        yield* Harness.textOf(response);
        expect(fake.last().target).toBe("/codex/models?client_version=0.167.1");
        yield* nextRequest;
      }),
    );

    it.effect("answers 404 for a path outside the prefix", () =>
      Effect.gen(function* () {
        const fake = yield* FakeProvider.FakeProvider;
        fake.forget();
        for (const path of [
          "/pools/codex/responses",
          "/pools/codex/backend-api/codexresponses",
          "/pools/codex/backend-api/responses",
        ]) {
          const response = yield* Harness.send(path, {
            method: "POST",
            headers: clients,
            body: "{}",
          });
          expect(yield* hubErrorOf(response)).toEqual({
            status: 404,
            retry: "false",
            body: errorBody("cota_unknown_path"),
          });
        }
        expect(fake.seen()).toEqual([]);
        yield* nothingMoreRecorded;
      }),
    );
  },
);

const shuttingDown = Harness.layer();
const sabotagedShutdown = Harness.layer({ protocols: Harness.sabotageable });

describe("shutdown", () => {
  it.effect(
    "records a stream the hub cut after its grace period as the hub's error",
    () =>
      Effect.gen(function* () {
        const scope = yield* Scope.make();
        const context = yield* Layer.buildWithScope(shuttingDown, scope);
        const run = <A, E>(
          effect: Effect.Effect<A, E, Layer.Success<typeof shuttingDown>>,
        ) => Effect.provide(effect, context);
        const fake = yield* run(FakeProvider.FakeProvider);
        fake.answer({
          headers: eventStream,
          chunks: streamed.slice(0, 1),
          afterwards: "hold",
        });
        const response = yield* run(
          post("/pools/work/chat/completions", chat(true)),
        );
        const reader = response.body?.getReader();
        yield* Effect.promise(async () => reader?.read());
        const closing = yield* Effect.forkChild(Scope.close(scope, Exit.void));
        for (
          let step = 0;
          step < 30 && closing.pollUnsafe() === undefined;
          step++
        ) {
          yield* TestClock.adjust("1 second");
          yield* Effect.promise(() => Bun.sleep(5));
        }
        yield* Fiber.join(closing);
        const request = yield* run(nextRequest);
        expect([request.outcome, request.errorType]).toEqual([
          "error",
          "cota_hub_shutdown",
        ]);
      }),
  );
  it.effect(
    "waits, once its server has stopped, for every request in flight to reach the request log, though its copy is still being read",
    () =>
      Effect.gen(function* () {
        Harness.sabotageReader("hang");
        const scope = yield* Scope.make();
        const context = yield* Layer.buildWithScope(sabotagedShutdown, scope);
        const run = <A, E>(
          effect: Effect.Effect<A, E, Layer.Success<typeof sabotagedShutdown>>,
        ) => Effect.provide(effect, context);
        const fake = yield* run(FakeProvider.FakeProvider);
        let answered = 0;
        fake.answer(() =>
          answered++ === 0
            ? {
                headers: eventStream,
                chunks: streamed.slice(0, 1),
                afterwards: "hold",
              }
            : { headers: eventStream, chunks: streamed },
        );
        const held = yield* run(
          post("/pools/work/chat/completions", chat(true)),
        );
        yield* Effect.promise(async () => held.body?.getReader().read());
        const done = yield* run(
          post("/pools/work/chat/completions", chat(true)),
        );
        yield* run(Harness.textOf(done));
        const closing = yield* Effect.forkChild(Scope.close(scope, Exit.void));
        for (
          let step = 0;
          step < 40 && closing.pollUnsafe() === undefined;
          step++
        ) {
          yield* TestClock.adjust("1 second");
          yield* Effect.promise(() => Bun.sleep(5));
        }
        yield* Fiber.join(closing);
        const requests = yield* run(
          Effect.flatMap(Recorded, (recorded) => recorded.drain),
        );
        expect(
          requests.map(
            ({ outcome, errorType, origin: { readingComplete } }) => [
              outcome,
              errorType,
              readingComplete,
            ],
          ),
        ).toEqual([
          ["ok", "", false],
          ["error", "cota_hub_shutdown", false],
        ]);
      }).pipe(
        Effect.ensuring(Effect.sync(() => Harness.sabotageReader("none"))),
      ),
  );
});
