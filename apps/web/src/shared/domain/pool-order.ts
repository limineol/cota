/** The orders the overview's pool cards can be in. */
export const poolOrders = ["usage", "name", "all-time"] as const;

export type PoolOrder = (typeof poolOrders)[number];

export const defaultOrder = "usage" satisfies PoolOrder;

/** A pool as its card is ordered: its id, the name it is shown by, its usage, and its usage since the request log began. */
export interface Placed {
  readonly id: string;
  readonly name: string;
  readonly usage: number;
  readonly allTime: number;
}

const compared = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const byName = (a: Placed, b: Placed) =>
  compared(a.name.toLowerCase(), b.name.toLowerCase()) || compared(a.id, b.id);

const byUsage = (a: Placed, b: Placed) => b.usage - a.usage || byName(a, b);

const byAllTime = (a: Placed, b: Placed) =>
  b.allTime - a.allTime || byName(a, b);

const orderings = {
  usage: byUsage,
  name: byName,
  "all-time": byAllTime,
} as const;

/**
 * The pools in the order chosen (V47): by usage, or by usage since the request
 * log began, most first, or by name whatever their usage; names compared
 * ignoring case, then ids, and pools equal in all of these in the order given.
 */
export const ordered = <P extends Placed>(
  pools: ReadonlyArray<P>,
  order: PoolOrder,
): ReadonlyArray<P> => [...pools].sort(orderings[order]);
