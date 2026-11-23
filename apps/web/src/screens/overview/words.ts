import { share, span } from "#shared/domain/quantities.ts";
import { millis } from "#shared/words.ts";
import type { Pool, QuotaWindow } from "./queries.ts";

const hour = 3_600_000;
const day = 24 * hour;

const named: Record<number, string> = {
  [5 * hour]: "5-hour",
  [day]: "Daily",
  [7 * day]: "Weekly",
  [28 * day]: "Monthly",
  [30 * day]: "Monthly",
  [31 * day]: "Monthly",
};

/** A window's name for people, from its length and scope: `5-hour`, `Weekly`, `Weekly · opus`. */
export const windowName = (window: QuotaWindow) => {
  const base =
    named[window.lengthMs] ??
    (window.lengthMs < day
      ? `${Math.round(window.lengthMs / hour)}-hour`
      : `${Math.round(window.lengthMs / day)}-day`);
  return window.scope === null ? base : `${base} · ${window.scope}`;
};

export const usedText = (window: QuotaWindow) =>
  `${share(window.usedPercent / 100)} used`;

/** When the window's standing was worked out: its reset less the time the hub said was left. */
const answeredAt = (window: QuotaWindow) =>
  window.resetsAt === null || window.standing === null
    ? null
    : millis(window.resetsAt) - window.standing.resetsInMs;

export type Tone = "ok" | "warn" | "danger";

/** A window's pace in words, as the hub decided it, with any emptying time counted down from `now`. */
export const paceOf = (
  window: QuotaWindow,
  now: number,
): { readonly text: string; readonly tone: Tone } | null => {
  const standing = window.standing;
  if (standing === null) return null;
  const points = Math.round(standing.points ?? 0);
  switch (standing.pace) {
    case "full":
      return { text: "Full until the reset", tone: "danger" };
    case "on-pace":
      return { text: "On pace", tone: "ok" };
    case "in-reserve":
      return { text: `${points}% in reserve`, tone: "ok" };
    case "ahead-of-pace": {
      const tone = window.usedPercent >= 80 ? "danger" : "warn";
      const asked = answeredAt(window);
      if (standing.emptiesInMs === null || asked === null) {
        return { text: `${points}% ahead of pace`, tone };
      }
      const left = asked + standing.emptiesInMs - now;
      return {
        text: `${points}% ahead of pace · empties in ${span(left)}`,
        tone,
      };
    }
  }
};

export interface NoWindows {
  /** A few words for the card. */
  readonly short: string;
  /** A sentence for the pool in full. */
  readonly long: string;
}

/** Why a pool shows no quota windows, from what the hub says of its quota reading and quota login. */
export const noWindows = (pool: Pool): NoWindows => {
  if (pool.kind === "observed") {
    return {
      short: "No quota windows",
      long: "An observed pool has no quota windows: the hub forwards nothing for it and reads no quota for it.",
    };
  }
  if (pool.reading?.failure) {
    return {
      short: "Quota unavailable",
      long: `The last quota reading failed. ${pool.reading.failure.detail}`,
    };
  }
  if (pool.quotaLogin?.state === "expired") {
    return {
      short: "Quota login expired",
      long: `The provider refused to refresh this pool's quota login. Give the hub a new one with bun run quota:connect ${pool.id}.`,
    };
  }
  if (pool.reading !== null && pool.reading.at === null) {
    return {
      short: "Not read yet",
      long: "The hub has not read this pool's quota yet.",
    };
  }
  if (pool.reading !== null) {
    return {
      short: "No open window",
      long: "The provider reported no open window. One opens with the pool's next request.",
    };
  }
  if (pool.quotaLogin?.state === "none") {
    return {
      short: "No quota login",
      long: `No request has reported this pool's windows yet, and the hub has no quota login to read them with. bun run quota:connect ${pool.id} gives it one.`,
    };
  }
  return {
    short: "No quota windows",
    long: "The hub reads no quota for this pool, and no request has reported any.",
  };
};

/** What went wrong with a pool's quota reading or quota login, when it still shows the windows it last had. */
export const readingProblem = (pool: Pool): string | null => {
  if (pool.reading?.failure) {
    return `The last quota reading failed, so these windows may be out of date. ${pool.reading.failure.detail}`;
  }
  if (pool.quotaLogin?.state === "expired") {
    return `The provider refused to refresh this pool's quota login, so only requests report its windows. Give the hub a new one with bun run quota:connect ${pool.id}.`;
  }
  return null;
};

export const kindName: Record<Pool["kind"], string> = {
  subscription: "Subscription",
  keyed: "Keyed",
  observed: "Observed",
};
