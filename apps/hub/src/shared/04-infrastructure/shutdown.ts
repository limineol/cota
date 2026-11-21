import {
  Clock,
  Context,
  Duration,
  Effect,
  FiberSet,
  Layer,
  Option,
  Ref,
} from "effect";

export class Shutdown extends Context.Service<
  Shutdown,
  {
    readonly begin: Effect.Effect<void>;
    /**
     * Is true once the grace period that began with the hub's shutdown is
     * over, when the hub cuts what is still in flight.
     */
    readonly cutting: Effect.Effect<boolean>;
  }
>()("@cota/hub/Shutdown") {}

export const layer = (grace: Duration.Input): Layer.Layer<Shutdown> =>
  Layer.effect(
    Shutdown,
    Effect.gen(function* () {
      const began = yield* Ref.make(Option.none<number>());
      const graceMillis = Duration.toMillis(Duration.fromInputUnsafe(grace));
      return Shutdown.of({
        begin: Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          yield* Ref.update(
            began,
            Option.orElse(() => Option.some(now)),
          );
        }),
        cutting: Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          return Option.exists(
            yield* Ref.get(began),
            (at) => now >= at + graceMillis,
          );
        }),
      });
    }),
  );

/**
 * Begins the shutdown when it is released, so it must be built after the
 * server, whose release is the grace period and the cut.
 */
export const beginOnRelease: Layer.Layer<never, never, Shutdown> =
  Layer.effectDiscard(
    Effect.gen(function* () {
      const shutdown = yield* Shutdown;
      yield* Effect.addFinalizer(() => shutdown.begin);
    }),
  );

/**
 * What finishes a request after its answer has left the server: the reading
 * of its copy and its recording in the request log.
 */
export class Finishers extends Context.Service<Finishers, FiberSet.FiberSet>()(
  "@cota/hub/Shutdown/Finishers",
) {}

/**
 * Waits, when it is released, up to `patience` for every finisher to reach the
 * request log, and then cuts those left; so it must be released after the
 * server and before the request log.
 */
export const finishers = (patience: Duration.Input): Layer.Layer<Finishers> =>
  Layer.effect(
    Finishers,
    Effect.gen(function* () {
      const running = yield* FiberSet.make();
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          const waited = yield* FiberSet.awaitEmpty(running).pipe(
            Effect.timeoutOption(patience),
          );
          if (Option.isSome(waited)) return;
          yield* Effect.logWarning(
            "requests were still finishing when the hub stopped; they are cut",
            { requests: yield* FiberSet.size(running) },
          );
        }),
      );
      return running;
    }),
  );
