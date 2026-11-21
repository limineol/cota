import { Option, Schema } from "effect";
import * as Conversation from "#shared/03-domain/conversation.ts";
import type { StoredContent } from "./session.ts";

/** How many characters of each text a session's transcript keeps, and the inspector's. */
export const longest = { session: 20_000, inspector: 100_000 } as const;

/** How many characters of a tool's description the inspector keeps. */
const longestDescription = 2_000;

/** The parts of a request a transcript sets out, in its order. */
export const parts = ["system", "input", "output"] as const;
export type TranscriptPart = (typeof parts)[number];

/** A piece of a message. An image is shown by its media type and its decoded size, never its bytes. */
export type MessagePart =
  | { readonly type: "text"; readonly text: string; readonly cut: number }
  | {
      readonly type: "image";
      readonly mediaType: Option.Option<string>;
      readonly bytes: Option.Option<number>;
    }
  | { readonly type: "other"; readonly json: string; readonly cut: number };

/** An entry as a renderer reads it in one item, before it is placed in a transcript and its texts are cut. */
export type ItemEntry =
  | {
      readonly kind: "message";
      readonly role: string;
      readonly parts: ReadonlyArray<MessagePart>;
    }
  | {
      readonly kind: "reasoning";
      /** None when only an encrypted or redacted form was sent: the reasoning is hidden. */
      readonly text: Option.Option<string>;
      readonly cut: number;
    }
  | {
      readonly kind: "tool-call";
      readonly callId: Option.Option<string>;
      readonly name: string;
      readonly input: string;
      readonly cut: number;
    }
  | {
      readonly kind: "tool-result";
      readonly callId: Option.Option<string>;
      /** The name of the call with the same id earlier in the transcript. */
      readonly name: Option.Option<string>;
      readonly output: string;
      readonly error: boolean;
      readonly cut: number;
    }
  | { readonly kind: "other"; readonly json: string; readonly cut: number };

/** One thing a transcript shows, with the item it comes from and that item's part. */
export type Entry = ItemEntry & {
  readonly item: Conversation.Digest;
  readonly part: TranscriptPart;
};

/** A tool definition as the inspector lists it. */
export interface Tool {
  readonly name: Option.Option<string>;
  readonly description: Option.Option<string>;
}

/** How a protocol's items read: what each says, and what a tool definition is called. */
export interface Renderer {
  readonly said: (
    item: Schema.Json,
    part: TranscriptPart,
  ) => ReadonlyArray<ItemEntry>;
  readonly tool: (item: Schema.Json) => Tool;
}

export type Parts = Readonly<
  Record<TranscriptPart, ReadonlyArray<StoredContent>>
>;

export const text = (value: string): MessagePart => ({
  type: "text",
  text: value,
  cut: 0,
});

export const message = (
  role: string,
  messageParts: ReadonlyArray<MessagePart>,
): ItemEntry => ({ kind: "message", role, parts: messageParts });

export const reasoning = (value: Option.Option<string>): ItemEntry => ({
  kind: "reasoning",
  text: Option.filter(value, (each) => each !== ""),
  cut: 0,
});

export const toolCall = (
  callId: Option.Option<string>,
  name: string,
  input: string,
): ItemEntry => ({ kind: "tool-call", callId, name, input, cut: 0 });

export const toolResult = (
  callId: Option.Option<string>,
  output: string,
  error: boolean,
): ItemEntry => ({
  kind: "tool-result",
  callId,
  name: Option.none(),
  output,
  error,
  cut: 0,
});

const isObject = (value: Schema.Json): value is Schema.JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const withheldFields = new Set(["data", "encrypted_content"]);

const isDataUrl = (value: string) =>
  value.startsWith("data:") && value.includes(";base64,");

const withheld = (value: string): string =>
  `[withheld: ${[...value].length} characters]`;

const withholding = (value: Schema.Json): Schema.Json => {
  if (typeof value === "string") {
    return isDataUrl(value) ? withheld(value) : value;
  }
  if (Array.isArray(value)) return value.map(withholding);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, each]) => [
      key,
      withheldFields.has(key) && typeof each === "string"
        ? withheld(each)
        : withholding(each),
    ]),
  );
};

/**
 * A value's canonical JSON, with what a transcript never shows withheld: the
 * string of a field named `data` or `encrypted_content`, and a `data:` URL,
 * each replaced by `[withheld: n characters]`.
 */
export const jsonOf = (value: Schema.Json): string =>
  Conversation.canonical(withholding(value));

export const other = (value: Schema.Json): ItemEntry => ({
  kind: "other",
  json: jsonOf(value),
  cut: 0,
});

export const otherPart = (value: Schema.Json): MessagePart => ({
  type: "other",
  json: jsonOf(value),
  cut: 0,
});

/** How many bytes base64 decodes to, without decoding it. */
const decodedSize = (base64: string): number => {
  const digits = base64.replace(/[\s=]/g, "").length;
  return Math.floor((digits * 3) / 4);
};

/** An image carried in an item as base64, or only named (a URL, a file id), when its data is none. */
export const image = (
  mediaType: Option.Option<string>,
  data: Option.Option<string>,
): MessagePart => ({
  type: "image",
  mediaType: Option.filter(mediaType, (each) => each !== ""),
  bytes: Option.map(data, decodedSize),
});

