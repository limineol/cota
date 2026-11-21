import { DateTime, Option, Schema } from "effect";
import * as Conversation from "#shared/03-domain/conversation.ts";
import type * as Request from "#shared/03-domain/request.entity.ts";
import { compareText } from "#shared/03-domain/text.ts";
import type * as Traffic from "./traffic.ts";
import * as Transcript from "./transcript.ts";

/** A search query's limits, in characters (code points) and in words. */
export const limits = { longest: 200, mostWords: 20 } as const;

const isWordCharacter = (point: number): boolean =>
  point > 0x7f ||
  (point >= 0x30 && point <= 0x39) ||
  (point >= 0x41 && point <= 0x5a) ||
  (point >= 0x61 && point <= 0x7a);

interface Placed {
  readonly word: string;
  /** Where it begins in the text, in characters. */
  readonly at: number;
}

// A word is lowercased once it is split off, as the text index's
// postprocessor `lowerUTF8` does: as a whole word, so a capital sigma at its
// end becomes ς, and with nothing around it in view.
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
      placed.push({ word: word.toLowerCase(), at: start });
      word = "";
    }
    at++;
  }
  if (word !== "") placed.push({ word: word.toLowerCase(), at: start });
  return placed;
};

/**
 * A text's words (`docs/specs/search/spec.md`, Words): its longest runs of
 * characters that are not ASCII spaces, punctuation or controls, each
 * lowercased, as ClickHouse's `splitByNonAlpha` tokens are, each through
 * `lowerUTF8` (K6).
 */
export const wordsOf = (text: string): ReadonlyArray<string> =>
  placedWordsOf(text).map(({ word }) => word);

/** A search query: 1 to 200 characters holding 1 to 20 words. */
export const SearchQuery = Schema.String.check(
  Schema.makeFilter(
    (text) => {
      const length = [...text].length;
      const words = wordsOf(text).length;
      return (
        length >= 1 &&
        length <= limits.longest &&
        words >= 1 &&
        words <= limits.mostWords
      );
    },
    {
      expected: `1 to ${limits.longest} characters holding 1 to ${limits.mostWords} words, a word being letters or digits between spaces or punctuation`,
    },
  ),
).pipe(Schema.brand("SearchQuery"));
export type SearchQuery = typeof SearchQuery.Type;

/** Whether every word of the search query is among the words of the text, in any order. */
export const matches = (text: string, query: SearchQuery): boolean => {
  const words = new Set(wordsOf(text));
  return wordsOf(query).every((word) => words.has(word));
};

/**
 * How far a word of a search query may be from a word it matches: with
 * `prefix`, a word that starts with it; with `fuzzy`, a word within that
 * fraction of its length in edits, at most two.
 */
export interface Tolerance {
  readonly prefix: boolean;
  readonly fuzzy: number;
}

export const exact: Tolerance = { prefix: false, fuzzy: 0 };

/** A fuzziness: a number from 0 to 1. */
export const Fuzzy = Schema.Finite.check(
  Schema.isBetween({ minimum: 0, maximum: 1 }),
);

/** A search query and the tolerance of its words. */
export interface Asked {
  readonly query: SearchQuery;
  readonly tolerance: Tolerance;
}

export const exactly = (query: SearchQuery): Asked => ({
  query,
  tolerance: exact,
});

const mostEdits = 2;

const charactersOf = (text: string): ReadonlyArray<string> => [...text];

/**
 * The edits a word of the search query allows, for a fuzziness: its length
 * in characters times the fuzziness, rounded to the nearest whole number with
 * halves up, and at most two.
 */
export const editsFor = (word: string, fuzzy: number): number =>
  Math.min(mostEdits, Math.round(charactersOf(word).length * fuzzy));

/**
 * The Levenshtein distance between two words over their characters (code
 * points): the fewest characters inserted, removed or replaced that make one
 * the other.
 */
export const editsBetween = (one: string, other: string): number => {
  const from = charactersOf(one);
  const to = charactersOf(other);
  let previous = Array.from({ length: to.length + 1 }, (_, at) => at);
  for (const [row, character] of from.entries()) {
    const current = [row + 1];
    for (const [column, target] of to.entries()) {
      current.push(
        Math.min(
          (previous[column + 1] ?? 0) + 1,
          (current[column] ?? 0) + 1,
          (previous[column] ?? 0) + (character === target ? 0 : 1),
        ),
      );
    }
    previous = current;
  }
  return previous[to.length] ?? 0;
};

/** Whether `word`'s characters begin with all of `start`'s. */
const startsWith = (word: string, start: string): boolean => {
  const characters = charactersOf(word);
  const opening = charactersOf(start);
  return (
    characters.length >= opening.length &&
    opening.every((character, at) => characters[at] === character)
  );
};

