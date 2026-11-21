import * as Fallback from "@cota/hub/fallback";
import { LoginFingerprint, ModelId, PoolId } from "@cota/hub/ids";
import { describe, expect, it } from "@effect/vitest";
import {
  Arbitrary,
  DateTime,
  Effect,
  Equal,
  HashMap,
  Option,
  Schema,
} from "effect";
import { TestClock } from "effect/testing";
import * as Proved from "./adapter.ts";

const pool = Arbitrary.schema(
  PoolId.check(Schema.isPattern(/^(work|personal|spare)$/)),
);
const login = Arbitrary.schema(
  LoginFingerprint.check(Schema.isPattern(/^login-[ab]$/)),
);
const model = Arbitrary.schema(
  ModelId.check(Schema.isPattern(/^(opus|sonnet)$/)),
);
const policy = Arbitrary.array(Arbitrary.all([pool, pool]), {
  minLength: 1,
  maxLength: 4,
}).pipe(
  Arbitrary.map(
    (fallbacks): Fallback.Policy => HashMap.fromIterable(fallbacks),
  ),
);
const flag = Arbitrary.schema(Schema.Boolean);
const int = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

const nineOClock = DateTime.toEpochMillis(
  DateTime.makeUnsafe("2026-11-11T09:00:00Z"),
);
const fiveMinutes = 5 * 60_000;
const anyTime = Arbitrary.all({ step: int(0, 12), nudge: int(-1, 1) }).pipe(
  Arbitrary.map(({ step, nudge }) =>
    DateTime.makeUnsafe(nineOClock + step * fiveMinutes + nudge),
  ),
);

const recorded = Arbitrary.all({
  login,
  model,
  reset: anyTime,
  givesReset: flag,
  recordedAt: anyTime,
}).pipe(
  Arbitrary.map(
    ({ givesReset, reset, recordedAt, ...refusal }): Proved.Recorded => ({
      refusal: givesReset ? { ...refusal, reset } : refusal,
      recordedAt,
    }),
  ),
);
const history = Arbitrary.array(recorded, { maxLength: 8 });

const resetOf = ({ refusal, recordedAt }: Proved.Recorded) =>
  refusal.reset ?? DateTime.add(recordedAt, { minutes: 15 });

const oneOf = <A>(
  items: ReadonlyArray<A>,
  otherwise: Arbitrary.Arbitrary<A>,
): Arbitrary.Arbitrary<A> =>
  Arbitrary.all({ index: int(0, items.length), otherwise }).pipe(
    Arbitrary.map(({ index, otherwise }) => items[index] ?? otherwise),
  );

const parkingOf = (refused: ReadonlyArray<Proved.Recorded>) =>
  oneOf(refused, recorded).pipe(
    Arbitrary.map(({ refusal: { login, model } }) => ({ login, model })),
  );

const requestTo = (refused: ReadonlyArray<Proved.Recorded>) =>
  Arbitrary.all({
    pool,
    carriesLogin: int(0, 3),
    parking: parkingOf(refused),
  }).pipe(
    Arbitrary.map(
      ({ pool, carriesLogin, parking }): Fallback.Request =>
        carriesLogin === 0
          ? { pool, model: parking.model }
          : { pool, ...parking },
    ),
  );

const nowAround = (refused: ReadonlyArray<Proved.Recorded>) =>
  oneOf(
    refused.flatMap((recorded) =>
      [-1, 0, 1].map((millis) =>
        DateTime.add(resetOf(recorded), { milliseconds: millis }),
      ),
    ),
    anyTime,
  );

const scene = Arbitrary.all({ policy, history }).pipe(
  Arbitrary.flatMap(({ policy, history }) =>
    Arbitrary.all({
      request: requestTo(history),
      now: nowAround(history),
    }).pipe(
      Arbitrary.map(({ request, now }) => ({ policy, history, request, now })),
    ),
  ),
);

const reading = history.pipe(
  Arbitrary.flatMap((history) =>
    Arbitrary.all({
      parking: parkingOf(history),
      now: nowAround(history),
    }).pipe(
      Arbitrary.map(({ parking, now }) => ({ history, ...parking, now })),
    ),
  ),
);

