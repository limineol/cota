import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Schema } from "effect";
import { unitOf } from "./columns.ts";
import { type ContextRequest, contextColumns, runFor } from "./context.ts";

const int = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

const flag = (oneIn: number) =>
  int(1, oneIn).pipe(Arbitrary.map((roll) => roll === 1));

const promptSize = Arbitrary.all({
  reported: int(0, 7),
  digits: int(0, 6),
  size: int(0, 400_000),
}).pipe(
  Arbitrary.map(({ reported, digits, size }) =>
    reported === 0 ? null : size % 10 ** digits,
  ),
);

const other = Arbitrary.all({ error: flag(6), diverted: flag(9) }).pipe(
  Arbitrary.map(
    ({ error, diverted }): ContextRequest => ({
      segment: null,
      promptSize: null,
      error,
      diverted,
    }),
  ),
);

const main = (segment: number) =>
  Arbitrary.all({
    promptSize,
    error: flag(8),
    diverted: flag(12),
    others: Arbitrary.array(other, { maxLength: 3 }),
    quiet: flag(2),
  }).pipe(
    Arbitrary.map(({ promptSize, error, diverted, others, quiet }) => [
      { segment, promptSize, error, diverted },
      ...(quiet ? [] : others),
    ]),
  );

const segment = (index: number) =>
  Arbitrary.all({ long: flag(5), length: int(1, 40), extra: int(0, 260) }).pipe(
    Arbitrary.flatMap(({ long, length, extra }) =>
      Arbitrary.array(main(index), {
        minLength: long ? length + extra : length,
        maxLength: long ? length + extra : length,
      }),
    ),
    Arbitrary.map((requests) => requests.flat()),
  );

const session = Arbitrary.all({
  segments: int(0, 6),
  leading: Arbitrary.array(other, { maxLength: 3 }),
  capacity: int(1, 140),
  skip: int(1, 3),
}).pipe(
  Arbitrary.flatMap(({ segments, leading, capacity, skip }) =>
    Arbitrary.all(
      Array.from({ length: segments }, (_, index) => segment(index * skip)),
    ).pipe(
      Arbitrary.map((parts) => ({
        requests: [...leading, ...parts.flat()],
        capacity,
      })),
    ),
  ),
);

const isMain = (request: ContextRequest) => request.segment !== null;

const lengthsOf = (requests: ReadonlyArray<ContextRequest>) => {
  const lengths: Array<number> = [];
  let current: number | null = null;
  for (const request of requests) {
    if (request.segment === null) continue;
    if (lengths.length === 0 || request.segment !== current) {
      lengths.push(0);
      current = request.segment;
    }
    lengths[lengths.length - 1] = (lengths.at(-1) ?? 0) + 1;
  }
  return lengths;
};

const fits = (lengths: ReadonlyArray<number>, run: number) =>
  lengths.reduce((sum, length) => sum + Math.ceil(length / run), 0) +
  lengths.length -
  1;

describe("context columns", () => {
  it.prop(
    "V24: the columns' stretches are consecutive and cover every request once, in order, each from a main request but the first, which starts with the session; a column's main requests, other requests, errors and diversions are those of its stretch",
    { session },
    ({ session: { requests, capacity } }) => {
      const { columns } = contextColumns(requests, capacity);
      if (!requests.some(isMain)) {
        expect(columns).toEqual([]);
        return;
      }
      expect(columns[0]?.from).toBe(0);
      expect(columns.at(-1)?.to).toBe(requests.length);
      columns.forEach((column, index) => {
        const next = columns[index + 1];
        if (next !== undefined) expect(next.from).toBe(column.to);
        expect(column.to).toBeGreaterThan(column.from);
        const stretch = requests.slice(column.from, column.to);
        const first = requests[column.from];
        if (index > 0) expect(first !== undefined && isMain(first)).toBe(true);
        const mains = stretch.filter(isMain);
        expect(column.main).toBe(mains.length);
        expect(column.main).toBeGreaterThan(0);
        expect(column.others).toBe(stretch.length - mains.length);
        expect(column.errors).toBe(stretch.filter((each) => each.error).length);
        expect(column.diverted).toBe(
          stretch.filter((each) => each.diverted).length,
        );
      });
    },
  );

  it.prop(
    "V25: a column's main requests are of one segment, and a segment's first main request is the first main request of a column",
    { session },
    ({ session: { requests, capacity } }) => {
      const { columns } = contextColumns(requests, capacity);
      const openers = new Set<number>();
      let current: number | null = null;
      requests.forEach((request, index) => {
        if (request.segment === null) return;
        if (openers.size === 0 || request.segment !== current) {
          openers.add(index);
        }
        current = request.segment;
      });
      const firsts = new Set<number>();
      for (const column of columns) {
        const mains = requests
          .slice(column.from, column.to)
          .map((request, at) => ({ request, index: column.from + at }))
          .filter(({ request }) => isMain(request));
        expect(new Set(mains.map(({ request }) => request.segment)).size).toBe(
          1,
        );
        expect(mains[0]?.request.segment).toBe(column.segment);
        const first = mains[0]?.index ?? -1;
        firsts.add(first);
        expect(column.opens).toBe(openers.has(first));
      }
      for (const opener of openers) expect(firsts.has(opener)).toBe(true);
    },
  );

  it.prop(
    "V26: within a segment every column but the last holds the run's number of main requests and the last at most that, and the run is the smallest for which the columns and a gap between each two segments fit, or the longest segment's length when none does",
    { session },
    ({ session: { requests, capacity } }) => {
      const { columns, run } = contextColumns(requests, capacity);
      const lengths = lengthsOf(requests);
      expect(run).toBe(runFor(lengths, capacity));
      expect(run).toBeGreaterThanOrEqual(1);
      const longest = Math.max(1, ...lengths);
      if (run > 1) expect(fits(lengths, run - 1)).toBeGreaterThan(capacity);
      if (run < longest) {
        expect(fits(lengths, run)).toBeLessThanOrEqual(capacity);
      } else if (fits(lengths, run) > capacity) {
        expect(run).toBe(longest);
      }
      columns.forEach((column, index) => {
        const next = columns[index + 1];
        const lastOfSegment = next === undefined || next.opens;
        if (lastOfSegment) expect(column.main).toBeLessThanOrEqual(run);
        else expect(column.main).toBe(run);
      });
    },
  );

  it.prop(
    "V27: a column's blocks are the largest prompt size of its main requests over the unit, rounded, and at least one when above zero, the unit chosen for the session's largest prompt size as block columns choose one",
    { session },
    ({ session: { requests, capacity } }) => {
      const { columns, unit } = contextColumns(requests, capacity);
      const sizes = requests.flatMap((request) =>
        isMain(request) && request.promptSize !== null
          ? [request.promptSize]
          : [],
      );
      expect(unit).toBe(unitOf(Math.max(0, ...sizes), 1));
      for (const column of columns) {
        const own = requests
          .slice(column.from, column.to)
          .flatMap((request) =>
            isMain(request) && request.promptSize !== null
              ? [request.promptSize]
              : [],
          );
        const peak = own.length === 0 ? null : Math.max(...own);
        expect(column.peak).toBe(peak);
        expect(column.blocks).toBe(
          peak === null || peak === 0
            ? 0
            : Math.max(1, Math.round(peak / unit)),
        );
        expect(column.blocks).toBeLessThanOrEqual(14);
      }
    },
  );
});
