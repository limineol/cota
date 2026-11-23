import { Option, Schema } from "effect";
import type * as ExchangeFile from "#modules/recording/03-domain/exchange-file.ts";
import type * as Conversation from "#shared/03-domain/conversation.ts";
import type { ProtocolName } from "#shared/03-domain/protocol-name.ts";
import type * as Request from "#shared/03-domain/request.entity.ts";
import type * as Replay from "#shared/05-tests/replay/replay.ts";

type Json = Schema.Json;

/** Every string a generated exchange holds that is not a word of its protocol carries this, in any case. */
export const marker = /zebra/i;

const tails = [
  "",
  " notes.txt",
  ' "quoted" \\ back',
  "\nline two",
  " é😀",
  " </script>",
  " /Users/jane/acme",
];

/** A seeded source of choices and of marked strings. */
export interface Generator {
  readonly int: (minimum: number, maximum: number) => number;
  readonly flag: () => boolean;
  readonly pick: <A>(values: ReadonlyArray<A>) => A;
  readonly mark: () => string;
  readonly text: () => string;
  readonly word: () => string;
  readonly key: () => string;
  readonly id: (prefix?: string) => string;
}

export const generator = (seed: number): Generator => {
  let state = seed >>> 0;
  let count = 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (minimum: number, maximum: number) =>
    minimum + Math.floor(next() * (maximum - minimum + 1));
  const pick = <A>(values: ReadonlyArray<A>): A => {
    const value = values[int(0, values.length - 1)];
    if (value === undefined) throw new Error("nothing to pick from");
    return value;
  };
  const mark = () => {
    count++;
    return `${next() < 0.5 ? "zebra" : "ZEBRA"}${count}`;
  };
  return {
    int,
    flag: () => next() < 0.5,
    pick,
    mark,
    text: () => {
      const text = `${mark()}${pick(tails)}`;
      return next() < 0.1 ? text.repeat(int(40, 120)) : text;
    },
    word: () => `${mark()}-value`,
    key: () => `${mark()}_key`,
    id: (prefix = "") => `${prefix}${mark()}x`,
  };
};

const cutInto = (g: Generator, text: string): ReadonlyArray<string> => {
  const points = Array.from({ length: g.int(0, 3) }, () =>
    g.int(1, Math.max(1, text.length - 1)),
  ).sort((a, b) => a - b);
  return [0, ...points].map((from, index) =>
    text.slice(from, points[index] ?? text.length),
  );
};

const unknownHeaders = (g: Generator): Record<string, string> => ({
  [`x-${g.mark().toLowerCase()}-private`]: g.word(),
});

const hubHeaders = (g: Generator): Record<string, string> => ({
  "x-cota-key": g.word(),
  "x-cota-project": g.word(),
  "x-cota-machine": g.word(),
  cookie: `session=${g.word()}`,
});

const asciiJson = (value: Json): string =>
  JSON.stringify(value).replace(
    /[^\x20-\x7e]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );

const base64Url = (value: Json) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

const anthropicModels = [
  "claude-opus-5-5",
  "claude-sonnet-5",
  "claude-haiku-4-5",
];