/** An image given as a URL: a `data:` URL carries its media type and bytes, any other only names it. */
export const imageOfUrl = (url: Option.Option<string>): MessagePart => {
  const carried = Option.flatMap(url, (each) =>
    Option.fromNullishOr(each.match(/^data:([^;,]*)(?:;[^,]*)?;base64,(.*)$/s)),
  );
  return image(
    Option.flatMap(carried, ([, mediaType]) => Option.fromNullishOr(mediaType)),
    Option.flatMap(carried, ([, , data]) => Option.fromNullishOr(data)),
  );
};

/** A string as it is; else the value in canonical form, as a call's input is shown. */
export const inputOf = (value: Schema.Json | undefined): string => {
  if (value === undefined) return "";
  return typeof value === "string" ? value : jsonOf(value);
};

const textTypes = new Set(["text", "input_text", "output_text"]);

/**
 * What a tool's result says: a string as it is; a list of text pieces, their
 * text joined by a blank line; anything else, its JSON with what a transcript
 * never shows withheld.
 */
export const outputOf = (value: Schema.Json | undefined): string => {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (
    Array.isArray(value) &&
    value.every(
      (piece: Schema.Json) =>
        textTypes.has(Conversation.stringOf(piece, "type")) &&
        typeof Conversation.fieldOf(piece, "text") === "string",
    )
  ) {
    return value
      .map((piece: Schema.Json) => Conversation.stringOf(piece, "text"))
      .join("\n\n");
  }
  return jsonOf(value);
};

export const stringAt = (
  value: Schema.Json | undefined,
  ...path: ReadonlyArray<string>
): Option.Option<string> => {
  const found = path.reduce<Schema.Json | undefined>(
    (each, key) =>
      each === undefined ? undefined : Conversation.fieldOf(each, key),
    value,
  );
  return typeof found === "string" ? Option.some(found) : Option.none();
};

/** A text cut to `length` code points, and how many were left out. */
const cutTo = (
  value: string,
  length: number,
): { readonly text: string; readonly cut: number } => {
  if (value.length <= length) return { text: value, cut: 0 };
  const points = [...value];
  if (points.length <= length) return { text: value, cut: 0 };
  return {
    text: points.slice(0, length).join(""),
    cut: points.length - length,
  };
};

const cutPart = (piece: MessagePart, length: number): MessagePart => {
  switch (piece.type) {
    case "text": {
      const { text: kept, cut } = cutTo(piece.text, length);
      return { type: "text", text: kept, cut };
    }
    case "other": {
      const { text: kept, cut } = cutTo(piece.json, length);
      return { type: "other", json: kept, cut };
    }
    case "image":
      return piece;
  }
};

const cutEntry = (said: ItemEntry, length: number): ItemEntry => {
  switch (said.kind) {
    case "message":
      return {
        ...said,
        parts: said.parts.map((piece) => cutPart(piece, length)),
      };
    case "reasoning": {
      if (Option.isNone(said.text)) return said;
      const { text: kept, cut } = cutTo(said.text.value, length);
      return { ...said, text: Option.some(kept), cut };
    }
    case "tool-call": {
      const { text: kept, cut } = cutTo(said.input, length);
      return { ...said, input: kept, cut };
    }
    case "tool-result": {
      const { text: kept, cut } = cutTo(said.output, length);
      return { ...said, output: kept, cut };
    }
    case "other": {
      const { text: kept, cut } = cutTo(said.json, length);
      return { ...said, json: kept, cut };
    }
  }
};

/** Every character an entry left out, its parts' included. */
export const cutOf = (entry: ItemEntry): number =>
  entry.kind === "message"
    ? entry.parts.reduce(
        (sum, piece) => sum + (piece.type === "image" ? 0 : piece.cut),
        0,
      )
    : entry.cut;

const decodeItem = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Json),
);

/**
 * A request's transcript (`docs/specs/sessions/spec.md`, Transcripts): the
 * items of its system, input and output parts in order, each as the entries
 * its protocol's renderer reads in it (T10), a tool result named by the
 * earlier call with its id, and every text cut at `length` characters with
 * the number left out (T11).
 */
export const entriesOf = (
  renderer: Renderer,
  items: Parts,
  length: number,
): ReadonlyArray<Entry> => {
  const names = new Map<string, string>();
  const entries: Array<Entry> = [];
  for (const part of parts) {
    for (const { digest, content } of items[part]) {
      const said = Option.match(decodeItem(content), {
        onNone: () => [{ kind: "other", json: content, cut: 0 } as const],
        onSome: (item) => renderer.said(item, part),
      });
      for (const each of said) {
        if (each.kind === "tool-call" && Option.isSome(each.callId)) {
          names.set(each.callId.value, each.name);
        }
        const named: ItemEntry =
          each.kind === "tool-result"
            ? {
                ...each,
                name: Option.flatMap(each.callId, (id) =>
                  Option.fromUndefinedOr(names.get(id)),
                ),
              }
            : each;
        entries.push({ ...cutEntry(named, length), item: digest, part });
      }
    }
  }
  return entries;
};

/** A request's tool definitions, each description cut to 2,000 characters. */
export const toolsOf = (
  renderer: Renderer,
  items: ReadonlyArray<StoredContent>,
): ReadonlyArray<Tool> =>
  items.map(({ content }) =>
    Option.match(decodeItem(content), {
      onNone: () => ({ name: Option.none(), description: Option.none() }),
      onSome: (item) => {
        const tool = renderer.tool(item);
        return {
          name: tool.name,
          description: Option.map(
            tool.description,
            (description) => cutTo(description, longestDescription).text,
          ),
        };
      },
    }),
  );
