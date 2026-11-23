import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, DateTime, Effect, Schema } from "effect";
import * as Report from "#modules/request-log/03-domain/report.ts";

const int = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

const oneOf = <A>(values: ReadonlyArray<A>, other: Arbitrary.Arbitrary<A>) =>
  Arbitrary.all({ at: int(0, values.length), other }).pipe(
    Arbitrary.map(({ at, other }) => values[at] ?? other),
  );

const callKey = oneOf(
  ["c", "call-1", "b:antigravity:c"],
  Arbitrary.schema(Schema.NonEmptyString),
);

const start = int(
  DateTime.toEpochMillis(Report.limits.earliest),
  DateTime.toEpochMillis(DateTime.makeUnsafe("2030-01-01T00:00:00Z")),
).pipe(Arbitrary.map((millis) => DateTime.makeUnsafe(millis)));

const timeOf = (id: string) =>
  Number.parseInt(id.replaceAll("-", "").slice(0, 12), 16);

describe("reported request laws", () => {
  it.effect.prop(
    "L8: a reported request's id is a function of its client, call key and start alone, a UUID version 7 stamped with the start, and two call keys never share one",
    { oneKey: callKey, otherKey: callKey, startedAt: start },
    ({ oneKey, otherKey, startedAt }) =>
      Effect.sync(() => {
        const id = Report.idOf("antigravity", oneKey, startedAt);
        expect(Report.idOf("antigravity", oneKey, startedAt)).toBe(id);
        expect(id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
        expect(timeOf(id)).toBe(DateTime.toEpochMillis(startedAt));
        if (oneKey !== otherKey) {
          expect(Report.idOf("antigravity", otherKey, startedAt)).not.toBe(id);
        }
      }),
    { arbitrary: { runs: 500 } },
  );

  // A stored id is for ever: a call reported again after a release must still be held.
  it("L8: a reported request's id is the one the spec's text gives", () => {
    expect(
      Report.idOf(
        "antigravity",
        "3f6c1f0a-8a52-4a51-9d0e-2b7c5e8d4a10:12",
        DateTime.makeUnsafe("2026-11-22T09:12:03.120Z"),
      ),
    ).toBe("01a20286-df30-7b11-a70d-c896d74662d5");
  });
});
