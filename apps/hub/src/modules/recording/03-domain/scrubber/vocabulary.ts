import { Option } from "effect";
import type { ProtocolName } from "#shared/03-domain/protocol-name.ts";

/** Says whether a string under a key is one of the protocol's own words. */
export type Rule = (value: string) => boolean;

export const oneOf =
  (...values: ReadonlyArray<string>): Rule =>
  (value) =>
    values.includes(value);

export const matches =
  (pattern: RegExp): Rule =>
  (value) =>
    pattern.test(value);

export const either =
  (...rules: ReadonlyArray<Rule>): Rule =>
  (value) =>
    rules.some((rule) => rule(value));

/** What to do with a string whose content is JSON: scrub it by the protocol's words, or as content. */
export type Nested = "protocol" | "content";

/**
 * The words of one protocol: the keys it defines, the keys whose string
 * values are its own fixed words, the keys that hold identifiers, the keys
 * whose whole value belongs to the client's user, the keys whose string
 * holds JSON, and the keys that are the protocol's only beside another key
 * (`code` is an error's code beside a `message`, and a tool's code elsewhere).
 * A key a protocol does not define is the client's or its user's.
 */
export interface Vocabulary {
  readonly keys: ReadonlySet<string>;
  readonly values: Readonly<Record<string, Rule>>;
  readonly identifiers: ReadonlySet<string>;
  readonly content: ReadonlySet<string>;
  readonly json: Readonly<Record<string, Nested>>;
  readonly beside: Readonly<Record<string, string>>;
  readonly headerMaps: ReadonlySet<string>;
  readonly paths: ReadonlySet<string>;
  readonly segments: ReadonlySet<string>;
  readonly query: Readonly<Record<string, Rule>>;
}

const model = matches(/^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._:@+/-]{0,127}$/);
const errorCode = matches(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/);
const errorType = matches(
  /^[a-z][a-z_]{0,62}_error$|^[A-Z][A-Za-z]{0,62}Error$/,
);
const dated = matches(/^[a-z][a-z_]{0,62}_20\d{6}$/);

interface Words {
  readonly keys: ReadonlyArray<string>;
  readonly values: Readonly<Record<string, Rule>>;
  readonly identifiers: ReadonlyArray<string>;
  readonly content: ReadonlyArray<string>;
  readonly json: Readonly<Record<string, Nested>>;
  readonly beside?: Readonly<Record<string, string>>;
  readonly headerMaps?: ReadonlyArray<string>;
  readonly paths: ReadonlyArray<string>;
  readonly query: Readonly<Record<string, Rule>>;
}

const vocabularyOf = (words: Words): Vocabulary => {
  const paths = new Set(words.paths);
  return {
    keys: new Set([
      ...words.keys,
      ...Object.keys(words.values),
      ...words.identifiers,
      ...words.content,
      ...Object.keys(words.json),
      ...(words.headerMaps ?? []),
    ]),
    values: words.values,
    identifiers: new Set(words.identifiers),
    content: new Set(words.content),
    json: words.json,
    beside: words.beside ?? {},
    headerMaps: new Set(words.headerMaps ?? []),
    paths,
    segments: new Set(
      [...paths].flatMap((path) => path.split("/").filter((s) => s !== "")),
    ),
    query: words.query,
  };
};

