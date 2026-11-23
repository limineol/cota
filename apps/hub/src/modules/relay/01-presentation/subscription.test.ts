import { expect, layer } from "@effect/vitest";
import { Clock, DateTime, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import * as StoredItems from "#modules/request-log/03-domain/stored-items.ts";
import { Recorded } from "#modules/request-log/05-tests/fakes/record-request.fake.ts";
import * as FakeProvider from "#shared/05-tests/fake-provider.ts";
import * as Harness from "#shared/05-tests/harness.ts";

const clients = { "x-cota-key": Harness.secrets.clientsHubKey };

const keptLogin = `Bearer ${Harness.secrets.keptLogin}`;

const fingerprintOf = (login: string) =>
  new Bun.CryptoHasher("sha256").update(login).digest("hex");

const nextRequest = Effect.flatMap(Recorded, (recorded) => recorded.take);

const nothingMoreRecorded = Effect.gen(function* () {
  expect(yield* Harness.recorded(0)).toEqual([]);
});

const messages = (model = "claude-opus-5-5") =>
  JSON.stringify({
    model,
    max_tokens: 64000,
    stream: true,
    messages: [{ role: "user", content: "hi" }],
  });

const streamed = [
  'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-opus-5-5","content":[],"stop_reason":null,"usage":{"input_tokens":25,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":1,"service_tier":"standard"}}}\n\n',
  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}\n\n',
  'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":15}}\n\n',
  'event: message_stop\ndata: {"type":"message_stop"}\n\n',
];

const answer: FakeProvider.Script = {
  headers: [
    ["content-type", "text/event-stream"],
    ["request-id", "req_answered"],
  ],
  chunks: streamed,
};

const ask = (
  pool: string,
  login: Record<string, string>,
  body: string = messages(),
  path = "/v1/messages?beta=true",
) =>
  Effect.gen(function* () {
    const response = yield* Harness.send(`/pools/${pool}${path}`, {
      method: path.startsWith("/v1/models") ? "GET" : "POST",
      headers: {
        ...clients,
        ...login,
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        "user-agent": "claude-cli/2.1.322 (external, cli)",
      },
      ...(path.startsWith("/v1/models") ? {} : { body }),
    });
    const text = yield* Harness.textOf(response);
    return { response, text };
  });

const reached = (seen: ReadonlyArray<FakeProvider.Seen>) =>
  seen.map((each) => [Harness.poolOf(each), Harness.credentialsOf(each)]);

const now = Effect.map(Clock.currentTimeMillis, (millis) =>
  DateTime.makeUnsafe(millis),
);

const inAnHour = Effect.map(now, (at) => DateTime.add(at, { hours: 1 }));

const refusingFor =
  (login: string, pool = "claude", script = Harness.refusal(Option.none())) =>
  (seen: FakeProvider.Seen): FakeProvider.Script =>
    Harness.poolOf(seen) === pool &&
    Harness.credentialsOf(seen).some(([, value]) => value.includes(login))
      ? script
      : answer;

