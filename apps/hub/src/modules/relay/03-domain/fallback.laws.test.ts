import { describe, it } from "@effect/vitest";
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
import { LoginFingerprint, ModelId, PoolId } from "#shared/03-domain/ids.ts";
import * as Fallback from "./fallback.ts";

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
  minLength: 2,
  maxLength: 3,
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

interface Recorded {
  readonly refusal: Fallback.Refusal;
  readonly recordedAt: DateTime.Utc;
}

const recorded = Arbitrary.all({
  login,
  model,
  reset: anyTime,
  givesReset: flag,
  recordedAt: anyTime,
}).pipe(
  Arbitrary.map(
    ({ givesReset, reset, recordedAt, ...refusal }): Recorded => ({
      refusal: givesReset ? { ...refusal, reset } : refusal,
      recordedAt,
    }),
  ),
);
const history = Arbitrary.array(recorded, { maxLength: 8 });

const request = Arbitrary.all({ pool, login, model, carriesLogin: flag }).pipe(
  Arbitrary.map(
    ({ carriesLogin, login, ...request }): Fallback.Request =>
      carriesLogin ? { ...request, login } : request,
  ),
);

const setClock = (time: DateTime.Utc) =>
  TestClock.setTime(DateTime.toEpochMillis(time));

const recordEachAtItsTime = (history: ReadonlyArray<Recorded>) =>
  Effect.gen(function* () {
    const fallback = yield* Fallback.Fallback;
    for (const { refusal, recordedAt } of history) {
      yield* setClock(recordedAt);
      yield* fallback.record(refusal);
    }
  });

const decideAt = (request: Fallback.Request, now: DateTime.Utc) =>
  Effect.gen(function* () {
    const fallback = yield* Fallback.Fallback;
    yield* setClock(now);
    return yield* fallback.decide(request);
  });

const resetOf = ({ refusal, recordedAt }: Recorded) =>
  refusal.reset ?? DateTime.add(recordedAt, { minutes: 15 });

const isFor =
  (request: Fallback.Request) =>
  ({ refusal }: Recorded) =>
    refusal.login === request.login && refusal.model === request.model;

const timesAround = (history: ReadonlyArray<Recorded>) =>
  history
    .flatMap((recorded) => [recorded.recordedAt, resetOf(recorded)])
    .flatMap((time) =>
      [-1, 0, 1].map((millis) => DateTime.add(time, { milliseconds: millis })),
    );

const runs = { arbitrary: { runs: 1000 } };