const anthropicRequest = (
  g: Generator,
  operation: string,
  stream: boolean,
  session: string,
): Json => {
  if (operation === "models") return null;
  if (g.int(0, 9) === 0) {
    return {
      model: g.pick(anthropicModels),
      max_tokens: 1,
      messages: [{ role: "user", content: "quota" }],
    };
  }
  const toolId = g.id("toolu_");
  return {
    model: g.pick(anthropicModels),
    messages: [
      { role: "user", content: g.text() },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: g.text(), signature: g.word() },
          { type: "redacted_thinking", data: g.word() },
          { type: "text", text: g.text() },
          {
            type: "tool_use",
            id: toolId,
            name: g.text(),
            input: { [g.key()]: g.text(), [g.key()]: [g.text(), g.int(0, 9)] },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: toolId,
            content: g.flag() ? g.text() : [{ type: "text", text: g.text() }],
            is_error: g.flag(),
          },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: Buffer.from(g.text()).toString("base64"),
            },
          },
          {
            type: "text",
            text: g.text(),
            cache_control: { type: "ephemeral", ttl: "1h" },
          },
        ],
      },
    ],
    system: [
      { type: "text", text: g.text() },
      {
        type: "text",
        text: g.text(),
        cache_control: { type: "ephemeral", ttl: "1h" },
      },
    ],
    tools: [
      {
        name: g.text(),
        description: g.text(),
        input_schema: {
          type: "object",
          properties: { [g.key()]: { type: "string", description: g.text() } },
          required: [g.text()],
        },
      },
    ],
    metadata: {
      user_id: JSON.stringify({
        device_id: g.id(),
        account_uuid: g.id(),
        session_id: session,
        [g.key()]: g.text(),
      }),
    },
    max_tokens: g.int(1000, 64000),
    thinking: { type: "adaptive" },
    ...(operation === "messages" ? { stream } : {}),
    [g.key()]: { [g.key()]: g.text(), [g.key()]: g.int(1, 99) },
  };
};

const anthropicEvents = (
  g: Generator,
  model: string,
): Array<ExchangeFile.Event> => {
  const event = (data: Schema.JsonObject): ExchangeFile.Event => ({
    event: String(data.type),
    data,
  });
  const input = JSON.stringify({
    [g.key()]: g.text(),
    [g.key()]: [g.text(), g.int(0, 99)],
  });
  const events: Array<ExchangeFile.Event> = [
    event({
      type: "message_start",
      message: {
        id: g.id("msg_"),
        type: "message",
        role: "assistant",
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: g.int(1, 99),
          cache_creation_input_tokens: g.int(0, 3000),
          cache_read_input_tokens: g.int(0, 30000),
          cache_creation: {
            ephemeral_5m_input_tokens: g.int(0, 1000),
            ephemeral_1h_input_tokens: g.int(0, 2000),
          },
          output_tokens: 1,
          service_tier: "standard",
        },
      },
    }),
    event({
      type: "content_block_start",
      index: 0,
      content_block: { type: "thinking", thinking: "", signature: "" },
    }),
    event({
      type: "content_block_delta",
      index: 0,
      delta: { type: "thinking_delta", thinking: g.text() },
    }),
    event({
      type: "content_block_delta",
      index: 0,
      delta: { type: "signature_delta", signature: g.word() },
    }),
    event({ type: "content_block_stop", index: 0 }),
    event({ type: "ping" }),
    event({
      type: "content_block_start",
      index: 1,
      content_block: { type: "text", text: "" },
    }),
    ...Array.from({ length: g.int(1, 3) }, () =>
      event({
        type: "content_block_delta",
        index: 1,
        delta: { type: "text_delta", text: g.text() },
      }),
    ),
    event({ type: "content_block_stop", index: 1 }),
    event({
      type: "content_block_start",
      index: 2,
      content_block: {
        type: "tool_use",
        id: g.id("toolu_"),
        name: g.text(),
        input: {},
      },
    }),
    ...["", ...cutInto(g, input)].map((partial_json) =>
      event({
        type: "content_block_delta",
        index: 2,
        delta: { type: "input_json_delta", partial_json },
      }),
    ),
    event({ type: "content_block_stop", index: 2 }),
    {
      event: `${g.mark()}_event`,
      data: { type: `${g.mark()}_event`, [g.key()]: g.text() },
    },
    { data: g.word() },
  ];
  if (g.int(0, 4) === 0) {
    return [
      ...events,
      event({
        type: "error",
        error: { type: "overloaded_error", message: g.text() },
      }),
    ];
  }
  return [
    ...events,
    event({
      type: "message_delta",
      delta: {
        stop_reason: g.pick(["end_turn", "tool_use", "max_tokens"]),
        stop_sequence: null,
      },
      usage: {
        output_tokens: g.int(1, 999),
        output_tokens_details: { thinking_tokens: g.int(0, 99) },
      },
    }),
    event({ type: "message_stop" }),
  ];
};

