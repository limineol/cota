/** How far a word of a search query may be from a word it matches (`docs/specs/search/spec.md`, Tolerance). */
export interface Tolerance {
  readonly prefix: boolean;
  readonly fuzzy: number;
}

export const exact: Tolerance = { prefix: false, fuzzy: 0 };

/** A piece of a snippet, marked when it is a word that matches a word of the search query. */
export interface Piece {
  readonly text: string;
  readonly marked: boolean;
}

interface Placed {
  readonly text: string;
  readonly word: string;
  readonly at: number;
}

const isWordCharacter = (point: number): boolean =>
  point > 0x7f ||
  (point >= 0x30 && point <= 0x39) ||
  (point >= 0x41 && point <= 0x5a) ||
  (point >= 0x61 && point <= 0x7a);

/** A text's words as the search spec splits them, each lowercased whole, with where it begins in UTF-16 units. */
const placedWordsOf = (text: string): ReadonlyArray<Placed> => {
  const placed: Array<Placed> = [];
  let word = "";
  let start = 0;
  let at = 0;
  for (const character of text) {
    if (isWordCharacter(character.codePointAt(0) ?? 0)) {
      if (word === "") start = at;
      word += character;
    } else if (word !== "") {
      placed.push({ text: word, word: word.toLowerCase(), at: start });
      word = "";
    }
    at += character.length;
  }
  if (word !== "") {
    placed.push({ text: word, word: word.toLowerCase(), at: start });
  }
  return placed;
};

export const wordsOf = (text: string): ReadonlyArray<string> =>
  placedWordsOf(text).map(({ word }) => word);

const editsFor = (word: string, fuzzy: number): number =>
  Math.min(2, Math.round([...word].length * fuzzy));

const editsBetween = (one: string, other: string): number => {
  const a = [...one];
  const b = [...other];
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (const [i, x] of a.entries()) {
    const current = [i + 1];
    for (const [j, y] of b.entries()) {
      current.push(
        Math.min(
          (previous[j + 1] ?? 0) + 1,
          (current[j] ?? 0) + 1,
          (previous[j] ?? 0) + (x === y ? 0 : 1),
        ),
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
};

const isMatch = (asked: string, word: string, tolerance: Tolerance) =>
  word === asked ||
  (tolerance.prefix && word.startsWith(asked)) ||
  editsBetween(asked, word) <= editsFor(asked, tolerance.fuzzy);

/**
 * A snippet in pieces: each word of it that matches a word of the search
 * query under the tolerance, compared as the search spec compares words, is
 * a marked piece, and what lies between them is unmarked.
 */
export const marks = (
  snippet: string,
  query: string,
  tolerance: Tolerance = exact,
): ReadonlyArray<Piece> => {
  const asked = wordsOf(query);
  const pieces: Array<Piece> = [];
  let from = 0;
  for (const placed of placedWordsOf(snippet)) {
    if (!asked.some((word) => isMatch(word, placed.word, tolerance))) continue;
    if (placed.at > from) {
      pieces.push({ text: snippet.slice(from, placed.at), marked: false });
    }
    pieces.push({ text: placed.text, marked: true });
    from = placed.at + placed.text.length;
  }
  if (from < snippet.length) {
    pieces.push({ text: snippet.slice(from), marked: false });
  }
  return pieces;
};
