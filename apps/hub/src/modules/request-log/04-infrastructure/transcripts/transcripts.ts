import { Layer } from "effect";
import { Transcripts } from "#modules/request-log/02-application/interfaces/transcripts.ts";
import * as Search from "#modules/request-log/03-domain/search.ts";
import type { StoredProtocol } from "#modules/request-log/03-domain/stored-protocol.ts";
import * as Transcript from "#modules/request-log/03-domain/transcript.ts";
import * as AnthropicMessages from "./anthropic-messages.ts";
import * as AntigravitySteps from "./antigravity-steps.ts";
import * as ChatGptCodex from "./chatgpt-codex.ts";
import * as OpenAiChat from "./openai-chat.ts";

/** The renderer of every protocol, source form and record form. */
export const renderers: Readonly<Record<StoredProtocol, Transcript.Renderer>> =
  {
    "anthropic-messages": AnthropicMessages.renderer,
    "chatgpt-codex": ChatGptCodex.renderer,
    "openai-chat": OpenAiChat.renderer,
    "bifrost-responses": ChatGptCodex.renderer,
    "bifrost-chat": OpenAiChat.renderer,
    "antigravity-steps": AntigravitySteps.renderer,
  };

export const layer: Layer.Layer<Transcripts> = Layer.succeed(
  Transcripts,
  Transcripts.of({
    entriesOf: (protocol, items, length) =>
      Transcript.entriesOf(renderers[protocol], items, length),
    toolsOf: (protocol, tools) =>
      Transcript.toolsOf(renderers[protocol], tools),
    shownOf: (protocol, part, content) =>
      Search.shownTextOf(renderers[protocol], part, content),
  }),
);
