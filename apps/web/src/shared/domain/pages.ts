/** The greatest `offset` the sessions list takes (`docs/specs/api/spec.md`, Limits). */
export const mostOffset = 10_000;

/** One page of a list the hub pages by `limit` and `offset`. */
export interface Page {
  /** The page shown, from 1: the one asked for, held between the first and the last that can be reached. */
  readonly page: number;
  readonly offset: number;
  /** The first and last rows of the page, from 1; both 0 when there are none. */
  readonly first: number;
  readonly last: number;
  /** How many pages the total needs. */
  readonly pages: number;
  /** The last page whose offset the hub takes. */
  readonly reachable: number;
}

/**
 * The page asked for of `total` rows at `limit` a page, held to the pages the
 * hub can reach with an offset of at most `most`.
 */
export const pageOf = (
  asked: number,
  total: number,
  limit: number,
  most: number = mostOffset,
): Page => {
  const pages = Math.max(1, Math.ceil(total / limit));
  const reachable = Math.min(pages, Math.floor(most / limit) + 1);
  const page = Math.min(Math.max(1, Math.floor(asked)), reachable);
  const offset = (page - 1) * limit;
  const last = Math.min(offset + limit, total);
  return {
    page,
    offset,
    first: last > offset ? offset + 1 : 0,
    last: last > offset ? last : 0,
    pages,
    reachable,
  };
};