const setClock = (time: DateTime.Utc) =>
  TestClock.setTime(DateTime.toEpochMillis(time));

const recordEachAtItsTime = (history: ReadonlyArray<Proved.Recorded>) =>
  Effect.gen(function* () {
    const fallback = yield* Fallback.Fallback;
    for (const { refusal, recordedAt } of history) {
      yield* setClock(recordedAt);
      yield* fallback.record(refusal);
    }
  });

const runs = { arbitrary: { runs: 2000 } };

const percentages = (outcomes: ReadonlyArray<string>) =>
  Object.fromEntries(
    [...new Set(outcomes)]
      .sort()
      .map((outcome) => [
        outcome,
        Math.round(
          (outcomes.filter((each) => each === outcome).length /
            outcomes.length) *
            100,
        ),
      ]),
  );

const nearness = (reset: Option.Option<DateTime.Utc>, now: DateTime.Utc) => {
  if (Option.isNone(reset)) return "never refused";
  const ahead =
    DateTime.toEpochMillis(reset.value) - DateTime.toEpochMillis(now);
  if (ahead === 0) return "at the reset";
  if (ahead === 1) return "a millisecond before the reset";
  if (ahead === -1) return "a millisecond after the reset";
  return "away from the reset";
};

describe("fallback agreement", () => {
  it.effect.prop(
    "the shipped decide answers as the proved model does, for every history we generate",
    { scene },
    ({ scene: { policy, history, request, now } }) =>
      Effect.gen(function* () {
        const fallback = yield* Fallback.Fallback;
        yield* recordEachAtItsTime(history);
        yield* setClock(now);
        return Equal.equals(
          yield* fallback.decide(request),
          Proved.afterHistory(policy, history).decide(request, now),
        );
      }).pipe(Effect.provide(Fallback.layer(policy))),
    runs,
  );

  it.effect.prop(
    "the shipped parkedUntil answers as the proved model does, for every history we generate",
    { reading },
    ({ reading: { history, login, model, now } }) =>
      Effect.gen(function* () {
        const fallback = yield* Fallback.Fallback;
        yield* recordEachAtItsTime(history);
        yield* setClock(now);
        return Equal.equals(
          yield* fallback.parkedUntil(login, model),
          Proved.afterHistory(HashMap.empty(), history).parkedUntil(
            login,
            model,
            now,
          ),
        );
      }).pipe(Effect.provide(Fallback.layer(HashMap.empty()))),
    runs,
  );

  it.effect(
    "a fixed sample of the generated scenes reaches every rule of decide, and the instants around a reset",
    () =>
      Effect.gen(function* () {
        const scenes = yield* Arbitrary.sampleEffect(scene, {
          count: 2000,
          seed: "coverage",
        });
        const reached = scenes.map(({ policy, history, request, now }) => {
          if (request.login === undefined) {
            return { rule: "kept without a login" };
          }
          const proved = Proved.afterHistory(policy, history);
          const latestReset = proved.parkedUntil(
            request.login,
            request.model,
            DateTime.makeUnsafe(0),
          );
          const near = nearness(latestReset, now);
          const parked = Option.isSome(
            proved.parkedUntil(request.login, request.model, now),
          );
          if (!HashMap.has(policy, request.pool)) {
            return {
              rule: parked
                ? "kept while parked, with no fallback pool"
                : "kept with no fallback pool",
              near,
            };
          }
          if (parked) return { rule: "diverted", near };
          if (Option.isSome(latestReset)) {
            return { rule: "kept once the reset passed", near };
          }
          return { rule: "kept, never refused", near };
        });
        const rules = percentages(reached.map(({ rule }) => rule));
        const instants = percentages(
          reached.flatMap(({ near }) => (near === undefined ? [] : [near])),
        );
        console.info("share of scenes, in percent:", { rules, instants });

        expect(Object.keys(rules)).toHaveLength(6);
        expect(Math.min(...Object.values(rules))).toBeGreaterThanOrEqual(5);
        expect(
          Math.min(
            instants["at the reset"] ?? 0,
            instants["a millisecond before the reset"] ?? 0,
            instants["a millisecond after the reset"] ?? 0,
          ),
        ).toBeGreaterThanOrEqual(5);
      }),
  );
});
