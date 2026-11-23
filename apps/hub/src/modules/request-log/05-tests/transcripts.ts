import { Arbitrary, Schema } from "effect";
import type { StoredContent } from "#modules/request-log/03-domain/session.ts";
import type { StoredProtocol } from "#modules/request-log/03-domain/stored-protocol.ts";
import type * as Transcript from "#modules/request-log/03-domain/transcript.ts";
import * as Conversation from "#shared/03-domain/conversation.ts";
import type { ProtocolName } from "#shared/03-domain/protocol-name.ts";
import * as Steps from "./antigravity-steps.ts";
import { pick } from "./sessions.ts";

const int = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

/** Texts of up to 60 characters, of one, two and four UTF-8 bytes, and of a surrogate pair. */
const text = Arbitrary.all({
  unit: pick(["a", "é", "€", "😀", "\n", "{"]),
  times: int(0, 60),
}).pipe(Arbitrary.map(({ unit, times }) => unit.repeat(times)));

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==";

type Template = (texts: ReadonlyArray<string>) => Schema.Json;

const at = (texts: ReadonlyArray<string>, index: number) => texts[index] ?? "";

/** Items in each protocol's shapes, known and not, as a client sends them and a provider answers. */
const wireTemplates: Readonly<Record<ProtocolName, ReadonlyArray<Template>>> = {
  "anthropic-messages": [
    (t) => at(t, 0),
    (t) => ({ type: "text", text: at(t, 0) }),
    (t) => ({ role: "user", content: at(t, 0) }),
    () => ({ role: "user", content: [] }),
    (t) => ({
      role: "assistant",
      content: [
        { type: "thinking", thinking: at(t, 0), signature: "c2lnbmF0dXJl" },
        { type: "text", text: at(t, 1) },
        {
          type: "tool_use",
          id: "toolu_1",
          name: "read",
          input: { path: at(t, 2) },
        },
      ],
    }),
    (t) => ({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_1",
          content: at(t, 0),
          is_error: true,
        },
        { type: "text", text: at(t, 1) },
      ],
    }),
    (t) => ({
      role: "user",
      content: [
        {
          type: "image",
          source: { type: "base64", media_type: "image/png", data: png },
        },
        { type: "text", text: at(t, 0) },
      ],
    }),
    () => ({
      role: "assistant",
      content: [{ type: "redacted_thinking", data: "ZW5jcnlwdGVk" }],
    }),
    (t) => ({
      role: "system",
      content: [
        { type: "text", text: at(t, 0) },
        { type: "tool_addition", tools: [{ name: at(t, 1) }] },
      ],
    }),
    (t) => ({
      role: "assistant",
      content: [
        {
          type: "server_tool_use",
          id: "srvtoolu_1",
          name: "web_search",
          input: { query: at(t, 0) },
        },
        {
          type: "web_search_tool_result",
          tool_use_id: "srvtoolu_1",
          content: [
            {
              type: "web_search_result",
              url: at(t, 1),
              encrypted_content: "ZW5j",
            },
          ],
        },
      ],
    }),
    (t) => ({ role: "user", content: 7, note: at(t, 0) }),
    (t) => ({ unknown: at(t, 0) }),
    () => 42,
    () => null,
  ],
  "chatgpt-codex": [
    (t) => at(t, 0),
    (t) => ({
      type: "message",
      role: "user",
      content: [
        { type: "input_text", text: at(t, 0) },
        { type: "input_image", image_url: `data:image/png;base64,${png}` },
      ],
    }),
    (t) => ({ role: "assistant", content: at(t, 0) }),
    (t) => ({
      type: "message",
      role: "assistant",
      content: [
        { type: "output_text", text: at(t, 0) },
        { type: "refusal", refusal: at(t, 1) },
      ],
    }),
    () => ({ type: "message", role: "developer", content: [] }),
    (t) => ({
      type: "reasoning",
      summary: [
        { type: "summary_text", text: at(t, 0) },
        { type: "summary_text", text: at(t, 1) },
      ],
      encrypted_content: "ZW5jcnlwdGVk",
    }),
    () => ({ type: "reasoning", summary: [], encrypted_content: "ZW5j" }),
    (t) => ({
      type: "function_call",
      call_id: "call_1",
      name: "exec",
      arguments: at(t, 0),
    }),
    (t) => ({
      type: "function_call_output",
      call_id: "call_1",
      output: at(t, 0),
    }),
    (t) => ({
      type: "custom_tool_call",
      call_id: "call_2",
      name: "apply_patch",
      input: at(t, 0),
    }),
    (t) => ({
      type: "custom_tool_call_output",
      call_id: "call_2",
      output: [{ type: "input_text", text: at(t, 0) }],
    }),
    (t) => ({
      type: "local_shell_call",
      call_id: "call_3",
      action: { command: [at(t, 0)] },
    }),
    (t) => ({
      type: "web_search_call",
      id: "ws_1",
      action: { query: at(t, 0) },
    }),
    () => ({ type: "additional_tools", role: "developer", tools: [] }),
    (t) => ({ type: "compaction", encrypted_content: at(t, 0) }),
    () => ({ type: "message" }),
    () => null,
  ],
  "openai-chat": [
    (t) => at(t, 0),
    (t) => ({ role: "system", content: at(t, 0) }),
    (t) => ({
      role: "user",
      content: [
        { type: "text", text: at(t, 0) },
        {
          type: "image_url",
          image_url: { url: `data:image/png;base64,${png}` },
        },
      ],
    }),
    (t) => ({
      role: "assistant",
      content: "",
      reasoning_content: at(t, 0),
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "read", arguments: at(t, 1) },
        },
      ],
    }),
    () => ({ role: "assistant", content: null }),
    (t) => ({ role: "tool", tool_call_id: "call_1", content: at(t, 0) }),
    (t) => ({ role: "assistant", content: at(t, 0), reasoning: at(t, 1) }),
    (t) => ({ name: at(t, 0) }),
    () => false,
  ],
};

