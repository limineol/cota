import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliCompressSync, deflateSync } from "node:zlib";
import { afterAll, expect, layer } from "@effect/vitest";
import {
  Arbitrary,
  Clock,
  DateTime,
  Effect,
  Fiber,
  Option,
  Schema,
} from "effect";
import { TestClock } from "effect/testing";
import * as Request from "#shared/03-domain/request.entity.ts";
import * as FakeProvider from "#shared/05-tests/fake-provider.ts";
import * as Harness from "#shared/05-tests/harness.ts";

const int = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));
const oneOf = <const A extends ReadonlyArray<string>>(values: A) =>
  Arbitrary.schema(Schema.Literals(values));
const flag = Arbitrary.schema(Schema.Boolean);
const pick = <const A extends readonly [unknown, ...Array<unknown>]>(
  values: A,
): Arbitrary.Arbitrary<A[number]> =>
  int(0, values.length - 1).pipe(
    Arbitrary.map((index): A[number] => values[index] ?? values[0]),
  );
const text = (pattern: RegExp) =>
  Arbitrary.schema(Schema.String.check(Schema.isPattern(pattern)));

const bytes = (maxLength: number) =>
  Arbitrary.array(int(0, 255), { maxLength }).pipe(
    Arbitrary.map((values) => new Uint8Array(values)),
  );

type Coding = "identity" | "gzip" | "deflate" | "br" | "zstd";
const coding = oneOf(["identity", "gzip", "deflate", "br", "zstd"]);

const encoded = (body: Uint8Array, as: Coding): Uint8Array => {
  switch (as) {
    case "identity":
      return body;
    case "gzip":
      return new Uint8Array(Bun.gzipSync(new Uint8Array(body)));
    case "deflate":
      return new Uint8Array(deflateSync(body));
    case "br":
      return new Uint8Array(brotliCompressSync(body));
    case "zstd":
      return new Uint8Array(Bun.zstdCompressSync(body));
  }
};

const encodingHeader = (as: Coding): Record<string, string> =>
  as === "identity" ? {} : { "content-encoding": as };

const cutAt = (body: Uint8Array, cuts: ReadonlyArray<number>) => {
  const points = [...new Set(cuts.map((cut) => cut % (body.byteLength + 1)))]
    .filter((cut) => cut > 0 && cut < body.byteLength)
    .sort((a, b) => a - b);
  return [0, ...points].map((from, index) =>
    body.subarray(from, points[index] ?? body.byteLength),
  );
};

const segment = text(/^[A-Za-z0-9_~-]{1,8}$|^%[2-7][0-9A-F]$/).pipe(
  Arbitrary.map((each) => (each === "%2E" ? "%2D" : each)),
);
const path = Arbitrary.array(segment, { maxLength: 3 }).pipe(
  Arbitrary.map((segments) => segments.map((each) => `/${each}`).join("")),
);
const query = Arbitrary.array(
  Arbitrary.all([text(/^[a-z]{1,5}$/), text(/^[A-Za-z0-9._~%-]{0,6}$/)]),
  { maxLength: 3 },
).pipe(
  Arbitrary.map((pairs) =>
    pairs.length === 0
      ? ""
      : `?${pairs.map(([name, value]) => `${name}=${value}`).join("&")}`,
  ),
);
const extraHeaders = Arbitrary.array(
  Arbitrary.all([
    text(/^x-gen-[a-z]{1,6}$/),
    text(/^[!-~]([ -~]{0,10}[!-~])?$/),
  ]),
  { maxLength: 4 },
).pipe(Arbitrary.map((pairs) => Object.fromEntries(pairs)));
const status = oneOf([
  "200",
  "201",
  "203",
  "301",
  "307",
  "400",
  "401",
  "404",
  "422",
  "429",
  "500",
  "503",
]).pipe(Arbitrary.map(Number));
const secret = (prefix: string) =>
  text(/^[A-Za-z0-9]{12}$/).pipe(Arbitrary.map((rest) => `${prefix}${rest}`));

const abortable = () => new AbortController();

let run = 0;
const freshRun = () => {
  run++;
  return `run${run}-`;
};

const fallbackOf: Readonly<Record<string, string>> = { claude: "personal" };

const anthropicAnswer: FakeProvider.Script = {
  headers: [["content-type", "application/json"]],
  chunks: [
    '{"id":"msg_1","type":"message","role":"assistant","model":"claude-opus-5-5","content":[{"type":"text","text":"Hi"}],"stop_reason":"end_turn","usage":{"input_tokens":3,"output_tokens":1}}',
  ],
};