const anthropic = (g: Generator): ExchangeFile.Exchange => {
  const operation = g.pick([
    "messages",
    "messages",
    "messages",
    "count_tokens",
    "models",
  ]);
  const stream = operation === "messages" && g.flag();
  const session = g.id();
  const body = anthropicRequest(g, operation, stream, session);
  const model = g.pick(anthropicModels);
  const path =
    operation === "messages"
      ? "/v1/messages"
      : operation === "count_tokens"
        ? "/v1/messages/count_tokens"
        : "/v1/models";
  const status = g.pick([200, 200, 200, 429, 500, 529]);
  const refused = status === 429 && g.flag();
  const quota = {
    "anthropic-ratelimit-unified-status": refused ? "rejected" : "allowed",
    "anthropic-ratelimit-unified-5h-utilization": "0.12",
    "anthropic-ratelimit-unified-reset": "1794477600",
    "anthropic-ratelimit-unified-representative-claim": "five_hour",
  };
  const responseHeaders = {
    "content-type":
      stream && status === 200
        ? "text/event-stream; charset=utf-8"
        : "application/json",
    "request-id": g.id("req_"),
    "anthropic-organization-id": g.id(),
    "set-cookie": `__cf_bm=${g.word()}`,
    ...quota,
    ...unknownHeaders(g),
  };
  const response = (): ExchangeFile.Body => {
    if (status !== 200) {
      return {
        json: {
          type: "error",
          error: {
            type: g.pick(["rate_limit_error", "api_error", "overloaded_error"]),
            message: g.text(),
          },
          request_id: g.id("req_"),
        },
      };
    }
    if (operation === "count_tokens")
      return { json: { input_tokens: g.int(1, 9999) } };
    if (operation === "models") {
      return {
        json: {
          data: [
            {
              type: "model",
              id: g.id(),
              display_name: g.text(),
              created_at: g.word(),
            },
          ],
          has_more: false,
          first_id: g.id(),
          last_id: g.id(),
        },
      };
    }
    if (stream) return { events: anthropicEvents(g, model) };
    return {
      json: {
        id: g.id("msg_"),
        type: "message",
        role: "assistant",
        model,
        content: [
          { type: "text", text: g.text() },
          {
            type: "tool_use",
            id: g.id("toolu_"),
            name: g.text(),
            input: { [g.key()]: g.text() },
          },
        ],
        stop_reason: "tool_use",
        stop_sequence: null,
        usage: { input_tokens: g.int(1, 99), output_tokens: g.int(1, 99) },
      },
    };
  };
  return {
    request: {
      method: operation === "models" ? "GET" : "POST",
      path: `${path}?beta=true${g.flag() ? `&${g.mark()}=${g.mark()}` : ""}`,
      headers: {
        authorization: `Bearer sk-ant-oat01-${g.mark()}`,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "claude-code-20250219,oauth-2025-04-20",
        "content-type": "application/json",
        "user-agent": `claude-cli/2.1.322 (external, cli, client-app/${g.mark()})`,
        "x-app": "cli",
        "x-stainless-retry-count": "0",
        "x-stainless-os": g.word(),
        "x-claude-code-session-id": session,
        "x-claude-code-agent-id": g.id(),
        "x-claude-code-request-class": g.pick([
          "main",
          "subagent",
          "compaction",
        ]),
        "x-claude-code-agent-type": g.word(),
        ...hubHeaders(g),
        ...unknownHeaders(g),
      },
      ...(body === null ? {} : { body: { json: body } }),
    },
    response: { status, headers: responseHeaders, body: response() },
  };
};

const codexModels = ["gpt-5.5-codex", "gpt-5.4"];

