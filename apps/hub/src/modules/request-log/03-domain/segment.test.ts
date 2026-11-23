import { describe, expect, it } from "@effect/vitest";
import { DateTime, Option } from "effect";
import * as Generated from "#modules/request-log/05-tests/sessions.ts";
import type { Roled } from "./request-role.ts";
import { segmentsOf } from "./segment.ts";

/** A reported conversation's model calls with these prompt sizes, the one at `compaction` a compaction its record names. */
const reported = (
  sizes: ReadonlyArray<number>,
  compaction: number,
): ReadonlyArray<Roled> =>
  sizes.map((size, at) => ({
    requestRole: "main",
    request: {
      id: Generated.idOf(at, at),
      startedAt: DateTime.makeUnsafe(Date.UTC(2026, 10, 12, 9, at)),
      protocol: "antigravity-steps",
      purpose: at === compaction ? "compaction" : "",
      outcome: "ok",
      promptSize: Option.some(size),
      clientHeaders: {},
      conversation: Option.none(),
    },
  }));

const cutOf = (roled: ReadonlyArray<Roled>) =>
  segmentsOf(roled).map(({ startedBy, requests }) => ({
    startedBy,
    requests: requests.length,
  }));

describe("segments of a reported conversation", () => {
  it("begins a segment at the call after a compaction its record names, though the prompt does not shrink", () => {
    expect(cutOf(reported([30_000, 31_000, 32_000, 32_100], 2))).toEqual([
      { startedBy: "start", requests: 3 },
      { startedBy: "compaction", requests: 1 },
    ]);
  });

  it("begins one segment, not two, for a compaction that shrinks the prompt, whether the prompt falls at the call after it or at its own", () => {
    expect(
      cutOf(reported([90_000, 100_000, 30_000, 31_000], 1)),
      "falls after it",
    ).toEqual([
      { startedBy: "start", requests: 2 },
      { startedBy: "compaction", requests: 2 },
    ]);
    expect(
      cutOf(reported([100_000, 40_000, 41_000, 42_000], 1)),
      "falls at it",
    ).toEqual([
      { startedBy: "start", requests: 2 },
      { startedBy: "compaction", requests: 2 },
    ]);
  });
});