const everyExchange = [
  "streamed",
  "answered",
  "answered at a keyed pool that speaks anthropic-messages",
  "refused",
  "refused, then diverted",
  "refused, then diverted and refused again",
  "failed",
  "broken",
  "unfinished",
  "hung up mid-stream",
  "hung up before the answer",
  "unreachable",
  "Codex hung up at its terminal event",
  "Codex refused",
  "no body",
  "rejected key",
  "unknown pool",
  "websocket",
] as const;

const runs = (count: number) => ({
  timeout: 30_000,
  arbitrary: { runs: count },
});

const toText = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

const requestsText = (requests: ReadonlyArray<Request.Request>) =>
  JSON.stringify(
    requests.map((request) => Schema.encodeSync(Request.Request)(request)),
  );

const sseEvents = Arbitrary.array(text(/^[ -~]{0,40}$/), {
  minLength: 1,
  maxLength: 14,
}).pipe(
  Arbitrary.map((data) =>
    [...data.map((each) => `data: ${each}\n\n`), "data: [DONE]\n\n"].join(""),
  ),
);

const recordings = mkdtempSync(join(tmpdir(), "cota-relay-laws-"));
afterAll(() => rmSync(recordings, { recursive: true, force: true }));

layer(
  Harness.layer({
    protocols: Harness.sabotageable,
    relay: "copy_capacity = 4",
    recorder: Harness.sabotageableRecorder({
      directory: recordings,
      limit: 1024 * 1024,
      capacity: 4,
      patience: "1 second",
    }),
  }),
)("relay laws", (it) => {
  it.effect.prop(
    "R1: For every forwarded request, the provider receives exactly the body the client sent, and the client receives exactly the body the provider sent.",
    {
      pool: pick([
        "work",
        "open",
        "console",
        "claude",
        "solo",
        "codex",
        "codex",
      ]),
      method: oneOf(["GET", "POST", "PUT", "PATCH", "DELETE"]),
      path,
      query,
      requestBody: bytes(3000),
      requestCoding: coding,
      responseBody: bytes(3000),
      responseCoding: coding,
      cuts: Arbitrary.array(int(0, 3000), { maxLength: 6 }),
      status,
      eventStream: flag,
      refused: flag,
    },
    (generated) =>
      Effect.gen(function* () {
        yield* Harness.forgetEverything;
        const fake = yield* FakeProvider.FakeProvider;
        const codex = generated.pool === "codex";
        const subscription =
          codex || generated.pool === "claude" || generated.pool === "solo";
        const refused = subscription && generated.refused;
        const plain =
          refused && !codex
            ? new TextEncoder().encode(
                JSON.stringify({
                  model: "claude-opus-5-5",
                  padding: [...generated.requestBody],
                }),
              )
            : generated.requestBody;
        const sent = encoded(plain, generated.requestCoding);
        const answer = encoded(
          refused && codex
            ? new TextEncoder().encode(
                Harness.usageLimit(Option.none()).chunks?.join(""),
              )
            : generated.responseBody,
          generated.responseCoding,
        );
        const answered: FakeProvider.Script = {
          status: refused && codex ? 429 : generated.status,
          headers: Object.entries({
            ...encodingHeader(generated.responseCoding),
            "content-type": generated.eventStream
              ? "text/event-stream"
              : "application/octet-stream",
          }),
          chunks: cutAt(answer, generated.cuts),
        };
        const refusal: FakeProvider.Script = {
          ...answered,
          status: 429,
          headers: [
            ...(answered.headers ?? []),
            ["anthropic-ratelimit-unified-status", "rejected"],
          ],
        };
        fake.answer((seen) =>
          refused && !codex && Harness.poolOf(seen) === generated.pool
            ? refusal
            : answered,
        );
        const hasBody = generated.method !== "GET";
        const diverted = refused && hasBody && generated.pool === "claude";
        const prefix = codex ? "/backend-api/codex" : "";
        const response = yield* Harness.send(
          `/pools/${generated.pool}${prefix}${generated.path}${generated.query}`,
          {
            method: generated.method,
            headers: {
              "x-cota-key": subscription
                ? Harness.secrets.clientsHubKey
                : Harness.secrets.fleetHubKey,
              ...(subscription
                ? { authorization: `Bearer ${freshRun()}login` }
                : {}),
              "accept-encoding": "gzip, deflate, br, zstd",
              ...(hasBody ? encodingHeader(generated.requestCoding) : {}),
            },
            ...(hasBody ? { body: sent } : {}),
          },
        );
        const received = yield* Harness.bytesOf(response);
        const base =
          generated.pool === "work"
            ? "/api/paas/v4"
            : generated.pool === "open"
              ? "/v1"
              : `/${generated.pool}`;
        const rest = `${generated.path}${generated.query}`;
        expect(fake.seen().map(({ target }) => target)).toEqual(
          diverted
            ? [`${base}${rest}`, `/personal${rest}`]
            : [`${base}${rest}`],
        );
        for (const seen of fake.seen()) {
          expect(seen.body).toEqual(hasBody ? sent : new Uint8Array());
        }
        expect(response.status).toBe(
          refused && !diverted ? 429 : generated.status,
        );
        expect(received).toEqual(answer);
        expect(yield* Harness.recorded(fake.seen().length)).toHaveLength(
          fake.seen().length,
        );
      }),
    runs(80),
  );

  it.effect.prop(
    "R2: A hub key and a tag never reach a provider. A held key and a kept login never reach a client. No hub key, held key, kept login or login reaches the request log or a log line.",
    {
      pool: pick([
        "work",
        "open",
        "claude",
        "claude",
        "solo",
        "personal",
        "console",
        "codex",
        "codex",
        "nowhere",
      ]),
      presented: pick([
        "x-cota-key",
        "x-cota-key",
        "x-cota-key",
        "bearer",
        "x-api-key",
        "unknown",
      ]),
      refused: flag,
      unknownKey: secret("unknown-"),
      clientKey: secret("client-"),
      account: Arbitrary.all({
        id: secret("account-"),
        user: secret("account-user-"),
      }),
      tags: Arbitrary.all({
        project: secret("project-"),
        machine: secret("machine-"),
        client: secret("client-"),
      }),
      extra: extraHeaders,
      status,
      stream: flag,
    },
    (generated) =>
      Effect.gen(function* () {
        yield* Harness.forgetEverything;
        const fake = yield* FakeProvider.FakeProvider;
        const logs = yield* Harness.Logs;
        const answer: FakeProvider.Script = {
          status: generated.status,
          headers: [
            [
              "content-type",
              generated.stream ? "text/event-stream" : "application/json",
            ],
          ],
          chunks: generated.stream
            ? ['data: {"choices":[]}\n\n', "data: [DONE]\n\n"]
            : ['{"choices":[]}'],
        };
        const codex = generated.pool === "codex";
        fake.answer((seen) =>
          generated.refused && Harness.poolOf(seen) === generated.pool
            ? codex
              ? Harness.usageLimit(Option.none())
              : Harness.refusal(Option.none())
            : answer,
        );
        const subscription = ["claude", "solo", "personal", "codex"].includes(
          generated.pool,
        );
        const accessToken = Harness.accessToken({
          "https://api.openai.com/auth": {
            chatgpt_account_id: generated.account.id,
            chatgpt_account_user_id: generated.account.user,
          },
        });
        const clientLogin = codex ? accessToken : generated.clientKey;
        const hubKey =
          generated.presented === "unknown"
            ? generated.unknownKey
            : subscription
              ? Harness.secrets.clientsHubKey
              : Harness.secrets.fleetHubKey;
        const credentials =
          generated.presented === "bearer"
            ? { authorization: `Bearer ${hubKey}` }
            : generated.presented === "x-api-key"
              ? { "x-api-key": hubKey }
              : {
                  "x-cota-key": hubKey,
                  authorization: `Bearer ${clientLogin}`,
                  ...(codex
                    ? { "chatgpt-account-id": generated.account.id }
                    : {}),
                };
        const anthropic = ["claude", "solo", "personal", "console"].includes(
          generated.pool,
        );
        const path = codex
          ? "/backend-api/codex/responses"
          : anthropic
            ? "/v1/messages"
            : "/chat/completions";
        const response = yield* Harness.send(
          `/pools/${generated.pool}${path}`,
          {
            method: "POST",
            headers: {
              ...generated.extra,
              "x-api-key": generated.clientKey,
              ...credentials,
              "x-cota-project": generated.tags.project,
              "x-cota-machine": generated.tags.machine,
              "x-cota-client": generated.tags.client,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: codex
                ? "gpt-5.5-codex"
                : anthropic
                  ? "claude-opus-5-5"
                  : "glm-5.2",
              stream: generated.stream,
            }),
          },
        );
        const answered = toText(yield* Harness.bytesOf(response));
        const forwarded = fake.seen();
        const requests = yield* Harness.recorded(forwarded.length);

        const toProvider = JSON.stringify(
          forwarded.map(({ target, headers, body }) => [
            target,
            headers,
            toText(body),
          ]),
        );
        for (const kept of [
          Harness.secrets.fleetHubKey,
          Harness.secrets.clientsHubKey,
          generated.unknownKey,
          ...Object.values(generated.tags),
        ]) {
          expect(toProvider).not.toContain(kept);
        }
        const toClient = JSON.stringify([...response.headers]) + answered;
        const toRequestLog = requestsText(requests);
        const logged = logs.lines().join("\n");
        for (const kept of [
          Harness.secrets.heldKey,
          Harness.secrets.consoleKey,
          Harness.secrets.keptLogin,
        ]) {
          expect(toClient).not.toContain(kept);
        }
        for (const kept of [
          Harness.secrets.fleetHubKey,
          Harness.secrets.clientsHubKey,
          Harness.secrets.heldKey,
          Harness.secrets.consoleKey,
          Harness.secrets.keptLogin,
          generated.unknownKey,
          generated.clientKey,
          accessToken,
          generated.account.id,
          generated.account.user,
        ]) {
          expect(toRequestLog).not.toContain(kept);
          expect(logged).not.toContain(kept);
        }
      }),
    runs(60),
  );

  it.effect.prop(
    "R3: A request to a subscription pool reaches a provider with the credential it came with, or, when `Fallback` answered divert, with the fallback pool's kept login. It never reaches a provider with a held key.",
    {
      logins: Arbitrary.all([secret("login-"), secret("login-")]),
      requests: Arbitrary.array(
        Arbitrary.all({
          pool: pick([
            "claude",
            "claude",
            "claude",
            "solo",
            "personal",
            "codex",
            "codex",
          ]),
          login: pick([0, 0, 0, 1, "none"]),
          sentAs: pick(["authorization", "x-api-key"]),
          model: pick([
            "claude-opus-5-5",
            "claude-opus-5-5",
            "claude-opus-5-5",
            "claude-sonnet-5-5",
            "none",
          ]),
          answer: pick([
            "refusal",
            "refusal",
            "refusal without reset",
            "plain 429",
            "rejected but served",
            "ok",
          ]),
          resetMinutes: int(-5, 120),
          fallbackRefuses: flag,
          fallbackResetMinutes: int(-5, 300),
          laterMinutes: pick([0, 0, 1, 5, 30, 90]),
        }),
        { minLength: 2, maxLength: 8 },
      ),
    },
    (generated) =>
      Effect.gen(function* () {
        yield* Harness.forgetEverything;
        const fake = yield* FakeProvider.FakeProvider;
        const prefix = freshRun();
        const logins = generated.logins.map((login) => `${prefix}${login}`);
        const parked = new Map<string, number>();
        for (const request of generated.requests) {
          yield* TestClock.adjust(`${request.laterMinutes} minutes`);
          const now = yield* Clock.currentTimeMillis;
          const resetIn = (minutes: number) =>
            Math.floor((now + minutes * 60_000) / 1000) * 1000;
          const login =
            request.login === "none" ? undefined : logins[request.login];
          const model = request.model === "none" ? undefined : request.model;
          const codex = request.pool === "codex";
          const codexAnswer: FakeProvider.Script =
            request.answer === "refusal"
              ? Harness.usageLimit(
                  Option.some(
                    DateTime.makeUnsafe(resetIn(request.resetMinutes)),
                  ),
                )
              : request.answer === "refusal without reset"
                ? Harness.usageLimit(Option.none())
                : request.answer === "plain 429"
                  ? {
                      status: 429,
                      chunks: [
                        '{"error":{"code":"rate_limit_exceeded","message":"slow down"}}',
                      ],
                    }
                  : Harness.codexAnswer([]);
          const ownAnswer: FakeProvider.Script = codex
            ? codexAnswer
            : request.answer === "refusal"
              ? Harness.refusal(
                  Option.some(
                    DateTime.makeUnsafe(resetIn(request.resetMinutes)),
                  ),
                )
              : request.answer === "refusal without reset"
                ? Harness.refusal(Option.none())
                : request.answer === "plain 429"
                  ? {
                      status: 429,
                      headers: [["retry-after", "20"]],
                      chunks: [
                        '{"type":"error","error":{"type":"rate_limit_error","message":"slow down"}}',
                      ],
                    }
                  : request.answer === "rejected but served"
                    ? {
                        ...anthropicAnswer,
                        headers: [
                          ["content-type", "application/json"],
                          ["anthropic-ratelimit-unified-status", "rejected"],
                          [
                            "anthropic-ratelimit-unified-overage-status",
                            "allowed",
                          ],
                        ],
                      }
                    : anthropicAnswer;
          const fallbackAnswer = request.fallbackRefuses
            ? Harness.refusal(
                Option.some(
                  DateTime.makeUnsafe(resetIn(request.fallbackResetMinutes)),
                ),
              )
            : anthropicAnswer;
          fake.forget();
          fake.answer((seen) =>
            Harness.poolOf(seen) === request.pool ? ownAnswer : fallbackAnswer,
          );

          const sent: Record<string, string> =
            login === undefined
              ? {}
              : request.sentAs === "authorization"
                ? { authorization: `Bearer ${login}` }
                : { "x-api-key": login };
          const clientCredential = Object.entries(sent);
          const kept = [
            ["authorization", `Bearer ${Harness.secrets.keptLogin}`],
          ];
          const fallback = fallbackOf[request.pool];
          const key = `${login}|${model}`;
          const asked = login !== undefined && model !== undefined && !codex;
          const expected: Array<
            readonly [string, ReadonlyArray<ReadonlyArray<string>>]
          > = [];
          if (asked && fallback !== undefined && (parked.get(key) ?? 0) > now) {
            expected.push([fallback, kept]);
          } else {
            expected.push([request.pool, clientCredential]);
            const refused =
              request.answer === "refusal" ||
              request.answer === "refusal without reset";
            if (asked && refused) {
              const reset =
                request.answer === "refusal"
                  ? resetIn(request.resetMinutes)
                  : now + 15 * 60_000;
              parked.set(key, Math.max(parked.get(key) ?? reset, reset));
              if (fallback !== undefined && (parked.get(key) ?? 0) > now) {
                expected.push([fallback, kept]);
              }
            }
          }

          const response = yield* Harness.send(
            codex
              ? "/pools/codex/backend-api/codex/responses"
              : `/pools/${request.pool}/v1/messages?beta=true`,
            {
              method: "POST",
              headers: {
                "x-cota-key": Harness.secrets.clientsHubKey,
                "content-type": "application/json",
                ...sent,
              },
              body: JSON.stringify({
                ...(model === undefined ? {} : { model }),
                ...(codex
                  ? { stream: true, input: [{ role: "user", content: "hi" }] }
                  : {
                      max_tokens: 1024,
                      messages: [{ role: "user", content: "hi" }],
                    }),
              }),
            },
          );
          yield* Harness.bytesOf(response);
          const reached = fake.seen();
          expect(
            reached.map((seen) => [
              Harness.poolOf(seen),
              Harness.credentialsOf(seen),
            ]),
          ).toEqual(expected);
          for (const seen of reached) {
            for (const held of [
              Harness.secrets.heldKey,
              Harness.secrets.consoleKey,
            ]) {
              expect(JSON.stringify(seen.headers)).not.toContain(held);
            }
          }
          yield* Harness.recorded(reached.length);
        }
      }),
    runs(60),
  );

  it.effect.prop(
    "R4: A request to a keyed pool reaches the provider with the pool's held key or with none.",
    {
      pool: oneOf(["work", "open", "console"]),
      hubKeyIn: oneOf(["x-cota-key", "authorization", "x-api-key"]),
      sent: Arbitrary.array(
        Arbitrary.all([
          oneOf([
            "authorization",
            "Authorization",
            "x-api-key",
            "X-Api-Key",
            "api-key",
            "x-goog-api-key",
          ]),
          secret("credential-"),
        ]),
        { maxLength: 4 },
      ),
      extra: extraHeaders,
    },
    (generated) =>
      Effect.gen(function* () {
        yield* Harness.forgetEverything;
        const fake = yield* FakeProvider.FakeProvider;
        fake.answer({ chunks: ["{}"] });
        const headers = new Headers(generated.extra);
        for (const [name, value] of generated.sent) {
          headers.set(
            name,
            name.toLowerCase() === "authorization" ? `Bearer ${value}` : value,
          );
        }
        if (
          generated.hubKeyIn === "authorization" &&
          !headers.has("authorization")
        ) {
          headers.set("authorization", `Bearer ${Harness.secrets.fleetHubKey}`);
        } else if (
          generated.hubKeyIn === "x-api-key" &&
          !headers.has("authorization") &&
          !headers.has("x-api-key")
        ) {
          headers.set("x-api-key", Harness.secrets.fleetHubKey);
        } else {
          headers.set("x-cota-key", Harness.secrets.fleetHubKey);
        }
        const held =
          generated.pool === "work"
            ? Harness.secrets.heldKey
            : generated.pool === "console"
              ? Harness.secrets.consoleKey
              : undefined;
        const heldAs = headers.has("x-api-key")
          ? ["x-api-key", held]
          : ["authorization", `Bearer ${held}`];
        const response = yield* Harness.send(
          generated.pool === "console"
            ? "/pools/console/v1/messages"
            : `/pools/${generated.pool}/chat/completions`,
          { method: "POST", headers, body: "{}" },
        );
        yield* Harness.bytesOf(response);
        expect(response.status).toBe(200);
        const seen = fake.last();
        const credentials = seen.headers.filter(([name]) =>
          ["authorization", "x-api-key", "api-key", "x-goog-api-key"].includes(
            name,
          ),
        );
        expect(credentials).toEqual(held === undefined ? [] : [heldAs]);
        for (const value of [
          ...generated.sent.map(([, each]) => each),
          Harness.secrets.fleetHubKey,
        ]) {
          expect(JSON.stringify(seen.headers)).not.toContain(value);
        }
        expect(yield* Harness.recorded(1)).toHaveLength(1);
      }),
    runs(60),
  );

  it.effect.prop(
    "R5: Whatever the copy's reader or the recorder does (falls behind, fails, never finishes), the client receives the provider's full response.",
    {
      sabotage: oneOf(["none", "slow", "fail", "hang"]),
      recorder: oneOf(["off", "on", "slow", "fail", "hang"]),
      body: Arbitrary.all([sseEvents, bytes(2000)]),
      eventStream: flag,
      cuts: Arbitrary.array(int(0, 4000), { minLength: 6, maxLength: 16 }),
      chunkEveryMs: int(0, 1),
      status,
    },
    (generated) =>
      Effect.gen(function* () {
        yield* Harness.forgetEverything;
        const fake = yield* FakeProvider.FakeProvider;
        const [events, binary] = generated.body;
        const body = generated.eventStream
          ? new TextEncoder().encode(events)
          : binary;
        fake.answer({
          status: generated.status,
          headers: [
            [
              "content-type",
              generated.eventStream ? "text/event-stream" : "application/json",
            ],
          ],
          chunks: cutAt(body, generated.cuts),
          chunkEveryMs: generated.chunkEveryMs,
        });
        Harness.sabotageReader(generated.sabotage);
        Harness.sabotageRecorder(generated.recorder);
        const hub = yield* Harness.hubUrl;
        const received = yield* Effect.promise(() =>
          Promise.race([
            fetch(`${hub}/pools/work/chat/completions`, {
              method: "POST",
              headers: { "x-cota-key": Harness.secrets.fleetHubKey },
              body: '{"model":"glm-5.2","stream":true}',
              decompress: false,
            }).then(async (response) => ({
              status: response.status,
              bytes: new Uint8Array(await response.arrayBuffer()),
            })),
            Bun.sleep(3000).then(() => undefined),
          ]),
        );
        Harness.sabotageReader("none");
        Harness.sabotageRecorder("off");
        expect(received).toEqual({ status: generated.status, bytes: body });
        expect(yield* Harness.recorded(1)).toHaveLength(1);
        for (let step = 0; step < 2; step++) {
          yield* TestClock.adjust("1 second");
          yield* Effect.promise(() => Bun.sleep(5));
        }
      }),
    runs(50),
  );

  it.effect(
    "R5: a recorder that hangs after the first chunk of a long event stream holds back none of it",
    () =>
      Effect.gen(function* () {
        yield* Harness.forgetEverything;
        const fake = yield* FakeProvider.FakeProvider;
        const events = Array.from(
          { length: 24 },
          (_, index) => `data: {"n":${index}}\n\n`,
        );
        fake.answer({
          headers: [["content-type", "text/event-stream"]],
          chunks: events,
          chunkEveryMs: 1,
        });
        Harness.sabotageRecorder("hang");
        const hub = yield* Harness.hubUrl;
        // A stream held back for the hung recorder never ends, so the bound
        // only has to outlast 24 events on a loaded machine.
        const received = yield* Effect.promise(() =>
          Promise.race([
            fetch(`${hub}/pools/work/chat/completions`, {
              method: "POST",
              headers: { "x-cota-key": Harness.secrets.fleetHubKey },
              body: '{"model":"glm-5.2","stream":true}',
            }).then((response) => response.text()),
            Bun.sleep(20_000).then(() => undefined),
          ]),
        );
        Harness.sabotageRecorder("off");
        expect(received).toBe(events.join(""));
        expect(yield* Harness.recorded(1)).toHaveLength(1);
        for (let step = 0; step < 2; step++) {
          yield* TestClock.adjust("1 second");
          yield* Effect.promise(() => Bun.sleep(5));
        }
      }),
    30_000,
  );

  it.effect.prop(
    "R6: Every request the hub sends to a provider is recorded in the request log exactly once, whatever the outcome; a rejected request is not recorded.",
    {
      statuses: Arbitrary.array(status, {
        minLength: everyExchange.length,
        maxLength: everyExchange.length,
      }),
    },
    ({ statuses }) =>
      Effect.forEach(
        everyExchange,
        (scenario, index) =>
          Effect.gen(function* () {
            const status = statuses[index] ?? 200;
            yield* Harness.forgetEverything;
            const fake = yield* FakeProvider.FakeProvider;
            const done = "data: [DONE]\n\n";
            const event = 'data: {"choices":[]}\n\n';
            const sse = [["content-type", "text/event-stream"]] as const;
            const diverted = scenario.startsWith("refused, then diverted");
            const codex = scenario.startsWith("Codex");
            const login = `${freshRun()}login`;
            fake.answer(
              scenario === "Codex hung up at its terminal event"
                ? { ...Harness.codexAnswer([]), afterwards: "hold" }
                : scenario === "Codex refused"
                  ? Harness.usageLimit(Option.none())
                  : diverted
                    ? (seen) =>
                        Harness.poolOf(seen) === "claude" ||
                        scenario === "refused, then diverted and refused again"
                          ? Harness.refusal(Option.none())
                          : anthropicAnswer
                    : scenario === "streamed"
                      ? { headers: sse, chunks: [event, done] }
                      : scenario === "refused"
                        ? { status: 429, chunks: ['{"error":{"code":"1308"}}'] }
                        : scenario === "failed"
                          ? { status: 500, chunks: ['{"error":{}}'] }
                          : scenario === "broken"
                            ? {
                                headers: sse,
                                chunks: [event],
                                chunkEveryMs: 2,
                                afterwards: "fail",
                              }
                            : scenario === "unfinished"
                              ? { headers: sse, chunks: [event] }
                              : scenario === "hung up mid-stream"
                                ? {
                                    headers: sse,
                                    chunks: [event],
                                    afterwards: "hold",
                                  }
                                : scenario === "hung up before the answer"
                                  ? { headersAfterMs: "never", chunks: [] }
                                  : scenario === "no body"
                                    ? { status: 204 }
                                    : { status, chunks: ["{}"] },
            );
            const subscription = diverted || codex;
            const keyedAnthropic =
              scenario ===
              "answered at a keyed pool that speaks anthropic-messages";
            const path = diverted
              ? "/claude/v1/messages"
              : keyedAnthropic
                ? "/console/v1/messages"
                : codex
                  ? "/codex/backend-api/codex/responses"
                  : scenario === "unreachable"
                    ? "/gone/chat/completions"
                    : scenario === "unknown pool"
                      ? "/nowhere/chat/completions"
                      : "/work/chat/completions";
            const hangUp = abortable();
            const call = Harness.send(`/pools${path}`, {
              method: "POST",
              headers: {
                [keyedAnthropic ? "x-api-key" : "x-cota-key"]:
                  scenario === "rejected key"
                    ? "not-a-hub-key"
                    : subscription
                      ? Harness.secrets.clientsHubKey
                      : Harness.secrets.fleetHubKey,
                ...(subscription ? { authorization: `Bearer ${login}` } : {}),
                ...(scenario === "websocket"
                  ? { connection: "upgrade", upgrade: "websocket" }
                  : {}),
              },
              body:
                diverted || keyedAnthropic
                  ? '{"model":"claude-opus-5-5","max_tokens":1024}'
                  : codex
                    ? '{"model":"gpt-5.5-codex","stream":true,"input":[]}'
                    : '{"model":"glm-5.2","stream":true}',
              signal: hangUp.signal,
            }).pipe(
              Effect.flatMap((response) =>
                scenario === "hung up mid-stream"
                  ? Effect.promise(async () => {
                      await response.body?.getReader().read();
                      hangUp.abort();
                    })
                  : scenario === "Codex hung up at its terminal event"
                    ? Effect.promise(async () => {
                        const reader = response.body?.getReader();
                        const decoder = new TextDecoder();
                        let received = "";
                        while (!received.includes("response.completed")) {
                          const next = await reader?.read();
                          if (next === undefined || next.done) break;
                          received += decoder.decode(next.value, {
                            stream: true,
                          });
                        }
                        hangUp.abort();
                      })
                    : Effect.exit(
                        Effect.tryPromise(() => response.arrayBuffer()),
                      ).pipe(Effect.asVoid),
              ),
              Effect.exit,
            );
            if (scenario === "hung up before the answer") {
              const pending = yield* Effect.forkChild(call);
              yield* Harness.waitUntil(() => fake.seen().length === 1);
              hangUp.abort();
              yield* Fiber.join(pending);
            } else {
              yield* call;
            }
            const rejected = [
              "rejected key",
              "unknown pool",
              "websocket",
            ].includes(scenario);
            const sentToProvider = rejected ? 0 : diverted ? 2 : 1;
            expect({ scenario, seen: fake.seen().length }).toEqual({
              scenario,
              seen: scenario === "unreachable" ? 0 : sentToProvider,
            });
            expect({
              scenario,
              recorded: (yield* Harness.recorded(sentToProvider)).length,
            }).toEqual({ scenario, recorded: sentToProvider });
          }),
        { discard: true },
      ),
    runs(6),
  );
  it.effect.prop(
    "G2: with a quota login kept for every subscription pool, no request the relay sends to a provider carries a quota login's token",
    {
      tokens: Arbitrary.array(secret("quota-"), {
        minLength: 8,
        maxLength: 8,
      }),
      requests: Arbitrary.array(
        Arbitrary.all({
          pool: pick(["claude", "claude", "solo", "personal", "codex", "work"]),
          refused: flag,
        }),
        { minLength: 1, maxLength: 5 },
      ),
    },
    (generated) =>
      Effect.gen(function* () {
        yield* Harness.forgetEverything;
        const fake = yield* FakeProvider.FakeProvider;
        const owner = yield* Harness.signIn();
        const prefix = freshRun();
        const tokens = generated.tokens.map((token) => `${prefix}${token}`);
        const at = DateTime.formatIso(
          DateTime.makeUnsafe((yield* Clock.currentTimeMillis) + 86_400_000),
        );
        const given = ["claude", "solo", "personal", "codex"].map(
          (pool, index) => {
            const accessToken = tokens[index * 2] ?? "";
            const refreshToken = tokens[index * 2 + 1] ?? "";
            return [
              pool,
              pool === "codex"
                ? {
                    provider: "chatgpt",
                    accessToken,
                    refreshToken,
                    accountId: `${prefix}account`,
                  }
                : {
                    provider: "anthropic",
                    accessToken,
                    refreshToken,
                    endsAt: at,
                    subscriptionType: "max",
                    rateLimitTier: null,
                  },
            ] as const;
          },
        );
        const refusing = new Set<string>(
          generated.requests.flatMap(({ pool, refused }) =>
            refused ? [pool] : [],
          ),
        );
        fake.answer((seen) => {
          if (seen.target.startsWith("/quota/")) {
            return {
              headers: [["content-type", "application/json"]],
              chunks: ['{"five_hour":{"utilization":10,"resets_at":null}}'],
            };
          }
          if (!refusing.has(Harness.poolOf(seen))) return anthropicAnswer;
          return Harness.poolOf(seen) === "codex"
            ? Harness.usageLimit(Option.none())
            : Harness.refusal(Option.none());
        });
        for (const [pool, body] of given) {
          const answer = yield* Harness.send(`/api/pools/${pool}/quota-login`, {
            method: "PUT",
            headers: { "content-type": "application/json", ...owner },
            body: JSON.stringify(body),
          });
          expect(answer.status).toBe(200);
        }
        const forward = (pool: string) =>
          Effect.gen(function* () {
            const codex = pool === "codex";
            const keyed = pool === "work";
            const response = yield* Harness.send(
              `/pools/${pool}${codex ? "/backend-api/codex/responses" : keyed ? "/chat/completions" : "/v1/messages"}`,
              {
                method: "POST",
                headers: {
                  "x-cota-key": keyed
                    ? Harness.secrets.fleetHubKey
                    : Harness.secrets.clientsHubKey,
                  ...(keyed
                    ? {}
                    : {
                        authorization: `Bearer ${
                          codex
                            ? Harness.accessToken({
                                "https://api.openai.com/auth": {
                                  chatgpt_account_id: `${prefix}client`,
                                },
                              })
                            : `${prefix}client-login`
                        }`,
                      }),
                  ...(codex ? { "chatgpt-account-id": `${prefix}client` } : {}),
                  "content-type": "application/json",
                },
                body: JSON.stringify({
                  model: codex
                    ? "gpt-5.5-codex"
                    : keyed
                      ? "glm-5.2"
                      : "claude-opus-5-5",
                  stream: false,
                }),
              },
            );
            yield* Harness.bytesOf(response);
          });
        const [first, ...rest] = generated.requests;
        if (first !== undefined) yield* forward(first.pool);
        yield* Harness.withTheClockRunning(
          Harness.send("/api/pools", {
            headers: { "x-cota-key": Harness.secrets.readerHubKey },
          }),
        );
        for (const { pool } of rest) yield* forward(pool);
        const pools = new Set([
          "work",
          "open",
          "gone",
          "claude",
          "personal",
          "solo",
          "codex",
          "console",
        ]);
        const toPools = JSON.stringify(
          fake
            .seen()
            .filter((seen) => pools.has(Harness.poolOf(seen)))
            .map(({ target, headers, body }) => [
              target,
              headers,
              toText(body),
            ]),
        );
        for (const token of tokens) expect(toPools).not.toContain(token);
        expect(
          fake.seen().filter((seen) => seen.target.startsWith("/quota/")),
        ).not.toHaveLength(0);
        for (const [pool] of given) {
          yield* Harness.send(`/api/pools/${pool}/quota-login`, {
            method: "DELETE",
            headers: owner,
          });
        }
        yield* Harness.recorded(0);
      }),
    runs(20),
  );
});
