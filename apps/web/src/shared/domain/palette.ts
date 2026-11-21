import type { Piece } from "./snippet.ts";

/** Something the command palette can list: its id, and the name it is shown by. */
export interface Candidate {
  readonly id: string;
  readonly name: string;
}

/** A candidate the text found, with its name and its id in pieces, the place the text first holds in each marked. */
export interface Found<C extends Candidate> {
  readonly candidate: C;
  readonly name: ReadonlyArray<Piece>;
  readonly id: ReadonlyArray<Piece>;
}

/** A text's code points, each lowercased when its lowercase is one code point, so that case is ignored and every place stays where it was. */
const folded = (text: string): ReadonlyArray<string> =>
  Array.from(text, (character) => {
    const lower = character.toLowerCase();
    return Array.from(lower).length === 1 ? lower : character;
  });

/** Where `asked` first occurs in `text`, in code points; -1 when it does not. */
const firstAt = (
  text: ReadonlyArray<string>,
  asked: ReadonlyArray<string>,
): number => {
  for (let at = 0; at + asked.length <= text.length; at++) {
    if (asked.every((character, index) => text[at + index] === character)) {
      return at;
    }
  }
  return -1;
};

const piecesOf = (
  text: string,
  asked: ReadonlyArray<string>,
): ReadonlyArray<Piece> => {
  const at = asked.length === 0 ? -1 : firstAt(folded(text), asked);
  if (at === -1) return text === "" ? [] : [{ text, marked: false }];
  const characters = Array.from(text);
  const end = at + asked.length;
  return [
    { text: characters.slice(0, at).join(""), marked: false },
    { text: characters.slice(at, end).join(""), marked: true },
    { text: characters.slice(end).join(""), marked: false },
  ].filter((piece) => piece.text !== "");
};

const startsTheName = 0;
const inTheName = 1;
const inTheId = 2;

const rankOf = (candidate: Candidate, asked: ReadonlyArray<string>) => {
  const inName = firstAt(folded(candidate.name), asked);
  if (inName === 0) return startsTheName;
  if (inName > 0) return inTheName;
  return firstAt(folded(candidate.id), asked) === -1 ? null : inTheId;
};

/**
 * The candidates a text finds, ignoring case: each whose name or id holds
 * it, once, first those whose name starts with it, then those whose name
 * holds it, then those whose id alone does, each in the order given (V37).
 * The place the text first holds in a name or an id is its one marked piece,
 * and its pieces, put together, are the name or the id (V38).
 */
export const found = <C extends Candidate>(
  candidates: ReadonlyArray<C>,
  text: string,
): ReadonlyArray<Found<C>> => {
  const asked = folded(text);
  const ranked = candidates.flatMap((candidate) => {
    const rank = rankOf(candidate, asked);
    return rank === null ? [] : [{ rank, candidate }];
  });
  return [startsTheName, inTheName, inTheId].flatMap((rank) =>
    ranked
      .filter((each) => each.rank === rank)
      .map(({ candidate }) => ({
        candidate,
        name: piecesOf(candidate.name, asked),
        id: piecesOf(candidate.id, asked),
      })),
  );
};