const codexEvents = (
  g: Generator,
  model: string,
): Array<ExchangeFile.Event> => {
  const event = (data: Schema.JsonObject): ExchangeFile.Event => ({
    event: String(data.type),
    data,
  });
  const callId = g.id("call_");
  const itemId = g.id("fc_");
  const name = g.text();
  const args = JSON.stringify({ [g.key()]: [g.text(), g.int(0, 9)] });
  const usage = {
    input_tokens: g.int(100, 999),
    input_tokens_details: { cached_tokens: g.int(0, 99) },
    output_tokens: g.int(1, 99),
    output_tokens_details: { reasoning_tokens: g.int(0, 9) },
    total_tokens: g.int(100, 1099),
  };
  const message = {
    type: "message",
    id: g.id("msg_"),
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: g.text(), annotations: [] }],
  };
  const call = {
    type: "function_call",
    id: itemId,
    status: "completed",
    name,
    arguments: args,
    call_id: callId,
  };
  const terminal = g.pick(["completed", "completed", "incomplete", "failed"]);
  return [
    event({
      type: "response.created",
      sequence_number: 0,
      response: { id: g.id("resp_"), status: "in_progress", model },
    }),
    event({
      type: "response.metadata",
      headers: {
        "openai-model": model,
        "x-codex-turn-state": g.word(),
        [`x-${g.mark().toLowerCase()}`]: g.word(),
      },
    }),
    event({
      type: "response.reasoning_summary_text.delta",
      item_id: g.id("rs_"),
      delta: g.text(),
    }),
    event({
      type: "response.output_item.done",
      output_index: 0,
      item: {
        type: "reasoning",
        id: g.id("rs_"),
        summary: [{ type: "summary_text", text: g.text() }],
        encrypted_content: g.word(),
      },
    }),
    event({
      type: "response.output_text.delta",
      item_id: message.id,
      output_index: 1,
      content_index: 0,
      delta: g.text(),
    }),
    event({
      type: "response.output_item.done",
      output_index: 1,
      item: message,
    }),
    ...cutInto(g, args).map((delta) =>
      event({
        type: "response.function_call_arguments.delta",
        item_id: itemId,
        output_index: 2,
        delta,
      }),
    ),
    event({
      type: "response.function_call_arguments.done",
      item_id: itemId,
      output_index: 2,
      arguments: args,
    }),
    event({ type: "response.output_item.done", output_index: 2, item: call }),
    {
      event: `${g.mark()}.event`,
      data: { type: `${g.mark()}.event`, [g.key()]: g.text() },
    },
    terminal === "completed"
      ? event({
          type: "response.completed",
          response: {
            id: g.id("resp_"),
            status: "completed",
            usage,
            end_turn: true,
          },
        })
      : terminal === "incomplete"
        ? event({
            type: "response.incomplete",
            response: {
              id: g.id("resp_"),
              status: "incomplete",
              incomplete_details: { reason: "max_output_tokens" },
              usage,
            },
          })
        : event({
            type: "response.failed",
            response: {
              id: g.id("resp_"),
              status: "failed",
              error: { code: "server_error", message: g.text() },
            },
          }),
  ];
};