/**
 * Whether a word matches a word of the search query under a tolerance: it is
 * the query's word, or starts with it given `prefix`, or is within the edits
 * the fuzziness allows it.
 */
export const isMatch = (
  queried: string,
  word: string,
  tolerance: Tolerance,
): boolean => {
  if (word === queried) return true;
  if (tolerance.prefix && startsWith(word, queried)) return true;
  const edits = editsFor(queried, tolerance.fuzzy);
  return (
    edits > 0 &&
    Math.abs(charactersOf(word).length - charactersOf(queried).length) <=
      edits &&
    editsBetween(queried, word) <= edits
  );
};

/** How many of the log's words a word of the search query is widened to, beside itself, by each tolerance. */
export interface Bounds {
  readonly completions: number;
  readonly neighbours: number;
}

export const bounds: Bounds = { completions: 100, neighbours: 100 };

/** Whether a tolerance can widen any word of the search query. */
export const widens = (query: SearchQuery, tolerance: Tolerance): boolean =>
  tolerance.prefix ||
  wordsOf(query).some((word) => editsFor(word, tolerance.fuzzy) > 0);

/**
 * The words a word of the search query is widened to among the log's words:
 * itself; given `prefix`, its completions (the words that start with it), the
 * shortest first and then by text, up to the bound; and given edits, its
 * neighbours (the words within them), the fewest edits first and then by
 * text, up to the bound.
 */
export const widened = (
  queried: string,
  logWords: Iterable<string>,
  tolerance: Tolerance,
  bounded: Bounds,
): ReadonlySet<string> => {
  const edits = editsFor(queried, tolerance.fuzzy);
  const length = charactersOf(queried).length;
  const completions: Array<{ word: string; length: number }> = [];
  const neighbours: Array<{ word: string; edits: number }> = [];
  for (const word of logWords) {
    if (word === queried) continue;
    const characters = charactersOf(word).length;
    if (tolerance.prefix && startsWith(word, queried)) {
      completions.push({ word, length: characters });
    }
    if (edits > 0 && Math.abs(characters - length) <= edits) {
      const distance = editsBetween(queried, word);
      if (distance <= edits) neighbours.push({ word, edits: distance });
    }
  }
  return new Set([
    queried,
    ...completions
      .sort(
        (one, other) =>
          one.length - other.length || compareText(one.word, other.word),
      )
      .slice(0, bounded.completions)
      .map(({ word }) => word),
    ...neighbours
      .sort(
        (one, other) =>
          one.edits - other.edits || compareText(one.word, other.word),
      )
      .slice(0, bounded.neighbours)
      .map(({ word }) => word),
  ]);
};

/** Whether the text has a word among each set's: every word of the search query, widened, is matched. */
export const matchesWidened = (
  text: string,
  each: ReadonlyArray<ReadonlySet<string>>,
): boolean => {
  const words = wordsOf(text);
  return each.every((widenedWords) =>
    words.some((word) => widenedWords.has(word)),
  );
};

/** A conversation item a search found. */
export interface Hit {
  readonly session: string;
  readonly item: Conversation.Digest;
  /** The request that first carried it. */
  readonly request: Request.RequestId;
  readonly part: Conversation.Part;
  /** The item's own `role`, or empty. */
  readonly role: string;
  /** When it was first seen. */
  readonly at: DateTime.Utc;
}

/** Where a page of hits ends: the last hit's place in their order. */
export interface After {
  readonly at: DateTime.Utc;
  readonly session: string;
  readonly item: Conversation.Digest;
}

/** The order of hits: newest first, then by session, then by item. */
export const byNewest = (one: After, other: After): number =>
  DateTime.toEpochMillis(other.at) - DateTime.toEpochMillis(one.at) ||
  compareText(one.session, other.session) ||
  compareText(one.item, other.item);

export const isAfter = (hit: After, after: After): boolean =>
  byNewest(after, hit) < 0;

/** How many hits a page holds: 1 to 100, 20 unless asked. */
export const paging = { defaultLimit: 20, mostLimit: 100 } as const;

const ItemContent = Schema.fromJsonString(Schema.Json);

/** What one entry shows as text: no image, no hidden reasoning, and what `Transcript.jsonOf` withholds already withheld. */
const shownOf = (entry: Transcript.ItemEntry): ReadonlyArray<string> => {
  switch (entry.kind) {
    case "message":
      return entry.parts.flatMap((part) =>
        part.type === "text"
          ? [part.text]
          : part.type === "other"
            ? [part.json]
            : [],
      );
    case "reasoning":
      return Option.toArray(entry.text);
    case "tool-call":
      return [entry.input];
    case "tool-result":
      return [entry.output];
    case "other":
      return [entry.json];
  }
};

