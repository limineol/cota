import { Clock, DateTime, Effect } from "effect";
import { type Client, useApiQuery } from "#shared/api.ts";
import type { Start } from "#shared/range.ts";
import { type Failure, type Filtered, filtered } from "./search.ts";

export type Chosen = Readonly<Record<Filtered, ReadonlyArray<string>>>;

/** What selects the failed requests the list and the menus count: the dimensions' values and the outcome. */
export interface Selection {
  readonly chosen: Chosen;
  readonly outcome: Failure;
}

const instant = (milliseconds: number) => DateTime.makeUnsafe(milliseconds);

const filtersOf = ({ chosen, outcome }: Selection) => {
  const filters: { -readonly [D in Filtered]?: ReadonlyArray<string> } = {};
  for (const dimension of filtered) {
    if (chosen[dimension].length > 0) filters[dimension] = chosen[dimension];
  }
  return { ...filters, outcome: [outcome] };
};

const keyOf = ({ chosen, outcome }: Selection) => [
  outcome,
  ...filtered.map((dimension) => chosen[dimension]),
];

const listPools = (client: Client) => client.pools.list();

/** The pools of the configuration, for their hues and marks. */
export const usePoolList = () =>
  useApiQuery(["errors", "pools"], listPools, {
    refetchInterval: 5 * 60_000,
  });

/** The causes of the selected failures in the range, latest first. */
export const useErrors = (selection: Selection, start: Start | null) =>
  useApiQuery(
    ["errors", "list", start?.key ?? null, ...keyOf(selection)],
    start === null
      ? null
      : (client) =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            return yield* client.traffic.errors({
              query: {
                from: instant(start.at(now)),
                to: instant(now),
                ...filtersOf(selection),
              },
            });
          }),
    { keepPrevious: true, refetchInterval: 60_000 },
  );

export type ErrorsAnswer = NonNullable<ReturnType<typeof useErrors>["data"]>;
export type Cause = ErrorsAnswer["groups"][number];

/** Each dimension's values among the failures in the range, counted under the other dimensions' choices. */
export const useFacets = (selection: Selection, start: Start | null) =>
  useApiQuery(
    ["errors", "facets", start?.key ?? null, ...keyOf(selection)],
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
