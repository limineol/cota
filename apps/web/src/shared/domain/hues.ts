/** The pool hues, in the order pools take them; `neutral` is every pool beyond them. */
export const hues = [1, 2, 3, 4, 5, 6, 7, 8] as const;

export type Hue = (typeof hues)[number] | "neutral";

/** Each pool's hue: the n-th pool takes the n-th hue, and a pool beyond the set is neutral. */
export const poolHues = (
  pools: ReadonlyArray<string>,
): ReadonlyMap<string, Hue> =>
  new Map(pools.map((pool, index) => [pool, hues[index] ?? "neutral"]));