/**
 * What a transcript shows of one item, its texts joined by a blank line: the
 * entries its protocol's renderer reads in it, or, for a tool definition,
 * which no transcript shows, its JSON with what a transcript withholds
 * withheld.
 */
export const shownTextOf = (
  renderer: Transcript.Renderer,
  part: Conversation.Part,
  content: string,
): string =>
  Option.match(Schema.decodeOption(ItemContent)(content), {
    onNone: () => content,
    onSome: (item) =>
      part === "tools"
        ? Transcript.jsonOf(item)
        : renderer
            .said(item, part)
            .flatMap(shownOf)
            .filter((text) => text !== "")
            .join("\n\n"),
  });

/** A piece of a hit's shown text, and where in it the piece begins, in characters. */
export interface Snippet {
  readonly text: string;
  readonly start: number;
}

const snippetLength = 280;
const before = 100;

/**
 * Up to 280 characters of a shown text, from 100 characters before the first
 * of its words that matches the search query's first word under the
 * tolerance, or from its start when that is nearer or none matches.
 */
export const snippetOf = (
  shown: string,
  query: SearchQuery,
  tolerance: Tolerance = exact,
): Snippet => {
  const [first] = wordsOf(query);
  const found = placedWordsOf(shown).find(
    ({ word }) => first !== undefined && isMatch(first, word, tolerance),
  );
  const start = found === undefined ? 0 : Math.max(0, found.at - before);
  return {
    text: [...shown].slice(start, start + snippetLength).join(""),
    start,
  };
};

/** A cursor did not come from a page of the same search query and filters. */
export class StaleCursor extends Schema.TaggedError<
  StaleCursor,
  { readonly brand: unique symbol }
>()("StaleCursor", {}) {}

const CursorFields = Schema.Struct({
  key: Schema.String,
  from: Schema.DateTimeUtcFromMillis,
  to: Schema.DateTimeUtcFromMillis,
  at: Schema.DateTimeUtcFromMillis,
  session: Schema.String,
  item: Conversation.Digest,
});

const Cursor = Schema.StringFromBase64Url.pipe(
  Schema.decodeTo(Schema.fromJsonString(CursorFields)),
);

const isExact = (tolerance: Tolerance): boolean =>
  !tolerance.prefix && tolerance.fuzzy === 0;

/**
 * What a cursor must match: the search query and its tolerance, the window
 * as given (an open end included) and each filter's values in any order. An
 * exact search's key holds no tolerance, as before there was one.
 */
export const keyOf = (
  asked: Traffic.Asked,
  query: SearchQuery,
  tolerance: Tolerance = exact,
): string =>
  Conversation.digestOf(
    Conversation.canonical({
      query,
      ...(isExact(tolerance)
        ? {}
        : { prefix: tolerance.prefix, fuzzy: tolerance.fuzzy }),
      from: Option.getOrNull(Option.map(asked.from, DateTime.toEpochMillis)),
      to: Option.getOrNull(Option.map(asked.to, DateTime.toEpochMillis)),
      filters: Object.fromEntries(
        Object.entries(asked.filters).map(([dimension, values]) => [
          dimension,
          [...values].sort(compareText),
        ]),
      ),
    }),
  );

/** A page's continuation: the search's key, the window its first page read, and its last hit. */
export const cursorOf = (
  key: string,
  window: Traffic.Window,
  last: After,
): string =>
  Schema.encodeSync(Cursor)({
    key,
    from: window.from,
    to: window.to,
    at: last.at,
    session: last.session,
    item: last.item,
  });

/** A session id the request log holds is at most 255 characters (code points): the relay's protocols skip a longer one. */
const longestSession = 255;

/**
 * The length of the longest cursor `cursorOf` makes: each instant at its
 * longest in digits, and the longest session id with every character written
 * as six bytes of JSON, as a control character or a lone surrogate is; no
 * other character takes more.
 */
export const longestCursor = (() => {
  const earliest = DateTime.makeUnsafe(-8.64e15);
  return cursorOf(
    "0".repeat(32),
    { from: earliest, to: earliest },
    {
      at: earliest,
      session: "\u0001".repeat(longestSession),
      item: Conversation.Digest.make("0".repeat(32)),
    },
  ).length;
})();

/** The window and the place a cursor continues from; none for a cursor of another search, or not a cursor. */
export const continuing = (
  cursor: string,
  key: string,
): Option.Option<{ readonly window: Traffic.Window; readonly after: After }> =>
  Option.flatMap(Schema.decodeOption(Cursor)(cursor), (fields) =>
    fields.key !== key
      ? Option.none()
      : Option.some({
          window: { from: fields.from, to: fields.to },
          after: {
            at: fields.at,
            session: fields.session,
            item: fields.item,
          },
        }),
  );
