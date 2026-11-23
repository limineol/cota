import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, DateTime, Effect, Schema } from "effect";
import * as Report from "#modules/request-log/03-domain/report.ts";
import { HubKeyName } from "#shared/03-domain/ids.ts";

const int = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

const oneOf = <A>(values: ReadonlyArray<A>, other: Arbitrary.Arbitrary<A>) =>
  Arbitrary.all({ at: int(0, values.length), other }).pipe(
    Arbitrary.map(({ at, other }) => values[at] ?? other),
  );

// Names and keys that meet often, a colon among them, as any text may hold one.
const reporter = Arbitrary.all({
  owner: Arbitrary.schema(Schema.Boolean),
  name: oneOf(
    ["fleet", "a", "owner", "a:antigravity:b"],
    Arbitrary.schema(Schema.NonEmptyString),
  ),
}).pipe(
  Arbitrary.map(
    ({ owner, name }): Report.Reporter =>
      owner
        ? { _tag: "Owner" }
        : { _tag: "HubKey", name: HubKeyName.make(name) },
  ),
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

const sameReporter = (one: Report.Reporter, other: Report.Reporter) =>
  Report.reporterText(one) === Report.reporterText(other);

describe("reported request laws", () => {
  it.effect.prop(
    "L8: a reported request's id is a function of its reporter, client, call key and start alone, a UUID version 7 stamped with the start, and two reporters never share one whatever their call keys",
    {
      generated: Arbitrary.all({
        one: reporter,
        other: reporter,
        oneKey: callKey,
        otherKey: callKey,
      }),
      // A key named with what a call key goes on with, beside a key whose name
      // ends where that one's call key begins.
      straddled: Arbitrary.schema(Schema.Boolean),
      startedAt: start,
    },
    ({ generated, straddled, startedAt }) =>
      Effect.sync(() => {
        const { one, other, oneKey, otherKey } = straddled
          ? ({
              one: { _tag: "HubKey", name: HubKeyName.make("a:antigravity:b") },
              oneKey: "c",
              other: { _tag: "HubKey", name: HubKeyName.make("a") },
              otherKey: "b:antigravity:c",
            } satisfies typeof generated)
          : generated;
        const id = Report.idOf(one, "antigravity", oneKey, startedAt);
        expect(Report.idOf(one, "antigravity", oneKey, startedAt)).toBe(id);
        expect(id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
        expect(timeOf(id)).toBe(DateTime.toEpochMillis(startedAt));
        const others = Report.idOf(other, "antigravity", otherKey, startedAt);
        if (!sameReporter(one, other)) expect(others).not.toBe(id);
        if (sameReporter(one, other) && oneKey !== otherKey) {
          expect(others).not.toBe(id);
        }
      }),
    { arbitrary: { runs: 500 } },
  );
});
