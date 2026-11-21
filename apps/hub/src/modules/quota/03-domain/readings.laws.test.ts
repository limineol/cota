import { expect, it } from "@effect/vitest";
import { Arbitrary, DateTime, Duration, Effect, Fiber, Option } from "effect";
import { TestClock } from "effect/testing";
import * as QuotaLog from "#modules/quota/05-tests/quota-log.ts";
import { PoolId } from "#shared/03-domain/ids.ts";
import * as Readings from "./readings.ts";

const second = 1000;
const minute = 60 * second;

/** What a scripted read does once started: how long it takes, and how it ends. */
type Outcome =
  | { readonly _tag: "Good"; readonly durationMs: number }
  | {
      readonly _tag: "Failed";
      readonly durationMs: number;
      readonly kind: Readings.ReadFailure["kind"];
      readonly retryAfterMs: number | undefined;
    }
  | { readonly _tag: "Expired"; readonly durationMs: number };

/** A step of a scene: an ask of the pool, or a move of the clock, to the next read's time or a running read's end, a millisecond either side at times. */
type Step =
  | { readonly _tag: "Ask" }
  | {
      readonly _tag: "MoveTo";
      readonly to: "next" | "end";
      readonly nudge: number;
    }
  | { readonly _tag: "Move"; readonly ms: number };

interface Scene {
  readonly period: number;
  readonly steps: ReadonlyArray<Step>;
  readonly outcomes: ReadonlyArray<Outcome>;
}

const duration = QuotaLog.pick([0, 0, 0, 1, 4 * second, 12 * second]);

const outcomeOf = (
  which: Arbitrary.Arbitrary<Outcome["_tag"]>,
): Arbitrary.Arbitrary<Outcome> =>
  Arbitrary.all({
    which,
    durationMs: duration,
    kind: QuotaLog.pick([
      "unreachable",
      "refused",
      "rate-limited",
      "failed",
      "unreadable",
    ]),
    retryAfterMs: QuotaLog.pick([
      undefined,
      undefined,
      0,
      30 * second,
      5 * minute,
      20 * minute,
    ]),
  }).pipe(
    Arbitrary.map(({ which, durationMs, kind, retryAfterMs }): Outcome => {
      if (which === "Good") return { _tag: "Good", durationMs };
      if (which === "Expired") return { _tag: "Expired", durationMs };
      return {
        _tag: "Failed",
        durationMs,
        kind,
        retryAfterMs: kind === "rate-limited" ? retryAfterMs : undefined,
      };
    }),
  );

const step: Arbitrary.Arbitrary<Step> = Arbitrary.all({
  which: QuotaLog.pick(["Ask", "Ask", "Ask", "MoveTo", "MoveTo", "Move"]),
  to: QuotaLog.pick(["next", "next", "end"]),
  nudge: QuotaLog.pick([-1, 0, 1]),
  ms: QuotaLog.pick([
    1,
    second,
    30 * second,
    60 * second,
    90 * second,
    2 * minute,
    16 * minute,
  ]),
}).pipe(
  Arbitrary.map(({ which, to, nudge, ms }): Step => {
    if (which === "Ask") return { _tag: "Ask" };
    if (which === "MoveTo") return { _tag: "MoveTo", to, nudge };
    return { _tag: "Move", ms };
  }),
);

const sceneOf = (
  which: Arbitrary.Arbitrary<Outcome["_tag"]>,
): Arbitrary.Arbitrary<Scene> =>
  Arbitrary.all({
    period: QuotaLog.pick([60 * second, 120 * second]),
    steps: Arbitrary.array(step, { minLength: 20, maxLength: 40 }),
    outcomes: Arbitrary.array(outcomeOf(which), {
      minLength: 10,
      maxLength: 30,
    }),
  });

/** Scenes whose reads end every way. */
const anyScene = sceneOf(
  QuotaLog.pick(["Good", "Good", "Failed", "Failed", "Expired"]),
);

/** What an ask answered, by plain values. */
interface Answer {
  readonly reading: { readonly plan: string; readonly at: number } | null;
  readonly failure: {
    readonly detail: string;
    readonly kind: string;
    readonly at: number;
  } | null;
  readonly failures: number;
  readonly nextAt: number | null;
}

const answerOf = (kept: Readings.Kept): Answer => ({
  reading: Option.getOrNull(
    Option.map(kept.last, ({ reading, at }) => ({
      plan: Option.getOrElse(reading.plan, () => ""),
      at: DateTime.toEpochMillis(at),
    })),
  ),
  failure: Option.getOrNull(
    Option.map(kept.failure, ({ failure, at }) => ({
      detail: failure.detail,
      kind: failure.kind,
      at: DateTime.toEpochMillis(at),
    })),
  ),
  failures: kept.failures,
  nextAt: Option.getOrNull(Option.map(kept.nextAt, DateTime.toEpochMillis)),
});

