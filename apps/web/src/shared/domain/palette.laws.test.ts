import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Schema } from "effect";
import { found } from "./palette.ts";

const int = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

const pick = <A>(values: ReadonlyArray<A>) =>
  int(0, values.length - 1).pipe(Arbitrary.map((index) => values[index] as A));

const characters = ["a", "b", "A", "B", "é", "É", "i", "İ", "😀", " ", "/"];

const textOf = (minLength: number, maxLength: number) =>
  Arbitrary.array(pick(characters), { minLength, maxLength }).pipe(
    Arbitrary.map((picked) => picked.join("")),
  );

/** A text with case ignored as the palette ignores it: each code point lowercased when its lowercase is one code point. */
const fold = (text: string) =>
  Array.from(text, (character) => {
    const lower = character.toLowerCase();
    return Array.from(lower).length === 1 ? lower : character;
  }).join("");

const candidates = Arbitrary.array(
  Arbitrary.all({ id: textOf(1, 6), name: textOf(0, 6) }),
  { maxLength: 8 },
).pipe(
  Arbitrary.map((made) => made.map((each, index) => ({ ...each, index }))),
);

/** A text typed: some characters of the alphabet, or part of a candidate's name or id, its case changed or not. */
const searched = Arbitrary.all({
  candidates,
  typed: textOf(0, 3),
  taken: int(-1, 15),
  from: int(0, 5),
  length: int(1, 3),
  upper: int(0, 1),
}).pipe(
  Arbitrary.map(({ candidates, typed, taken, from, length, upper }) => {
    const source = candidates[taken % Math.max(1, candidates.length)];
    const whole =
      taken < 0 || source === undefined
        ? typed
        : Array.from(taken % 2 === 0 ? source.name : source.id)
            .slice(from, from + length)
            .join("");
    return {
      candidates,
      text: upper === 1 ? whole.toUpperCase() : whole,
    };
  }),
);

const rankOf = (candidate: { id: string; name: string }, text: string) => {
  const asked = fold(text);
  if (fold(candidate.name).startsWith(asked)) return 0;
  if (fold(candidate.name).includes(asked)) return 1;
  return fold(candidate.id).includes(asked) ? 2 : null;
};

const markedIn = (
  whole: string,
  text: string,
  pieces: ReadonlyArray<{ text: string; marked: boolean }>,
) => {
  expect(pieces.map((piece) => piece.text).join("")).toBe(whole);
  expect(pieces.filter((piece) => piece.text === "")).toEqual([]);
  const marked = pieces.flatMap((piece, index) =>
    piece.marked ? [index] : [],
  );
  const asked = fold(text);
  if (asked === "" || !fold(whole).includes(asked)) {
    expect(marked).toEqual([]);
    return;
  }
  expect(marked).toHaveLength(1);
  const at = marked[0] ?? 0;
  const before = pieces
    .slice(0, at)
    .map((piece) => piece.text)
    .join("");
  const piece = pieces[at]?.text ?? "";
  expect(fold(piece)).toBe(asked);
  expect(fold(before + piece).indexOf(asked)).toBe(fold(before).length);
};

describe("what the command palette finds", () => {
  it.prop(
    "V37: a candidate is listed when its name or its id holds the text, ignoring case, and once: first those whose name starts with it, then those whose name holds it, then those whose id alone does, each in the order given",
    { searched },
    ({ searched: { candidates, text } }) => {
      const listed = found(candidates, text).map(
        ({ candidate }) => candidate.index,
      );
      const expected = [0, 1, 2].flatMap((rank) =>
        candidates
          .filter((candidate) => rankOf(candidate, text) === rank)
          .map((candidate) => candidate.index),
      );
      expect(listed).toEqual(expected);
    },
  );

  it.prop(
    "V38: a found candidate's name and id, put together from their pieces, are unchanged, and the place the text first holds in each, ignoring case, is its one marked piece",
    { searched },
    ({ searched: { candidates, text } }) => {
      for (const each of found(candidates, text)) {
        markedIn(each.candidate.name, text, each.name);
        markedIn(each.candidate.id, text, each.id);
      }
    },
  );
});
