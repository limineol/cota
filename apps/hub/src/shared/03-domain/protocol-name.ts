import { Schema } from "effect";

export const ProtocolName = Schema.Literals([
  "anthropic-messages",
  "chatgpt-codex",
  "openai-chat",
]);
export type ProtocolName = typeof ProtocolName.Type;