const anthropicTypes = oneOf(
  "message_start",
  "message_delta",
  "message_stop",
  "content_block_start",
  "content_block_delta",
  "content_block_stop",
  "ping",
  "error",
  "message",
  "model",
  "text",
  "image",
  "document",
  "search_result",
  "thinking",
  "redacted_thinking",
  "tool_use",
  "tool_result",
  "server_tool_use",
  "web_search_tool_result",
  "web_fetch_tool_result",
  "web_search_result",
  "web_fetch_result",
  "web_search_tool_result_error",
  "code_execution_tool_result",
  "bash_code_execution_tool_result",
  "text_editor_code_execution_tool_result",
  "tool_search_tool_result",
  "mcp_tool_use",
  "mcp_tool_result",
  "mcp_tool_listing",
  "container_upload",
  "compaction",
  "fallback",
  "fallback_message",
  "advisor_tool_result",
  "tool_addition",
  "tool_removal",
  "connector_text",
  "mid_conv_system",
  "tool_reference",
  "text_delta",
  "input_json_delta",
  "thinking_delta",
  "signature_delta",
  "citations_delta",
  "base64",
  "url",
  "file",
  "content",
  "char_location",
  "page_location",
  "content_block_location",
  "web_search_result_location",
  "search_result_location",
  "ephemeral",
  "enabled",
  "disabled",
  "adaptive",
  "auto",
  "any",
  "tool",
  "none",
  "custom",
  "json_schema",
  "input_tokens",
  "tool_uses",
  "thinking_turns",
  "all",
);

const anthropic = vocabularyOf({
  keys: [
    "messages",
    "system",
    "tools",
    "tool_choice",
    "metadata",
    "max_tokens",
    "thinking",
    "temperature",
    "top_p",
    "top_k",
    "stop_sequences",
    "stream",
    "context_management",
    "output_config",
    "text",
    "cache_control",
    "citations",
    "source",
    "data",
    "url",
    "title",
    "context",
    "name",
    "is_error",
    "signature",
    "description",
    "max_uses",
    "disable_parallel_tool_use",
    "budget_tokens",
    "format",
    "edits",
    "trigger",
    "keep",
    "clear_at_least",
    "value",
    "exclude_tools",
    "clear_tool_inputs",
    "index",
    "message",
    "content_block",
    "delta",
    "partial_json",
    "citation",
    "usage",
    "error",
    "stop_sequence",
    "input_tokens",
    "output_tokens",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
    "cache_creation",
    "ephemeral_5m_input_tokens",
    "ephemeral_1h_input_tokens",
    "output_tokens_details",
    "thinking_tokens",
    "server_tool_use",
    "web_search_requests",
    "web_fetch_requests",
    "iterations",
    "display_name",
    "created_at",
    "has_more",
    "cited_text",
    "document_index",
    "document_title",
    "start_char_index",
    "end_char_index",
    "start_page_number",
    "end_page_number",
    "start_block_index",
    "end_block_index",
    "encrypted_content",
    "encrypted_index",
    "page_age",
    "strict",
  ],
  values: {
    type: either(anthropicTypes, dated, errorType),
    role: oneOf("user", "assistant", "system"),
    model,
    stop_reason: oneOf(
      "end_turn",
      "max_tokens",
      "stop_sequence",
      "tool_use",
      "pause_turn",
      "refusal",
      "model_context_window_exceeded",
    ),
    ttl: oneOf("5m", "1h"),
    scope: oneOf("global"),
    media_type: oneOf(
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "application/pdf",
      "text/plain",
    ),
    service_tier: oneOf(
      "standard",
      "priority",
      "batch",
      "auto",
      "standard_only",
    ),
    speed: oneOf("fast", "standard"),
    inference_geo: oneOf("us", "eu", "global"),
    effort: oneOf("low", "medium", "high", "max", "xhigh"),
    content: oneOf("quota"),
  },
  identifiers: [
    "id",
    "tool_use_id",
    "request_id",
    "device_id",
    "account_uuid",
    "session_id",
    "parent_session_id",
    "first_id",
    "last_id",
    "file_id",
    "user_id",
  ],
  content: ["input", "input_schema", "schema"],
  json: { user_id: "protocol" },
  paths: ["/v1/messages", "/v1/messages/count_tokens", "/v1/models"],
  query: { beta: oneOf("true") },
});