const nothing: Answer = {
  reading: null,
  failure: null,
  failures: 0,
  nextAt: null,
};

/** The quota readers spec's "When the hub reads", written out again over plain numbers. */
class Model {
  now: number;
  state: Answer = nothing;
  running: { readonly id: number; readonly end: number } | undefined;
  readonly starts: Array<number> = [];
  /** For each ask, its answer, or the read it waits for. */
  readonly asks: Array<Answer | number> = [];
  /** The state after each read, by its number. */
  readonly after = new Map<number, Answer>();

  constructor(
    readonly period: number,
    readonly outcomes: ReadonlyArray<Outcome>,
    start: number,
  ) {
    this.now = start;
  }

  outcomeOf(id: number): Outcome {
    return this.outcomes[id] ?? { _tag: "Good", durationMs: 0 };
  }

  waitAfter(failures: number): number {
    return Math.min(15 * minute, this.period * 2 ** (failures - 1));
  }

  end(id: number, at: number) {
    const outcome = this.outcomeOf(id);
    switch (outcome._tag) {
      case "Good":
        this.state = {
          reading: { plan: `read ${id}`, at },
          failure: null,
          failures: 0,
          nextAt: at + this.period,
        };
        break;
      case "Expired":
        this.state = nothing;
        break;
      case "Failed": {
        const failures = this.state.failures + 1;
        this.state = {
          reading: this.state.reading,
          failure: { detail: `read ${id}`, kind: outcome.kind, at },
          failures,
          nextAt: Math.max(
            at + this.waitAfter(failures),
            outcome.retryAfterMs === undefined
              ? Number.NEGATIVE_INFINITY
              : at + outcome.retryAfterMs,
          ),
        };
      }
    }
    this.running = undefined;
    this.after.set(id, this.state);
  }

  ask() {
    if (this.running !== undefined) {
      this.asks.push(this.running.id);
      return;
    }
    if (this.state.nextAt !== null && this.now < this.state.nextAt) {
      this.asks.push(this.state);
      return;
    }
    const id = this.starts.length;
    this.starts.push(this.now);
    this.running = { id, end: this.now + this.outcomeOf(id).durationMs };
    this.asks.push(id);
    if (this.running.end === this.now) this.end(id, this.now);
  }

  /** Where a move lands: the next read's time or the running read's end, nudged, or a fixed step; never back. */
  targetOf(step: Exclude<Step, { _tag: "Ask" }>): number {
    if (step._tag === "Move") return this.now + step.ms;
    const mark = step.to === "end" ? this.running?.end : this.state.nextAt;
    return Math.max(this.now, (mark ?? this.now) + step.nudge);
  }

  moveTo(target: number) {
    if (this.running !== undefined && this.running.end <= target) {
      this.end(this.running.id, this.running.end);
    }
    this.now = target;
  }

  expected(): ReadonlyArray<Answer> {
    return this.asks.map((ask) =>
      typeof ask === "number" ? (this.after.get(ask) ?? nothing) : ask,
    );
  }
}

const pool = PoolId.make("zai");
const start = DateTime.toEpochMillis(QuotaLog.now);

const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 40; turn++) yield* Effect.yieldNow;
});

/** Runs a scene against a new cache with a scripted read, beside the model of it. */
const played = (scene: Scene) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(start);
    const readings = yield* Readings.Readings;
    const model = new Model(scene.period, scene.outcomes, start);
    const starts: Array<number> = [];
    let running = 0;
    let mostRunning = 0;
    const read = Effect.gen(function* () {
      const id = starts.length;
      const outcome = model.outcomeOf(id);
      starts.push(DateTime.toEpochMillis(yield* DateTime.now));
      running++;
      mostRunning = Math.max(mostRunning, running);
      yield* Effect.sleep(Duration.millis(outcome.durationMs)).pipe(
        Effect.ensuring(Effect.sync(() => running--)),
      );
      const end = DateTime.toEpochMillis(yield* DateTime.now);
      switch (outcome._tag) {
        case "Good":
          return { windows: [], plan: Option.some(`read ${id}`) };
        case "Expired":
          return yield* new Readings.QuotaLoginExpired();
        case "Failed":
          return yield* new Readings.ReadFailure({
            kind: outcome.kind,
            status: Option.none(),
            detail: `read ${id}`,
            retryAt: Option.map(
              Option.fromUndefinedOr(outcome.retryAfterMs),
              (ms) => DateTime.makeUnsafe(end + ms),
            ),
          });
      }
    });
    const asks: Array<Fiber.Fiber<Readings.Kept>> = [];
    for (const step of scene.steps) {
      if (step._tag === "Ask") {
        model.ask();
        asks.push(
          yield* Effect.forkChild(
            readings.ask(pool, Duration.millis(scene.period), read),
          ),
        );
      } else {
        const target = model.targetOf(step);
        model.moveTo(target);
        yield* TestClock.setTime(target);
      }
      yield* settle;
    }
    const last = model.now + 60 * minute;
    model.moveTo(last);
    yield* TestClock.setTime(last);
    yield* settle;
    const answers: Array<Answer> = [];
    for (const ask of asks) answers.push(answerOf(yield* Fiber.join(ask)));
    return { model, starts, mostRunning, answers };
  }).pipe(Effect.provide(Readings.layer));

