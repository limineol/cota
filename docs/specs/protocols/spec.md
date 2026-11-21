---
status: active
scope: apps/hub
owner: limineol
last_verified: 2026-11-17
review_by: 2027-02-17
supersedes: []
code:
  - apps/hub/src/modules/relay/02-application/interfaces/protocol.ts
  - apps/hub/src/modules/relay/03-domain/client-request.ts
  - apps/hub/src/modules/relay/03-domain/description.ts
  - apps/hub/src/modules/relay/03-domain/reading.ts
  - apps/hub/src/modules/relay/03-domain/refusal.ts
  - apps/hub/src/modules/relay/04-infrastructure/protocols/anthropic-messages
  - apps/hub/src/modules/relay/04-infrastructure/protocols/openai-chat
  - apps/hub/src/modules/relay/04-infrastructure/protocols/chatgpt-codex
  - apps/hub/src/modules/request-log/04-infrastructure/prices
---

# Protocols

A pool speaks one protocol. The relay forwards every protocol the same way (`docs/specs/relay/spec.md`); what differs is what the hub reads. This spec says what a protocol must tell the hub, and what each of the three says. Every fact about a provider's wire format here is held by a recorded exchange (ADR-0008); where the exchange is only constructed so far, the text says so.

## What a protocol tells the hub

| Question | Asked of | Answer |
| --- | --- | --- |
| Where do requests go? | the configuration | The default base URL, and the **client prefix**: the path a client's base URL must end in, which the hub requires and strips before forwarding. |
| What is this request? | method, path, headers, the decoded body | Its **operation**, model, session (and where that came from), whether it streams, its **purpose** if the client states one, the service tier it asks for where that sets the price, and the headers worth keeping. |
| Whose login is this? | the credential headers, the decoded body | The login's **fingerprint**. |
| What is the conversation? | the operation, the decoded body | Whether the operation carries one; the parts to split and which of the request log's parts each is (`docs/specs/request-log/spec.md`); what to take out of each item; and each item's readable text. An item's `type` and `role` are its own, for every protocol. |
| Is this answer a refusal? | status and headers, or the start of the body | Whether it is, and its reset if it gives one. |
| What did the answer say? | the copy of the response, as it passes | For the operations that have usage: usage, the output items, the stop reason, the model that served it, and **when the answer is finished**. For every answer: an error if there was one, the provider's request id and the quota headers. |

Rules that hold for all three:

- **A refusal is known from the head where a fallback can follow.** A protocol that tells a refusal from status and headers lets the hub decide before the first byte reaches the client, and drop the refusal to divert. One that needs the body knows only once the body has passed, so a pool that speaks it cannot have a fallback pool (ADR-0009).

- **Read what is there, never what should be.** An unknown event, field, item type or header is skipped, not an error. A missing one leaves its request log column empty.
- **The client's own word, or nothing.** `purpose` is taken only from a header or field in which the client names the request. It is never inferred from the prompt.
- **Usage is overwritten, not added,** when a stream reports it more than once, and it is mapped to the request log's classes so that input never includes cached tokens.
- **A refusal is recognised by its status and the provider's own marker,** never by the wording of a message.
- **Session ids** are trimmed, and ignored when empty or longer than 255 characters (code points, as the API counts them, so that `PUT /api/session-titles` takes every id the request log can hold).

## Anthropic Messages (`anthropic-messages`)

Claude Code, with `ANTHROPIC_BASE_URL={hub}/pools/<pool>`. A subscription pool, or a keyed pool when the pool holds a key: an Anthropic API key, or a provider that speaks the protocol for its own plan. Claude Code is given the keyed hub key where the provider's documentation puts the provider's key, in `ANTHROPIC_API_KEY` (sent in `x-api-key`) or `ANTHROPIC_AUTH_TOKEN` (sent as a bearer token), and the held key goes out in the same header (`docs/specs/relay/spec.md`).

When it starts, Claude Code checks that it can reach its base URL with `HEAD /api/hello`, which carries no login and none of its custom headers (seen, 2.1.322). The hub rejects it for having no hub key, as it does any request without one, and Claude Code carries on.

- **Base URL**: `https://api.anthropic.com`, for a keyed pool as for a subscription one, unless the pool gives its own. No client prefix.
- **Operations**:

  | Request | Operation |
  | --- | --- |
  | `POST /v1/messages` | `messages` |
  | `POST /v1/messages/count_tokens` | `count_tokens` |
  | `GET /v1/models` | `models` |
  | anything else | `other` |

  Only `messages` has usage and a conversation.
