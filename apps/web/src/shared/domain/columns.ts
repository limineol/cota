/** The most blocks the tallest column of a chart may have. */
export const tallest = 14;

export interface Bucket {
  readonly start: number;
  readonly end: number;
  /** Each part's value, in the same order in every bucket. */
  readonly parts: ReadonlyArray<number>;
}

export interface Column {
  readonly bucket: Bucket;
  readonly total: number;
  readonly blocks: number;
  /** Each part's blocks, in the bucket's order, summing to the column's blocks. */
  readonly parts: ReadonlyArray<number>;
}

export interface Columns {
  readonly unit: number;
  readonly columns: ReadonlyArray<Column>;
}

const steps = [1, 2, 5];

const floatingPointSlack = 1 - 4 * Number.EPSILON;

/** The smallest of 1, 2 and 5 × 10ⁿ, no less than `least`, that a column of `highest` fills with at most fourteen blocks. */
export const unitOf = (highest: number, least: number): number => {
  const wanted = Math.max(highest / tallest, least);
  let power = 10 ** Math.floor(Math.log10(wanted));
  for (;;) {
    for (const step of steps) {
      const unit = step * power;
      if (unit >= wanted * floatingPointSlack) return unit;
    }
    power *= 10;
  }
};

const sum = (values: ReadonlyArray<number>) =>
  values.reduce((total, value) => total + value, 0);

/** A column's parts' blocks, rounded on their running total, so that they sum to the column's own rounded total. */
const partsOf = (
  parts: ReadonlyArray<number>,
  unit: number,
): ReadonlyArray<number> => {
  let running = 0;
  let placed = 0;
  const blocks = parts.map((part) => {
    running += part;
    const upTo = Math.round(running / unit);
    const given = upTo - placed;
    placed = upTo;
    return given;
  });
  if (placed > 0 || running <= 0) return blocks;
  const biggest = parts.indexOf(Math.max(...parts));
  return blocks.map((given, index) => (index === biggest ? 1 : given));
};

/** Stacks every bucket in blocks of one unit for the whole chart. */
export const stack = (
  buckets: ReadonlyArray<Bucket>,
  least: number,
): Columns => {
  const totals = buckets.map((bucket) => sum(bucket.parts));
  const unit = unitOf(Math.max(0, ...totals), least);
  return {
    unit,
    columns: buckets.map((bucket, index) => {
      const parts = partsOf(bucket.parts, unit);
      return {
        bucket,
        total: totals[index] ?? 0,
        blocks: sum(parts),
        parts,
      };
    }),
  };
};

/** Merges adjacent buckets in runs of one length, the last run shorter, so that at most `capacity` columns remain. */
export const merge = (
  buckets: ReadonlyArray<Bucket>,
  capacity: number,
): ReadonlyArray<Bucket> => {
  const run = Math.ceil(buckets.length / Math.max(1, capacity));
  if (run <= 1) return buckets;
  const merged: Array<Bucket> = [];
  for (let index = 0; index < buckets.length; index += run) {
    const group = buckets.slice(index, index + run);
    const first = group[0];
    const last = group.at(-1);
    if (first === undefined || last === undefined) continue;
    merged.push({
      start: first.start,
      end: last.end,
      parts: first.parts.map((_, part) =>
        sum(group.map((bucket) => bucket.parts[part] ?? 0)),
      ),
    });
  }
  return merged;
};