const codex = (g: Generator): ExchangeFile.Exchange => {
  const operation = g.pick(["responses", "responses", "responses", "models"]);
  const session = g.id();
  const account = g.id();
  const metadata = asciiJson({
    session_id: session,
    turn_id: g.id(),
    request_kind: g.pick(["turn", "compaction"]),
    sandbox: g.word(),
    workspaces: {
      [`/Users/${g.mark()}/acme`]: {
        associated_remote_urls: { origin: g.text() },
        latest_git_commit_hash: g.word(),
        has_changes: true,
      },
    },
    [g.key()]: g.text(),
  });
  const model = g.pick(codexModels);
  const status = g.pick([200, 200, 200, 429, 401]);
  const token = `${base64Url({ alg: "RS256", kid: g.mark() })}.${base64Url({
    email: `${g.mark()}@example.com`,
    sub: g.id(),
    "https://api.openai.com/auth": {
      chatgpt_account_id: account,
      chatgpt_account_user_id: `${g.id()}__${account}`,
      chatgpt_plan_type: g.word(),
    },
  })}.${Buffer.from(g.word()).toString("base64url")}`;
  const subagent = g.flag() ? { "x-openai-subagent": "review" } : {};
  const zstd = g.flag() ? { "content-encoding": "zstd" } : {};
  const body: Json =
    operation === "models"
      ? null
      : {
          model,
          stream: true,
          input: [
            {
              type: "message",
              role: "developer",
              content: [{ type: "input_text", text: g.text() }],
            },
            {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: g.text() }],
            },
            {
              type: "reasoning",
              id: g.id("rs_"),
              summary: [{ type: "summary_text", text: g.text() }],
              encrypted_content: g.word(),
            },
            {
              type: "function_call",
              id: g.id("fc_"),
              name: g.text(),
              arguments: JSON.stringify({ [g.key()]: g.text() }),
              call_id: g.id("call_"),
            },
            {
              type: "function_call_output",
              call_id: g.id("call_"),
              output: g.text(),
            },
            {
              type: "custom_tool_call",
              call_id: g.id("call_"),
              name: g.text(),
              input: g.text(),
            },
          ],
          tools: [
            {
              type: "function",
              name: g.text(),
              description: g.text(),
              strict: false,
              parameters: {
                type: "object",
                properties: { [g.key()]: { type: "string" } },
              },
            },
          ],
          tool_choice: "auto",
          parallel_tool_calls: true,
          reasoning: { effort: "medium", summary: "auto" },
          store: false,
          include: ["reasoning.encrypted_content"],
          prompt_cache_key: session,
          client_metadata: {
            session_id: session,
            "x-codex-turn-metadata": metadata,
            [g.key()]: g.text(),
          },
          [g.key()]: g.text(),
        };
  const response = (): ExchangeFile.Body => {
    if (status === 429) {
      return {
        json: {
          error: {
            type: "usage_limit_reached",
            message: g.text(),
            plan_type: g.word(),
            resets_at: 1794477600,
          },
        },
      };
    }
    if (status === 401) {
      return { json: { error: { code: "token_expired", message: g.text() } } };
    }
    if (operation === "models") {
      return { json: { models: [{ slug: g.word(), display_name: g.text() }] } };
    }
    return { events: codexEvents(g, model) };
  };
  return {
    request: {
      method: operation === "models" ? "GET" : "POST",
      path:
        operation === "models"
          ? "/backend-api/codex/models?client_version=0.167.1"
          : "/backend-api/codex/responses",
      headers: {
        accept: "text/event-stream",
        authorization: `Bearer ${token}`,
        "chatgpt-account-id": account,
        "content-type": "application/json",
        originator: "codex_cli_rs",
        "session-id": session,
        "thread-id": session,
        "x-client-request-id": session,
        "user-agent": `codex_cli_rs/0.167.1 (Mac OS 26.1.0; arm64) ${g.mark()}/1.0`,
        "x-codex-beta-features": "remote_compaction_v2",
        "x-codex-turn-metadata": metadata,
        "x-codex-window-id": g.id(),
        ...subagent,
        ...(operation === "models" ? {} : zstd),
        ...hubHeaders(g),
        ...unknownHeaders(g),
      },
      ...(body === null ? {} : { body: { json: body } }),
    },
    response: {
      status,
      headers: {
        "content-type":
          status === 200 && operation === "responses"
            ? "text/event-stream"
            : "application/json",
        "x-request-id": g.id(),
        "x-codex-primary-used-percent": "12.5",
        "x-codex-primary-window-minutes": "300",
        "x-codex-active-limit": "codex",
        "x-codex-turn-state": g.word(),
        "openai-model": model,
        "cf-ray": g.word(),
        ...unknownHeaders(g),
      },
      body: response(),
    },
  };
};

const chatModels = ["glm-5.2", "kimi-k2.5", "qwen/qwen3-coder"];

