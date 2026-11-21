/** What a piece of SQL is, for its tone in the editor. */
export type SqlTokenKind =
  | "keyword"
  | "name"
  | "quoted"
  | "string"
  | "number"
  | "comment"
  | "punctuation"
  | "space";

export interface SqlToken {
  readonly kind: SqlTokenKind;
  readonly text: string;
}

const keywords = new Set([
  "all",
  "alter",
  "and",
  "anti",
  "any",
  "array",
  "as",
  "asc",
  "asof",
  "between",
  "both",
  "by",
  "case",
  "cast",
  "create",
  "cross",
  "cube",
  "database",
  "delete",
  "desc",
  "describe",
  "distinct",
  "drop",
  "else",
  "end",
  "except",
  "exists",
  "explain",
  "false",
  "fill",
  "final",
  "first",
  "following",
  "for",
  "format",
  "from",
  "full",
  "global",
  "grant",
  "group",
  "having",
  "if",
  "ilike",
  "in",
  "inner",
  "insert",
  "intersect",
  "interval",
  "into",
  "is",
  "join",
  "kill",
  "last",
  "leading",
  "left",
  "like",
  "limit",
  "not",
  "null",
  "nulls",
  "offset",
  "on",
  "or",
  "order",
  "outer",
  "over",
  "partition",
  "preceding",
  "prewhere",
  "qualify",
  "range",
  "rename",
  "right",
  "rollup",
  "rows",
  "sample",
  "select",
  "semi",
  "set",
  "settings",
  "show",
  "step",
  "system",
  "table",
  "then",
  "ties",
  "to",
  "totals",
  "trailing",
  "true",
  "truncate",
  "unbounded",
  "union",
  "using",
  "values",
  "view",
  "when",
  "where",
  "window",
  "with",
]);

/** Whether a word is one of the SQL keywords the editor tones, in any case. */
export const isKeyword = (word: string) => keywords.has(word.toLowerCase());

const isSpace = (character: string) => /\s/u.test(character);
const isDigit = (character: string) => character >= "0" && character <= "9";
const startsName = (character: string) => /[\p{L}_]/u.test(character);
const continuesName = (character: string) => /[\p{L}\p{N}_$]/u.test(character);

/** Where a quoted run that opened at `from` ends: after its closing quote, or at the end of the text when it has none. */
const quotedEnd = (text: string, from: number, quote: string) => {
  let at = from + 1;
  while (at < text.length) {
    const character = text[at];
    if (character === "\\") {
      at += 2;
    } else if (character === quote) {
      if (text[at + 1] === quote) {
        at += 2;
      } else {
        return at + 1;
      }
    } else {
      at += 1;
    }
  }
  return text.length;
};

const runEnd = (
  text: string,
  from: number,
  continues: (character: string) => boolean,
) => {
  let at = from;
  while (at < text.length && continues(text[at] ?? "")) at += 1;
  return at;
};

const numberEnd = (text: string, from: number) => {
  if (/^0[xX][0-9a-fA-F]/.test(text.slice(from, from + 3))) {
    return runEnd(text, from + 2, (character) => /[0-9a-fA-F]/.test(character));
  }
  let at = runEnd(text, from, isDigit);
  if (text[at] === "." && isDigit(text[at + 1] ?? "")) {
    at = runEnd(text, at + 1, isDigit);
  }
  const exponent = /^[eE][+-]?\d/.exec(text.slice(at, at + 3));
  if (exponent !== null) {
    at = runEnd(text, at + exponent[0].length - 1, isDigit);
  }
  return at;
};

/**
 * SQL cut into the pieces the editor tones, as ClickHouse reads it: a string
 * in single quotes, a name in backticks or double quotes and a comment (from
 * two dashes to the end of its line, or a block between slash-star and
 * star-slash) are each one piece from
 * their opening to their closing, or to the end of a text that leaves them
 * open, whatever they hold. Put together, the pieces are the text.
 */
export const tokensOf = (text: string): ReadonlyArray<SqlToken> => {
  const tokens: Array<SqlToken> = [];
  let at = 0;
  const take = (kind: SqlTokenKind, end: number) => {
    tokens.push({ kind, text: text.slice(at, end) });
    at = end;
  };
  while (at < text.length) {
    const character = text[at] ?? "";
    const next = text[at + 1] ?? "";
    if (character === "-" && next === "-") {
      const lineEnd = text.slice(at).search(/[\n\r]/);
      take("comment", lineEnd === -1 ? text.length : at + lineEnd);
    } else if (character === "/" && next === "*") {
      const close = text.indexOf("*/", at + 2);
      take("comment", close === -1 ? text.length : close + 2);
    } else if (character === "'") {
      take("string", quotedEnd(text, at, "'"));
    } else if (character === "`" || character === '"') {
      take("quoted", quotedEnd(text, at, character));
    } else if (isSpace(character)) {
      take("space", runEnd(text, at, isSpace));
    } else if (isDigit(character)) {
      take("number", numberEnd(text, at));
    } else if (startsName(character)) {
      const end = runEnd(text, at, continuesName);
      take(isKeyword(text.slice(at, end)) ? "keyword" : "name", end);
    } else {
      const point = text.codePointAt(at) ?? 0;
      take("punctuation", at + (point > 0xffff ? 2 : 1));
    }
  }
  return tokens;
};

/**
 * The SQL a run sends: the selection, from `start` to `end`, when it holds
 * anything but white space, and otherwise the whole text; either without the
 * white space at its ends.
 */
export const statementOf = (text: string, start: number, end: number) => {
  const selected = text.slice(Math.min(start, end), Math.max(start, end));
  return (selected.trim() === "" ? text : selected).trim();
};
