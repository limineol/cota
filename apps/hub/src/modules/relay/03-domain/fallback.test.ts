import { describe, expect, it } from "@effect/vitest";
import { DateTime, Effect, HashMap, Option } from "effect";
import { TestClock } from "effect/testing";
import { LoginFingerprint, ModelId, PoolId } from "#shared/03-domain/ids.ts";
import * as Fallback from "./fallback.ts";

const at = (time: string) => DateTime.makeUnsafe(`2026-11-11T${time}Z`);

const clockAt = (time: string) =>
  TestClock.setTime(DateTime.toEpochMillis(at(time)));

const work = PoolId.make("work");
const personal = PoolId.make("personal");
const api = PoolId.make("api");
const policy: Fallback.Policy = HashMap.make([work, personal]);

const alice = LoginFingerprint.make("login-alice");
const bob = LoginFingerprint.make("login-bob");
const opus = ModelId.make("opus");
const sonnet = ModelId.make("sonnet");

const aliceOnOpusUntilNoon: Fallback.Refusal = {
  login: alice,
  model: opus,
  reset: at("12:00:00"),
};

describe("decide", () => {
  it.effect(
    "keeps a request without a login, even while every login is parked",
    () =>
      Effect.gen(function* () {
        const fallback = yield* Fallback.Fallback;
        yield* clockAt("10:00:00");
        yield* fallback.record(aliceOnOpusUntilNoon);
        yield* fallback.record({ ...aliceOnOpusUntilNoon, login: bob });
        yield* clockAt("11:00:00");

        expect(yield* fallback.decide({ pool: work, model: opus })).toEqual({
          _tag: "Keep",
        });
      }).pipe(Effect.provide(Fallback.layer(policy))),
  );

  it.effect("keeps a parked login whose pool has no fallback pool", () =>
    Effect.gen(function* () {
      const fallback = yield* Fallback.Fallback;
      yield* clockAt("10:00:00");
      yield* fallback.record(aliceOnOpusUntilNoon);
      yield* clockAt("11:00:00");

      expect(
        yield* fallback.decide({ pool: api, login: alice, model: opus }),
      ).toEqual({ _tag: "Keep" });
    }).pipe(Effect.provide(Fallback.layer(policy))),
  );

  it.effect(
    "diverts a parked login to its pool's fallback pool, with the reset",
    () =>
      Effect.gen(function* () {
        const fallback = yield* Fallback.Fallback;
        yield* clockAt("10:00:00");
        yield* fallback.record(aliceOnOpusUntilNoon);
        yield* clockAt("11:59:59.999");

        expect(
          yield* fallback.decide({ pool: work, login: alice, model: opus }),
        ).toEqual({
          _tag: "Divert",
          fallbackPool: personal,
          reset: at("12:00:00"),
        });
      }).pipe(Effect.provide(Fallback.layer(policy))),
  );

  it.effect("keeps a parked login again at the reset itself", () =>
    Effect.gen(function* () {
      const fallback = yield* Fallback.Fallback;
      yield* clockAt("10:00:00");
      yield* fallback.record(aliceOnOpusUntilNoon);
      yield* clockAt("12:00:00");

      expect(
        yield* fallback.decide({ pool: work, login: alice, model: opus }),
      ).toEqual({ _tag: "Keep" });
    }).pipe(Effect.provide(Fallback.layer(policy))),
  );

  it.effect(
    "keeps another login on the same pool, and the parked login on another model",
    () =>
      Effect.gen(function* () {
        const fallback = yield* Fallback.Fallback;
        yield* clockAt("10:00:00");
        yield* fallback.record(aliceOnOpusUntilNoon);
        yield* clockAt("11:00:00");

        expect([
          yield* fallback.decide({ pool: work, login: bob, model: opus }),
          yield* fallback.decide({ pool: work, login: alice, model: sonnet }),
        ]).toEqual([{ _tag: "Keep" }, { _tag: "Keep" }]);
      }).pipe(Effect.provide(Fallback.layer(policy))),
  );

  it.effect("keeps a login that was never refused", () =>
    Effect.gen(function* () {
      const fallback = yield* Fallback.Fallback;
      yield* clockAt("11:00:00");

      expect(
        yield* fallback.decide({ pool: work, login: alice, model: opus }),
      ).toEqual({ _tag: "Keep" });
    }).pipe(Effect.provide(Fallback.layer(policy))),
  );
});