const chatChunks = (g: Generator, model: string): Array<ExchangeFile.Event> => {
  const id = g.id("chatcmpl-");
  const chunk = (
    choices: Json,
    extra: Schema.JsonObject = {},
  ): ExchangeFile.Event => ({
    data: {
      id,
      object: "chat.completion.chunk",
      created: 1794441600,
      model,
      choices,
      ...extra,
    },
  });
  const args = JSON.stringify({ [g.key()]: g.text(), [g.key()]: g.int(0, 9) });
  return [
    chunk([
      {
        index: 0,
        delta: { role: "assistant", content: "" },
        finish_reason: null,
      },
    ]),
    chunk([
      { index: 0, delta: { reasoning_content: g.text() }, finish_reason: null },
    ]),
    chunk([{ index: 0, delta: { content: g.text() }, finish_reason: null }]),
    chunk([
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index: 0,
              id: g.id("call_"),
              type: "function",
              function: { name: g.text(), arguments: "" },
            },
          ],
        },
        finish_reason: null,
      },
    ]),
    ...cutInto(g, args).map((each) =>
      chunk([
        {
          index: 0,
          delta: { tool_calls: [{ index: 0, function: { arguments: each } }] },
          finish_reason: null,
        },
      ]),
    ),
    chunk([
      {
        index: 0,
        delta: {},
        finish_reason: g.pick(["stop", "tool_calls", "length"]),
      },
    ]),
    { data: g.word() },
    chunk([], {
      usage: {
        prompt_tokens: g.int(100, 999),
        completion_tokens: g.int(1, 99),
        total_tokens: g.int(100, 1099),
        prompt_tokens_details: { cached_tokens: g.int(0, 99) },
        completion_tokens_details: { reasoning_tokens: g.int(0, 9) },
      },
    }),
    { data: "[DONE]" },
  ];
};

const chat = (g: Generator): ExchangeFile.Exchange => {
  const operation = g.pick(["chat", "chat", "chat", "models"]);
  const stream = g.flag();
  const session = g.id("ses_");
  const model = g.pick(chatModels);
  const callId = g.id("call_");
  const status = g.pick([200, 200, 200, 429, 500]);
  const body: Json =
    operation === "models"
      ? null
      : {
          model,
          messages: [
            { role: "system", content: g.text() },
            { role: "user", content: [{ type: "text", text: g.text() }] },
            {
              role: "assistant",
              content: g.text(),
              reasoning_content: g.text(),
              tool_calls: [
                {
                  id: callId,
                  type: "function",
                  function: {
                    name: g.text(),
                    arguments: JSON.stringify({ [g.key()]: g.text() }),
                  },
                },
              ],
            },
            { role: "tool", tool_call_id: callId, content: g.text() },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: g.text(),
                description: g.text(),
                parameters: {
                  type: "object",
                  properties: { [g.key()]: { type: "string" } },
                },
              },
            },
          ],
          stream,
          stream_options: { include_usage: true },
          max_tokens: 32000,
          user: g.id(),
          [g.key()]: g.text(),
        };
  const response = (): ExchangeFile.Body => {
    if (status === 429) {
      return g.flag()
        ? { json: { error: { code: "1308", message: g.text() } } }
        : { json: { error: { type: "GoUsageLimitError", message: g.text() } } };
    }
    if (status === 500) return { text: g.text() };
    if (operation === "models") {
      return {
        json: {
          object: "list",
          data: [
            {
              id: g.id(),
              object: "model",
              created: 1794441600,
              owned_by: g.word(),
            },
          ],
        },
      };
    }
    if (stream) return { events: chatChunks(g, model) };
    return {
      json: {
        id: g.id("chatcmpl-"),
        object: "chat.completion",
        created: 1794441600,
        model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: g.text(),
              tool_calls: [
                {
                  id: g.id("call_"),
                  type: "function",
                  function: {
                    name: g.text(),
                    arguments: JSON.stringify({ [g.key()]: [g.text()] }),
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: {
          prompt_tokens: g.int(1, 999),
          completion_tokens: g.int(1, 99),
          total_tokens: 1,
        },
        system_fingerprint: g.id("fp_"),
      },
    };
  };
  return {
    request: {
      method: operation === "models" ? "GET" : "POST",
      path: operation === "models" ? "/models" : "/chat/completions",
      headers: {
        authorization: `Bearer ${g.word()}`,
        "content-type": "application/json",
        "user-agent": `opencode/1.19.5 ai-sdk/provider-utils/4.0.23 runtime/${g.mark()}`,
        "x-session-affinity": session,
        "x-opencode-session-id": session,
        "x-session-id": session,
        "x-stainless-retry-count": "0",
        ...hubHeaders(g),
        ...unknownHeaders(g),
      },
      ...(body === null ? {} : { body: { json: body } }),
    },
    response: {
      status,
      headers: {
        "content-type":
          status === 200 && stream && operation === "chat"
            ? "text/event-stream"
            : status === 500
              ? "text/plain"
              : "application/json",
        "x-request-id": g.id(),
        "retry-after": "30",
        ...unknownHeaders(g),
      },
      body: response(),
    },
  };
};

export interface Generated {
  readonly protocol: ProtocolName;
  readonly exchange: ExchangeFile.Exchange;
}

/** An exchange of each protocol, of a shape the seed picks, every string of which that is not a word of its protocol is marked. */
export const exchanges = (seed: number): ReadonlyArray<Generated> => {
  const g = generator(seed);
  return [
    { protocol: "anthropic-messages", exchange: anthropic(g) },
    { protocol: "chatgpt-codex", exchange: codex(g) },
    { protocol: "openai-chat", exchange: chat(g) },
  ];
};

const parseJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Json),
);

