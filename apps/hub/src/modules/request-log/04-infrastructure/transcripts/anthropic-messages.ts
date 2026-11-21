import { Option, type Schema } from "effect";
import * as Transcript from "#modules/request-log/03-domain/transcript.ts";
import { fieldOf, stringOf } from "#shared/03-domain/conversation.ts";

const toolCalls = new Set(["tool_use", "server_tool_use", "mcp_tool_use"]);

const isToolResult = (type: string) =>
  type === "tool_result" || type.endsWith("_tool_result");

/** A message's content blocks, in order, consecutive text, image and unknown blocks as one message. */
const blocksOf = (
  role: string,
  blocks: ReadonlyArray<Schema.Json>,
): ReadonlyArray<Transcript.ItemEntry> => {
  const said: Array<Transcript.ItemEntry> = [];
  let pieces: Array<Transcript.MessagePart> = [];
  const flush = () => {
    if (pieces.length > 0) said.push(Transcript.message(role, pieces));
    pieces = [];
  };
  for (const block of blocks) {
    const type = stringOf(block, "type");
    const text = fieldOf(block, "text");
    if (type === "text" && typeof text === "string") {
      pieces.push(Transcript.text(text));
    } else if (type === "image") {
      const source = fieldOf(block, "source");
      pieces.push(
        Transcript.image(
          Transcript.stringAt(source, "media_type"),
          stringOf(source ?? null, "type") === "base64"
            ? Transcript.stringAt(source, "data")
            : Option.none(),
        ),
      );
    } else if (type === "thinking") {
      flush();
      said.push(Transcript.reasoning(Transcript.stringAt(block, "thinking")));
    } else if (type === "redacted_thinking") {
      flush();
      said.push(Transcript.reasoning(Option.none()));
    } else if (toolCalls.has(type)) {
      flush();
      said.push(
        Transcript.toolCall(
          Transcript.stringAt(block, "id"),
          stringOf(block, "name"),
          Transcript.inputOf(fieldOf(block, "input")),
        ),
      );
    } else if (isToolResult(type)) {
      flush();
      said.push(
        Transcript.toolResult(
          Transcript.stringAt(block, "tool_use_id"),
          Transcript.outputOf(fieldOf(block, "content")),
          fieldOf(block, "is_error") === true,
        ),
      );
    } else {
      pieces.push(Transcript.otherPart(block));
    }
  }
  flush();
  return said.length > 0 ? said : [Transcript.message(role, [])];
};

const said = (
  item: Schema.Json,
  part: Transcript.TranscriptPart,
): ReadonlyArray<Transcript.ItemEntry> => {
  const own = part === "system" ? "system" : "user";
  if (typeof item === "string") {
    return [Transcript.message(own, [Transcript.text(item)])];
  }
  const role = fieldOf(item, "role");
  if (typeof role !== "string") {
    return part === "system" && typeof fieldOf(item, "type") === "string"
      ? blocksOf(own, [item])
      : [Transcript.other(item)];
  }
  const content = fieldOf(item, "content");
  if (typeof content === "string") {
    return [Transcript.message(role, [Transcript.text(content)])];
  }
  if (Array.isArray(content)) return blocksOf(role, content);
  return [Transcript.other(item)];
};

/** How Anthropic Messages items read (`docs/specs/sessions/spec.md`, Transcripts). */
export const renderer: Transcript.Renderer = {
  said,
  tool: (item) => ({
    name: Transcript.stringAt(item, "name"),
    description: Transcript.stringAt(item, "description"),
  }),
};
