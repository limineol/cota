import type { Schema } from "effect";
import * as Conversation from "./conversation.ts";

const textsOf = (value: Schema.Json | undefined): ReadonlyArray<string> => {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.map((part: Schema.Json) => Conversation.stringOf(part, "text"));
};

const argumentsText = (
  value: Schema.Json | undefined,
): ReadonlyArray<string> => {
  if (value === undefined) return [];
  return typeof value === "string" ? [value] : [Conversation.canonical(value)];
};

const responsesTexts = (item: Schema.Json): ReadonlyArray<string> => {
  if (typeof item === "string") return [item];
  const type = Conversation.stringOf(item, "type");
  const field = (key: string) => Conversation.fieldOf(item, key);
  switch (type) {
    case "reasoning":
      return textsOf(field("summary"));
    case "function_call":
    case "tool_search_call":
      return argumentsText(field("arguments"));
    case "custom_tool_call":
      return argumentsText(field("input"));
    case "local_shell_call":
    case "web_search_call":
      return argumentsText(field("action"));
    case "function_call_output":
    case "custom_tool_call_output":
      return textsOf(field("output"));
    case "":
    case "message":
      return textsOf(field("content"));
    default:
      return [];
  }
};

/** What a person would read in an item of OpenAI's Responses shape, as Codex sends it and Bifrost logged every conversation but a chat one. */
export const responsesTextOf = (item: Schema.Json): string =>
  responsesTexts(item)
    .filter((text) => text !== "")
    .join("\n\n");

/** The fields a Chat Completions message or delta carries its reasoning in. */
export const reasoningFields = [
  "reasoning_content",
  "reasoning",
  "reasoning_text",
];

const contentText = (
  content: Schema.Json | undefined,
): ReadonlyArray<string> => {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  return content.map((part: Schema.Json) =>
    typeof part === "string" ? part : Conversation.stringOf(part, "text"),
  );
};

const toolCallsText = (
  calls: Schema.Json | undefined,
): ReadonlyArray<string> =>
  Array.isArray(calls)
    ? calls.map((call: Schema.Json) =>
        Conversation.stringOf(
          Conversation.fieldOf(call, "function") ?? null,
          "arguments",
        ),
      )
    : [];

/** What a person would read in a Chat Completions message. */
export const chatTextOf = (item: Schema.Json): string =>
  [
    ...contentText(Conversation.fieldOf(item, "content")),
    ...reasoningFields.map((field) => Conversation.stringOf(item, field)),
    ...toolCallsText(Conversation.fieldOf(item, "tool_calls")),
  ]
    .filter((text) => text !== "")
    .join("\n\n");
