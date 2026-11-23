import { expect, layer } from "@effect/vitest";
import { Effect, Option } from "effect";
import { Prices } from "#modules/request-log/02-application/interfaces/prices.ts";
import * as Cost from "#modules/request-log/03-domain/cost.ts";
import * as StoredItems from "#modules/request-log/03-domain/stored-items.ts";
import { Recorded } from "#modules/request-log/05-tests/fakes/record-request.fake.ts";
import * as FakeProvider from "#shared/05-tests/fake-provider.ts";
import * as Harness from "#shared/05-tests/harness.ts";

const nextRequest = Effect.flatMap(Recorded, (recorded) => recorded.take);

const nothingMoreRecorded = Effect.gen(function* () {
  expect(yield* Harness.recorded(0)).toEqual([]);
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

const ask = (pool: string, credentials: Record<string, string>) =>
  Effect.gen(function* () {
    const fake = yield* FakeProvider.FakeProvider;
    fake.forget();
    fake.answer(answer);
    const response = yield* Harness.send(`/pools/${pool}/v1/messages`, {
      method: "POST",
      headers: {
        ...credentials,
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        "user-agent": "claude-cli/2.1.322 (external, cli)",
      },
      body: JSON.stringify({
        model: "claude-opus-5-5",
        max_tokens: 64000,
        stream: true,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    const text = yield* Harness.textOf(response);
    return { response, text, seen: fake.seen() };
  });

const reached = (seen: ReadonlyArray<FakeProvider.Seen>) =>
  seen.map((each) => [Harness.poolOf(each), Harness.credentialsOf(each)]);

layer(Harness.layer())("a keyed pool that speaks anthropic-messages", (it) => {
  it.effect(
    "sends the held key as a bearer token when the hub key came as one, and never the hub key",
    () =>
      Effect.gen(function* () {
        const { response, seen } = yield* ask("console", {
          authorization: `Bearer ${Harness.secrets.fleetHubKey}`,
        });
        expect(response.status).toBe(200);
        expect(reached(seen)).toEqual([
          [
            "console",
            [["authorization", `Bearer ${Harness.secrets.consoleKey}`]],
          ],
        ]);
        expect(JSON.stringify(seen)).not.toContain(Harness.secrets.fleetHubKey);
        expect((yield* nextRequest).origin.hubKey).toBe("fleet");
      }),
  );

  it.effect(
    "sends the held key in x-api-key when the hub key came in x-api-key, and never the hub key",
    () =>
      Effect.gen(function* () {
        const { response, seen } = yield* ask("console", {
          "x-api-key": Harness.secrets.fleetHubKey,
        });
        expect(response.status).toBe(200);
        expect(reached(seen)).toEqual([
          ["console", [["x-api-key", Harness.secrets.consoleKey]]],
        ]);
        expect(JSON.stringify(seen)).not.toContain(Harness.secrets.fleetHubKey);
        expect((yield* nextRequest).origin.hubKey).toBe("fleet");
      }),
  );

  it.effect(
    "drops a client's own bearer login beside a hub key in x-cota-key, and sends the held key as a bearer token",
    () =>
      Effect.gen(function* () {
        const login = "sk-ant-oat01-the-clients-own-login";
        const { response, seen } = yield* ask("console", {
          "x-cota-key": Harness.secrets.fleetHubKey,
          authorization: `Bearer ${login}`,
        });
        expect(response.status).toBe(200);
        expect(reached(seen)).toEqual([
          [
            "console",
            [["authorization", `Bearer ${Harness.secrets.consoleKey}`]],
          ],
        ]);
        expect(JSON.stringify(seen)).not.toContain(login);
        yield* nextRequest;
      }),
  );

  it.effect(
    "sends the held key as a bearer token when the hub key came as one beside an empty x-api-key",
    () =>
      Effect.gen(function* () {
        const { response, seen } = yield* ask("console", {
          authorization: `Bearer ${Harness.secrets.fleetHubKey}`,
          "x-api-key": "",
        });
        expect(response.status).toBe(200);
        expect(reached(seen)).toEqual([
          [
            "console",
            [["authorization", `Bearer ${Harness.secrets.consoleKey}`]],
          ],
        ]);
        yield* nextRequest;
      }),
  );

  it.effect(
    "rejects the subscription hub key at a keyed pool, and the keyed hub key at a subscription pool, as the wrong scope",
    () =>
      Effect.gen(function* () {
        const rejected = [];
        for (const [pool, credentials] of [
          ["console", { "x-cota-key": Harness.secrets.clientsHubKey }],
          ["console", { "x-api-key": Harness.secrets.clientsHubKey }],
          ["solo", { "x-cota-key": Harness.secrets.fleetHubKey }],
        ] as const) {
          const { response, text, seen } = yield* ask(pool, credentials);
          rejected.push([pool, response.status, JSON.parse(text), seen]);
        }
        const wrongScope = {
          type: "error",
          error: { type: "cota_hub_key_scope", message: expect.any(String) },
        };
        expect(rejected).toEqual([
          ["console", 403, wrongScope, []],
          ["console", 403, wrongScope, []],
          ["solo", 403, wrongScope, []],
        ]);
        yield* nothingMoreRecorded;
      }),
  );

  it.effect(
    "records a streamed answer with its usage and cost, and no login fingerprint",
    () =>
      Effect.gen(function* () {
        const { text } = yield* ask("console", {
          "x-cota-key": Harness.secrets.fleetHubKey,
          authorization: "Bearer sk-ant-oat01-a-login-it-must-not-remember",
        });
        expect(text).toBe(streamed.join(""));
        const request = yield* nextRequest;
        expect(StoredItems.storedOf(request)).toMatchObject({
          pool: "console",
          provider: "anthropic",
          protocol: "anthropic-messages",
          operation: "messages",
          model: "claude-opus-5-5",
          outcome: "ok",
          stopReason: "end_turn",
          divertedFrom: Option.none(),
          loginFingerprint: Option.none(),
          providerRequestId: "req_answered",
        });
        const usage = Option.getOrThrow(request.usage);
        expect(usage.tokens).toEqual({
          input: 25,
          cacheRead: 0,
          cacheWriteShort: 0,
          cacheWriteLong: 0,
          output: 15,
        });
        const prices = yield* Prices;
        const asked = { ...request, ...request.origin };
        expect(yield* Cost.of(usage.tokens, prices.of(asked))).toEqual(
          Option.some(400_000_000n),
        );
      }),
  );
});
