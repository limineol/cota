import { Arbitrary, DateTime, Effect, Option, Schema } from "effect";
import type { PricedRequest } from "#modules/request-log/02-application/interfaces/requests.repository.ts";
import type { FoundHit } from "#modules/request-log/02-application/queries/read-snippets.query.ts";
import * as SearchItems from "#modules/request-log/02-application/queries/search-items.query.ts";
import * as Search from "#modules/request-log/03-domain/search.ts";
import * as StoredItems from "#modules/request-log/03-domain/stored-items.ts";
import * as Traffic from "#modules/request-log/03-domain/traffic.ts";
import * as Conversation from "#shared/03-domain/conversation.ts";
import { compareText } from "#shared/03-domain/text.ts";
import * as Harness from "#shared/05-tests/harness.ts";
import * as Sessions from "./sessions.ts";

const int = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

/** The search spec's words, restated: runs between ASCII characters that are not letters or digits, each lowercased. */
export const wordsIn = (text: string): ReadonlyArray<string> =>
  text
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ASCII controls separate words, so the class names them.
    .split(/[\u0000-/:-@[-`{-\u007F]+/)
    .filter((word) => word !== "")
    .map((word) => word.toLowerCase());

/** Whether every word of the query is a word of the text. */
export const holdsAll = (text: string, query: string): boolean => {
  const words = new Set(wordsIn(text));
  return wordsIn(query).every((word) => words.has(word));
};

/** The search spec's edits between two words, restated: Levenshtein's table over their characters. */
export const editsBetween = (one: string, other: string): number => {
  const a = [...one];
  const b = [...other];
  const table = Array.from({ length: a.length + 1 }, (_, row) =>
    Array.from({ length: b.length + 1 }, (_, column) =>
      row === 0 ? column : column === 0 ? row : 0,
    ),
  );
  for (let row = 1; row <= a.length; row++) {
    for (let column = 1; column <= b.length; column++) {
      const above = table[row - 1] ?? [];
      const here = table[row] ?? [];
      here[column] = Math.min(
        (above[column] ?? 0) + 1,
        (here[column - 1] ?? 0) + 1,
        (above[column - 1] ?? 0) + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
    }
  }
  return table[a.length]?.[b.length] ?? 0;
};

/** The distinct words of a log's items. */
export const logWordsOf = (
  items: ReadonlyArray<{ readonly text: string }>,
): ReadonlyArray<string> => [
  ...new Set(items.flatMap((item) => wordsIn(item.text))),
];

/**
 * The search spec's widening, restated: the word, its completions among the
 * log's words by length and then text, and its neighbours by edits and then
 * text, each list cut at its bound.
 */
export const widenedIn = (
  logWords: ReadonlyArray<string>,
  word: string,
  tolerance: Search.Tolerance,
  bounds: Search.Bounds = Search.bounds,
): ReadonlySet<string> => {
  const length = [...word].length;
  const edits = Math.min(2, Math.floor(length * tolerance.fuzzy + 0.5));
  const others = logWords.filter((other) => other !== word);
  const completions = tolerance.prefix
    ? others
        .filter(
          (other) =>
            [...other].length > length &&
            [...other].slice(0, length).join("") === word,
        )
        .sort(
          (one, other) =>
            [...one].length - [...other].length || compareText(one, other),
        )
        .slice(0, bounds.completions)
    : [];
  const neighbours = others
    .map((other) => ({ other, edits: editsBetween(word, other) }))
    .filter((each) => each.edits <= edits)
    .sort(
      (one, other) =>
        one.edits - other.edits || compareText(one.other, other.other),
    )
    .slice(0, bounds.neighbours)
    .map(({ other }) => other);
  return new Set([word, ...completions, ...neighbours]);
};

/** Whether every word of the query, widened among the log's words, has one of its words in the text. */
export const holdsWithin = (
  text: string,
  { query, tolerance }: Search.Asked,
  logWords: ReadonlyArray<string>,
  bounds: Search.Bounds = Search.bounds,
): boolean => {
  const words = wordsIn(text);
  return wordsIn(query).every((word) => {
    const widened = widenedIn(logWords, word, tolerance, bounds);
    return words.some((each) => widened.has(each));
  });
};

/** Whether every word of the query matches a word of the text under the tolerance, unbounded: the spec's definition of a match. */
export const matchesWithin = (
  text: string,
  { query, tolerance }: Search.Asked,
): boolean => {
  const words = wordsIn(text);
  return wordsIn(query).every((word) => {
    const length = [...word].length;
    const edits = Math.min(2, Math.floor(length * tolerance.fuzzy + 0.5));
    return words.some(
      (each) =>
        each === word ||
        (tolerance.prefix && [...each].slice(0, length).join("") === word) ||
        editsBetween(word, each) <= edits,
    );
  });
};

/**
 * The query with some characters made capitals, where lowercasing the whole
 * query gives it back: a capital sigma lowercases to a final sigma at the end
 * of a word, so `σοφοσ` is never recased to `ΣΟΦΟΣ`.
 */
export const recased = (
  query: Search.SearchQuery,
  flips: ReadonlyArray<boolean>,
): Search.SearchQuery => {
  const other = [...query]
    .map((character, at) => {
      const upper = character.toUpperCase();
      return flips[at % Math.max(flips.length, 1)] &&
        [...upper].length === 1 &&
        upper.toLowerCase() === character
        ? upper
        : character;
    })
    .join("");
  return Search.SearchQuery.make(
    other.toLowerCase() === query.toLowerCase() ? other : query,
  );
};

export const flips = Arbitrary.array(Arbitrary.schema(Schema.Boolean), {
  minLength: 1,
  maxLength: 8,
});

const ranges: ReadonlyArray<readonly [number, number]> = [
  [0x00, 0x7f],
  [0x00, 0x7f],
  [0x41, 0x5a],
  [0x80, 0xff],
  [0x0130, 0x0131],
  [0x0391, 0x03c9],
  [0x03a3, 0x03a3],
  [0x0300, 0x036f],
  [0x0400, 0x04ff],
  [0x1e9e, 0x1e9e],
  [0x2000, 0x206f],
  [0x2126, 0x212b],
  [0x3040, 0x30ff],
  [0x4e00, 0x9fff],
  [0xff01, 0xff5e],
  [0x10400, 0x1044f],
  [0x1f600, 0x1f64f],
  [0x80, 0xd7ff],
  [0xe000, 0x10ffff],
];

/** A well-formed character from any of the ranges above, ASCII and not, past the BMP among them. */
export const character = Arbitrary.all({
  range: int(0, ranges.length - 1),
  offset: int(0, 0x10ffff),
}).pipe(
  Arbitrary.map(({ range, offset }) => {
    const [low, high] = ranges[range] ?? [0x41, 0x5a];
    return String.fromCodePoint(low + (offset % (high - low + 1)));
  }),
);

/** Text of any well-formed characters, ASCII controls and punctuation, capitals of every script, combining marks, and characters past the BMP among them. */
export const anyText = Arbitrary.array(character, { maxLength: 40 }).pipe(
  Arbitrary.map((characters) => characters.join("")),
);

/**
 * Two strings at most a few edits apart: any text, and the same text with
 * characters inserted, removed or replaced at any place.
 */
export const nearbyTexts = Arbitrary.all({
  text: anyText,
  edits: Arbitrary.array(
    Arbitrary.all({ kind: int(0, 2), at: int(0, 40), character }),
    { maxLength: 3 },
  ),
}).pipe(
  Arbitrary.map(({ text, edits }): readonly [string, string] => {
    const characters = [...text];
    for (const { kind, at, character } of edits) {
      const place = at % (characters.length + 1);
      if (kind === 0) characters.splice(place, 0, character);
      else if (kind === 1) characters.splice(place, 1);
      else characters.splice(place, 1, character);
    }
    return [text, characters.join("")];
  }),
);

/** Every hit, read page by page from the first by `next`. */
export const everyPage = (
  asked: Traffic.Asked,
  searched: Search.SearchQuery | Search.Asked,
  limit: number,
) =>
  Effect.gen(function* () {
    const search = yield* SearchItems.SearchItems;
    const hits: Array<FoundHit> = [];
    let cursor = Option.none<string>();
    const sought =
      typeof searched === "string" ? Search.exactly(searched) : searched;
    for (let page = 0; page < 1_000; page++) {
      const read = yield* search.execute(asked, sought, limit, cursor);
      hits.push(...read.hits);
      if (Option.isNone(read.next)) return hits;
      cursor = read.next;
    }
    return hits;
  }).pipe(Effect.orDie);

/** The sessions of a request log with a traffic request in the window that matches the filters. */
export const selectedSessions = (
  asked: Traffic.Asked,
  log: ReadonlyArray<PricedRequest>,
) =>
  Effect.map(Traffic.selectionOf(asked), (selection) => {
    const sessions = new Set<string>();
    for (const { request } of log) {
      if (Traffic.isSelected(selection, StoredItems.storedOf(request))) {
        sessions.add(request.session);
      }
    }
    return sessions;
  }).pipe(Effect.orDie);

export const keyOf = ({ session, item }: { session: string; item: string }) =>
  `${session} ${item}`;

/** The keys of the items of the sessions given that hold every word of the query, each once. */
export const matchingIn = (
  items: ReadonlyArray<StoredItems.StoredItem>,
  sessions: ReadonlySet<string>,
  query: string,
): ReadonlyArray<string> => [
  ...new Set(
    items
      .filter(
        (item) => sessions.has(item.session) && holdsAll(item.text, query),
      )
      .map((item) => keyOf({ session: item.session, item: item.digest })),
  ),
];

/** The keys of the items of the sessions given that hold every word of the search, widened among the items' words, each once. */
export const matchingWithin = (
  items: ReadonlyArray<StoredItems.StoredItem>,
  sessions: ReadonlySet<string>,
  search: Search.Asked,
  bounds: Search.Bounds = Search.bounds,
): ReadonlyArray<string> => {
  const logWords = logWordsOf(items);
  return [
    ...new Set(
      items
        .filter(
          (item) =>
            sessions.has(item.session) &&
            holdsWithin(item.text, search, logWords, bounds),
        )
        .map((item) => keyOf({ session: item.session, item: item.digest })),
    ),
  ];
};

/**
 * The words of the bound's law (K10), one an item: `relay`, four of its
 * completions and five of its neighbours within one edit (`relays` is both),
 * more of each than a bound of two.
 */
export const boundWords = [
  "relay",
  "relays",
  "relayed",
  "relayer",
  "relaying",
  "delay",
  "relax",
  "rely",
  "replay",
];

/** The bound's law's log: one session, each request carrying one of `boundWords` as its prompt, on 12 November 2026. */
export const boundLog: ReadonlyArray<PricedRequest> = boundWords.map(
  (word, at) => ({
    request: Harness.requestOf({
      id: Sessions.idOf(at + 1),
      startedAt: DateTime.makeUnsafe(Date.UTC(2026, 10, 12, 9, at)),
      session: "bounds",
      protocol: "openai-chat",
      conversation: Conversation.read(
        Sessions.rulesOf("openai-chat"),
        { model: "glm-5.2", messages: [{ role: "user", content: word }] },
        [],
      ),
    }),
    cost: Option.none(),
  }),
);

/** The day the bound's law's log is in, unfiltered. */
export const boundAsked: Traffic.Asked = {
  from: Option.some(DateTime.makeUnsafe(Date.UTC(2026, 10, 12))),
  to: Option.some(DateTime.makeUnsafe(Date.UTC(2026, 10, 13))),
  filters: Traffic.noFilters,
};

/** The bound the law gives the readers: two completions and two neighbours. */
export const smallBounds: Search.Bounds = { completions: 2, neighbours: 2 };

/**
 * The searches of the bound's law and the words of their hits under
 * `smallBounds`: the shortest completions, `relayed` before `relayer` by text,
 * and the nearest neighbours by text.
 */
export const boundSearches: ReadonlyArray<{
  readonly search: Search.Asked;
  readonly words: ReadonlyArray<string>;
}> = [
  {
    search: {
      query: Search.SearchQuery.make("relay"),
      tolerance: { prefix: true, fuzzy: 0 },
    },
    words: ["relay", "relayed", "relays"],
  },
  {
    search: {
      query: Search.SearchQuery.make("relay"),
      tolerance: { prefix: false, fuzzy: 0.2 },
    },
    words: ["delay", "relax", "relay"],
  },
  {
    search: {
      query: Search.SearchQuery.make("relay"),
      tolerance: { prefix: true, fuzzy: 0.2 },
    },
    words: ["delay", "relax", "relay", "relayed", "relays"],
  },
];
