import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Schema } from "effect";
import { type Pairable, pairCalls } from "./pairs.ts";

const int = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

const pick = <A>(values: ReadonlyArray<A>) =>
  int(0, values.length - 1).pipe(Arbitrary.map((index) => values[index] as A));

const kinds = [
  "message",
  "reasoning",
  "other",
  "tool-call",
  "tool-call",
  "tool-result",
  "tool-result",
] as const;

const entry = Arbitrary.all({
  kind: pick(kinds),
  callId: pick(["a", "b", "c", null]),
}).pipe(
  Arbitrary.map(
    ({ kind, callId }): Pairable =>
      kind === "tool-call" || kind === "tool-result"
        ? { kind, callId }
        : { kind },
  ),
);

const entries = Arbitrary.array(entry, { maxLength: 30 });

/** What the law says each result is paired with: the nearest earlier call of its id that no result before it took. */
const expectedPairs = (entries: ReadonlyArray<Pairable>) => {
  const taken = new Map<number, number>();
  entries.forEach((each, at) => {
    if (each.kind !== "tool-result" || (each.callId ?? null) === null) return;
    for (let call = at - 1; call >= 0; call -= 1) {
      const candidate = entries[call];
      if (
        candidate?.kind === "tool-call" &&
        candidate.callId === each.callId &&
        ![...taken.values()].includes(call)
      ) {
        taken.set(at, call);
        return;
      }
    }
  });
  return taken;
};

describe("pairing tool calls with their results", () => {
  it.prop(
    "V28: every entry appears once, in order, and a result is paired with the nearest earlier unpaired call of its call id, standing alone when there is none",
    { entries },
    ({ entries }) => {
      const rows = pairCalls(entries);
      const seen = rows.flatMap((row) =>
        row.result === null ? [row.at] : [row.at, row.result],
      );
      expect([...seen].sort((a, b) => a - b)).toEqual(
        entries.map((_, at) => at),
      );
      rows.forEach((row, index) => {
        const next = rows[index + 1];
        if (next !== undefined) expect(next.at).toBeGreaterThan(row.at);
        if (row.result !== null) {
          expect(entries[row.at]?.kind).toBe("tool-call");
          expect(row.result).toBeGreaterThan(row.at);
        }
      });
      const pairs = expectedPairs(entries);
      const found = new Map(
        rows.flatMap((row) =>
          row.result === null ? [] : [[row.result, row.at] as const],
        ),
      );
      expect(found).toEqual(pairs);
    },
  );
});