describe("record", () => {
  it.effect(
    "parks a refusal without a reset for 15 minutes from when it was recorded",
    () =>
      Effect.gen(function* () {
        const fallback = yield* Fallback.Fallback;
        yield* clockAt("10:00:00");
        yield* fallback.record({ login: alice, model: opus });

        expect(yield* fallback.parkedUntil(alice, opus)).toEqual(
          Option.some(at("10:15:00")),
        );
      }).pipe(Effect.provide(Fallback.layer(policy))),
  );

  it.effect("keeps the later of two resets, in either order", () =>
    Effect.gen(function* () {
      const early = { login: alice, model: opus, reset: at("11:00:00") };
      const late = { login: alice, model: opus, reset: at("12:00:00") };
      const parkedUntilAfter = (
        first: Fallback.Refusal,
        second: Fallback.Refusal,
      ) =>
        Effect.gen(function* () {
          const fallback = yield* Fallback.Fallback;
          yield* clockAt("10:00:00");
          yield* fallback.record(first);
          yield* clockAt("10:30:00");
          yield* fallback.record(second);
          return yield* fallback.parkedUntil(alice, opus);
        }).pipe(Effect.provide(Fallback.layer(policy)));

      expect([
        yield* parkedUntilAfter(early, late),
        yield* parkedUntilAfter(late, early),
      ]).toEqual([Option.some(at("12:00:00")), Option.some(at("12:00:00"))]);
    }),
  );

  it.effect("keeps the later reset after the earlier one has passed", () =>
    Effect.gen(function* () {
      const fallback = yield* Fallback.Fallback;
      yield* clockAt("10:00:00");
      yield* fallback.record({
        login: alice,
        model: opus,
        reset: at("11:00:00"),
      });
      yield* clockAt("10:30:00");
      yield* fallback.record({
        login: alice,
        model: opus,
        reset: at("10:45:00"),
      });
      yield* clockAt("10:50:00");

      expect(yield* fallback.parkedUntil(alice, opus)).toEqual(
        Option.some(at("11:00:00")),
      );
    }).pipe(Effect.provide(Fallback.layer(policy))),
  );

  it.effect("leaves every other login and model as it was", () =>
    Effect.gen(function* () {
      const fallback = yield* Fallback.Fallback;
      yield* clockAt("10:00:00");
      yield* fallback.record(aliceOnOpusUntilNoon);
      yield* clockAt("10:30:00");
      yield* fallback.record({
        login: bob,
        model: sonnet,
        reset: at("13:00:00"),
      });
      yield* clockAt("11:00:00");

      expect([
        yield* fallback.parkedUntil(alice, opus),
        yield* fallback.parkedUntil(alice, sonnet),
        yield* fallback.parkedUntil(bob, opus),
      ]).toEqual([Option.some(at("12:00:00")), Option.none(), Option.none()]);
    }).pipe(Effect.provide(Fallback.layer(policy))),
  );
});

describe("parkedUntil", () => {
  it.effect("gives the reset before it and nothing from the reset on", () =>
    Effect.gen(function* () {
      const fallback = yield* Fallback.Fallback;
      yield* clockAt("10:00:00");
      yield* fallback.record(aliceOnOpusUntilNoon);
      yield* clockAt("11:59:59.999");
      const before = yield* fallback.parkedUntil(alice, opus);
      yield* clockAt("12:00:00");
      const atReset = yield* fallback.parkedUntil(alice, opus);

      expect([before, atReset]).toEqual([
        Option.some(at("12:00:00")),
        Option.none(),
      ]);
    }).pipe(Effect.provide(Fallback.layer(policy))),
  );
});

describe("forget", () => {
  it.effect(
    "drops what resets at or before now and keeps what resets later",
    () =>
      Effect.gen(function* () {
        const fallback = yield* Fallback.Fallback;
        yield* clockAt("10:00:00");
        yield* fallback.record(aliceOnOpusUntilNoon);
        yield* fallback.record({
          login: bob,
          model: opus,
          reset: at("12:00:00.001"),
        });
        yield* clockAt("12:00:00");
        yield* fallback.forget;
        yield* clockAt("10:00:00");

        expect([
          yield* fallback.parkedUntil(alice, opus),
          yield* fallback.parkedUntil(bob, opus),
        ]).toEqual([Option.none(), Option.some(at("12:00:00.001"))]);
      }).pipe(Effect.provide(Fallback.layer(policy))),
  );
});
