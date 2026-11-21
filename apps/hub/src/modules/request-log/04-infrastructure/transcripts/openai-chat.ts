import { Option, type Schema } from "effect";
import * as Transcript from "#modules/request-log/03-domain/transcript.ts";
import { fieldOf, stringOf } from "#shared/03-domain/conversation.ts";

const reasoningFields = ["reasoning_content", "reasoning", "reasoning_text"];

const partOf = (piece: Schema.Json): Transcript.MessagePart => {
  const type = stringOf(piece, "type");
  const text = fieldOf(piece, "text");
  if (type === "text" && typeof text === "string") {
    return Transcript.text(text);
  }
  if (type === "image_url") {
    return Transcript.imageOfUrl(
      Option.orElse(Transcript.stringAt(piece, "image_url", "url"), () =>
        Transcript.stringAt(piece, "image_url"),
      ),
    );
  }
  return Transcript.otherPart(piece);
};

const contentOf = (
  content: Schema.Json | undefined,
): ReadonlyArray<Transcript.MessagePart> => {
  if (typeof content === "string") {
    return content === "" ? [] : [Transcript.text(content)];
  }
  return Array.isArray(content) ? content.map(partOf) : [];
};

const said = (
  item: Schema.Json,
  part: Transcript.TranscriptPart,
): ReadonlyArray<Transcript.ItemEntry> => {
  if (typeof item === "string") {
    return [
      Transcript.message(part === "system" ? "system" : "user", [
        Transcript.text(item),
      ]),
    ];
  }
  const role = fieldOf(item, "role");
  if (typeof role !== "string") return [Transcript.other(item)];
  if (role === "tool") {
    return [
      Transcript.toolResult(
        Transcript.stringAt(item, "tool_call_id"),
        Transcript.outputOf(fieldOf(item, "content")),
        false,
      ),
    ];
  }
  const thought = reasoningFields
    .map((field) => fieldOf(item, field))
    .find((value) => typeof value === "string" && value !== "");
  const pieces = contentOf(fieldOf(item, "content"));
  const calls = fieldOf(item, "tool_calls");
  const said: Array<Transcript.ItemEntry> = [
    ...(typeof thought === "string"
      ? [Transcript.reasoning(Option.some(thought))]
      : []),
    ...(pieces.length > 0 ? [Transcript.message(role, pieces)] : []),
    ...(Array.isArray(calls)
      ? calls.map((call: Schema.Json) => {
          const called = fieldOf(call, "function") ?? null;
          return Transcript.toolCall(
            Transcript.stringAt(call, "id"),
            stringOf(called, "name"),
            Transcript.inputOf(fieldOf(called, "arguments")),
          );
        })
      : []),
  ];
  return said.length > 0 ? said : [Transcript.message(role, [])];
};

/** How OpenAI Chat Completions items read (`docs/specs/sessions/spec.md`, Transcripts). */
export const renderer: Transcript.Renderer = {
  said,
  tool: (item) => ({
    name: Option.orElse(Transcript.stringAt(item, "function", "name"), () =>
      Transcript.stringAt(item, "name"),
    ),
    description: Option.orElse(
      Transcript.stringAt(item, "function", "description"),
      () => Transcript.stringAt(item, "description"),
    ),
  }),
};
