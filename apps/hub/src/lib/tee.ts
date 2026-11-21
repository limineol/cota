import {
  Cause,
  Clock,
  type Duration,
  Effect,
  Exit,
  Fiber,
  FiberSet,
  Option,
  Queue,
  Ref,
  Schema,
  type Scope,
  Stream,
} from "effect";

export class TapOverflowed extends Schema.TaggedError<
  TapOverflowed,
  { readonly brand: unique symbol }
>()("TapOverflowed", {}) {}

/**
 * A second reader of the copy, with its own bounded queue: when it falls
 * behind its copy fails with `TapOverflowed`, and once the source has ended it
 * has `patience` to finish before it is cut.
 */
export interface Tap {
  readonly capacity: number;
  readonly patience: Duration.Input;
  readonly read: (
    copy: Stream.Stream<Uint8Array, TapOverflowed>,
  ) => Effect.Effect<void>;
}

export interface Copy<S> {
  readonly initial: S;
  readonly read: (copy: Stream.Stream<Uint8Array>) => Stream.Stream<S, unknown>;
  readonly isTerminal: (state: S) => boolean;
}

export type End =
  | { readonly _tag: "Terminal" }
  | { readonly _tag: "Ended" }
  | { readonly _tag: "Failed" }
  | { readonly _tag: "Interrupted" };

export interface Finished<S> {
  readonly end: End;
  readonly read: S;
  readonly complete: boolean;
  readonly bytes: number;
  readonly firstByteAt: Option.Option<number>;
  readonly endedAt: number;
}

export interface Options {
  readonly capacity: number;
  readonly drainTimeout: Duration.Input;
  /** Where the copy's reader and the call to `onFinished` run, so that they can be waited for. */
  readonly finishers: FiberSet.FiberSet;
  readonly tap?: Tap;
}

interface Tapped {
  readonly queue: Queue.Queue<Uint8Array, TapOverflowed | Cause.Done>;
  readonly fiber: Fiber.Fiber<void>;
  readonly patience: Duration.Input;
}

const startTap = Effect.fn("Tee.startTap")(function* (
  tap: Tap,
  finishers: FiberSet.FiberSet,
) {
  const queue = yield* Queue.dropping<Uint8Array, TapOverflowed | Cause.Done>(
    tap.capacity,
  );
  const fiber = yield* tap
    .read(Stream.fromQueue(queue))
    .pipe(FiberSet.run(finishers));
  return { queue, fiber, patience: tap.patience } satisfies Tapped;
});

const untilPatienceRunsOut = (tapped: Tapped) =>
  Fiber.await(tapped.fiber).pipe(
    Effect.timeoutOption(tapped.patience),
    Effect.andThen(Fiber.interrupt(tapped.fiber)),
  );

const endOf = <E>(exit: Exit.Exit<unknown, E>): End => {
  if (Exit.isSuccess(exit)) return { _tag: "Ended" };
  if (Cause.hasInterruptsOnly(exit.cause)) return { _tag: "Interrupted" };
  return { _tag: "Failed" };
};

/**
 * Passes `source` on unchanged while `copy` reads the same chunks from a
 * bounded queue that never makes the source wait, and calls `onFinished`
 * exactly once: at the copy's terminal state, or once the source has ended
 * and the copy has caught up or run out of time.
 */
export const tee = Effect.fn("Tee.tee")(function* <E, S>(
  source: Stream.Stream<Uint8Array, E>,
  copy: Copy<S>,
  onFinished: (finished: Finished<S>) => Effect.Effect<void>,
  options: Options,
): Effect.fn.Return<Stream.Stream<Uint8Array, E>, never, Scope.Scope> {
  const queue = yield* Queue.dropping<Uint8Array, Cause.Done>(options.capacity);
  const latest = yield* Ref.make(copy.initial);
  const overflowed = yield* Ref.make(false);
  const settled = yield* Ref.make(false);
  const finished = yield* Ref.make(false);
  const bytes = yield* Ref.make(0);
  const firstByteAt = yield* Ref.make(Option.none<number>());

  const finish = Effect.fn("Tee.finish")(function* (
    end: End,
    endedAt: number,
    complete: boolean,
  ) {
    if (yield* Ref.getAndSet(finished, true)) return;
    yield* onFinished({
      end,
      read: yield* Ref.get(latest),
      complete,
      bytes: yield* Ref.get(bytes),
      firstByteAt: yield* Ref.get(firstByteAt),
      endedAt,
    });
  });

  const tapped =
    options.tap === undefined
      ? undefined
      : yield* startTap(options.tap, options.finishers);

  const reader = yield* copy.read(Stream.fromQueue(queue)).pipe(
    Stream.runForEach((state) =>
      Effect.gen(function* () {
        yield* Ref.set(latest, state);
        if (!copy.isTerminal(state)) return;
        const at = yield* Clock.currentTimeMillis;
        yield* finish({ _tag: "Terminal" }, at, !(yield* Ref.get(overflowed)));
      }),
    ),
    FiberSet.run(options.finishers),
  );

  const drainThenFinish = (end: End, endedAt: number) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const drained = yield* restore(
          Fiber.await(reader).pipe(Effect.timeoutOption(options.drainTimeout)),
        ).pipe(Effect.exit);
        const readToTheEnd =
          Exit.isSuccess(drained) &&
          Option.isSome(drained.value) &&
          Exit.isSuccess(drained.value.value);
        yield* finish(
          end,
          endedAt,
          readToTheEnd && !(yield* Ref.get(overflowed)),
        );
        yield* FiberSet.run(options.finishers, Fiber.interrupt(reader));
      }),
    );

  const settle = Effect.fn("Tee.settle")(function* (end: End) {
    if (yield* Ref.getAndSet(settled, true)) return;
    const endedAt = yield* Clock.currentTimeMillis;
    yield* Queue.end(queue);
    yield* FiberSet.run(options.finishers, drainThenFinish(end, endedAt));
    if (tapped !== undefined) {
      yield* Queue.end(tapped.queue);
      yield* FiberSet.run(options.finishers, untilPatienceRunsOut(tapped));
    }
  });

  yield* Effect.addFinalizer(() => settle({ _tag: "Interrupted" }));

  return source.pipe(
    Stream.tap((chunk) =>
      Effect.gen(function* () {
        if (chunk.byteLength === 0) return;
        if (Option.isNone(yield* Ref.get(firstByteAt))) {
          yield* Ref.set(
            firstByteAt,
            Option.some(yield* Clock.currentTimeMillis),
          );
        }
        yield* Ref.update(bytes, (sofar) => sofar + chunk.byteLength);
        if (!(yield* Queue.offer(queue, chunk))) {
          yield* Ref.set(overflowed, true);
          yield* Queue.end(queue);
        }
        if (
          tapped !== undefined &&
          !(yield* Queue.offer(tapped.queue, chunk))
        ) {
          yield* Queue.fail(tapped.queue, new TapOverflowed());
        }
      }),
    ),
    Stream.onExit((exit) => settle(endOf(exit))),
  );
});
