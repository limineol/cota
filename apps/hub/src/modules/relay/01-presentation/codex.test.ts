import { expect, layer } from "@effect/vitest";
import { Clock, DateTime, Effect, Option } from "effect";
import * as StoredItems from "#modules/request-log/03-domain/stored-items.ts";
import { Recorded } from "#modules/request-log/05-tests/fakes/record-request.fake.ts";
import * as FakeProvider from "#shared/05-tests/fake-provider.ts";
import * as Harness from "#shared/05-tests/harness.ts";

const clients = { "x-cota-key": Harness.secrets.clientsHubKey };

const hangingUp = () => new AbortController();

const nextRequest = Effect.flatMap(Recorded, (recorded) => recorded.take);

const nothingMoreRecorded = Effect.gen(function* () {
  expect(yield* Harness.recorded(0)).toEqual([]);
});

const sha256 = (text: string) =>
  new Bun.CryptoHasher("sha256").update(text).digest("hex");

const token = Harness.accessToken({
  "https://api.openai.com/auth": {
    chatgpt_account_id: "acct-fake-0001",
    chatgpt_account_user_id: "user-fake-ann__acct-fake-0001",
  },
  exp: 1794441600,
});

const login = {
  authorization: `Bearer ${token}`,
  "chatgpt-account-id": "acct-fake-0001",
};

const question = {
  type: "message",
  role: "user",
  content: [{ type: "input_text", text: "List the files." }],
};

const answerItem = {
  id: "msg_0fake",
  type: "message",
  status: "completed",
  role: "assistant",
  content: [{ type: "output_text", annotations: [], text: "README.md" }],
};

const responses = (model = "gpt-5.5-codex") =>
  JSON.stringify({
    model,
    stream: true,
    service_tier: "priority",
    input: [question],
    client_metadata: { session_id: "019a7c1e-body" },
  });

const ask = (
  headers: Record<string, string>,
  body: Uint8Array | string,
  init: RequestInit = {},
) =>
  Harness.send("/pools/codex/backend-api/codex/responses", {
    method: "POST",
    headers: {
      ...clients,
      "content-type": "application/json",
      "user-agent": "codex_cli_rs/0.167.1 (Mac OS 26.1.0; arm64) iTerm.app",
      ...headers,
    },
    body,
    ...init,
  });

const inAnHour = Effect.map(Clock.currentTimeMillis, (millis) =>
  DateTime.add(DateTime.makeUnsafe(Math.floor(millis / 1000) * 1000), {
    hours: 1,
  }),
);