- **Session**: the `x-claude-code-session-id` header; else `session_id` inside `metadata.user_id`, which is a JSON string.
- **Purpose**: the `x-claude-code-request-class` header, which Claude Code sends when `CLAUDE_CODE_GATEWAY_HINT_HEADERS=1` is set. Else `quota_probe` for the request Claude Code uses to check its limits: `max_tokens` of 1 and a single user message whose content is `quota`.
- **Headers kept**: `anthropic-beta`, `anthropic-version`, `x-app`, `x-claude-code-request-class`, `x-claude-code-agent-type`, `x-claude-code-agent-id`, `x-claude-code-parent-agent-id`, `x-claude-code-prompt-id`, `x-stainless-retry-count`.
- **Fingerprint**: SHA-256 of the login. A keyed pool's requests carry no login the hub keeps, so they have none.
- **Conversation**: the parts are `system` (system), `tools` (tools) and `messages` (input). Claude Code also sends messages whose role is `system` among `messages` (recorded, 2.1.322); they are input items like any other. `cache_control` is taken out of every item, at any depth, because Claude Code moves its cache markers on every request. An item's text is, for a message, that of its content, and for any other item, that of the item as a block: a string is its own text; a `text` block gives its `text`, a `thinking` block its `thinking`, a `tool_result` block the text of its content, and a `tool_use`, `server_tool_use` or `mcp_tool_use` block its `input` in canonical form; other blocks give none. The texts are joined by a blank line.
- **Refusal**: status 429 and `anthropic-ratelimit-unified-status: rejected`. The reset is `anthropic-ratelimit-unified-reset`, in Unix seconds. The body is not looked at, since a refusal's body can be a `rate_limit_error` or a `billing_error`. A `rejected` status on an answer that is not a 429 is the pool's extra usage being spent, not a refusal. (Constructed: no subscription refusal has been recorded yet.) A keyed pool has no fallback pool, so its refusal is recorded and passed on.
- **The answer**: a stream of events, told apart by the `type` in their data. Usage starts at `message_start` and each later `message_delta` overwrites the fields it carries that are not null. `message_stop` is the terminal event; an `error` event is a terminal failure. The output is one item, `{ "role": "assistant", "content": [...] }`, built from the content blocks so that it is the message the client sends back as the next request's last assistant turn: each block as `content_block_start` gave it, with text, thinking and citations deltas appended, the last signature delta as its signature, and the input of a tool-use or server tool block parsed from its input JSON deltas at `content_block_stop`. A block without deltas, such as redacted thinking or a server tool's result, is kept as it came. An answer that is not a stream is the message itself: its `role` and `content` are the output item, and its usage, stop reason and model are read as from a stream.
- **Usage classes**: `input_tokens` is input; `cache_read_input_tokens` is cache read; `cache_creation.ephemeral_5m_input_tokens` is the short cache write and `ephemeral_1h_input_tokens` the long one (without that breakdown, all of `cache_creation_input_tokens` is short); `output_tokens` is output; `output_tokens_details.thinking_tokens` is reasoning.
- **Also read**: `request-id`; every `anthropic-ratelimit-*` header and `retry-after`; the tier, which is usage's `speed` when it gives one and its `service_tier` otherwise; the served model from `message_start`; the `type` and `message` of an error body's `error`.

## ChatGPT's Codex backend (`chatgpt-codex`)

Codex with its ChatGPT login, and a model provider named `OpenAI` whose base URL is `{hub}/pools/<pool>/backend-api/codex`. A subscription pool; it cannot hold a key. The facts below were read from Codex 0.167.1's source (`codex-rs`, tag `rust-v0.167.1`); its exchanges are constructed until real traffic is recorded.

- **Base URL**: `https://chatgpt.com/backend-api/codex`. **Client prefix**: `/backend-api/codex`. Codex turns off compaction, web search and request compression unless its base URL ends this way. A path outside the prefix is the hub's `cota_unknown_path`.
- **Operations**:

  | Request | Operation |
  | --- | --- |
  | `POST /responses` | `responses` |
  | `GET /models` | `models` |
  | `POST /alpha/search` | `search` |
  | `POST /images/generations`, `POST /images/edits` | `image` |
  | anything else | `other` |

  Only `responses` has usage and a conversation.