const stringsOf = (value: Schema.Json): ReadonlyArray<string> => {
  if (typeof value === "string") {
    return [
      value,
      ...Option.match(parseJson(value), {
        onNone: () => [],
        onSome: (nested) =>
          typeof nested === "object" && nested !== null
            ? stringsOf(nested)
            : [],
      }),
    ];
  }
  if (Array.isArray(value)) return value.flatMap(stringsOf);
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, each]) => [
      key,
      ...stringsOf(each),
    ]);
  }
  return [];
};

/**
 * Every way a marker could be read in an exchange file: its bytes, the
 * strings in it joined in order (which mends a marker cut across deltas), and
 * the decoding of every run of characters that could be base64.
 */
export const readable = (text: string): string => {
  const strings = Option.match(parseJson(text), {
    onNone: () => [],
    onSome: stringsOf,
  });
  const decoded = [...strings, text].flatMap((each) =>
    (each.match(/[A-Za-z0-9+/_-]{8,}={0,2}/g) ?? []).flatMap((run) => [
      Buffer.from(run, "base64").toString("latin1"),
      Buffer.from(run, "base64url").toString("latin1"),
    ]),
  );
  return [text, strings.join(""), ...decoded].join("\n");
};

export const recordedOn = "2026-11-12";

export const withoutHubHeaders = (
  exchange: ExchangeFile.Exchange,
): ExchangeFile.Exchange => ({
  ...exchange,
  request: {
    ...exchange.request,
    headers: Object.fromEntries(
      Object.entries(exchange.request.headers).filter(
        ([name]) => !name.startsWith("x-cota-"),
      ),
    ),
  },
});

export const loaded = (
  protocol: ProtocolName,
  exchange: ExchangeFile.ExchangeFile,
): Replay.Loaded => ({ file: "generated.json", protocol, exchange });

export const asExchangeFile = (
  exchange: ExchangeFile.Exchange,
): ExchangeFile.ExchangeFile => ({
  source: { kind: "constructed", from: ["generated"] },
  ...exchange,
  expects: { logged: null },
});

const itemsOf = (items: ReadonlyArray<Conversation.Item>) =>
  items.map(({ type, role }) => [type, role]);

/** What a scrubbed exchange must keep of the request the original logged. */
export const shapeOf = ({ origin, ...request }: Request.ForwardedRequest) => ({
  operation: request.operation,
  outcome: request.outcome,
  upstreamStatus: origin.upstreamStatus,
  stream: origin.stream,
  model: request.model,
  purpose: origin.purpose,
  stopReason: request.stopReason,
  errorType: request.errorType,
  sessionSource: origin.sessionSource,
  refused: Option.isSome(origin.refusalReset),
  readingComplete: origin.readingComplete,
  usage: Option.getOrNull(
    Option.map(request.usage, ({ tokens, reasoning }) => ({
      ...tokens,
      reasoning,
    })),
  ),
  conversation: Option.getOrNull(
    Option.map(request.conversation, (conversation) => ({
      system: itemsOf(conversation.system),
      tools: itemsOf(conversation.tools),
      input: itemsOf(conversation.input),
      output: itemsOf(conversation.output),
    })),
  ),
});
