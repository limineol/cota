import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, FiberSet, Option, Stream } from "effect";
import { TestClock } from "effect/testing";
import * as Tee from "./tee.ts";

const chunks = Array.from({ length: 100 }, (_, n) => new Uint8Array([n]));

const counting: Tee.Copy<number> = {
  initial: 0,
  read: (copy) =>
    copy.pipe(
      Stream.scan(
        () => 0,
        (count) => count + 1,
      ),
    ),
  isTerminal: () => false,
};

const arriving = Stream.fromIterable(chunks).pipe(
  Stream.tap(() => Effect.yieldNow),
);
const burst = Stream.fromIterable(chunks);

const teed = <S>(
  copy: Tee.Copy<S>,
  source: Stream.Stream<Uint8Array, string> = arriving,
) =>
  Effect.gen(function* () {
    const finished = yield* Deferred.make<Tee.Finished<S>>();
    const client = yield* Tee.tee(
      source,
      copy,
      (result) => Deferred.succeed(finished, result).pipe(Effect.asVoid),
      {
        capacity: 4,
        drainTimeout: "1 second",
        finishers: yield* FiberSet.make(),
      },
    );
    return { client, finished };
  });

const finishedAfterTheClockMoves = <S>(
  finished: Deferred.Deferred<Tee.Finished<S>>,
) =>
  Effect.gen(function* () {
    while (Option.isNone(yield* Deferred.poll(finished))) {
      yield* TestClock.adjust("1 second");
      yield* Effect.promise(() => Bun.sleep(1));
    }
    return yield* Deferred.await(finished);
  });

describe("tee", () => {
  it.effect(
    "gives the client every chunk, and the copy every chunk when it keeps up",
    () =>
      Effect.gen(function* () {
        const { client, finished } = yield* teed(counting);
        const received = yield* Stream.runCollect(client);
        const result = yield* Deferred.await(finished);
        expect(received).toEqual(chunks);
        expect([
          result.end,
          result.read,
          result.complete,
          result.bytes,
        ]).toEqual([{ _tag: "Ended" }, 100, true, 100]);
      }),
  );

  it.effect(
    "drops the copy rather than slow the client when chunks come faster than it reads",
    () =>
      Effect.gen(function* () {
        const { client, finished } = yield* teed(counting, burst);
        const received = yield* Stream.runCollect(client);
        const result = yield* Deferred.await(finished);
        expect(received).toEqual(chunks);
        expect(result.read).toBeLessThan(100);
        expect([result.end, result.complete]).toEqual([
          { _tag: "Ended" },
          false,
        ]);
      }),
  );

  it.effect(
    "ends the client's stream without waiting for a copy that is stuck, and finishes it incomplete once the drain time is up",
    () =>
      Effect.gen(function* () {
        const stuck: Tee.Copy<number> = {
          ...counting,
          read: (copy) =>
            counting.read(
              copy.pipe(
                Stream.mapEffect((chunk) =>
                  chunk[0] === 2 ? Effect.never : Effect.succeed(chunk),
                ),
              ),
            ),
        };
        const { client, finished } = yield* teed(stuck);
        const received = yield* Stream.runCollect(client);
        expect(received).toEqual(chunks);
        expect(yield* Deferred.poll(finished)).toEqual(Option.none());
        const result = yield* finishedAfterTheClockMoves(finished);
        expect([result.end, result.read, result.complete]).toEqual([
          { _tag: "Ended" },
          2,
          false,
        ]);
      }),
  );

  it.effect("keeps serving the client when the copy's reader throws", () =>
    Effect.gen(function* () {
      const broken: Tee.Copy<number> = {
        ...counting,
        read: (copy) =>
          counting.read(
            copy.pipe(
              Stream.map((chunk) => {
                if (chunk[0] === 10) throw new Error("reader bug");
                return chunk;
              }),
            ),
          ),
      };
      const { client, finished } = yield* teed(broken);
      const received = yield* Stream.runCollect(client);
      const result = yield* Deferred.await(finished);
      expect(received).toEqual(chunks);
      expect([result.read, result.complete]).toEqual([10, false]);
    }),
  );

  it.effect(
    "finishes at the copy's terminal state while the client's stream is still open",
    () =>
      Effect.gen(function* () {
        const terminalAtFive: Tee.Copy<number> = {
          ...counting,
          isTerminal: (count) => count === 5,
        };
        const { client, finished } = yield* teed(
          terminalAtFive,
          Stream.concat(arriving.pipe(Stream.take(8)), Stream.never),
        );
        const running = yield* Stream.runDrain(client).pipe(Effect.forkChild);
        const result = yield* Deferred.await(finished);
        expect(running.pollUnsafe()).toBeUndefined();
        expect([result.end, result.read, result.complete]).toEqual([
          { _tag: "Terminal" },
          5,
          true,
        ]);
        yield* Fiber.interrupt(running);
      }),
  );

  it.effect(
    "finishes as failed when the source fails, and fails the client",
    () =>
      Effect.gen(function* () {
        const { client, finished } = yield* teed(
          counting,
          Stream.concat(
            Stream.fromIterable(chunks.slice(0, 3)),
            Stream.fail("cut"),
          ),
        );
        const exit = yield* Stream.runCollect(client).pipe(Effect.flip);
        const result = yield* Deferred.await(finished);
        expect(exit).toBe("cut");
        expect([result.end, result.read, result.complete]).toEqual([
          { _tag: "Failed" },
          3,
          true,
        ]);
      }),
  );

  it.effect(
    "finishes once, as interrupted, when the client never reads the body",
    () =>
      Effect.gen(function* () {
        const results: Array<Tee.Finished<number>> = [];
        yield* Effect.scoped(
          Effect.gen(function* () {
            const finishers = yield* FiberSet.make();
            yield* Effect.scoped(
              Tee.tee(
                arriving,
                counting,
                (result) =>
                  Effect.sync(() => {
                    results.push(result);
                  }),
                { capacity: 4, drainTimeout: "1 second", finishers },
              ).pipe(Effect.asVoid),
            );
            while (results.length === 0) yield* Effect.yieldNow;
          }),
        );
        expect(results.map(({ end, bytes }) => [end, bytes])).toEqual([
          [{ _tag: "Interrupted" }, 0],
        ]);
      }),
  );
});
