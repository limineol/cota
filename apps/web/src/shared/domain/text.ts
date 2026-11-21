export type Fenced =
  | { readonly kind: "prose"; readonly raw: string }
  | {
      readonly kind: "code";
      readonly raw: string;
      readonly language: string;
      readonly code: string;
    };

const fence = "```";

const code = (raw: string, language: string, body: string): Fenced => ({
  kind: "code",
  raw,
  language,
  code: body.endsWith("\n") ? body.slice(0, -1) : body,
});

/** A text cut into prose and fenced code, each piece keeping its `raw` characters, so that the pieces put together are the text: a fence opens at a line that begins with three backticks and closes at the next such line, or at the end. */
export const fencesOf = (text: string): ReadonlyArray<Fenced> => {
  const pieces: Array<Fenced> = [];
  let prose = 0;
  let open: { readonly start: number; readonly language: string } | null = null;
  let body = 0;
  let line = 0;
  for (;;) {
    const end = text.indexOf("\n", line);
    const next = end === -1 ? text.length : end + 1;
    const content = text.slice(line, end === -1 ? text.length : end);
    if (content.startsWith(fence)) {
      if (open === null) {
        if (line > prose) {
          pieces.push({ kind: "prose", raw: text.slice(prose, line) });
        }
        open = { start: line, language: content.slice(fence.length).trim() };
        body = next;
      } else {
        pieces.push(
          code(
            text.slice(open.start, next),
            open.language,
            text.slice(body, line),
          ),
        );
        open = null;
        prose = next;
      }
    }
    if (end === -1) break;
    line = next;
  }
  if (open !== null) {
    pieces.push(code(text.slice(open.start), open.language, text.slice(body)));
  } else if (prose < text.length) {
    pieces.push({ kind: "prose", raw: text.slice(prose) });
  }
  return pieces;
};

export type Block =
  | { readonly kind: "space"; readonly raw: string }
  | { readonly kind: "paragraph"; readonly raw: string; readonly text: string }
  | {
      readonly kind: "heading";
      readonly raw: string;
      readonly text: string;
    }
  | {
      readonly kind: "list";
      readonly raw: string;
      readonly ordered: boolean;
      readonly items: ReadonlyArray<string>;
    };

const blankLines = /(\n(?:[ \t]*\n)+)/;
const heading = /^#{1,4}[ \t]+(.*)$/;
const bullet = /^[ \t]*[-*+][ \t]+/;
const numbered = /^[ \t]*\d{1,3}[.)][ \t]+/;

const trimLines = (text: string) => text.replace(/^\n+|\n+$/g, "");

const blockOf = (raw: string): Block => {
  const text = trimLines(raw);
  const lines = text.split("\n");
  const [first = ""] = lines;
  const titled = lines.length === 1 ? heading.exec(first) : null;
  if (titled !== null) {
    return { kind: "heading", raw, text: titled[1] ?? "" };
  }
  const ordered = numbered.test(first);
  if (!ordered && !bullet.test(first)) return { kind: "paragraph", raw, text };
  const marker = ordered ? numbered : bullet;
  const items: Array<string> = [];
  for (const line of lines) {
    const item = marker.exec(line);
    if (item !== null || items.length === 0) {
      items.push(line.slice(item?.[0].length ?? 0));
    } else {
      items[items.length - 1] = `${items.at(-1) ?? ""}\n${line.trim()}`;
    }
  }
  return { kind: "list", raw, ordered, items };
};

/** Prose cut into blocks at blank lines: a heading is one line of one to four `#`, a list begins with a bullet or a number, and the rest are paragraphs. */
export const blocksOf = (prose: string): ReadonlyArray<Block> =>
  prose
    .split(blankLines)
    .filter((raw) => raw !== "")
    .map((raw) => (raw.trim() === "" ? { kind: "space", raw } : blockOf(raw)));

export type Inline =
  | { readonly kind: "text"; readonly raw: string }
  | { readonly kind: "code"; readonly raw: string; readonly text: string }
  | { readonly kind: "strong"; readonly raw: string; readonly text: string }
  | {
      readonly kind: "link";
      readonly raw: string;
      readonly label: string;
      readonly url: string;
    };

const inlinePattern =
  /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\(([^)\s]+)\)/g;

const inlineOf = (match: RegExpMatchArray): Inline => {
  const [raw, code, strong, label, url] = match;
  if (code !== undefined) return { kind: "code", raw, text: code };
  if (strong !== undefined) return { kind: "strong", raw, text: strong };
  return { kind: "link", raw, label: label ?? "", url: url ?? "" };
};

/** A line cut into plain text, inline code, bold and links, which are shown as text. */
export const inlinesOf = (text: string): ReadonlyArray<Inline> => {
  const pieces: Array<Inline> = [];
  let last = 0;
  for (const match of text.matchAll(inlinePattern)) {
    if (match.index > last) {
      pieces.push({ kind: "text", raw: text.slice(last, match.index) });
    }
    pieces.push(inlineOf(match));
    last = match.index + match[0].length;
  }
  if (last < text.length) pieces.push({ kind: "text", raw: text.slice(last) });
  return pieces;
};

export type Reminded =
  | { readonly kind: "text"; readonly raw: string }
  | { readonly kind: "reminder"; readonly raw: string; readonly text: string };

const reminderPattern = /<system-reminder>([\s\S]*?)(?:<\/system-reminder>|$)/g;

/** A message's text cut at its `<system-reminder>` blocks; one left open by a cut runs to the end. */
export const remindersOf = (text: string): ReadonlyArray<Reminded> => {
  const pieces: Array<Reminded> = [];
  let last = 0;
  for (const match of text.matchAll(reminderPattern)) {
    if (match.index > last) {
      pieces.push({ kind: "text", raw: text.slice(last, match.index) });
    }
    pieces.push({ kind: "reminder", raw: match[0], text: match[1] ?? "" });
    last = match.index + match[0].length;
  }
  if (last < text.length) pieces.push({ kind: "text", raw: text.slice(last) });
  return pieces;
};