const codexTypes = oneOf(
  "message",
  "reasoning",
  "function_call",
  "function_call_output",
  "custom_tool_call",
  "custom_tool_call_output",
  "local_shell_call",
  "local_shell_call_output",
  "web_search_call",
  "image_generation_call",
  "tool_search_call",
  "tool_search_output",
  "compaction",
  "compaction_summary",
  "context_compaction",
  "configuration_update",
  "compaction_trigger",
  "additional_tools",
  "agent_message",
  "input_text",
  "input_image",
  "input_file",
  "input_audio",
  "output_text",
  "refusal",
  "summary_text",
  "reasoning_text",
  "function",
  "custom",
  "web_search",
  "web_search_preview",
  "local_shell",
  "image_generation",
  "tool_search",
  "grammar",
  "text",
  "json_schema",
  "json_object",
  "exec",
  "search",
  "open_page",
  "find",
  "find_in_page",
  "response.created",
  "response.in_progress",
  "response.queued",
  "response.completed",
  "response.incomplete",
  "response.failed",
  "response.output_item.added",
  "response.output_item.done",
  "response.content_part.added",
  "response.content_part.done",
  "response.output_text.delta",
  "response.output_text.done",
  "response.output_text.annotation.added",
  "response.refusal.delta",
  "response.refusal.done",
  "response.reasoning_summary_part.added",
  "response.reasoning_summary_part.done",
  "response.reasoning_summary_text.delta",
  "response.reasoning_summary_text.done",
  "response.reasoning_text.delta",
  "response.reasoning_text.done",
  "response.function_call_arguments.delta",
  "response.function_call_arguments.done",
  "response.custom_tool_call_input.delta",
  "response.custom_tool_call_input.done",
  "response.web_search_call.in_progress",
  "response.web_search_call.searching",
  "response.web_search_call.completed",
  "response.image_generation_call.in_progress",
  "response.image_generation_call.generating",
  "response.image_generation_call.partial_image",
  "response.image_generation_call.completed",
  "response.metadata",
  "codex.response.metadata",
  "keepalive",
  "error",
  "usage_limit_reached",
  "usage_not_included",
  "rate_limit_exceeded",
  "insufficient_quota",
  "context_length_exceeded",
  "quota_exceeded",
);

