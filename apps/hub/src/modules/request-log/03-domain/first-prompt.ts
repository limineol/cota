import { Option, Schema } from "effect";
import type { StoredProtocol } from "#modules/request-log/03-domain/stored-protocol.ts";
import { cut } from "#shared/03-domain/text.ts";
import type { Roled } from "./request-role.ts";
import type { SessionRequest, StoredContent } from "./session.ts";

/** How many characters of a first prompt are kept. */
export const longest = 500;

/** The session's first request whose role is `main` and which has a conversation (T12). */
export const firstMainRequestOf = (
  roled: ReadonlyArray<Roled>,
): Option.Option<SessionRequest> =>
  Option.map(
    Option.fromUndefinedOr(
      roled.find(
        ({ requestRole, request }) =>
          requestRole === "main" && Option.isSome(request.conversation),
      ),
    ),
    ({ request }) => request,
  );

const Content = Schema.Union([Schema.String, Schema.Array(Schema.Unknown)]);

const Message = Schema.fromJsonString(
  Schema.Struct({
    type: Schema.optional(Schema.String),
    role: Schema.String,
    content: Content,
  }),
);

const Part = Schema.Struct({ type: Schema.String, text: Schema.String });

/** The part of a user message that holds its text, in each protocol. */
const textPart: Readonly<Record<StoredProtocol, string>> = {
  "anthropic-messages": "text",
  "chatgpt-codex": "input_text",
  "openai-chat": "text",
  "bifrost-responses": "input_text",
  "bifrost-chat": "text",
};

/**
 * The text of a user message: its content when that is a string, except for
 * `chatgpt-codex`, else the text of its last text part. A user message of
 * Codex, and of the Responses source form, is an item of type `message`, or
 * one with no type.
 */
const textOf = (
  protocol: StoredProtocol,
  { type, role, content }: typeof Message.Type,
): Option.Option<string> => {
  if (role !== "user") return Option.none();
  const responses =
    protocol === "chatgpt-codex" || protocol === "bifrost-responses";
  if (responses && type !== undefined && type !== "message") {
    return Option.none();
  }
  if (protocol === "chatgpt-codex" && typeof content === "string") {
    return Option.none();
  }
  if (typeof content === "string") return Option.some(content);
  return Option.map(
    Option.fromUndefinedOr(
      content
        .filter(Schema.is(Part))
        .findLast(({ type }) => type === textPart[protocol]),
    ),
    ({ text }) => text,
  );
};

/**
 * The text of the last user message among a request's input items, cut to
 * 500 characters (`docs/specs/sessions/spec.md`, First prompt).
 */
export const firstPromptOf = (
  protocol: StoredProtocol,
  input: ReadonlyArray<StoredContent>,
): Option.Option<string> => {
  for (const item of [...input].reverse()) {
    const text = Option.flatMap(
      Schema.decodeOption(Message)(item.content),
      (message) => textOf(protocol, message),
    );
    if (Option.isSome(text)) return Option.some(cut(text.value, longest));
  }
  return Option.none();
};
