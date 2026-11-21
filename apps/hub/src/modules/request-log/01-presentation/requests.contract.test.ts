import { expect, layer } from "@effect/vitest";
import { DateTime, Effect, Option } from "effect";
import { InMemoryRequests } from "#modules/request-log/05-tests/fakes/in-memory-requests.repository.ts";
import * as FakeProvider from "#shared/05-tests/fake-provider.ts";
import * as Harness from "#shared/05-tests/harness.ts";

const reader = { "x-cota-key": Harness.secrets.readerHubKey };

const login = "sk-ant-oat01-refused-then-inspected";

const usage = {
  input_tokens: 25,
  cache_read_input_tokens: 300,
  cache_creation_input_tokens: 0,
  output_tokens: 15,
};

const answer: FakeProvider.Script = {
  headers: [
    ["content-type", "application/json"],
    ["request-id", "req_answered"],
  ],
  chunks: [
    JSON.stringify({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      content: [
        { type: "thinking", thinking: "", signature: "c2lnbmVk" },
        { type: "text", text: "Done." },
      ],
      stop_reason: "end_turn",
      usage,
    }),
  ],
};

const body = {
  model: "claude-opus-5-5",
  max_tokens: 64000,
  temperature: 1,
  system: [{ type: "text", text: "You are Claude Code." }],
  tools: [
    {
      name: "Bash",
      description: "Runs a command.",
      input_schema: { type: "object" },
    },
  ],
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "What is in this picture?" },
        {
          type: "image",
          source: { type: "base64", media_type: "image/png", data: "iVBORw0K" },
        },
      ],
    },
  ],
};

const send = (path: string, init: RequestInit = {}) =>
  Harness.send(path, {
    ...init,
    headers: {
      "x-cota-key": Harness.secrets.clientsHubKey,
      authorization: `Bearer ${login}`,
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      "user-agent": "claude-cli/2.1.322 (external, cli)",
      "x-claude-code-session-id": "inspected-1",
      "x-claude-code-request-class": "main",
    },
  }).pipe(Effect.andThen(Harness.textOf));

const inspect = (id: string) =>
  Harness.send(`/api/requests/${id}`, { headers: reader });