const runs = { arbitrary: { runs: 300 } };

/** The reads a model started, each with when it started and ended and how. */
const readsOf = (model: Model) =>
  model.starts.map((at, id) => {
    const outcome = model.outcomeOf(id);
    return { at, end: at + outcome.durationMs, outcome };
  });

it.effect.prop(
  "U1: for any asks of a pool, however they overlap, no two reads of that pool are in flight at once, and every ask made while a read runs gets that read's outcome",
  { scene: anyScene },
  ({ scene }) =>
    Effect.gen(function* () {
      const { model, mostRunning, answers } = yield* played(scene);
      expect(mostRunning).toBeLessThanOrEqual(1);
      const expected = model.expected();
      model.asks.forEach((ask, index) => {
        if (typeof ask === "number") {
          expect(answers[index]).toEqual(expected[index]);
        }
      });
    }),
  runs,
);

it.effect.prop(
  "U2: after a good reading of a pool, no read of it starts until its period has passed, and the first ask at or after then starts one",
  { scene: sceneOf(QuotaLog.pick(["Good", "Good", "Good", "Expired"])) },
  ({ scene }) =>
    Effect.gen(function* () {
      const { model, starts } = yield* played(scene);
      const reads = readsOf(model);
      reads.forEach((read, index) => {
        const next = reads[index + 1];
        if (read.outcome._tag === "Good" && next !== undefined) {
          expect(next.at).toBeGreaterThanOrEqual(read.end + scene.period);
        }
      });
      expect(starts).toEqual(model.starts);
    }),
  runs,
);

it.effect.prop(
  "U3: after n failed reads in a row, no read starts before the last failure's end plus the longer of min(15 minutes, period × 2^(n−1)) and its retry-after, and the first ask at or after then starts one; a good reading ends the run",
  { scene: sceneOf(QuotaLog.pick(["Failed", "Failed", "Failed", "Good"])) },
  ({ scene }) =>
    Effect.gen(function* () {
      const { model, starts } = yield* played(scene);
      let failures = 0;
      for (const [index, read] of readsOf(model).entries()) {
        const next = readsOf(model)[index + 1];
        if (read.outcome._tag !== "Failed") {
          failures = 0;
          continue;
        }
        failures++;
        if (next === undefined) continue;
        const backoff = Math.min(
          15 * minute,
          scene.period * 2 ** (failures - 1),
        );
        expect(next.at).toBeGreaterThanOrEqual(
          read.end + Math.max(backoff, read.outcome.retryAfterMs ?? 0),
        );
      }
      expect(starts).toEqual(model.starts);
    }),
  runs,
);

it.effect.prop(
  "U4: after any sequence of reads, a pool's quota reading is its last good one, and its failure the latest since that reading, or none",
  { scene: anyScene },
  ({ scene }) =>
    Effect.gen(function* () {
      const { model, answers } = yield* played(scene);
      expect(answers).toEqual(model.expected());
    }),
  runs,
);

/** The scene the given steps and outcomes make, and what it answered. */
const fixed = (
  period: number,
  steps: ReadonlyArray<Step>,
  outcomes: ReadonlyArray<Outcome>,
) => played({ period, steps, outcomes });

const ask: Step = { _tag: "Ask" };
const toNext = (nudge: number): Step => ({ _tag: "MoveTo", to: "next", nudge });
const failed = (retryAfterMs?: number): Outcome => ({
  _tag: "Failed",
  durationMs: 0,
  kind: retryAfterMs === undefined ? "failed" : "rate-limited",
  retryAfterMs,
});

