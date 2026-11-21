import { Option, Schema } from "effect";

/** What the SQL console can be asked to show: the SQL last run, which a link runs on load. */
export interface SqlSearch {
  readonly q?: string;
}

const decodeQuery = Schema.decodeUnknownOption(Schema.NonEmptyString);

/** Keeps `q` when it is SQL, and drops anything else, so a stale link still opens the screen. */
export const validateSearch = (search: Record<string, unknown>): SqlSearch => {
  const q = Option.getOrUndefined(decodeQuery(search.q));
  return q === undefined || q.trim() === "" ? {} : { q };
};