- **Request bodies** of `responses` arrive compressed with zstd while Codex's request compression is on, which is its default. The hub forwards them as they are and reads a decoded copy.
- **Model, stream and service tier** are the body's `model`, `stream` and `service_tier`.
- **Session**: the `session-id` header; else the `session_id` header, which older versions of Codex sent; else `client_metadata.session_id` in the body, whose source is `body`.
- **Purpose**: the `x-openai-subagent` header when present; else `request_kind` in the `x-codex-turn-metadata` header, which is JSON. A metadata header that is not JSON, or has no `request_kind` string, gives none.
- **Headers kept**: `originator`, `thread-id`, `x-codex-window-id`, `x-codex-turn-metadata`, `x-openai-subagent`, `x-codex-parent-thread-id`, `x-codex-beta-features`.
- **Fingerprint**: SHA-256 of the `chatgpt-account-id` header and the `chatgpt_account_user_id` claim (under `https://api.openai.com/auth`) of the access token, joined by a line feed. The claim is read from the token's payload without verifying the token. When the claim is missing, or the login is not a JWT, it is the SHA-256 of the account id alone; when there is no account id, of the login. The access token itself changes at every refresh, so it would not name the login for long.
- **Conversation**: the parts are `instructions` (system, a single value when present), `tools` and `input`. Codex 0.167.2 sends neither `instructions` nor `tools` at the top level (recorded): its tools arrive as an `additional_tools` input item and its base instructions as developer messages, all among `input`. An output item is not the same JSON value as the item Codex sends back in its next request (recorded): the backend's `metadata` is dropped and `internal_chat_message_metadata_passthrough` is rewritten by the client, so each answer is stored once as output and once more as input. Nothing is taken out of items. An item's text is, for a message (an item of type `message`, or without a type), the `text` of its content parts (a string content is its own text); for `reasoning`, the `text` of its summary parts; for `function_call` and `tool_search_call`, its `arguments`; for `custom_tool_call`, its `input`; for `local_shell_call` and `web_search_call`, its `action` in canonical form; for `function_call_output` and `custom_tool_call_output`, its `output` (a string, or the `text` of its parts). Encrypted content and image data are not text, and other items have none. The texts are joined by a blank line.
- **Output items** are the items of the stream's `response.output_item.done` events, as they came, in order. Codex reads each into its own type and sends it back as an input item of its next request (`codex-rs/protocol/src/models.rs`, `ResponseItem`), so the output item and the next request's input item are the same item when the provider's item holds only fields Codex keeps. They are different items when the provider's item has a field Codex does not know, a `reasoning` item has no `encrypted_content` (Codex sends it back as `null`) or has `reasoning_text` content (Codex drops it), a `local_shell_call` action leaves out an optional field (Codex sends it as `null`), a `web_search_call` action is of a type Codex does not know, or an item has no id (Codex makes one). Nothing is moved by Codex on every request, so nothing is added to the overlay.
- **Refusal**: status 429 and a JSON body whose `error.type` is `usage_limit_reached`. The reset is `error.resets_at`, in Unix seconds. Other 429s are errors. (Constructed.) A ChatGPT pool cannot have a fallback pool yet, so `Fallback` is not asked about its requests: a refusal is recorded in the request log, with its reset, and passed on, and nothing is parked.
- **The answer**: a stream of events told apart by the `type` in their data, which the backend sends without a `content-type` (recorded, Codex 0.167.2). Each `response.output_item.done` carries one finished output item. `response.completed` and `response.incomplete` are terminal and carry the usage in their `response`; `response.failed` and `error` are terminal failures. Codex hangs up at `response.completed` and `response.incomplete`, so the request is finished at the terminal event, and the hang-up that follows is not a cancellation. The stop reason is the response's `incomplete_details.reason`, else its `status`. A failure's error is `response.error` of `response.failed`, and the `error` of an `error` event, else the event's own `code` and `message`; its type is the error's `type`, else its `code`, since the backend's errors usually carry only a code.
- **Usage classes**: `input_tokens` less `cached_tokens` less `cache_write_tokens` is input; `cached_tokens` is cache read; `cache_write_tokens` is the short cache write; `output_tokens` is output; `reasoning_tokens` is reasoning. The details may be null. (Codex's own count of uncached input takes out only `cached_tokens`; that `input_tokens` includes `cache_write_tokens` is not yet confirmed by a recording.)
- **Also read**: `x-request-id`, else `x-oai-request-id`; the served model from the `openai-model` header, or from `openai-model` (or `x-openai-model`) in an event's `response.headers`, which Codex prefers; `service_tier` from the request; and as quota headers every `x-codex-*` header except `x-codex-turn-state`, and any header ending in `-used-percent`, `-window-minutes`, `-reset-at` or `-limit-name`.

## OpenAI Chat Completions (`openai-chat`)

OpenCode and Pi, with a provider whose base URL is `{hub}/pools/<pool>` and whose API key is a keyed hub key. A keyed pool, with a held key or without one: Z.ai, OpenCode Go, a local model server.

- **Base URL**: from the configuration, including any path the provider needs (`https://api.z.ai/api/coding/paas/v4`, `http://127.0.0.1:1234/v1`). No client prefix.
- **Operations**:

  | Request | Operation |
  | --- | --- |
  | `POST /chat/completions` | `chat` |
  | `GET /models` | `models` |
  | anything else | `other` |

  Only `chat` has usage and a conversation.
- **The model id is not touched.** A client is configured with the provider's own ids.
- **Session**: the first of the headers `x-session-affinity`, `x-opencode-session-id`, `x-opencode-session`, `x-session-id`, `session_id`.
- **Purpose**: none.
- **Headers kept**: `x-opencode-parent-session-id`, `x-parent-session-id`, `x-opencode-request`, `x-stainless-retry-count`.
- **Conversation**: the parts are `tools` (tools) and `messages` (input; system messages are among them). Nothing is taken out. An item's text is its content (a string, or the `text` of its parts), its reasoning under `reasoning_content`, `reasoning` or `reasoning_text`, and its tool calls' arguments, joined by a blank line. The output item is not the turn the client sends back: OpenCode and Pi both rewrite it (the arguments re-serialised, empty content as `""` or `null`), so it is stored as a separate item.
- **Refusal**: status 429 and one of the providers' own markers: Z.ai's `error.code` of `1308`, `1310` or `1316` to `1321`; OpenCode Go's `error.type` of `GoUsageLimitError`. The reset is `retry-after` when it is given in seconds; Z.ai's reset inside its message is not parsed. (Constructed.) Other 429s are errors. A keyed pool has no fallback pool, so a refusal is recorded and passed on.
- **The answer**: a stream of chunks, ended by `[DONE]`, which is the terminal event: the request is finished there. The reader neither stops nor fails at it, because OpenCode Go sends a chunk after it (a cost, without usage), but nothing after it changes what is recorded. Usage is taken from any chunk that carries it, the latest winning. The output is one item, the assistant's message, folded from the deltas of the first choice: content, reasoning under the field it arrived in, and tool calls by index. An answer that is not a stream is read from `choices[0].message` and `usage`.
- **Usage classes**: `prompt_tokens` less `prompt_tokens_details.cached_tokens` is input; `cached_tokens` is cache read; cache writes are 0; `completion_tokens` is output; `completion_tokens_details.reasoning_tokens` is reasoning. A stream without usage leaves `usage_reported` false.
- **Also read**: `x-request-id`; the served model from the chunks' `model`; `retry-after` as a quota header.

## Prices

The hub ships price lists in `apps/hub/src/modules/request-log/04-infrastructure/prices/prices.json`. `bun run prices:update` writes it from [models.dev](https://models.dev) (MIT; its licence is `LICENSE.models-dev` beside the file) and from `curated.json`, the rates models.dev lacks, each entry naming the provider's page and row its numbers come from: the long cache-write rates (Anthropic's 1-hour writes, OpenAI's 12-hour writes) and the rates of a fast mode (Anthropic's fast mode, and OpenAI's Fast, which Codex asks for as the `priority` service tier). An update is a reviewed diff of the two files. The lists are `anthropic`, `openai`, `zai` and `opencode-go`.

A list gives, for each model, its price (`docs/specs/cost/spec.md`): the rates of the five classes in picodollars per token, and models.dev's context tiers as the price's tiers, each over the number of prompt tokens models.dev gives. A model can also have a price for a service tier, by the word the request log records in `service_tier` (`fast`, `priority`). A model also has the name models.dev gives it, which the hub shows as its built-in display name (`docs/specs/display-names/spec.md`); prices never depend on it. And it has the facts models.dev gives of it, each unknown where models.dev does not say: its context limit and its output limit, in tokens (models.dev's `limit.context` and `limit.output`, a whole number above zero, else unknown), and whether it takes image input (`modalities.input` holds `image`; unknown without `modalities.input`). `curated.json` may state a fact models.dev does not give, never one it does. The hub answers them to machines (`GET /api/machine`, `docs/specs/api/spec.md`); prices never depend on them.

- A pool names its price list with `prices`. The default is `anthropic` for `anthropic-messages`, `openai` for `chatgpt-codex`, and none for `openai-chat`. A name the hub does not ship is a configuration error.
- A request's price is looked up by the model that served it, then by the model asked for. An Anthropic model id is also tried without a trailing date (`-YYYYMMDD`). The first id found wins.
- When the model has a price for the service tier the request ran in, that is the price; otherwise the model's own price applies.
- A pool's own price for a model, in the configuration (ADR-0009), wins over its list, whatever the service tier.
- A model found nowhere has no price, so its requests have no cost (`docs/specs/cost/spec.md`). A model id is whatever the client sent: it is looked up only among the ids a list or a pool names, so `constructor` has no price.

The request log looks the price up once, as it writes the request (`docs/specs/request-log/spec.md`).

## Not built, on purpose

- **OpenAI Responses with a held key, Gemini.** A keyed pool speaks Chat Completions or Anthropic Messages, so a model a provider serves only over another protocol is not reachable yet.
- **A fallback pool for ChatGPT.** It needs a kept login the hub can refresh (Milestone 2).
- **Guessing a purpose.** Title requests, subagents and the main conversation are told apart when reading, from what is stored here: each request's request role (`docs/specs/sessions/spec.md`).
- **Web search and image fees** are not usage and are not in the cost.