describe("fallback laws", () => {
  it.effect.prop(
    "F1: a request without a login is kept, whatever was refused before it",
    { policy, history, request: Arbitrary.all({ pool, model }), now: anyTime },
    ({ policy, history, request, now }) =>
      Effect.gen(function* () {
        yield* recordEachAtItsTime(history);
        const decision = yield* decideAt(request, now);
        return decision._tag === "Keep";
      }).pipe(Effect.provide(Fallback.layer(policy))),
    runs,
  );

  it.effect.prop(
    "F2: a diverted request goes to the fallback pool of the pool it bills, and to no other",
    { policy, history, request, now: anyTime },
    ({ policy, history, request, now }) =>
      Effect.gen(function* () {
        yield* recordEachAtItsTime(history);
        const decision = yield* decideAt(request, now);
        if (decision._tag === "Keep") return true;
        return Equal.equals(
          Option.some(decision.fallbackPool),
          HashMap.get(policy, request.pool),
        );
      }).pipe(Effect.provide(Fallback.layer(policy))),
    runs,
  );

  it.effect.prop(
    "F3: recording a refusal for another login, or for another model, never changes the decision for a request",
    {
      policy,
      history,
      unrelated: Arbitrary.all({ request, other: recorded }).pipe(
        Arbitrary.filter(({ request, other }) => !isFor(request)(other)),
      ),
      now: anyTime,
    },
    ({ policy, history, unrelated: { request, other }, now }) =>
      Effect.gen(function* () {
        const decisionAfter = (history: ReadonlyArray<Recorded>) =>
          Effect.gen(function* () {
            yield* recordEachAtItsTime(history);
            return yield* decideAt(request, now);
          }).pipe(Effect.provide(Fallback.layer(policy)));
        return Equal.equals(
          yield* decisionAfter([...history, other]),
          yield* decisionAfter(history),
        );
      }),
    runs,
  );

  it.effect.prop(
    "F4: a request is diverted only if a refusal for its own login and model was recorded with a reset after now",
    { policy, history, request, now: anyTime },
    ({ policy, history, request, now }) =>
      Effect.gen(function* () {
        yield* recordEachAtItsTime(history);
        const decision = yield* decideAt(request, now);
        if (decision._tag === "Keep") return true;
        return history
          .filter(isFor(request))
          .some((recorded) => DateTime.isGreaterThan(resetOf(recorded), now));
      }).pipe(Effect.provide(Fallback.layer(policy))),
    runs,
  );

  it.effect.prop(
    "F5: once now reaches the latest reset recorded for a login and model, that login's requests for that model are kept again",
    { policy, refused: recorded, others: history, pool, afterwards: int(0, 2) },
    ({ policy, refused, others, pool, afterwards }) =>
      Effect.gen(function* () {
        const history = [refused, ...others];
        const request = {
          pool,
          login: refused.refusal.login,
          model: refused.refusal.model,
        };
        const latestReset = history
          .filter(isFor(request))
          .map(resetOf)
          .reduce((latest, reset) => DateTime.max(latest, reset));
        yield* recordEachAtItsTime(history);
        const decision = yield* decideAt(
          request,
          DateTime.add(latestReset, { milliseconds: afterwards }),
        );
        return decision._tag === "Keep";
      }).pipe(Effect.provide(Fallback.layer(policy))),
    runs,
  );

  it.effect.prop(
    "F6: recording the same refusals in any order, and any number of times each, gives the same decisions",
    {
      policy,
      recordings: Arbitrary.array(
        Arbitrary.all({
          recorded,
          ranks: Arbitrary.array(int(0, 99), { minLength: 1, maxLength: 3 }),
        }),
        { maxLength: 8 },
      ),
      request,
    },
    ({ policy, recordings, request }) =>
      Effect.gen(function* () {
        const history = recordings.map(({ recorded }) => recorded);
        const reordered = recordings
          .flatMap(({ recorded, ranks }) =>
            ranks.map((rank) => ({ rank, recorded })),
          )
          .sort((left, right) => left.rank - right.rank)
          .map(({ recorded }) => recorded);
        const times = timesAround(history);
        const decisionsAfter = (history: ReadonlyArray<Recorded>) =>
          Effect.gen(function* () {
            yield* recordEachAtItsTime(history);
            const decisions: Array<Fallback.Decision> = [];
            for (const now of times) {
              decisions.push(yield* decideAt(request, now));
            }
            return decisions;
          }).pipe(Effect.provide(Fallback.layer(policy)));
        return Equal.equals(
          yield* decisionsAfter(reordered),
          yield* decisionsAfter(history),
        );
      }),
    runs,
  );

  it.effect.prop(
    "F7: forget changes no decision made at or after the time it ran",
    { policy, history, forgetAt: anyTime, request },
    ({ policy, history, forgetAt, request }) =>
      Effect.gen(function* () {
        const times = [forgetAt, ...timesAround(history)].filter((now) =>
          DateTime.isGreaterThanOrEqualTo(now, forgetAt),
        );
        const decisionsAfter = (forgets: boolean) =>
          Effect.gen(function* () {
            const fallback = yield* Fallback.Fallback;
            yield* recordEachAtItsTime(history);
            if (forgets) {
              yield* setClock(forgetAt);
              yield* fallback.forget;
            }
            const decisions: Array<Fallback.Decision> = [];
            for (const now of times) {
              decisions.push(yield* decideAt(request, now));
            }
            return decisions;
          }).pipe(Effect.provide(Fallback.layer(policy)));
        return Equal.equals(
          yield* decisionsAfter(true),
          yield* decisionsAfter(false),
        );
      }),
    runs,
  );
});
