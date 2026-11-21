/** The blocks of a block mix: fifty, each 2% of the total. */
export const mixBlocks = 50;

/** Gives each part whole blocks out of `blocks` by largest remainder, earlier parts first on a tie. */
export const apportion = (
  parts: ReadonlyArray<number>,
  blocks: number,
): ReadonlyArray<number> => {
  const total = parts.reduce((sum, part) => sum + part, 0);
  if (total <= 0) return parts.map(() => 0);
  const exact = parts.map((part) => (part / total) * blocks);
  const given = exact.map(Math.floor);
  const left = blocks - given.reduce((sum, count) => sum + count, 0);
  const byRemainder = exact
    .map((share, index) => ({ index, remainder: share - Math.floor(share) }))
    .sort((a, b) => b.remainder - a.remainder)
    .slice(0, left);
  for (const { index } of byRemainder) given[index] = (given[index] ?? 0) + 1;
  return given;
};