layer(Harness.layer())("subscription pools", (it) => {
  it.effect(
    "forwards a request with the client's own credential headers, untouched, and records its login's fingerprint",
    () =>
      Effect.gen(function* () {
        const fake = yield* FakeProvider.FakeProvider;
        fake.forget();
        fake.answer(answer);
        const login = "sk-ant-oat01-kept-as-sent";
        const { response, text } = yield* ask("claude", {
          authorization: `Bearer ${login}`,
          "x-api-key": "sk-ant-api03-also-sent",
        });
        expect([response.status, text]).toEqual([200, streamed.join("")]);
        expect(fake.last().target).toBe("/claude/v1/messages?beta=true");
        expect(Harness.credentialsOf(fake.last())).toEqual([
          ["authorization", `Bearer ${login}`],
          ["x-api-key", "sk-ant-api03-also-sent"],
        ]);
        const request = yield* nextRequest;
        expect(StoredItems.storedOf(request)).toMatchObject({
          pool: "claude",
          provider: "anthropic",
          protocol: "anthropic-messages",
          operation: "messages",
          model: "claude-opus-5-5",
          outcome: "ok",
          stopReason: "end_turn",
          divertedFrom: Option.none(),
          follows: Option.none(),
          loginFingerprint: Option.some(fingerprintOf(login)),
          refusalReset: Option.none(),
          providerRequestId: "req_answered",
        });
      }),
  );

  it.effect(
    "diverts a refused request once to the fallback pool with its kept login, drops the refusal, and records both",
    () =>
      Effect.gen(function* () {
        const fake = yield* FakeProvider.FakeProvider;
        fake.forget();
        const login = "sk-ant-oat01-refused-then-diverted";
        const reset = yield* inAnHour;
        fake.answer(
          refusingFor(login, "claude", {
            ...Harness.refusal(Option.some(reset)),
            afterwards: "hold",
          }),
        );
        const body = messages();
        const { response, text } = yield* ask(
          "claude",
          { authorization: `Bearer ${login}`, "x-api-key": login },
          body,
        );
        expect([response.status, text]).toEqual([200, streamed.join("")]);
        expect(reached(fake.seen())).toEqual([
          [
            "claude",
            [
              ["authorization", `Bearer ${login}`],
              ["x-api-key", login],
            ],
          ],
          ["personal", [["authorization", keptLogin]]],
        ]);
        expect(fake.seen().map((seen) => seen.target)).toEqual([
          "/claude/v1/messages?beta=true",
          "/personal/v1/messages?beta=true",
        ]);
        expect(
          fake.seen().map((seen) => new TextDecoder().decode(seen.body)),
        ).toEqual([body, body]);
        expect(
          yield* Harness.waitUntil(
            () => fake.seen()[0]?.signal.aborted ?? false,
          ),
        ).toBe(true);
        const refused = yield* nextRequest;
        const diverted = yield* nextRequest;
        expect(StoredItems.storedOf(refused)).toMatchObject({
          pool: "claude",
          outcome: "refused",
          upstreamStatus: 429,
          refusalReset: Option.some(reset),
          loginFingerprint: Option.some(fingerprintOf(login)),
          divertedFrom: Option.none(),
          follows: Option.none(),
          providerRequestId: "req_refused",
          responseBytes: 0,
          errorBody: "",
        });
        expect(StoredItems.storedOf(diverted)).toMatchObject({
          pool: "personal",
          provider: "anthropic",
          outcome: "ok",
          upstreamStatus: 200,
          refusalReset: Option.none(),
          loginFingerprint: Option.some(fingerprintOf(login)),
          divertedFrom: Option.some("claude"),
          follows: Option.some(refused.id),
        });
        expect(response.headers.get("x-cota-request")).toBe(diverted.id);
        yield* nothingMoreRecorded;

        fake.forget();
        fake.answer(answer);
        yield* ask("claude", { authorization: `Bearer ${login}` });
        yield* ask("claude", {
          authorization: "Bearer sk-ant-oat01-another-login",
        });
        yield* ask(
          "claude",
          { authorization: `Bearer ${login}` },
          messages("claude-sonnet-5-5"),
        );
        expect(reached(fake.seen())).toEqual([
          ["personal", [["authorization", keptLogin]]],
          ["claude", [["authorization", "Bearer sk-ant-oat01-another-login"]]],
          ["claude", [["authorization", `Bearer ${login}`]]],
        ]);
        const straightAway = yield* nextRequest;
        expect(StoredItems.storedOf(straightAway)).toMatchObject({
          pool: "personal",
          divertedFrom: Option.some("claude"),
          follows: Option.none(),
          outcome: "ok",
        });
        yield* nextRequest;
        yield* nextRequest;
        yield* nothingMoreRecorded;

        yield* TestClock.setTime(DateTime.toEpochMillis(reset) - 1);
        fake.forget();
        yield* ask("claude", { authorization: `Bearer ${login}` });
        yield* TestClock.setTime(DateTime.toEpochMillis(reset));
        yield* ask("claude", { "x-api-key": login });
        expect(reached(fake.seen())).toEqual([
          ["personal", [["authorization", keptLogin]]],
          ["claude", [["x-api-key", login]]],
        ]);
        yield* Harness.recorded(2);
      }),
  );

  it.effect(
    "parks a refusal without a reset for 15 minutes from when it was recorded",
    () =>
      Effect.gen(function* () {
        const fake = yield* FakeProvider.FakeProvider;
        const login = "sk-ant-oat01-refused-without-reset";
        fake.answer(refusingFor(login));
        const refusedAt = DateTime.toEpochMillis(yield* now);
        yield* ask("claude", { authorization: `Bearer ${login}` });
        const [refused] = yield* Harness.recorded(2);
        expect(refused?.origin.refusalReset).toEqual(Option.none());
        fake.forget();
        yield* TestClock.setTime(refusedAt + 15 * 60_000 - 1);
        yield* ask("claude", { authorization: `Bearer ${login}` });
        yield* TestClock.setTime(refusedAt + 15 * 60_000);
        fake.answer(answer);
        yield* ask("claude", { authorization: `Bearer ${login}` });
        expect(reached(fake.seen()).map(([pool]) => pool)).toEqual([
          "personal",
          "claude",
        ]);
        yield* Harness.recorded(2);
      }),
  );

  it.effect(
    "passes a refusal from a pool without a fallback pool to the client byte for byte, and records it refused",
    () =>
      Effect.gen(function* () {
        const fake = yield* FakeProvider.FakeProvider;
        fake.forget();
        const reset = yield* inAnHour;
        const login = "sk-ant-oat01-solo";
        const script = Harness.refusal(Option.some(reset));
        fake.answer(script);
        const { response, text } = yield* ask("solo", {
          authorization: `Bearer ${login}`,
        });
        expect([
          response.status,
          response.headers.get("anthropic-ratelimit-unified-status"),
          text,
        ]).toEqual([429, "rejected", script.chunks?.join("")]);
        expect(reached(fake.seen())).toEqual([
          ["solo", [["authorization", `Bearer ${login}`]]],
        ]);
        const request = yield* nextRequest;
        expect(StoredItems.storedOf(request)).toMatchObject({
          pool: "solo",
          outcome: "refused",
          refusalReset: Option.some(reset),
          errorType: "rate_limit_error",
          errorBody: script.chunks?.join(""),
          responseBytes: text.length,
        });
        yield* nothingMoreRecorded;
      }),
  );

  it.effect(
    "passes on a refusal from the fallback pool, and does not record it with Fallback",
    () =>
      Effect.gen(function* () {
        const fake = yield* FakeProvider.FakeProvider;
        fake.forget();
        const login = "sk-ant-oat01-refused-twice";
        const first = yield* inAnHour;
        const later = DateTime.add(first, { hours: 4 });
        const fallbackRefusal = Harness.refusal(
          Option.some(later),
          '{"type":"error","error":{"type":"billing_error","message":"The fallback is out too."}}',
        );
        fake.answer((seen) =>
          Harness.poolOf(seen) === "claude"
            ? Harness.refusal(Option.some(first))
            : fallbackRefusal,
        );
        const { response, text } = yield* ask("claude", {
          authorization: `Bearer ${login}`,
        });
        expect([response.status, text]).toEqual([
          429,
          fallbackRefusal.chunks?.join(""),
        ]);
        const refused = yield* nextRequest;
        const diverted = yield* nextRequest;
        expect([
          refused.outcome,
          refused.origin.refusalReset,
          diverted.outcome,
          diverted.pool,
          diverted.origin.follows,
          diverted.origin.refusalReset,
          diverted.errorType,
        ]).toEqual([
          "refused",
          Option.some(first),
          "refused",
          "personal",
          Option.some(refused.id),
          Option.some(later),
          "billing_error",
        ]);
        yield* TestClock.setTime(DateTime.toEpochMillis(first));
        fake.forget();
        fake.answer(answer);
        yield* ask("claude", { authorization: `Bearer ${login}` });
        expect(reached(fake.seen()).map(([pool]) => pool)).toEqual(["claude"]);
        yield* nextRequest;
      }),
  );

  it.effect(
    "keeps a request without a login, and does not divert it after its refusal",
    () =>
      Effect.gen(function* () {
        const fake = yield* FakeProvider.FakeProvider;
        fake.forget();
        fake.answer(Harness.refusal(Option.some(yield* inAnHour)));
        const { response } = yield* ask("claude", {});
        expect(response.status).toBe(429);
        expect(reached(fake.seen())).toEqual([["claude", []]]);
        const request = yield* nextRequest;
        expect([request.outcome, request.origin.loginFingerprint]).toEqual([
          "refused",
          Option.none(),
        ]);
        yield* nothingMoreRecorded;
      }),
  );

  it.effect(
    "keeps a request without a model, though its login is parked, and passes its refusal on",
    () =>
      Effect.gen(function* () {
        const fake = yield* FakeProvider.FakeProvider;
        const login = "sk-ant-oat01-parked-without-a-model";
        fake.answer(refusingFor(login));
        yield* ask("claude", { authorization: `Bearer ${login}` });
        yield* Harness.recorded(2);

        fake.forget();
        const refusal = Harness.refusal(Option.some(yield* inAnHour));
        fake.answer((seen) =>
          seen.target.startsWith("/claude/v1/messages") ? refusal : answer,
        );
        const listed = yield* ask(
          "claude",
          { authorization: `Bearer ${login}` },
          "",
          "/v1/models",
        );
        const unmodelled = yield* ask(
          "claude",
          { authorization: `Bearer ${login}` },
          JSON.stringify({ max_tokens: 10, messages: [] }),
        );
        expect([listed.response.status, unmodelled.response.status]).toEqual([
          200, 429,
        ]);
        expect(reached(fake.seen())).toEqual([
          ["claude", [["authorization", `Bearer ${login}`]]],
          ["claude", [["authorization", `Bearer ${login}`]]],
        ]);
        const requests = yield* Harness.recorded(2);
        expect(
          requests.map(({ operation, model, outcome }) => [
            operation,
            model,
            outcome,
          ]),
        ).toEqual([
          ["models", "", "ok"],
          ["messages", "", "refused"],
        ]);
      }),
  );

  it.effect(
    "never takes the hub key of a subscription pool from the login",
    () =>
      Effect.gen(function* () {
        const fake = yield* FakeProvider.FakeProvider;
        fake.forget();
        const response = yield* Harness.send("/pools/claude/v1/messages", {
          method: "POST",
          headers: { authorization: `Bearer ${Harness.secrets.clientsHubKey}` },
          body: messages(),
        });
        expect(response.status).toBe(403);
        yield* Harness.textOf(response);
        expect(fake.seen()).toEqual([]);
        yield* nothingMoreRecorded;
      }),
  );
});