const codex = vocabularyOf({
  keys: [
    "stream",
    "input",
    "instructions",
    "tools",
    "parallel_tool_calls",
    "reasoning",
    "context",
    "store",
    "stream_options",
    "reasoning_summary_delivery",
    "prompt_cache_key",
    "text",
    "format",
    "name",
    "strict",
    "client_metadata",
    "content",
    "encrypted_content",
    "namespace",
    "output",
    "action",
    "command",
    "timeout_ms",
    "working_directory",
    "user",
    "query",
    "url",
    "pattern",
    "sources",
    "result",
    "revised_prompt",
    "image_url",
    "annotations",
    "logprobs",
    "description",
    "definition",
    "sequence_number",
    "response",
    "item",
    "output_index",
    "content_index",
    "delta",
    "part",
    "summary_index",
    "message",
    "param",
    "error",
    "created_at",
    "incomplete_details",
    "usage",
    "end_turn",
    "input_tokens",
    "input_tokens_details",
    "cached_tokens",
    "cache_write_tokens",
    "output_tokens",
    "output_tokens_details",
    "reasoning_tokens",
    "total_tokens",
    "codex_rollout_budget_units",
    "resets_at",
    "resets_in_seconds",
    "window_number",
    "forked_from_ordinal_exclusive",
    "agent_name",
    "subagent_kind",
    "thread_source",
    "turn_trigger",
    "sandbox",
    "sandbox_mode",
    "auto_review_enabled",
    "node_repl_auto_review_required",
    "node_repl_disabled",
    "turn_started_at_unix_ms",
    "history_ingest_requested",
    "analytics_enabled",
    "compaction",
    "history_initialization",
    "models",
  ],
  values: {
    type: either(codexTypes, errorType),
    role: oneOf("user", "assistant", "developer", "system", "tool"),
    model,
    status: oneOf(
      "completed",
      "incomplete",
      "in_progress",
      "failed",
      "queued",
      "cancelled",
      "searching",
      "generating",
    ),
    phase: oneOf(
      "commentary",
      "final_answer",
      "standalone_turn",
      "pre_turn",
      "mid_turn",
      "post_turn",
    ),
    reason: oneOf(
      "max_output_tokens",
      "content_filter",
      "interrupted",
      "user_requested",
      "context_limit",
      "model_downshift",
      "comp_hash_changed",
    ),
    effort: oneOf("none", "minimal", "low", "medium", "high", "xhigh"),
    summary: oneOf("auto", "concise", "detailed", "none"),
    verbosity: oneOf("low", "medium", "high"),
    tool_choice: oneOf("auto", "none", "required"),
    include: oneOf(
      "reasoning.encrypted_content",
      "output.encrypted_content",
      "message.output_text.logprobs",
      "web_search_call.action.sources",
    ),
    service_tier: oneOf("auto", "default", "flex", "priority", "scale"),
    code: errorCode,
    object: oneOf("response", "list", "model"),
    detail: oneOf("auto", "low", "high", "original"),
    syntax: oneOf("lark", "regex"),
    request_kind: oneOf("turn", "prewarm", "compaction", "memory"),
    trigger: oneOf("manual", "auto"),
    implementation: oneOf("responses", "responses_compaction_v2"),
    strategy: oneOf("memento", "prefix_compaction"),
    "x-openai-subagent": oneOf(
      "review",
      "compact",
      "memory_consolidation",
      "collab_spawn",
    ),
  },
  identifiers: [
    "id",
    "call_id",
    "item_id",
    "response_id",
    "previous_response_id",
    "prompt_cache_key",
    "session_id",
    "thread_id",
    "turn_id",
    "installation_id",
    "window_id",
    "context_window_id",
    "forked_from_thread_id",
    "parent_thread_id",
    "parent_turn_id",
    "root_turn_id",
    "x-codex-window-id",
    "x-codex-installation-id",
    "x-codex-parent-thread-id",
    "file_id",
  ],
  content: ["parameters", "schema", "env", "workspaces"],
  json: { arguments: "content", "x-codex-turn-metadata": "protocol" },
  beside: { code: "message" },
  headerMaps: ["headers"],
  paths: [
    "/backend-api/codex/responses",
    "/backend-api/codex/models",
    "/backend-api/codex/alpha/search",
    "/backend-api/codex/images/generations",
    "/backend-api/codex/images/edits",
  ],
  query: { client_version: matches(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/) },
});

const openAiChat = vocabularyOf({
  keys: [
    "messages",
    "tools",
    "stream",
    "stream_options",
    "include_usage",
    "max_tokens",
    "max_completion_tokens",
    "temperature",
    "top_p",
    "stop",
    "seed",
    "store",
    "parallel_tool_calls",
    "response_format",
    "json_schema",
    "name",
    "strict",
    "thinking",
    "clear_thinking",
    "n",
    "frequency_penalty",
    "presence_penalty",
    "logprobs",
    "top_logprobs",
    "content",
    "tool_calls",
    "reasoning_content",
    "reasoning",
    "reasoning_text",
    "refusal",
    "text",
    "image_url",
    "url",
    "function",
    "index",
    "description",
    "created",
    "choices",
    "delta",
    "message",
    "usage",
    "prompt_tokens",
    "completion_tokens",
    "total_tokens",
    "prompt_tokens_details",
    "cached_tokens",
    "completion_tokens_details",
    "reasoning_tokens",
    "audio_tokens",
    "accepted_prediction_tokens",
    "rejected_prediction_tokens",
    "cost",
    "error",
    "param",
    "data",
  ],
  values: {
    type: either(
      oneOf(
        "function",
        "text",
        "image_url",
        "input_audio",
        "file",
        "json_schema",
        "json_object",
        "enabled",
        "disabled",
      ),
      errorType,
    ),
    role: oneOf("system", "developer", "user", "assistant", "tool", "function"),
    model,
    finish_reason: oneOf(
      "stop",
      "length",
      "tool_calls",
      "content_filter",
      "function_call",
    ),
    object: oneOf("chat.completion", "chat.completion.chunk", "list", "model"),
    reasoning_effort: oneOf(
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
    ),
    verbosity: oneOf("low", "medium", "high"),
    tool_choice: oneOf("auto", "none", "required"),
    service_tier: oneOf("auto", "default", "flex", "priority", "scale"),
    prompt_cache_retention: oneOf("in-memory", "24h"),
    detail: oneOf("auto", "low", "high"),
    code: errorCode,
  },
  identifiers: [
    "id",
    "tool_call_id",
    "prompt_cache_key",
    "user",
    "system_fingerprint",
  ],
  content: ["parameters", "schema"],
  json: { arguments: "content" },
  beside: { code: "message" },
  paths: ["/chat/completions", "/models"],
  query: {},
});

