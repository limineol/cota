import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as Strings from "#modules/recording/01-presentation/strings.ts";
import type * as ExchangeFile from "#modules/recording/03-domain/exchange-file.ts";
import type { ProtocolName } from "#shared/03-domain/protocol-name.ts";
import * as Scrubber from "./scrubber.ts";

const exchange = (
  request: Partial<ExchangeFile.Exchange["request"]>,
  response: Partial<ExchangeFile.Exchange["response"]> = {},
): ExchangeFile.Exchange => ({
  request: { method: "POST", path: "/v1/messages", headers: {}, ...request },
  response: { status: 200, headers: {}, ...response },
});

const json = (value: Schema.Json): ExchangeFile.Body => ({ json: value });

const jsonOf = (text: string): Schema.Json =>
  Schema.decodeSync(Schema.fromJsonString(Schema.Json))(text);

const base64Url = (value: Schema.Json) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

const payloadOf = (token: string): Schema.Json =>
  jsonOf(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));

describe("Scrubber", () => {
  it("replaces a string the protocol does not hold as one of its words by a filler that tells its length class, and keeps an empty one", () => {
    const scrubbed = Scrubber.scrub(
      "anthropic-messages",
      exchange({
        body: json({
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "" },
                { type: "text", text: "ls" },
                { type: "text", text: "read the notes in ~/secret" },
                { type: "text", text: "x".repeat(1024) },
                { type: "text", text: "x".repeat(1025) },
              ],
            },
          ],
        }),
      }),
      Scrubber.makeFakes(),
    );

    expect(scrubbed.request.body).toEqual(
      json({
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "" },
              { type: "text", text: "scrubbed:s" },
              { type: "text", text: "scrubbed:m" },
              { type: "text", text: "scrubbed:l" },
              { type: "text", text: "scrubbed:xl" },
            ],
          },
        ],
      }),
    );
  });

  it("keeps the words of the protocol, numbers, booleans and nulls", () => {
    const scrubbed = Scrubber.scrub(
      "anthropic-messages",
      exchange(
        {},
        {
          body: json({
            id: "msg_01Real",
            type: "message",
            role: "assistant",
            model: "claude-opus-5-5",
            content: [],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: {
              input_tokens: 12,
              output_tokens: 3,
              service_tier: "standard",
            },
          }),
        },
      ),
      Scrubber.makeFakes(),
    );

    expect(scrubbed.response.body).toEqual(
      json({
        id: "msg_FAKE0001",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: {
          input_tokens: 12,
          output_tokens: 3,
          service_tier: "standard",
        },
      }),
    );
  });

  it("replaces a field the protocol does not define, its key with it, and every key, string and number inside it", () => {
    const scrubbed = Scrubber.scrub(
      "chatgpt-codex",
      exchange({
        path: "/backend-api/codex/responses",
        body: json({
          model: "gpt-5.5-codex",
          stream: true,
          brand_new_field: { project: "acme-payroll", count: 42, on: true },
          also_new: "acme",
        }),
      }),
      Scrubber.makeFakes(),
    );

    expect(scrubbed.request.body).toEqual(
      json({
        model: "gpt-5.5-codex",
        stream: true,
        "scrubbed-key-1": {
          "scrubbed-key-1": "scrubbed:m",
          "scrubbed-key-2": 0,
          "scrubbed-key-3": true,
        },
        "scrubbed-key-2": "scrubbed:s",
      }),
    );
  });

  it("replaces an event type the scrubber has never heard of, in the event's name and in its data", () => {
    const scrubbed = Scrubber.scrub(
      "anthropic-messages",
      exchange(
        {},
        {
          headers: { "content-type": "text/event-stream" },
          body: {
            events: [
              { event: "ping", data: { type: "ping" } },
              {
                event: "teleport_start",
                data: { type: "teleport_start", destination: "home" },
              },
              { data: "not json" },
            ],
          },
        },
      ),
      Scrubber.makeFakes(),
    );

    expect(scrubbed.response.body).toEqual({
      events: [
        { event: "ping", data: { type: "ping" } },
        {
          event: "scrubbed:m",
          data: { type: "scrubbed:m", "scrubbed-key-1": "scrubbed:s" },
        },
        { data: "scrubbed:s" },
      ],
    });
  });

  it("keeps no key of a tool's input, schema or arguments, nor any tool name", () => {
    const fakes = Scrubber.makeFakes();
    const anthropic = Scrubber.scrub(
      "anthropic-messages",
      exchange({
        body: json({
          tools: [
            {
              name: "PayrollLookup",
              description: "Looks up a salary.",
              input_schema: {
                type: "object",
                properties: { employee: { type: "string" } },
                required: ["employee"],
              },
            },
          ],
          messages: [
            {
              role: "assistant",
              content: [
                {
                  type: "tool_use",
                  id: "toolu_01Real",
                  name: "PayrollLookup",
                  input: { employee: "Jane Doe", year: 2026 },
                },
              ],
            },
          ],
        }),
      }),
      fakes,
    );
    const chat = Scrubber.scrub(
      "openai-chat",
      exchange({
        path: "/chat/completions",
        body: json({
          messages: [
            {
              role: "assistant",
              tool_calls: [
                {
                  id: "call_real",
                  type: "function",
                  function: {
                    name: "read",
                    arguments: '{"path": "/home/jane/notes.txt", "lines": 3}',
                  },
                },
              ],
            },
          ],
        }),
      }),
      fakes,
    );

    expect([anthropic.request.body, chat.request.body]).toEqual([
      json({
        tools: [
          {
            name: "scrubbed:m",
            description: "scrubbed:m",
            input_schema: {
              "scrubbed-key-1": "scrubbed:s",
              "scrubbed-key-2": {
                "scrubbed-key-1": { "scrubbed-key-1": "scrubbed:s" },
              },
              "scrubbed-key-3": ["scrubbed:s"],
            },
          },
        ],
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_FAKE0001",
                name: "scrubbed:m",
                input: { "scrubbed-key-1": "scrubbed:s", "scrubbed-key-2": 0 },
              },
            ],
          },
        ],
      }),
      json({
        messages: [
          {
            role: "assistant",
            tool_calls: [
              {
                id: "call_FAKE0002",
                type: "function",
                function: {
                  name: "scrubbed:s",
                  arguments:
                    '{"scrubbed-key-1":"scrubbed:m","scrubbed-key-2":0}',
                },
              },
            ],
          },
        ],
      }),
    ]);
  });

  it("scrubs the JSON inside metadata.user_id, and gives its session the fake the session header gets", () => {
    const session = "0f6c1a52-7a3e-4c55-9d0e-c4553e7d1a99";
    const scrubbed = Scrubber.scrub(
      "anthropic-messages",
      exchange({
        headers: { "x-claude-code-session-id": session },
        body: json({
          metadata: {
            user_id: JSON.stringify({
              device_id: "d3v1ce-real",
              account_uuid: "11111111-2222-4333-8444-555555555555",
              session_id: session,
              team: "payroll",
            }),
          },
        }),
      }),
      Scrubber.makeFakes(),
    );

    expect(scrubbed).toEqual(
      exchange({
        headers: {
          "x-claude-code-session-id": "00000000-0000-4000-8000-000000000001",
        },
        body: json({
          metadata: {
            user_id:
              '{"device_id":"fake-id-0002","account_uuid":"00000000-0000-4000-8000-000000000003","session_id":"00000000-0000-4000-8000-000000000001","scrubbed-key-1":"scrubbed:s"}',
          },
        }),
      }),
    );
  });

  it("scrubs Codex's turn metadata inside, in its header and in the body, and keeps its request kind", () => {
    const metadata = JSON.stringify({
      session_id: "019a-session",
      turn_id: "019a-turn",
      request_kind: "compaction",
      workspaces: {
        "/Users/jane/acme": {
          associated_remote_urls: { origin: "git@github.com:jane/acme.git" },
        },
      },
    });
    const scrubbed = Scrubber.scrub(
      "chatgpt-codex",
      exchange({
        path: "/backend-api/codex/responses",
        headers: { "x-codex-turn-metadata": metadata },
        body: json({
          client_metadata: {
            session_id: "019a-session",
            "x-codex-turn-metadata": metadata,
          },
        }),
      }),
      Scrubber.makeFakes(),
    );
    const scrubbedMetadata =
      '{"session_id":"fake-id-0001","turn_id":"fake-id-0002","request_kind":"compaction","workspaces":{"scrubbed-key-1":{"scrubbed-key-1":{"scrubbed-key-1":"scrubbed:m"}}}}';

    expect(scrubbed).toEqual(
      exchange({
        path: "/backend-api/codex/responses",
        headers: { "x-codex-turn-metadata": scrubbedMetadata },
        body: json({
          client_metadata: {
            session_id: "fake-id-0001",
            "x-codex-turn-metadata": scrubbedMetadata,
          },
        }),
      }),
    );
  });

  it("scrubs a tool's input spread over stream deltas so that the deltas of each block still join into JSON of the same shape", () => {
    const anthropic = Scrubber.scrub(
      "anthropic-messages",
      exchange(
        {},
        {
          body: {
            events: [
              {
                event: "content_block_delta",
                data: {
                  type: "content_block_delta",
                  index: 2,
                  delta: { type: "input_json_delta", partial_json: "" },
                },
              },
              {
                event: "content_block_delta",
                data: {
                  type: "content_block_delta",
                  index: 2,
                  delta: {
                    type: "input_json_delta",
                    partial_json: '{"file_path": "/home/',
                  },
                },
              },
              {
                event: "content_block_delta",
                data: {
                  type: "content_block_delta",
                  index: 2,
                  delta: {
                    type: "input_json_delta",
                    partial_json: 'jane/notes.txt", "limit": 40}',
                  },
                },
              },
            ],
          },
        },
      ),
      Scrubber.makeFakes(),
    );
    const codex = Scrubber.scrub(
      "chatgpt-codex",
      exchange(
        { path: "/backend-api/codex/responses" },
        {
          body: {
            events: ['{"cmd": ["cat", ', '"/etc/hosts"]}'].map((delta) => ({
              data: {
                type: "response.function_call_arguments.delta",
                item_id: "fc_1",
                delta,
              },
            })),
          },
        },
      ),
      Scrubber.makeFakes(),
    );
    const chat = Scrubber.scrub(
      "openai-chat",
      exchange(
        { path: "/chat/completions" },
        {
          body: {
            events: ['{"q":', ' "acme payroll"}', "[DONE]"].map((each) =>
              each === "[DONE]"
                ? { data: each }
                : {
                    data: {
                      choices: [
                        {
                          index: 0,
                          delta: {
                            tool_calls: [
                              { index: 0, function: { arguments: each } },
                            ],
                          },
                        },
                      ],
                    },
                  },
            ),
          },
        },
      ),
      Scrubber.makeFakes(),
    );
    const deltas = (
      body: ExchangeFile.Body | undefined,
      pick: (data: Schema.Json) => unknown,
    ) =>
      body !== undefined && "events" in body
        ? body.events.map(({ data }) => pick(data))
        : [];
    const field =
      (...path: ReadonlyArray<string | number>) =>
      (data: Schema.Json) =>
        path.reduce<unknown>(
          (value, step) =>
            typeof value === "object" && value !== null
              ? Reflect.get(value, step)
              : undefined,
          data,
        );

    expect([
      deltas(anthropic.response.body, field("delta", "partial_json")),
      deltas(codex.response.body, field("delta")),
      deltas(
        chat.response.body,
        field("choices", 0, "delta", "tool_calls", 0, "function", "arguments"),
      ),
    ]).toEqual([
      ["", '{"scrubbed-key-1":"sc', 'rubbed:m","scrubbed-key-2":0}'],
      ['{"scrubbed-key-1":["scrub', 'bed:s","scrubbed:m"]}'],
      ['{"scrub', 'bed-key-1":"scrubbed:m"}', undefined],
    ]);
  });

  it("replaces a JWT login by a made-up JWT whose payload holds only the fakes of the claims the fingerprint reads", () => {
    const real = `${base64Url({ alg: "RS256", kid: "real" })}.${base64Url({
      email: "jane@example.com",
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct-real-1",
        chatgpt_account_user_id: "user-real__acct-real-1",
        chatgpt_plan_type: "pro",
      },
      exp: 1794441600,
    })}.c2lnbmF0dXJl`;
    const scrubbed = Scrubber.scrub(
      "chatgpt-codex",
      exchange({
        path: "/backend-api/codex/responses",
        headers: {
          authorization: `Bearer ${real}`,
          "chatgpt-account-id": "acct-real-1",
        },
      }),
      Scrubber.makeFakes(),
    );
    const token = (scrubbed.request.headers.authorization ?? "").slice(
      "Bearer ".length,
    );

    expect({
      headers: scrubbed.request.headers,
      payload: payloadOf(token),
    }).toEqual({
      headers: {
        authorization: `Bearer ${base64Url({ alg: "RS256", typ: "JWT" })}.${base64Url(
          {
            "https://api.openai.com/auth": {
              chatgpt_account_id: "fake-id-0001",
              chatgpt_account_user_id: "fake-id-0002",
            },
          },
        )}.${Buffer.from("FAKE-signature-for-tests-only").toString("base64url")}`,
        "chatgpt-account-id": "fake-id-0001",
      },
      payload: {
        "https://api.openai.com/auth": {
          chatgpt_account_id: "fake-id-0001",
          chatgpt_account_user_id: "fake-id-0002",
        },
      },
    });
  });

  it("gives every login a fixed fake: the same login the same fake within a run, another login the next one", () => {
    const fakes = Scrubber.makeFakes();
    const loginOf = (
      protocol: "anthropic-messages" | "openai-chat",
      headers: Record<string, string>,
    ) => Scrubber.scrub(protocol, exchange({ headers }), fakes).request.headers;

    expect([
      loginOf("anthropic-messages", {
        authorization: "Bearer sk-ant-oat01-work",
      }),
      loginOf("anthropic-messages", {
        authorization: "Bearer sk-ant-oat01-personal",
      }),
      loginOf("anthropic-messages", {
        authorization: "Bearer sk-ant-oat01-work",
      }),
      loginOf("anthropic-messages", { "x-api-key": "sk-ant-api03-key" }),
      loginOf("openai-chat", { authorization: "Bearer cota-hub-key" }),
    ]).toEqual([
      {
        authorization: "Bearer sk-ant-oat01-FAKE-login-for-tests-only-0000",
      },
      {
        authorization: "Bearer sk-ant-oat01-FAKE-login-for-tests-only-0001",
      },
      {
        authorization: "Bearer sk-ant-oat01-FAKE-login-for-tests-only-0000",
      },
      { "x-api-key": "sk-ant-api03-FAKE-key-for-tests-only-0002" },
      { authorization: "Bearer cota-FAKE-hub-key-for-tests-0003" },
    ]);
  });

  it("gives identifiers fakes counted in the order they are first seen, the same fake for the same value, with their prefix or UUID shape kept", () => {
    const run = (values: ReadonlyArray<string>) => {
      const fakes = Scrubber.makeFakes();
      return values.map(fakes.identifier);
    };

    expect([
      run([
        "ses_a",
        "toolu_01b",
        "ses_a",
        "6f1d2c3b-0000-4abc-8def-0123456789ab",
        "plain",
      ]),
      run(["toolu_99z", "ses_q"]),
    ]).toEqual([
      [
        "ses_FAKE0001",
        "toolu_FAKE0002",
        "ses_FAKE0001",
        "00000000-0000-4000-8000-000000000003",
        "fake-id-0004",
      ],
      ["toolu_FAKE0001", "ses_FAKE0002"],
    ]);
  });

  it("replaces encrypted content, thinking signatures, image data and base64 bodies", () => {
    const fakes = Scrubber.makeFakes();
    const anthropic = Scrubber.scrub(
      "anthropic-messages",
      exchange({
        body: json({
          messages: [
            {
              role: "assistant",
              content: [
                {
                  type: "thinking",
                  thinking: "hmm",
                  signature: "EqQBCgIYAhIM",
                },
                { type: "redacted_thinking", data: "EmwKAhgBEgy3" },
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: "image/png",
                    data: "iVBORw0KGgo=",
                  },
                },
              ],
            },
          ],
        }),
      }),
      fakes,
    );
    const codex = Scrubber.scrub(
      "chatgpt-codex",
      exchange(
        { path: "/backend-api/codex/responses" },
        {
          body: json({
            type: "reasoning",
            summary: [],
            encrypted_content: "gAAAAABo-real-ciphertext",
          }),
        },
      ),
      fakes,
    );
    const binary = Scrubber.scrub(
      "openai-chat",
      exchange({}, { body: { base64: "AAECAwQ=" } }),
      fakes,
    );

    expect([
      anthropic.request.body,
      codex.response.body,
      binary.response.body,
    ]).toEqual([
      json({
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "thinking",
                thinking: "scrubbed:s",
                signature: "scrubbed:m",
              },
              { type: "redacted_thinking", data: "scrubbed:m" },
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: "scrubbed:m",
                },
              },
            ],
          },
        ],
      }),
      json({ type: "reasoning", summary: [], encrypted_content: "scrubbed:m" }),
      { text: "scrubbed:s" },
    ]);
  });

  it("keeps of an error body only its type and code", () => {
    const fakes = Scrubber.makeFakes();
    const bodyOf = (
      protocol: "anthropic-messages" | "openai-chat",
      body: Schema.Json,
    ) =>
      Scrubber.scrub(
        protocol,
        exchange({}, { status: 429, body: json(body) }),
        fakes,
      ).response.body;

    expect([
      bodyOf("anthropic-messages", {
        type: "error",
        error: {
          type: "rate_limit_error",
          message: "Jane's org acme is over its limit",
        },
        request_id: "req_011Real",
      }),
      bodyOf("openai-chat", {
        error: {
          code: "1308",
          message: "Usage limit reached, resets 2026-11-12 10:00",
          type: "GoUsageLimitError",
        },
      }),
      bodyOf("openai-chat", {
        error: { message: "nope", type: "Jane's error" },
      }),
    ]).toEqual([
      json({
        type: "error",
        error: { type: "rate_limit_error", message: "scrubbed:m" },
        request_id: "req_FAKE0001",
      }),
      json({
        error: {
          code: "1308",
          message: "scrubbed:m",
          type: "GoUsageLimitError",
        },
      }),
      json({ error: { message: "scrubbed:s", type: "scrubbed:m" } }),
    ]);
  });

  it("keeps a code only where it is an error's, beside a message, and not where it is what a tool ran", () => {
    const scrubbed = Scrubber.scrub(
      "chatgpt-codex",
      exchange(
        {},
        {
          status: 200,
          body: json({
            error: { code: "rate_limit_exceeded", message: "Slow down, Jane" },
            output: [
              { type: "code_interpreter_call", code: "build.acme.internal" },
            ],
          }),
        },
      ),
      Scrubber.makeFakes(),
    ).response.body;

    expect(scrubbed).toEqual(
      json({
        error: { code: "rate_limit_exceeded", message: "scrubbed:m" },
        output: [{ type: "scrubbed:m", code: "scrubbed:m" }],
      }),
    );
  });

  it("replaces a number under an identifier key, and keeps token counts and times", () => {
    const scrubbed = Scrubber.scrub(
      "openai-chat",
      exchange(
        {
          path: "/chat/completions",
          body: json({ user: 734001, max_tokens: 32000 }),
        },
        {
          body: json({
            id: 1234,
            created: 1794441600,
            usage: { prompt_tokens: 100 },
          }),
        },
      ),
      Scrubber.makeFakes(),
    );

    expect([scrubbed.request.body, scrubbed.response.body]).toEqual([
      json({ user: 1000001, max_tokens: 32000 }),
      json({ id: 1000002, created: 1794441600, usage: { prompt_tokens: 100 } }),
    ]);
  });

  it("keeps a header only when the hub or a replay needs it, its value only when it is a word of the protocol, and drops every other header with its name", () => {
    const scrubbed = Scrubber.scrub(
      "anthropic-messages",
      exchange(
        {
          path: "/v1/messages?beta=true&org=acme",
          headers: {
            "content-type": "application/json",
            "anthropic-version": "2023-06-01",
            "anthropic-beta":
              "claude-code-20250219,oauth-2025-04-20,acme-internal",
            "user-agent":
              "claude-cli/2.1.322 (external, cli, client-app/acme-desk)",
            "x-app": "cli",
            "x-stainless-retry-count": "0",
            "x-stainless-os": "MacOS",
            "x-claude-code-request-class": "main",
            "x-claude-code-agent-type": "payroll-bot",
            "x-cota-key": "the-hub-key",
            "x-cota-project": "acme/payroll",
            cookie: "session=abc",
            "x-acme-trace": "jane",
          },
        },
        {
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "request-id": "req_011Real",
            "anthropic-organization-id": "org-real",
            "anthropic-ratelimit-unified-status": "allowed",
            "anthropic-ratelimit-unified-5h-utilization": "0.12",
            "anthropic-ratelimit-unified-overage-disabled-reason":
              "Jane turned it off",
            "set-cookie": "__cf_bm=real",
            server: "cloudflare",
          },
        },
      ),
      Scrubber.makeFakes(),
    );

    expect([
      scrubbed.request.path,
      scrubbed.request.headers,
      scrubbed.response.headers,
    ]).toEqual([
      "/v1/messages?beta=true",
      {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "claude-code-20250219,oauth-2025-04-20",
        "user-agent": "claude-cli/2.1.322",
        "x-app": "cli",
        "x-stainless-retry-count": "0",
        "x-claude-code-request-class": "main",
        "x-claude-code-agent-type": "scrubbed:m",
      },
      {
        "content-type": "text/event-stream; charset=utf-8",
        "request-id": "req_FAKE0001",
        "anthropic-organization-id": "fake-id-0002",
        "anthropic-ratelimit-unified-status": "allowed",
        "anthropic-ratelimit-unified-5h-utilization": "0",
        "anthropic-ratelimit-unified-overage-disabled-reason": "scrubbed:m",
      },
    ]);
  });

  it("keeps only the shape of a quota header's value, which says what plan its owner has and how much of it is used, and the status a refusal is told by", () => {
    const quotaOf = (protocol: ProtocolName, headers: Record<string, string>) =>
      Scrubber.scrub(protocol, exchange({}, { headers }), Scrubber.makeFakes())
        .response.headers;

    expect([
      quotaOf("anthropic-messages", {
        "anthropic-ratelimit-unified-status": "rejected",
        "anthropic-ratelimit-unified-reset": "1794888000",
        "anthropic-ratelimit-unified-7d-utilization": "0.49",
        "anthropic-ratelimit-unified-7d-status": "allowed",
        "anthropic-ratelimit-unified-representative-claim": "seven_day",
      }),
      quotaOf("chatgpt-codex", {
        "x-codex-plan-type": "pro",
        "x-codex-credits-balance": "62500.0000000000",
        "x-codex-primary-used-percent": "3",
        "x-codex-primary-reset-at": "1795028373",
        "x-codex-credits-has-credits": "True",
      }),
    ]).toEqual([
      {
        "anthropic-ratelimit-unified-status": "rejected",
        "anthropic-ratelimit-unified-reset": "1800000000",
        "anthropic-ratelimit-unified-7d-utilization": "0",
        "anthropic-ratelimit-unified-7d-status": "scrubbed:s",
        "anthropic-ratelimit-unified-representative-claim": "scrubbed:m",
      },
      {
        "x-codex-plan-type": "scrubbed:s",
        "x-codex-credits-balance": "0",
        "x-codex-primary-used-percent": "0",
        "x-codex-primary-reset-at": "1800000000",
        "x-codex-credits-has-credits": "scrubbed:s",
      },
    ]);
  });

  it("keeps a user agent only as the first product of a client Cota knows", () => {
    const agentOf = (agent: string) =>
      Scrubber.scrub(
        "chatgpt-codex",
        exchange({ headers: { "user-agent": agent } }),
        Scrubber.makeFakes(),
      ).request.headers["user-agent"];

    expect([
      agentOf("codex_cli_rs/0.167.1 (Mac OS 26.1.0; arm64) iTerm.app/3.6.6"),
      agentOf("opencode/1.19.5 ai-sdk/provider-utils/4.0.23 runtime/bun/1.4.2"),
      agentOf("acme-payroll-agent/2.0 (jane)"),
    ]).toEqual(["codex_cli_rs/0.167.1", "opencode/1.19.5", "scrubbed:m"]);
  });

  it("replaces the segments of a path the protocol does not serve, and every query parameter it does not know", () => {
    const pathOf = (
      protocol: "anthropic-messages" | "chatgpt-codex",
      path: string,
    ) =>
      Scrubber.scrub(protocol, exchange({ path }), Scrubber.makeFakes()).request
        .path;

    expect([
      pathOf("anthropic-messages", "/v1/files/file_jane_taxes/content"),
      pathOf(
        "chatgpt-codex",
        "/backend-api/codex/models?client_version=0.167.1&user=jane",
      ),
    ]).toEqual([
      "/v1/scrubbed/scrubbed/scrubbed",
      "/backend-api/codex/models?client_version=0.167.1",
    ]);
  });

  it("keeps the one word of Claude Code's quota probe", () => {
    const scrubbed = Scrubber.scrub(
      "anthropic-messages",
      exchange({
        body: json({
          max_tokens: 1,
          messages: [{ role: "user", content: "quota" }],
        }),
      }),
      Scrubber.makeFakes(),
    );

    expect(scrubbed.request.body).toEqual(
      json({ max_tokens: 1, messages: [{ role: "user", content: "quota" }] }),
    );
  });

  it("names a recorded exchange's client and version from a user agent Cota knows, and no other", () => {
    expect([
      Scrubber.sourceOf(
        { "user-agent": "claude-cli/2.1.322 (external, cli)" },
        "2026-11-12",
      ),
      Scrubber.sourceOf({ "user-agent": "acme-agent/1.0" }, "2026-11-12"),
    ]).toEqual([
      {
        kind: "recorded",
        date: "2026-11-12",
        client: "claude-code",
        version: "2.1.322",
      },
      { kind: "recorded", date: "2026-11-12", client: "unknown", version: "" },
    ]);
  });

  it("lists for review every string an exchange file holds, its keys and what is inside JSON strings and JWTs, and no filler", () => {
    const token = `${base64Url({ alg: "RS256" })}.${base64Url({ sub: "left-in-a-jwt" })}.c2ln`;
    expect(
      Strings.stringsOf({
        request: {
          headers: { authorization: `Bearer ${token}` },
          body: {
            json: {
              metadata: { user_id: '{"device_id":"left-in-json"}' },
              "scrubbed-key-1": "scrubbed:m",
            },
          },
        },
      }).map(({ text }) => text),
    ).toEqual([
      "request",
      "headers",
      "authorization",
      `Bearer ${token}`,
      "alg",
      "RS256",
      "sub",
      "left-in-a-jwt",
      "body",
      "json",
      "metadata",
      "user_id",
      '{"device_id":"left-in-json"}',
      "device_id",
      "left-in-json",
    ]);
  });
});
