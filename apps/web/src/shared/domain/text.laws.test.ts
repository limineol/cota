import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Schema } from "effect";
import { blocksOf, fencesOf, inlinesOf, remindersOf } from "./text.ts";

const int = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

const pick = <A>(values: ReadonlyArray<A>) =>
  int(0, values.length - 1).pipe(Arbitrary.map((index) => values[index] as A));

const tokens = [
  "a",
  "word",
  " ",
  "é",
  "日",
  "😀",
  "\n",
  "\n",
  "\n\n",
  " \n",
  "```",
  "```ts\n",
  "`",
  "**",
  "*",
  "[",
  "](",
  ")",
  "# ",
  "#### ",
  "- ",
  "* ",
  "1. ",
  "12) ",
  "\t",
  "<system-reminder>",
  "</system-reminder>",
];

const fenceLine = pick(["```", "```ts", "```  json", "````"]);

const contentLine = Arbitrary.array(pick(tokens), { maxLength: 12 }).pipe(
  Arbitrary.map((pieces) => pieces.join("")),
);

const line = Arbitrary.all({
  fenced: int(0, 3),
  fence: fenceLine,
  content: contentLine,
}).pipe(
  Arbitrary.map(({ fenced, fence, content }) =>
    fenced === 0 ? fence : content,
  ),
);

const text = Arbitrary.all({
  lines: Arbitrary.array(line, { maxLength: 14 }),
  end: pick(["", "\n", "\n\n"]),
}).pipe(Arbitrary.map(({ lines, end }) => `${lines.join("\n")}${end}`));

const joined = (pieces: ReadonlyArray<{ readonly raw: string }>) =>
  pieces.map((piece) => piece.raw).join("");

describe("splitting a transcript's text", () => {
  it.prop(
    "V29: the pieces of a text, put together, are the text: its prose and fenced code, a prose's blocks, a line's inline pieces and a message's reminders",
    { text },
    ({ text }) => {
      const fenced = fencesOf(text);
      expect(joined(fenced)).toBe(text);
      for (const piece of fenced) {
        expect(piece.raw).not.toBe("");
        if (piece.kind === "prose") {
          expect(joined(blocksOf(piece.raw))).toBe(piece.raw);
        } else {
          expect(piece.raw.startsWith("```")).toBe(true);
        }
      }
      expect(joined(blocksOf(text))).toBe(text);
      expect(joined(inlinesOf(text))).toBe(text);
      expect(joined(remindersOf(text))).toBe(text);
    },
  );
});
