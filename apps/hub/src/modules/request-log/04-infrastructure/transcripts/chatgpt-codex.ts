import { Option, type Schema } from "effect";
import * as Transcript from "#modules/request-log/03-domain/transcript.ts";
import { fieldOf, stringOf } from "#shared/03-domain/conversation.ts";

const textParts: Readonly<Record<string, string>> = {
  input_text: "text",
  output_text: "text",
  refusal: "refusal",
};

const toolCalls = new Set([
  "function_call",
  "custom_tool_call",
  "tool_search_call",
  "local_shell_call",
  "web_search_call",
]);

const toolResults = new Set([
  "function_call_output",
  "custom_tool_call_output",
]);

const partOf = (piece: Schema.Json): Transcript.MessagePart => {
  const type = stringOf(piece, "type");
  const field = textParts[type];
  const text = field === undefined ? undefined : fieldOf(piece, field);
  if (typeof text === "string") return Transcript.text(text);
  if (type === "input_image") {
    return Transcript.imageOfUrl(Transcript.stringAt(piece, "image_url"));
  }
  return Transcript.otherPart(piece);
};

const messageOf = (item: Schema.Json): Transcript.ItemEntry => {
  const role = stringOf(item, "role");
  const content = fieldOf(item, "content");
  if (typeof content === "string") {
    return Transcript.message(role, [Transcript.text(content)]);
  }
  return Transcript.message(
    role,
    Array.isArray(content) ? content.map(partOf) : [],
  );
};

const textsOf = (
  value: Schema.Json | undefined,
  type: string,
): ReadonlyArray<string> =>
  Array.isArray(value)
    ? value.flatMap((piece: Schema.Json) =>
        stringOf(piece, "type") === type
          ? Option.toArray(Transcript.stringAt(piece, "text"))
          : [],
      )
    : [];

/** Its summary's text, else its `reasoning_text` content; hidden when it has neither. */
const reasoningOf = (item: Schema.Json): Transcript.ItemEntry => {
  const summary = textsOf(fieldOf(item, "summary"), "summary_text");
  const texts =
    summary.length > 0
      ? summary
      : textsOf(fieldOf(item, "content"), "reasoning_text");
  return Transcript.reasoning(
    texts.length > 0 ? Option.some(texts.join("\n\n")) : Option.none(),
  );
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
  const type = fieldOf(item, "type");
  if (type === undefined || type === "message") {
    return typeof fieldOf(item, "role") === "string"
      ? [messageOf(item)]
      : [Transcript.other(item)];
  }
  if (type === "reasoning") return [reasoningOf(item)];
  if (typeof type === "string" && toolCalls.has(type)) {
    return [
      Transcript.toolCall(
        Option.orElse(Transcript.stringAt(item, "call_id"), () =>
          Transcript.stringAt(item, "id"),
        ),
        Option.getOrElse(Transcript.stringAt(item, "name"), () => type),
        Transcript.inputOf(
          fieldOf(item, "arguments") ??
            fieldOf(item, "input") ??
            fieldOf(item, "action"),
        ),
      ),
    ];
  }
  if (typeof type === "string" && toolResults.has(type)) {
    return [
      Transcript.toolResult(
        Transcript.stringAt(item, "call_id"),
        Transcript.outputOf(fieldOf(item, "output")),
        false,
      ),
    ];
  }
  return [Transcript.other(item)];
};

/** How ChatGPT's Codex backend's items read (`docs/specs/sessions/spec.md`, Transcripts). */
export const renderer: Transcript.Renderer = {
  said,
  tool: (item) => ({
    name: Transcript.stringAt(item, "name"),
    description: Transcript.stringAt(item, "description"),
  }),
};