/** Every protocol's words, for the scrubber. */
export const vocabularies: Readonly<Record<ProtocolName, Vocabulary>> = {
  "anthropic-messages": anthropic,
  "chatgpt-codex": codex,
  "openai-chat": openAiChat,
};

/** What a header's value becomes, and whether a header is kept at all. */
export type HeaderRule =
  | { readonly _tag: "Keep"; readonly rule: Rule }
  | { readonly _tag: "List"; readonly item: Rule }
  | { readonly _tag: "Identifier" }
  | { readonly _tag: "Login" }
  | { readonly _tag: "Json" }
  | { readonly _tag: "UserAgent" };

const keep = (rule: Rule): HeaderRule => ({ _tag: "Keep", rule });
const list = (item: Rule): HeaderRule => ({ _tag: "List", item });
const identifier: HeaderRule = { _tag: "Identifier" };

const mediaType = matches(
  /^(application\/(json|octet-stream|x-ndjson|pdf)|text\/(event-stream|plain|html)|multipart\/form-data|\*\/\*)(;\s*charset=utf-8)?$/i,
);
const coding = oneOf(
  "gzip",
  "x-gzip",
  "deflate",
  "br",
  "zstd",
  "identity",
  "*",
);
const digits = matches(/^\d{1,10}$/);
const flag = oneOf("true", "false");

/** The headers whose name and value may appear in an exchange file, and how. */
export const requestHeaders: Readonly<Record<string, HeaderRule>> = {
  "content-type": keep(mediaType),
  "content-encoding": keep(coding),
  accept: list(mediaType),
  "accept-encoding": list((value) =>
    coding(value.replace(/;\s*q=[01](\.\d{1,3})?$/, "")),
  ),
  "user-agent": { _tag: "UserAgent" },
  "anthropic-version": keep(matches(/^\d{4}-\d{2}-\d{2}$/)),
  "anthropic-beta": list(matches(/^[a-z][a-z0-9-]{0,63}-\d{4}-?\d{2}-?\d{2}$/)),
  "anthropic-dangerous-direct-browser-access": keep(flag),
  "x-app": keep(oneOf("cli", "cli-bg")),
  "x-stainless-retry-count": keep(digits),
  "x-claude-code-request-class": keep(
    oneOf(
      "main",
      "subagent",
      "workflow",
      "compaction",
      "auxiliary",
      "side_reply",
    ),
  ),
  "x-claude-code-agent-type": keep(
    oneOf(
      "teammate",
      "custom",
      "general-purpose",
      "Explore",
      "Plan",
      "statusline-setup",
      "output-style-setup",
      "claude-code-guide",
    ),
  ),
  originator: keep(matches(/^codex[a-z_-]{0,32}$/)),
  "x-openai-subagent": keep(
    oneOf("review", "compact", "memory_consolidation", "collab_spawn"),
  ),
  "x-codex-beta-features": list(
    oneOf("remote_compaction_v2", "prevent_idle_sleep"),
  ),
  authorization: { _tag: "Login" },
  "x-api-key": { _tag: "Login" },
  "chatgpt-account-id": identifier,
  "x-codex-turn-metadata": { _tag: "Json" },
  "x-claude-code-session-id": identifier,
  "x-claude-code-agent-id": identifier,
  "x-claude-code-parent-agent-id": identifier,
  "x-claude-code-prompt-id": identifier,
  "session-id": identifier,
  session_id: identifier,
  "thread-id": identifier,
  "x-client-request-id": identifier,
  "x-codex-window-id": identifier,
  "x-codex-parent-thread-id": identifier,
  "x-codex-turn-state": identifier,
  "x-codex-image-turn-id": identifier,
  "x-session-affinity": identifier,
  "x-opencode-session-id": identifier,
  "x-opencode-session": identifier,
  "x-session-id": identifier,
  "x-opencode-parent-session-id": identifier,
  "x-parent-session-id": identifier,
  "x-opencode-request": identifier,
};