/**
 * Items in each source form's shapes too: Bifrost's Responses items, with the
 * ids it makes up and the types the prototype's log holds (ADR-0025, fact 9),
 * and its chat messages, which have no type.
 */
const templates: Readonly<Record<StoredProtocol, ReadonlyArray<Template>>> = {
  ...wireTemplates,
  "bifrost-responses": [
    ...wireTemplates["chatgpt-codex"],
    (t) => ({
      type: "message",
      id: "msg_bifrost",
      role: "user",
      content: at(t, 0),
    }),
    (t) => ({
      type: "message",
      role: "system",
      content: [{ type: "input_text", text: at(t, 0) }],
    }),
    () => ({ type: "compaction_trigger" }),
    () => ({ type: "configuration_update", reasoning: { effort: "low" } }),
  ],
  "bifrost-chat": wireTemplates["openai-chat"],
  "antigravity-steps": [
    (t) => Steps.userMessage(0, at(t, 0)),
    (t) =>
      Steps.modelOutput(1, {
        text: at(t, 0),
        thoughts: at(t, 1),
        calls: [{ id: "call_1", name: "read_file", arguments: at(t, 2) }],
      }),
    (t) =>
      Steps.modelOutput(2, {
        calls: [
          { id: "call_2", name: "read_file", arguments: at(t, 0) },
          { id: "call_3", name: "read_file", arguments: at(t, 1) },
        ],
      }),
    () => Steps.modelOutput(3, {}),
    (t) =>
      Steps.toolResult(
        4,
        { id: "call_1", name: "read_file", arguments: "{}" },
        at(t, 0),
      ),
    (t) => Steps.compaction(5, at(t, 0)),
    (t) => Steps.step(6, 99, [{ number: 50, text: at(t, 0) }]),
    () => Steps.step(7, 14, []),
    (t) =>
      Steps.step(8, 15, [
        { number: 20, bytes: new Uint8Array([0x0a, 0xff, 0x01]) },
        { number: 21, text: at(t, 0) },
      ]),
    (t) =>
      Steps.step(9, "14", [
        { number: 19, message: [{ number: 2, text: at(t, 0) }] },
      ]),
    (t) => ({ idx: 10, step_type: 14, status: 3, note: at(t, 0) }),
    () => null,
  ],
};

const storedOf = (item: Schema.Json): StoredContent => {
  const content = Conversation.canonical(item);
  return {
    digest: Conversation.digestOf(content),
    type: Conversation.stringOf(item, "type"),
    role: Conversation.stringOf(item, "role"),
    content,
  };
};

const items = (protocol: StoredProtocol, maxLength: number) =>
  Arbitrary.array(
    Arbitrary.all({
      template: int(0, templates[protocol].length - 1),
      texts: Arbitrary.array(text, { minLength: 3, maxLength: 3 }),
      twice: pick([false, false, false, true]),
    }),
    { maxLength },
  ).pipe(
    Arbitrary.map((generated) =>
      generated.flatMap(({ template, texts, twice }) => {
        const item = storedOf(templates[protocol][template]?.(texts) ?? null);
        return twice ? [item, item] : [item];
      }),
    ),
  );

/**
 * A request's system, input and output items in one protocol's shapes, known
 * ones and ones its renderer does not know, some twice in a row.
 */
export const requestItems = pick([
  "anthropic-messages",
  "chatgpt-codex",
  "openai-chat",
  "bifrost-responses",
  "bifrost-chat",
  "antigravity-steps",
]).pipe(
  Arbitrary.flatMap((protocol) =>
    Arbitrary.all({
      protocol: Arbitrary.Constant(protocol),
      items: Arbitrary.all({
        system: items(protocol, 2),
        input: items(protocol, 8),
        output: items(protocol, 3),
      }),
    }),
  ),
);

export type RequestItems = {
  readonly protocol: StoredProtocol;
  readonly items: Transcript.Parts;
};