it.effect(
  "U1: three asks while one read runs share it, and all three get its reading",
  () =>
    Effect.gen(function* () {
      const { starts, answers } = yield* fixed(
        60 * second,
        [ask, ask, { _tag: "Move", ms: second }, ask],
        [{ _tag: "Good", durationMs: 4 * second }],
      );
      expect(starts).toEqual([start]);
      const reading = {
        reading: { plan: "read 0", at: start + 4 * second },
        failure: null,
        failures: 0,
        nextAt: start + 64 * second,
      };
      expect(answers).toEqual([reading, reading, reading]);
    }),
);

it.effect(
  "U2: a pool read with a held key is read again at 60 seconds after a good reading, not a millisecond before",
  () =>
    Effect.gen(function* () {
      const { starts } = yield* fixed(
        60 * second,
        [ask, toNext(-1), ask, toNext(0), ask],
        [{ _tag: "Good", durationMs: 0 }],
      );
      expect(starts).toEqual([start, start + 60 * second]);
    }),
);

it.effect(
  "U3: after one to six failed reads in a row the waits are 60 seconds, 2, 4, 8 and 15 minutes with a held key, and 2, 4, 8 and 15 minutes with a quota login",
  () =>
    Effect.gen(function* () {
      const steps = [
        ask,
        ...Array.from({ length: 6 }, () => [
          toNext(-1),
          ask,
          toNext(0),
          ask,
        ]).flat(),
      ];
      const outcomes = Array.from({ length: 7 }, () => failed());
      const gaps = (reads: ReadonlyArray<number>) =>
        reads.slice(1).map((at, index) => at - (reads[index] ?? 0));
      expect(gaps((yield* fixed(60 * second, steps, outcomes)).starts)).toEqual(
        [1, 2, 4, 8, 15, 15].map((minutes) => minutes * minute),
      );
      expect(
        gaps((yield* fixed(120 * second, steps, outcomes)).starts),
      ).toEqual([2, 4, 8, 15, 15, 15].map((minutes) => minutes * minute));
    }),
);

it.effect(
  "U3: a 429's retry-after longer than the backoff holds the next read back until it has passed",
  () =>
    Effect.gen(function* () {
      const { starts, answers } = yield* fixed(
        60 * second,
        [ask, toNext(-1), ask, toNext(0), ask],
        [failed(20 * minute), { _tag: "Good", durationMs: 0 }],
      );
      expect(starts).toEqual([start, start + 20 * minute]);
      expect(answers[1]?.nextAt).toBe(start + 20 * minute);
    }),
);

it.effect(
  "U4: a failed read keeps the last good reading beside its failure, a good one clears the failure, and an expired quota login forgets them",
  () =>
    Effect.gen(function* () {
      const later = { _tag: "Move", ms: 16 * minute } as const;
      const { answers } = yield* fixed(
        60 * second,
        [ask, later, ask, later, ask, later, ask],
        [
          { _tag: "Good", durationMs: 0 },
          failed(),
          { _tag: "Good", durationMs: 0 },
          { _tag: "Expired", durationMs: 0 },
        ],
      );
      const at = (minutes: number) => start + minutes * minute;
      expect(answers).toEqual([
        {
          reading: { plan: "read 0", at: at(0) },
          failure: null,
          failures: 0,
          nextAt: at(1),
        },
        {
          reading: { plan: "read 0", at: at(0) },
          failure: { detail: "read 1", kind: "failed", at: at(16) },
          failures: 1,
          nextAt: at(17),
        },
        {
          reading: { plan: "read 2", at: at(32) },
          failure: null,
          failures: 0,
          nextAt: at(33),
        },
        nothing,
      ]);
    }),
);

it.effect(
  "U2: a read every asker stopped waiting for runs to its end and is kept, so twenty abandoned asks make one read in a period",
  () =>
    Effect.gen(function* () {
      const readings = yield* Readings.Readings;
      const pool = PoolId.make("abandoned");
      let reads = 0;
      const read = Effect.gen(function* () {
        reads++;
        yield* Effect.sleep(Duration.seconds(4));
        return { windows: [], plan: Option.some(`read ${reads}`) };
      });
      const asking = Effect.forkChild(
        readings.ask(pool, Duration.seconds(60), read),
      );
      for (let abandoned = 0; abandoned < 20; abandoned++) {
        const asked = yield* asking;
        yield* Effect.yieldNow;
        yield* Fiber.interrupt(asked);
      }
      const asked = yield* asking;
      yield* TestClock.adjust(Duration.seconds(4));
      const kept = yield* Fiber.join(asked);
      expect({
        reads,
        plan: Option.flatMap(kept.last, ({ reading }) => reading.plan),
      }).toEqual({ reads: 1, plan: Option.some("read 1") });
    }).pipe(Effect.provide(Readings.layer)),
);
