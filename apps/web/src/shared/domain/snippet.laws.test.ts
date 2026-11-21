import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Schema } from "effect";
import { marks, type Tolerance } from "./snippet.ts";

const int = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

const pick = <A>(values: ReadonlyArray<A>) =>
  int(0, values.length - 1).pipe(Arbitrary.map((index) => values[index] as A));

const wordPattern = /[0-9A-Za-z\u0080-\u{10FFFF}]+/gu;

const flag = int(0, 1).pipe(Arbitrary.map((bit) => bit === 1));

const letters = ["a", "b", "c", "A", "B", "é", "É", "Σ", "日", "1"];
const separators = [" ", "  ", ", ", "-", "_", ".", "'", "\n", ": ", "("];

const word = Arbitrary.array(pick(letters), {
  minLength: 1,
  maxLength: 5,
}).pipe(Arbitrary.map((characters) => characters.join("")));

const words = Arbitrary.array(word, { minLength: 0, maxLength: 12 });

const joined = (parts: ReadonlyArray<string>, between: ReadonlyArray<string>) =>
  parts.map((part, index) => `${between[index] ?? " "}${part}`).join("");

const snippet = Arbitrary.all({
  parts: words,
  between: Arbitrary.array(pick(separators), { maxLength: 13 }),
  end: pick(["", ".", " …"]),
}).pipe(
  Arbitrary.map(({ parts, between, end }) => `${joined(parts, between)}${end}`),
);

const searched = Arbitrary.all({
  text: snippet,
  taken: Arbitrary.array(int(0, 20), { maxLength: 3 }),
  others: Arbitrary.array(word, { maxLength: 2 }),
  upper: flag,
  between: Arbitrary.array(pick(separators), { maxLength: 5 }),
  prefix: flag,
  fuzzy: pick([0, 0.2, 0.5]),
}).pipe(
  Arbitrary.map(({ text, taken, others, upper, between, prefix, fuzzy }) => {
    const found = [...text.matchAll(wordPattern)].map(([each]) => each);
    const chosen = taken.flatMap((index) =>
      found.length === 0 ? [] : [found[index % found.length] ?? ""],
    );
    const asked = [...chosen, ...others].map((each) =>
      upper ? each.toUpperCase() : each,
    );
    return {
      text,
      query: joined(asked, between),
      tolerance: { prefix, fuzzy },
    };
  }),
);

const edits = (one: string, other: string): number => {
  const a = [...one];
  const b = [...other];
  const table = a.map(() => b.map(() => 0));
  const at = (i: number, j: number): number =>
    i < 0 ? j + 1 : j < 0 ? i + 1 : (table[i]?.[j] ?? 0);
  for (const [i, x] of a.entries()) {
    for (const [j, y] of b.entries()) {
      const row = table[i];
      if (row === undefined) continue;
      row[j] = Math.min(
        at(i - 1, j) + 1,
        at(i, j - 1) + 1,
        at(i - 1, j - 1) + (x === y ? 0 : 1),
      );
    }
  }
  return at(a.length - 1, b.length - 1);
};

const matching = (query: string, tolerance: Tolerance) => {
  const asked = [...query.matchAll(wordPattern)].map(([each]) =>
    each.toLowerCase(),
  );
  return (text: string) => {
    const word = text.toLowerCase();
    return asked.some(
      (each) =>
        word === each ||
        (tolerance.prefix && word.startsWith(each)) ||
        edits(each, word) <=
          Math.min(2, Math.round([...each].length * tolerance.fuzzy)),
    );
  };
};

describe("marking a snippet", () => {
  it.prop(
    "V21: the marked and unmarked pieces of a snippet, put together, are the snippet unchanged",
    { searched },
    ({ searched: { text, query, tolerance } }) => {
      const pieces = marks(text, query, tolerance);
      expect(pieces.map((piece) => piece.text).join("")).toBe(text);
      expect(pieces.every((piece) => piece.text !== "")).toBe(true);
    },
  );

  it.prop(
    "V22: a marked piece is a whole word of the snippet that matches a word of the search query under its tolerance, compared as the search spec compares words, and every such word is marked",
    { searched },
    ({ searched: { text, query, tolerance } }) => {
      const matches = matching(query, tolerance);
      const expected = [...text.matchAll(wordPattern)]
        .filter(([each]) => matches(each))
        .map((found) => `${found.index}:${found[0]}`);
      let at = 0;
      const marked: Array<string> = [];
      for (const piece of marks(text, query, tolerance)) {
        if (piece.marked) marked.push(`${at}:${piece.text}`);
        at += piece.text.length;
      }
      expect(marked).toEqual(expected);
    },
  );
});