export const responseHeaders: Readonly<Record<string, HeaderRule>> = {
  "content-type": keep(mediaType),
  "content-encoding": keep(coding),
  "cache-control": list(matches(/^[a-z-]{1,32}(=\d{1,10})?$/)),
  "retry-after": keep(
    either(
      digits,
      matches(
        /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/,
      ),
    ),
  ),
  "retry-after-ms": keep(digits),
  "x-should-retry": keep(flag),
  "openai-model": keep(model),
  "x-openai-model": keep(model),
  "request-id": identifier,
  "x-request-id": identifier,
  "x-oai-request-id": identifier,
  "cf-ray": identifier,
  "anthropic-organization-id": identifier,
  "x-codex-turn-state": identifier,
  "x-codex-imagegen-request-id": identifier,
};

const codexQuotaSuffixes = [
  "-used-percent",
  "-window-minutes",
  "-reset-at",
  "-limit-name",
];

/**
 * The quota headers the hub reads into the request log: every one is kept by name.
 * Their values say what plan the owner has and how much of it is used, so
 * only the shape of a value is kept (`quotaShapeOf`), except the status a
 * refusal is told by.
 */
export const isQuotaHeader = (name: string): boolean =>
  /^[a-z0-9-]{1,96}$/.test(name) &&
  (name.startsWith("anthropic-ratelimit-") ||
    (name.startsWith("x-codex-") && name !== "x-codex-turn-state") ||
    codexQuotaSuffixes.some((suffix) => name.endsWith(suffix)));

const refusalStatusHeaders: ReadonlySet<string> = new Set([
  "anthropic-ratelimit-unified-status",
]);
const refusalStatus = oneOf("allowed", "allowed_warning", "rejected");
const quotaNumber = /^-?\d{1,20}(\.\d{1,10})?$/;
const quotaDate = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;
const firstUnixSecond = 1_000_000_000;

/**
 * What a quota header's value becomes: the status a refusal is told by stays;
 * a time becomes one fixed time, any other number 0; nothing else has a shape
 * worth keeping.
 */
export const quotaShapeOf = (
  name: string,
  value: string,
): Option.Option<string> => {
  if (refusalStatusHeaders.has(name) && refusalStatus(value)) {
    return Option.some(value);
  }
  if (quotaNumber.test(value)) {
    return Option.some(Number(value) >= firstUnixSecond ? "1800000000" : "0");
  }
  if (quotaDate.test(value)) return Option.some("2027-01-15T08:00:00Z");
  return Option.none();
};

/** The bodies of event streams that are a word of the protocol, not JSON. */
export const eventWords = oneOf("[DONE]");

/** The prefixes of identifiers a provider or client gives, kept on their fakes. */
export const identifierPrefixes: ReadonlyArray<string> = [
  "msg_",
  "toolu_",
  "srvtoolu_",
  "mcptoolu_",
  "req_",
  "resp_",
  "rs_",
  "fc_",
  "call_",
  "ctc_",
  "ws_",
  "ig_",
  "lsh_",
  "at_",
  "ses_",
  "file_",
  "chatcmpl-",
  "fp_",
];

/** The clients whose user agent is kept, by their first product. */
export const knownClients: ReadonlyArray<string> = [
  "claude-code",
  "codex",
  "opencode",
  "pi",
];
