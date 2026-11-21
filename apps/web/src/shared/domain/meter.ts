/** The blocks of a block meter: twenty, each 5% of the allowance. */
export const meterBlocks = 20;

const perBlock = 100 / meterBlocks;

export type Severity = "normal" | "near" | "full";

export interface Meter {
  /** Each block's fill, from 0 to 1. */
  readonly blocks: ReadonlyArray<number>;
  readonly severity: Severity;
  /** Where the pace marker stands along the track, from 0 to 1, or null without a standing. */
  readonly pace: number | null;
}

const between = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

export const blocksOf = (used: number): ReadonlyArray<number> => {
  const held = between(used, 0, 100);
  const full = Math.floor(held / perBlock);
  const partial = (held - full * perBlock) / perBlock;
  return Array.from({ length: meterBlocks }, (_, index) =>
    index < full ? 1 : index === full ? partial : 0,
  );
};

export const severityOf = (used: number): Severity =>
  used >= 100 ? "full" : used >= 80 ? "near" : "normal";

/** A quota window's meter, from its used percentage and the share of its span that has passed, as the hub gives them. */
export const meter = (window: {
  readonly usedPercent: number;
  readonly elapsed: number | null;
}): Meter => ({
  blocks: blocksOf(window.usedPercent),
  severity: severityOf(window.usedPercent),
  pace: window.elapsed === null ? null : between(window.elapsed, 0, 1),
});
