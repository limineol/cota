import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Schema } from "effect";
import { textOf, tsvOf, type Value } from "./tsv.ts";

const int = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

const pick = <A>(values: ReadonlyArray<A>) =>
  int(0, values.length - 1).pipe(Arbitrary.map((index) => values[index] as A));

const text = Arbitrary.array(
  pick([
    "a",
    "é",
    "😀",
    " ",
    "\t",
    "\n",
    "\r",
    "\r\n",
    "\\",
    "\\t",
    "\\N",
    "N",
  ]),
  { maxLength: 6 },
).pipe(Arbitrary.map((pieces) => pieces.join("")));

const value = Arbitrary.all({
  which: int(0, 6),
  text,
  number: int(-1000, 1000),
}).pipe(
  Arbitrary.map(({ which, text, number }): Value => {
    switch (which) {
      case 0:
        return null;
      case 1:
        return number;
      case 2:
        return number % 2 === 0;
      case 3:
        return [text, number, null];
      case 4:
        return { [text]: text, n: number };
      case 5:
        return "NULL";
      default:
        return text;
    }
  }),
);

const answer = int(1, 5).pipe(
  Arbitrary.flatMap((width) =>
    Arbitrary.all({
      columns: Arbitrary.array(text, { minLength: width, maxLength: width }),
      rows: Arbitrary.array(
        Arbitrary.array(value, { minLength: width, maxLength: width }),
        { maxLength: 8 },
      ),
    }),
  ),
);

const unescapes: Readonly<Record<string, string>> = {
  "\\": "\\",
  t: "\t",
  n: "\n",
  r: "\r",
};

const unescaped = (field: string) =>
  field.replace(
    /\\(.)/gsu,
    (all, character: string) => unescapes[character] ?? all,
  );

describe("an answer as tab-separated values", () => {
  it.prop(
    "V34: a TSV has a line of the column names and a line per row, each a field per column; a tab or a line break inside a value never makes a field or a line, and a field's escapes read back give the value's text, a null alone written \\N",
    { answer },
    ({ answer: { columns, rows } }) => {
      const tsv = tsvOf(columns, rows);
      expect(tsv.endsWith("\n")).toBe(true);
      const lines = tsv.slice(0, -1).split(/\r\n|\r|\n/);
      expect(lines).toHaveLength(rows.length + 1);
      const [head = "", ...body] = lines;
      expect(head.split("\t").map(unescaped)).toEqual(columns);
      body.forEach((line, index) => {
        const fields = line.split("\t");
        const row = rows[index] ?? [];
        expect(fields).toHaveLength(columns.length);
        fields.forEach((field, column) => {
          const value = row[column] ?? null;
          if (value === null) {
            expect(field).toBe("\\N");
          } else {
            expect(field).not.toBe("\\N");
            expect(unescaped(field)).toBe(textOf(value));
          }
        });
      });
    },
  );
});
