import { Clock, DateTime, Effect } from "effect";
import { type Client, useApiQuery } from "#shared/api.ts";
import { pageOf } from "#shared/domain/pages.ts";
import type { Start } from "#shared/range.ts";
import { searchQueryOf, UnreadableSearch } from "#shared/search-query.ts";
import {
  type Dimension,
  dimensions,
  type Sort,
} from "#shared/sessions-search.ts";

/** Sessions on a page, as the hub pages them unless asked otherwise. */
export const limit = 50;

/** The tolerance Loose asks for: a completion of each word, or a word within an edit or two (`docs/specs/search/spec.md`). */
export const loose = { prefix: true, fuzzy: 0.2 } as const;

const instant = (milliseconds: number) => DateTime.makeUnsafe(milliseconds);

export type Chosen = Readonly<Record<Dimension, ReadonlyArray<string>>>;

/** What selects the requests the list and the facets count: the dimensions' values and the outcome. */
export interface Selection {
  readonly chosen: Chosen;
  readonly outcome: "ok" | "error" | null;
}

const filtersOf = ({ chosen, outcome }: Selection) => {
  const filters: {
    -readonly [D in Dimension]?: ReadonlyArray<string>;
  } & { outcome?: ReadonlyArray<"ok" | "error"> } = {};
  for (const dimension of dimensions) {
    if (chosen[dimension].length > 0) filters[dimension] = chosen[dimension];
  }
  if (outcome !== null) filters.outcome = [outcome];
  return filters;
};

const keyOf = ({ chosen, outcome }: Selection) => [
  outcome,
  ...dimensions.map((dimension) => chosen[dimension]),
];

const listPools = (client: Client) => client.pools.list();

/** The pools of the configuration, for their hues and marks. */
export const usePoolList = () =>
  useApiQuery(["sessions", "pools"], listPools, {
    refetchInterval: 5 * 60_000,
  });

export interface Listing extends Selection {
  readonly q: string | null;
  readonly loose: boolean;
  readonly sort: Sort;
  readonly page: number;
}

/** A page of the sessions the selection holds in the range, found by the search when there is one. */
export const useSessions = (listing: Listing, start: Start | null) =>
  useApiQuery(
    [
      "sessions",
      "list",
      start?.key ?? null,
      listing.q,
      listing.loose,
      listing.sort,
      listing.page,
      ...keyOf(listing),
    ],
    start === null
      ? null
      : (client) =>
          Effect.gen(function* () {
            const q = listing.q === null ? undefined : searchQueryOf(listing.q);
            if (listing.q !== null && q === undefined) {
              return yield* new UnreadableSearch({ q: listing.q });
            }
            const now = yield* Clock.currentTimeMillis;
            return yield* client.sessions.sessions({
              query: {
                from: instant(start.at(now)),
                to: instant(now),
                ...filtersOf(listing),
                ...(q === undefined ? {} : { q }),
                ...(q !== undefined && listing.loose ? loose : {}),
                ...(listing.sort === "recent" ? {} : { sort: listing.sort }),
                limit,
                offset: pageOf(listing.page, Number.POSITIVE_INFINITY, limit)
                  .offset,
              },
            });
          }),
    { keepPrevious: true },
  );

export type SessionsAnswer = NonNullable<
  ReturnType<typeof useSessions>["data"]
>;
export type SessionRow = SessionsAnswer["sessions"][number];

/** Each dimension's values in the range, counted under the other dimensions' choices and the outcome. */
export const useFacets = (selection: Selection, start: Start | null) =>
  useApiQuery(
    ["sessions", "facets", start?.key ?? null, ...keyOf(selection)],
    start === null
      ? null
      : (client) =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            return yield* client.traffic.facets({
              query: {
                from: instant(start.at(now)),
                to: instant(now),
                ...filtersOf(selection),
              },
            });
          }),
    { keepPrevious: true },
  );

export type FacetsAnswer = NonNullable<ReturnType<typeof useFacets>["data"]>;
