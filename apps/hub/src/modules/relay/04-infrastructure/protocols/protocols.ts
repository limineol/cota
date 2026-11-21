import { Layer } from "effect";
import * as Protocol from "#modules/relay/02-application/interfaces/protocol.ts";
import type { ProtocolName } from "#shared/03-domain/protocol-name.ts";
import * as AnthropicMessages from "./anthropic-messages/anthropic-messages.ts";
import * as ChatgptCodex from "./chatgpt-codex/chatgpt-codex.ts";
import * as OpenAiChat from "./openai-chat/openai-chat.ts";

export const protocolsOf = (
  known: Readonly<Record<ProtocolName, Protocol.Protocol>>,
): Layer.Layer<Protocol.Protocols> =>
  Layer.succeed(
    Protocol.Protocols,
    Protocol.Protocols.of({ of: (name) => known[name] }),
  );

export const shipped: Readonly<Record<ProtocolName, Protocol.Protocol>> = {
  "anthropic-messages": AnthropicMessages.protocol,
  "chatgpt-codex": ChatgptCodex.protocol,
  "openai-chat": OpenAiChat.protocol,
};

/** The protocols the hub ships. */
export const layer = protocolsOf(shipped);
