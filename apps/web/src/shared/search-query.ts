import { Api } from "@cota/hub/api";
import { Data, Option, Predicate, Schema } from "effect";
import type { HttpApiEndpoint } from "effect/http-api";
import { wordsOf } from "#shared/domain/snippet.ts";
import { counted } from "#shared/words.ts";

const sessionsEndpoint = Api.groups.sessions.endpoints.sessions;

/* HttpApiEndpoint types `query` loosely at runtime; it is the endpoint's own query Schema, which the client encodes with. */
const decodeListing = Schema.decodeUnknownOption(
  sessionsEndpoint.query as HttpApiEndpoint.Query<typeof sessionsEndpoint>,
);

/** The search query as the hub reads it, or nothing when the hub would refuse it. */
export const searchQueryOf = (q: string) =>
  Option.getOrUndefined(decodeListing({ q }))?.q;

/** A search the hub would refuse: no word in it, more than 20, or more than 200 characters. */
export class UnreadableSearch extends Data.TaggedError("UnreadableSearch")<{
  readonly q: string;
}> {}

/** What a search the hub cannot run says, from the words the search spec counts in it. */
export const unreadable = (q: string) => {
  const words = wordsOf(q).length;
  if (words === 0) {
    return `“${q}” holds no word to search for: a word is letters or digits between spaces or punctuation.`;
  }
  if (words > 20) {
    return `“${q}” holds ${counted(words)} words, and a search takes at most 20.`;
  }
  return `A search takes at most 200 characters, and this one has ${counted([...q].length)}.`;
};

/** Whether a search failed because the hub cannot run it, as said before it was sent or by the hub's 400. */
export const isUnreadable = (error: unknown, q: string | null) =>
  q !== null &&
  (Predicate.isTagged(error, "UnreadableSearch") ||
    (Predicate.hasProperty(error, "status") && error.status === 400));
