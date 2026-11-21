import { Schema } from "effect";

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

export const ranges = ["1h", "5h", "24h", "7d", "30d", "90d", "all"] as const;

export type Range = (typeof ranges)[number];

type Preset = Exclude<Range, "all">;

export const Range = Schema.Literals(ranges);

/** The range picker's options, all time written "All". */
export const rangeOptions = ranges.map((value) => ({
  value,
  label: value === "all" ? "All" : value,
}));

export const defaultRange = "24h" satisfies Range;

const rangeLength: Record<Preset, number> = {
  "1h": hour,
  "5h": 5 * hour,
  "24h": day,
  "7d": 7 * day,
  "30d": 30 * day,
  "90d": 90 * day,
};

/** What the range covers, as it ends "No traffic …" and "Nothing was logged …". */
export const during: Record<Range, string> = {
  "1h": "in the last hour",
  "5h": "in the last 5 hours",
  "24h": "in the last 24 hours",
  "7d": "in the last 7 days",
  "30d": "in the last 30 days",
  "90d": "in the last 90 days",
  all: "since the request log began",
};

export const rangeTitle: Record<Range, string> = {
  "1h": "Last hour",
  "5h": "Last 5 hours",
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  all: "All time",
};

/** The window a preset is compared with, as it ends "compared with the … before". */
export const spanOf: Record<Preset, string> = {
  "1h": "hour",
  "5h": "5 hours",
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
};

/** Where a range's traffic window starts, for a window ending at `now`, and the key its reads are kept under. */
export interface Start {
  readonly key: string;
  readonly at: (now: number) => number;
}

/**
 * A preset starts its length before `now`; all time starts when the request
 * log begins (`first`), and has no start while that is unknown or the log is
 * empty.
 */
export const startOf = (
  range: Range,
  first: number | null | undefined,
): Start | null => {
  if (range !== "all") {
    return { key: range, at: (now) => now - rangeLength[range] };
  }
  if (first === null || first === undefined) return null;
  return {
    key: `all-${first}`,
    // The browser's clock can be behind the hub's: a window starting at a first request the browser has not reached yet would be empty, which the hub refuses.
    at: (now) => Math.min(first, now - minute),
  };
};

export const fifteenMinutes = 15 * minute;

export const thirtyDays = 30 * day;