layer(Harness.layer())("ChatGPT pools", (it) => {
  it.effect(
    "reads an answer without a content-type as an event stream when the request asked for one, as ChatGPT sends it",
    () =>
      Effect.gen(function* () {
        const fake = yield* FakeProvider.FakeProvider;
        fake.forget();
        const answer = Harness.codexAnswer([answerItem]);
        fake.answer({
          ...answer,
          headers: (answer.headers ?? []).filter(
            ([name]) => name !== "content-type",
          ),
        });
        const response = yield* ask(login, responses());
        yield* Harness.textOf(response);
        const request = yield* nextRequest;
        expect([
          request.origin.stream,
          request.outcome,
          Option.isSome(request.usage),
          Option.map(request.conversation, ({ output }) => output.length),
          request.origin.readingComplete,
        ]).toEqual([true, "ok", true, Option.some(1), true]);
        yield* nothingMoreRecorded;
      }),
  );

  it.effect(
    "closes the request as ok at response.completed when Codex hangs up there, while the provider still holds the stream open",
    () =>
      Effect.gen(function* () {
        const fake = yield* FakeProvider.FakeProvider;
        fake.forget();
        fake.answer({
          ...Harness.codexAnswer([answerItem]),
          chunkEveryMs: 2,
          afterwards: "hold",
        });
        const hangUp = hangingUp();
        const response = yield* ask(login, responses(), {
          signal: hangUp.signal,
        });
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        yield* Effect.promise(async () => {
          let received = "";
          while (!received.includes('"type":"response.completed"')) {
            const next = await reader?.read();
            if (next === undefined || next.done) break;
            received += decoder.decode(next.value, { stream: true });
          }
        });
        hangUp.abort();
        const request = yield* nextRequest;
        expect([
          request.outcome,
          request.errorType,
          request.stopReason,
          request.origin.readingComplete,
          Option.map(request.usage, ({ tokens }) => tokens.output),
          Option.map(request.conversation, ({ output }) => output.length),
        ]).toEqual([
          "ok",
          "",
          "completed",
          true,
          Option.some(3),
          Option.some(1),
        ]);
        expect(yield* Harness.waitUntil(() => fake.last().signal.aborted)).toBe(
          true,
        );
        yield* nothingMoreRecorded;
      }),
  );

  it.effect(
    "forwards a zstd body as it came, and reads the request and its answer from the decoded copy",
    () =>
      Effect.gen(function* () {
        const fake = yield* FakeProvider.FakeProvider;
        fake.forget();
        fake.answer(Harness.codexAnswer([answerItem]));
        const plain = new TextEncoder().encode(responses());
        const compressed = new Uint8Array(Bun.zstdCompressSync(plain));
        const response = yield* ask(
          {
            ...login,
            "content-encoding": "zstd",
            "session-id": "019a7c1e-header",
            "x-codex-turn-metadata": '{"request_kind":"turn"}',
          },
          compressed,
        );
        yield* Harness.textOf(response);
        const seen = fake.last();
        expect([
          seen.target,
          seen.body,
          seen.headers.find(([name]) => name === "content-encoding"),
        ]).toEqual([
          "/codex/responses",
          compressed,
          ["content-encoding", "zstd"],
        ]);
        const request = yield* nextRequest;
        expect(StoredItems.storedOf(request)).toMatchObject({
          protocol: "chatgpt-codex",
          operation: "responses",
          model: "gpt-5.5-codex",
          stream: true,
          session: "019a7c1e-header",
          sessionSource: "session-id",
          purpose: "turn",
          serviceTier: "priority",
          servedModel: "",
          outcome: "ok",
          stopReason: "completed",
          client: "codex",
          clientVersion: "0.167.1",
          providerRequestId: "req_codex",
          loginFingerprint: Option.some(
            sha256("acct-fake-0001\nuser-fake-ann__acct-fake-0001"),
          ),
          requestBytes: compressed.byteLength,
        });
        const conversation = Option.getOrThrow(request.conversation);
        expect([
          conversation.params,
          conversation.input.map(({ text }) => text),
          conversation.output.map(({ type, role, text }) => [type, role, text]),
        ]).toEqual([
          {
            model: "gpt-5.5-codex",
            stream: true,
            service_tier: "priority",
            client_metadata: { session_id: "019a7c1e-body" },
          },
          ["List the files."],
          [["message", "assistant", "README.md"]],
        ]);
      }),
  );

  it.effect(
    "records a usage-limit refusal as refused with its reset, passes it on byte for byte, and parks nothing",
    () =>
      Effect.gen(function* () {
        const fake = yield* FakeProvider.FakeProvider;
        fake.forget();
        const reset = yield* inAnHour;
        const refusal = Harness.usageLimit(Option.some(reset));
        const shared = "login-shared-by-claude-and-codex";
        fake.answer((seen) =>
          Harness.poolOf(seen) === "codex"
            ? refusal
            : {
                headers: [["content-type", "application/json"]],
                chunks: [
                  '{"type":"message","role":"assistant","content":[],"usage":{"input_tokens":1,"output_tokens":1}}',
                ],
              },
        );
        const response = yield* ask(
          { authorization: `Bearer ${shared}` },
          responses("model-asked-of-both"),
        );
        const text = yield* Harness.textOf(response);
        expect([response.status, text]).toEqual([
          429,
          refusal.chunks?.join(""),
        ]);
        const request = yield* nextRequest;
        expect(StoredItems.storedOf(request)).toMatchObject({
          pool: "codex",
          outcome: "refused",
          refusalReset: Option.some(reset),
          errorType: "usage_limit_reached",
          errorMessage: "The usage limit has been reached",
          errorBody: refusal.chunks?.join(""),
          loginFingerprint: Option.some(sha256(shared)),
          rateLimits: { "x-codex-active-limit": "codex" },
        });

        const claude = yield* Harness.send("/pools/claude/v1/messages", {
          method: "POST",
          headers: {
            ...clients,
            authorization: `Bearer ${shared}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "model-asked-of-both",
            max_tokens: 16,
            messages: [{ role: "user", content: "hi" }],
          }),
        });
        yield* Harness.textOf(claude);
        expect(
          fake
            .seen()
            .map((seen) => [Harness.poolOf(seen), Harness.credentialsOf(seen)]),
        ).toEqual([
          ["codex", [["authorization", `Bearer ${shared}`]]],
          ["claude", [["authorization", `Bearer ${shared}`]]],
        ]);
        expect((yield* nextRequest).outcome).toBe("ok");
        yield* nothingMoreRecorded;
      }),
  );

  it.effect(
    "records the answer's failure at response.failed as an error with the provider's code and message",
    () =>
      Effect.gen(function* () {
        const fake = yield* FakeProvider.FakeProvider;
        fake.forget();
        fake.answer({
          headers: [["content-type", "text/event-stream"]],
          chunks: [
            'event: response.failed\ndata: {"type":"response.failed","response":{"id":"resp_1","status":"failed","error":{"code":"server_is_overloaded","message":"Our servers are busy."}}}\n\n',
          ],
        });
        const response = yield* ask(login, responses());
        yield* Harness.textOf(response);
        const request = yield* nextRequest;
        expect([
          response.status,
          request.outcome,
          request.errorType,
          request.errorMessage,
          request.stopReason,
        ]).toEqual([
          200,
          "error",
          "server_is_overloaded",
          "Our servers are busy.",
          "failed",
        ]);
      }),
  );
});