layer(Harness.layer())("the requests group", (it) => {
  it.effect(
    "shows a diverted request with its record, role, params, tools and entries, and the refused one it follows, without a secret",
    () =>
      Effect.gen(function* () {
        const fake = yield* FakeProvider.FakeProvider;
        fake.answer((seen) =>
          Harness.poolOf(seen) === "claude"
            ? Harness.refusal(Option.none())
            : answer,
        );
        yield* send("/pools/claude/v1/messages", {
          method: "POST",
          body: JSON.stringify(body),
        });
        const [refused, diverted] = yield* Harness.recorded(2);
        const refusedId = refused?.id ?? "";
        const divertedId = diverted?.id ?? "";
        const response = yield* inspect(divertedId);
        const text = yield* Harness.textOf(response);
        const shown = JSON.parse(text);
        const first = JSON.parse(
          yield* Harness.textOf(yield* inspect(refusedId)),
        );

        expect(response.status).toBe(200);
        expect(shown.request).toMatchObject({
          id: divertedId,
          startedAt: DateTime.formatIso(
            diverted?.startedAt ?? DateTime.makeUnsafe(0),
          ),
          session: "inspected-1",
          sessionSource: "x-claude-code-session-id",
          client: "claude-code",
          clientVersion: "2.1.322",
          hubKey: "clients",
          pool: "personal",
          divertedFrom: "claude",
          follows: refusedId,
          protocol: "anthropic-messages",
          operation: "messages",
          purpose: "main",
          model: "claude-opus-5-5",
          stream: false,
          outcome: "ok",
          upstreamStatus: 200,
          stopReason: "end_turn",
          usageReported: true,
          inputTokens: 25,
          cacheReadTokens: 300,
          outputTokens: 15,
          providerRequestId: "req_answered",
          usage,
          promptSize: 325,
        });
        expect([
          shown.requestRole,
          shown.segment,
          shown.params,
          shown.tools,
          shown.followedBy,
          shown.cutCharacters,
        ]).toEqual([
          "main",
          0,
          { model: "claude-opus-5-5", max_tokens: 64000, temperature: 1 },
          [{ name: "Bash", description: "Runs a command." }],
          null,
          0,
        ]);
        const unplaced = ({ item: _, ...entry }: { item: string }) => entry;
        expect({
          system: shown.system.map(unplaced),
          input: shown.input.map(unplaced),
          output: shown.output.map(unplaced),
        }).toEqual({
          system: [
            {
              kind: "message",
              part: "system",
              role: "system",
              parts: [{ type: "text", text: "You are Claude Code.", cut: 0 }],
            },
          ],
          input: [
            {
              kind: "message",
              part: "input",
              role: "user",
              parts: [
                { type: "text", text: "What is in this picture?", cut: 0 },
                { type: "image", mediaType: "image/png", bytes: 6 },
              ],
            },
          ],
          output: [
            {
              kind: "reasoning",
              part: "output",
              text: null,
              hidden: true,
              cut: 0,
            },
            {
              kind: "message",
              part: "output",
              role: "assistant",
              parts: [{ type: "text", text: "Done.", cut: 0 }],
            },
          ],
        });
        expect(first.request).toMatchObject({
          pool: "claude",
          outcome: "refused",
          upstreamStatus: 429,
          divertedFrom: null,
          follows: null,
        });
        expect(first.followedBy).toBe(divertedId);
        for (const secret of [
          login,
          ...Object.values(Harness.secrets),
          "iVBORw0K",
          "c2lnbmVk",
        ]) {
          expect([text, JSON.stringify(first)].join()).not.toContain(secret);
        }
      }),
  );

  it.effect(
    "gives a request's body as the client sent it, and says no body was kept for a model listing",
    () =>
      Effect.gen(function* () {
        const fake = yield* FakeProvider.FakeProvider;
        fake.answer(answer);
        yield* send("/pools/personal/v1/messages", {
          method: "POST",
          body: JSON.stringify(body),
        });
        fake.answer({
          headers: [["content-type", "application/json"]],
          chunks: ['{"data":[]}'],
        });
        yield* send("/pools/personal/v1/models");
        const [asked, listed] = yield* Harness.recorded(2);
        const rebuilt = yield* Harness.send(`/api/requests/${asked?.id}/body`, {
          headers: reader,
        });
        const rebuiltBody = JSON.parse(yield* Harness.textOf(rebuilt));
        const listing = JSON.parse(
          yield* Harness.textOf(yield* inspect(listed?.id ?? "")),
        );
        const noBody = yield* Harness.problemOf(
          yield* Harness.send(`/api/requests/${listed?.id}/body`, {
            headers: reader,
          }),
        );

        expect(rebuilt.status).toBe(200);
        expect(Harness.sameJson(rebuiltBody, body)).toBe(true);
        expect([
          listing.request.operation,
          listing.requestRole,
          listing.params,
          listing.tools,
          listing.system,
          listing.input,
          listing.output,
        ]).toEqual(["models", "utility", null, null, null, null, null]);
        expect([noBody.status, noBody.body]).toEqual([
          404,
          {
            type: "urn:cota:no-conversation",
            status: 404,
            title: "The request log kept no body for this request.",
            detail: `The request log kept no body for request ${listed?.id}: its operation carries no conversation, or its body could not be read.`,
          },
        ]);
      }),
  );

  it.effect(
    "answers 404 for a request the request log does not have, or an id that is not one",
    () =>
      Effect.gen(function* () {
        const unknown = "01900000-0000-7000-8000-000000000000";
        const answers = [];
        for (const path of [
          `/api/requests/${unknown}`,
          `/api/requests/${unknown}/body`,
          "/api/requests/not-an-id",
          "/api/requests/not-an-id/body",
        ]) {
          const { status, body } = yield* Harness.problemOf(
            yield* Harness.send(path, { headers: reader }),
          );
          answers.push([status, Object(body).type, Object(body).detail]);
        }

        expect(answers).toEqual([
          [
            404,
            "urn:cota:no-such-request",
            `The request log has no request "${unknown}".`,
          ],
          [
            404,
            "urn:cota:no-such-request",
            `The request log has no request "${unknown}".`,
          ],
          [
            404,
            "urn:cota:no-such-request",
            'The request log has no request "not-an-id".',
          ],
          [
            404,
            "urn:cota:no-such-request",
            'The request log has no request "not-an-id".',
          ],
        ]);
      }),
  );

  it.effect(
    "answers 503 when the request log cannot be read, saying so without what ClickHouse said",
    () =>
      Effect.gen(function* () {
        const requests = yield* InMemoryRequests;
        requests.readingFails = true;
        const answers = [];
        for (const path of [
          "/api/requests/01900000-0000-7000-8000-000000000000",
          "/api/sessions/inspected-1",
          "/api/requests/01900000-0000-7000-8000-000000000000/body",
        ]) {
          const { status, body } = yield* Harness.problemOf(
            yield* Harness.send(path, { headers: reader }),
          );
          answers.push([status, Object(body).type, Object(body).detail]);
        }
        requests.readingFails = false;

        const unavailable = (detail: string) => [
          503,
          "urn:cota:request-log-unavailable",
          detail,
        ];
        expect(answers).toEqual([
          unavailable(
            "ClickHouse could not be reached, or did not answer within 30 seconds.",
          ),
          unavailable(
            "ClickHouse could not be reached, or did not answer within 30 seconds.",
          ),
          unavailable("ClickHouse could not be reached, or failed the query."),
        ]);
      }),
  );
});
