import { Schema } from "effect";

/** A text's length in characters, which the API counts as code points. */
export const charactersOf = (text: string): number => [...text].length;

/** A text's first `length` characters (code points). */
export const cut = (text: string, length: number): string =>
  [...text].slice(0, length).join("");

/** Checks that a text holds `shortest` to `longest` characters (code points). */
export const isCharactersBetween = (shortest: number, longest: number) =>
  Schema.makeFilter(
    (text: string) => {
      const length = charactersOf(text);
      return length >= shortest && length <= longest;
    },
    {
      expected:
        shortest === 0
          ? `at most ${longest} characters`
          : `${shortest} to ${longest} characters`,
      // JSON Schema counts a string's length in code points, as this does.
      toJsonSchema: () =>
        shortest === 0
          ? { maxLength: longest }
          : { minLength: shortest, maxLength: longest },
    },
  );

/** Orders text as ClickHouse does, by its UTF-8 bytes, which is the order of its code points. */
export const compareText = (one: string, other: string): number => {
  const ones = [...one];
  const others = [...other];
  for (let at = 0; at < Math.min(ones.length, others.length); at++) {
    const a = ones[at]?.codePointAt(0) ?? 0;
    const b = others[at]?.codePointAt(0) ?? 0;
    if (a !== b) return a - b;
  }
  return ones.length - others.length;
};
