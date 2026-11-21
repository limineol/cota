import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Schema } from "effect";
import { isKeyword, type SqlTokenKind, statementOf, tokensOf } from "./sql.ts";

const int = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

const pick = <A>(values: ReadonlyArray<A>) =>
  int(0, values.length - 1).pipe(Arbitrary.map((index) => values[index] as A));

const words = [
  "SELECT",
  "from",
  "Where",
  "requests",
  "count",
  "started_at",
  "é",
  "日本",
  "x1",
];

/** Pieces that may hold what opens or closes a string or a comment, but only inside one. */
const inside = [
  ...words,
  " ",
  "\n",
  "\t",
  "--",
  "/*",
  "'",
  "''",
  "\\'",
  "\\\\",
  '"',
  "`",
  "*",
  "/",
  "😀",
];

/** Code between strings and comments: words, numbers, spaces and punctuation that opens nothing. */
const code = Arbitrary.array(
  pick([
    ...words,
    " ",
    "\n",
    "\t",
    "42",
    "3.5",
    "1e-3",
    "0x1F",
    ",",
    "(",
    ")",
    "=",
    "*",
    ".",
    "😀",
  ]),
  { minLength: 1, maxLength: 6 },
).pipe(Arbitrary.map((pieces) => pieces.join("")));

const body = (excluded: ReadonlyArray<string>) =>
  Arbitrary.array(pick(inside.filter((piece) => !excluded.includes(piece))), {
    maxLength: 8,
  }).pipe(Arbitrary.map((pieces) => pieces.join("")));

interface Segment {
  readonly kind: SqlTokenKind | "code" | "open";
  readonly text: string;
}

const segment = Arbitrary.all({
  which: int(0, 5),
  code,
  string: body(["'", "\\\\"]),
  quoted: body(["'", "''", "\\'", "\\\\", "`"]),
  line: body(["\n"]),
  block: body(["*", "/", "/*"]),
}).pipe(
  Arbitrary.map(({ which, code, string, quoted, line, block }): Segment => {
    switch (which) {
      case 0:
        return { kind: "string", text: `'${string}'` };
      case 1:
        return { kind: "quoted", text: `\`${quoted}\`` };
      case 2:
        return { kind: "comment", text: `--${line}` };
      case 3:
        return { kind: "comment", text: `/*${block}*/` };
      default:
        return { kind: "code", text: code };
    }
  }),
);

/** Segments set apart by a line feed, the last one perhaps left open by the end of the text. */
const sql = Arbitrary.all({
  segments: Arbitrary.array(segment, { maxLength: 6 }),
  open: pick(["", "'", "`", '"', "/*", "--", "'it''s from", "/* where\n"]),
}).pipe(
  Arbitrary.map(({ segments, open }) => ({
    segments: [
      ...segments,
      ...(open === "" ? [] : [{ kind: "open", text: open } satisfies Segment]),
    ],
    text: [...segments.map((each) => each.text), open]
      .filter((each) => each !== "")
      .join("\n"),
  })),
);

describe("tokenising SQL", () => {
  it.prop(
    "V31: the tokens of a text, put together, are the text, none of them empty; a string, a quoted name or a comment is one token from its opening to its closing or the end of the text, whatever keywords it holds",
    { sql },
    ({ sql: { segments, text } }) => {
      const tokens = tokensOf(text);
      expect(tokens.map((token) => token.text).join("")).toBe(text);
      for (const token of tokens) {
        expect(token.text).not.toBe("");
        if (token.kind === "keyword") expect(isKeyword(token.text)).toBe(true);
      }
      let at = 0;
      for (const each of segments) {
        const start = text.indexOf(each.text, at);
        at = start + each.text.length;
        if (each.kind === "code") continue;
        const offsets = tokens.map((_, index) =>
          tokens
            .slice(0, index)
            .reduce((sum, token) => sum + token.text.length, 0),
        );
        const index = offsets.indexOf(start);
        expect(index).not.toBe(-1);
        const token = tokens[index];
        if (each.kind === "open") {
          expect(token?.text).toBe(text.slice(start));
        } else {
          expect(token).toEqual({ kind: each.kind, text: each.text });
        }
      }
    },
  );
});

const selection = Arbitrary.all({
  pieces: Arbitrary.array(pick(["SELECT 1", " ", "\n", "\t", "x", "é"]), {
    maxLength: 10,
  }),
  a: int(0, 1000),
  b: int(0, 1000),
}).pipe(
  Arbitrary.map(({ pieces, a, b }) => {
    const text = pieces.join("");
    const start = text.length === 0 ? 0 : a % (text.length + 1);
    const end = text.length === 0 ? 0 : b % (text.length + 1);
    return { text, start: Math.min(start, end), end: Math.max(start, end) };
  }),
);

const blank = (text: string) => text.trim() === "";

describe("the statement a run sends", () => {
  it.prop(
    "V32: the statement run is the selection when it holds anything but white space, and otherwise the whole text, without the white space at either end",
    { selection },
    ({ selection: { text, start, end } }) => {
      const statement = statementOf(text, start, end);
      expect(statement).toBe(statement.trim());
      const selected = text.slice(start, end);
      if (blank(selected)) {
        expect(statement).toBe(text.trim());
      } else {
        const lead = selected.length - selected.trimStart().length;
        expect(text.indexOf(statement, start)).toBe(start + lead);
        expect(statement.length).toBe(selected.trim().length);
      }
    },
  );
});
