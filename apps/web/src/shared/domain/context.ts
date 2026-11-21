import { unitOf } from "./columns.ts";

/** A request of a session, oldest first, as its context columns read it; `segment` is null for every role but main. */
export interface ContextRequest {
  readonly segment: number | null;
  readonly promptSize: number | null;
  readonly error: boolean;
  readonly diverted: boolean;
}

export interface ContextColumn {
  /** Its stretch of the requests, by index, `to` excluded: from its first main request, or from the first request for the first column, up to the next column's. */
  readonly from: number;
  readonly to: number;
  readonly segment: number;
  /** Whether its first main request begins its segment. */
  readonly opens: boolean;
  readonly main: number;
  readonly others: number;
  readonly errors: number;
  readonly diverted: number;
  /** The largest prompt size of its main requests, or null when none reported one. */
  readonly peak: number | null;
  readonly blocks: number;
}

export interface ContextColumns {
  /** The prompt size one block stands for. */
  readonly unit: number;
  /** How many main requests a column holds, the last of a segment fewer. */
  readonly run: number;
  readonly columns: ReadonlyArray<ContextColumn>;
}

/** The indexes of the main requests, one array per segment, in order. */
const segmentsOf = (
  requests: ReadonlyArray<ContextRequest>,
): ReadonlyArray<ReadonlyArray<number>> => {
  const segments: Array<Array<number>> = [];
  let current: number | null = null;
  requests.forEach((request, index) => {
    if (request.segment === null) return;
    const last = segments.at(-1);
    if (last === undefined || request.segment !== current) {
      segments.push([index]);
      current = request.segment;
      return;
    }
    last.push(index);
  });
  return segments;
};

/** The smallest run for which the columns, and a gap between each two segments, fit `capacity`; the longest segment's length when none does. */
export const runFor = (
  lengths: ReadonlyArray<number>,
  capacity: number,
): number => {
  const longest = Math.max(1, ...lengths);
  for (let run = 1; run < longest; run += 1) {
    const columns = lengths.reduce(
      (sum, length) => sum + Math.ceil(length / run),
      0,
    );
    if (columns + lengths.length - 1 <= capacity) return run;
  }
  return longest;
};

const largest = (sizes: ReadonlyArray<number | null>): number | null =>
  sizes.reduce<number | null>(
    (most, size) =>
      size === null ? most : most === null ? size : Math.max(most, size),
    null,
  );

/**
 * A session's main requests as columns of blocks, each as tall as the largest
 * prompt size among the requests it holds, at most `capacity` of them with a
 * gap before each segment but the first.
 */
export const contextColumns = (
  requests: ReadonlyArray<ContextRequest>,
  capacity: number,
): ContextColumns => {
  const segments = segmentsOf(requests);
  const run = runFor(
    segments.map((segment) => segment.length),
    capacity,
  );
  const starts = segments.flatMap((segment) =>
    segment
      .filter((_, at) => at % run === 0)
      .map((first, at) => ({ first, opens: at === 0 })),
  );
  const unit = unitOf(
    largest(
      requests.map((request) =>
        request.segment === null ? null : request.promptSize,
      ),
    ) ?? 0,
    1,
  );
  const columns = starts.map(({ first, opens }, index): ContextColumn => {
    const from = index === 0 ? 0 : first;
    const to = starts[index + 1]?.first ?? requests.length;
    const stretch = requests.slice(from, to);
    const main = stretch.filter((request) => request.segment !== null);
    const peak = largest(main.map((request) => request.promptSize));
    return {
      from,
      to,
      segment: requests[first]?.segment ?? 0,
      opens,
      main: main.length,
      others: stretch.length - main.length,
      errors: stretch.filter((request) => request.error).length,
      diverted: stretch.filter((request) => request.diverted).length,
      peak,
      blocks:
        peak === null || peak <= 0 ? 0 : Math.max(1, Math.round(peak / unit)),
    };
  });
  return { unit, run, columns };
};
