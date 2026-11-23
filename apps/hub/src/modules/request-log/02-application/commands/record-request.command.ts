import {
  Cause,
  Context,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Metric,
  Option,
  Queue,
  Ref,
} from "effect";
import { Prices } from "#modules/request-log/02-application/interfaces/prices.ts";
import {
  type Batch,
  type PricedRequest,
  RequestsRepository,
  RequestsRepositoryFailed,
} from "#modules/request-log/02-application/interfaces/requests.repository.ts";
import * as Cost from "#modules/request-log/03-domain/cost.ts";
import * as StoredItems from "#modules/request-log/03-domain/stored-items.ts";
import type * as Conversation from "#shared/03-domain/conversation.ts";
import type * as Request from "#shared/03-domain/request.entity.ts";

export class RecordRequest extends Context.Service<
  RecordRequest,
  {
    /** Takes a finished forwarded request without waiting, and never fails. */
    readonly execute: (
      request: Request.ForwardedRequest,
    ) => Effect.Effect<void>;
  }
>()("@cota/hub/request-log/RecordRequest") {}

export interface Options {
  readonly capacity: number;
  readonly batchSize: number;
  readonly drainTimeout: Duration.Input;
  readonly firstPause: Duration.Input;
  readonly longestPause: Duration.Input;
  readonly sessionsRemembered: number;
}

export const defaults: Options = {
  capacity: 10_000,
  batchSize: 500,
  drainTimeout: Duration.seconds(10),
  firstPause: Duration.seconds(1),
  longestPause: Duration.minutes(1),
  sessionsRemembered: 512,
};

export const dropped = Metric.counter("cota_requests_dropped", {
  description:
    "Requests the request log never wrote: dropped from a full queue, given after it closed, left at shutdown, past what its repository holds, or declined alone by its repository again after it stored another.",
  incremental: true,
});

interface SetAside {
  readonly request: Request.ForwardedRequest;
  readonly reason: string;
}

interface Made {
  readonly batch: Batch;
  readonly token: string;
  readonly known: ReadonlyMap<string, ReadonlySet<Conversation.Digest>>;
  readonly trusted: ReadonlyArray<string>;
}

const tokenOf = (ids: ReadonlyArray<Request.RequestId>): string =>
  new Bun.CryptoHasher("sha256")
    .update(ids.join(","))
    .digest("hex")
    .slice(0, 32);

/**
 * Puts a request on a bounded queue, and a writer stores each batch's new
 * items, its requests' items and its requests, trying a failed batch again
 * with the same token until it is stored, once, and splitting a declined batch
 * until the request its repository will not keep stands alone.
 */
export const layer = (
  options: Options = defaults,
): Layer.Layer<RecordRequest, never, RequestsRepository | Prices> =>
  Layer.effect(
    RecordRequest,
    Effect.gen(function* () {
      const repository = yield* RequestsRepository;
      const prices = yield* Prices;
      const queue = yield* Queue.dropping<Request.ForwardedRequest, Cause.Done>(
        options.capacity,
      );
      const closed = yield* Ref.make(false);
      const pending = new Set<Request.RequestId>();
      const setAside: Array<SetAside> = [];
      const firstPause = Duration.fromInputUnsafe(options.firstPause);
      const longestPause = Duration.fromInputUnsafe(options.longestPause);
      const remembered = new Map<string, ReadonlySet<Conversation.Digest>>();

      const remember = (
        session: string,
        digests: ReadonlySet<Conversation.Digest>,
      ) => {
        remembered.delete(session);
        remembered.set(session, digests);
        for (const oldest of remembered.keys()) {
          if (remembered.size <= options.sessionsRemembered) break;
          remembered.delete(oldest);
        }
      };

      const persistently = Effect.fn("RecordRequest.persistently")(function* <
        E,
      >(
        attempt: Effect.Effect<void, RequestsRepositoryFailed | E>,
        what: string,
      ) {
        let pause = firstPause;
        while (true) {
          const result = yield* Effect.result(attempt);
          if (result._tag === "Success") return;
          if (!(result.failure instanceof RequestsRepositoryFailed)) {
            return yield* Effect.fail(result.failure);
          }
          yield* Effect.logWarning(
            `the request log could not ${what}; it will try again`,
            {
              error: result.failure.message,
              retryIn: Duration.format(pause),
            },
          );
          yield* Effect.sleep(pause);
          pause = Duration.min(Duration.times(pause, 2), longestPause);
        }
      });

      const knownOf = Effect.fn("RecordRequest.knownOf")(function* (
        sessions: ReadonlyArray<string>,
      ) {
        const known = new Map<string, Set<Conversation.Digest>>();
        const unseen: Array<string> = [];
        for (const session of sessions) {
          const digests = remembered.get(session);
          if (digests === undefined) unseen.push(session);
          known.set(session, new Set(digests));
        }
        if (unseen.length === 0) return { known, trusted: sessions };
        const asked = yield* Effect.result(repository.known(unseen));
        if (asked._tag === "Failure") {
          yield* Effect.logWarning(
            "the request log could not ask which items its sessions have; it writes every item of theirs",
            { sessions: unseen.length, error: asked.failure.message },
          );
          return {
            known,
            trusted: sessions.filter((session) => remembered.has(session)),
          };
        }
        for (const { session, digest } of asked.success) {
          known.get(session)?.add(digest);
        }
        return { known, trusted: sessions };
      });

      const valuesOf = Effect.fn("RecordRequest.valuesOf")(function* (
        request: Request.ForwardedRequest,
        session: ReadonlySet<Conversation.Digest>,
      ) {
        const cost = yield* Option.match(request.usage, {
          onNone: () => Effect.succeedNone,
          onSome: (usage) =>
            Cost.of(
              usage.tokens,
              prices.of({
                pool: request.pool,
                model: request.model,
                protocol: request.origin.protocol,
                servedModel: request.origin.servedModel,
                serviceTier: request.origin.serviceTier,
              }),
            ),
        });
        const priced: PricedRequest = { request, cost };
        return {
          priced,
          held: repository.holds(priced),
          items: StoredItems.newItems(session, request),
          requestItems: Option.toArray(StoredItems.requestItemsOf(request)),
        };
      });

      const drop = Effect.fn("RecordRequest.drop")(function* (
        request: Request.ForwardedRequest,
        message: string,
        fields: Readonly<Record<string, string>> = {},
      ) {
        pending.delete(request.id);
        yield* Metric.update(dropped, 1);
        yield* Effect.logError(message, { request: request.id, ...fields });
      });

      const batchOf = Effect.fn("RecordRequest.batchOf")(function* (
        finished: ReadonlyArray<Request.ForwardedRequest>,
      ): Effect.fn.Return<Made> {
        const sessions = [
          ...new Set(
            finished
              .filter(({ conversation }) => Option.isSome(conversation))
              .map(({ session }) => session),
          ),
        ];
        const { known, trusted } = yield* knownOf(sessions);
        const items: Array<StoredItems.StoredItem> = [];
        const requestItems: Array<StoredItems.RequestItems> = [];
        const requests: Array<PricedRequest> = [];
        for (const request of finished) {
          const session = known.get(request.session) ?? new Set();
          const made = yield* Effect.exit(valuesOf(request, session));
          if (Exit.isFailure(made)) {
            yield* drop(
              request,
              "the request log could not make a request's values; the request is lost",
              { error: String(Cause.squash(made.cause)) },
            );
            continue;
          }
          if (!made.value.held) {
            yield* drop(
              request,
              "the request log cannot hold a request: a value is past what its repository keeps",
            );
            continue;
          }
          for (const { digest } of made.value.items) session.add(digest);
          items.push(...made.value.items);
          requestItems.push(...made.value.requestItems);
          requests.push(made.value.priced);
        }
        return {
          batch: { items, requestItems, requests },
          token: tokenOf(requests.map(({ request }) => request.id)),
          known,
          trusted,
        };
      });

      const store = Effect.fn("RecordRequest.store")(function* (made: Made) {
        if (made.batch.requests.length === 0) return;
        yield* persistently(
          repository.store(made.batch, made.token),
          "write a batch",
        );
        for (const session of made.trusted) {
          remember(session, made.known.get(session) ?? new Set());
        }
        for (const { request } of made.batch.requests) {
          pending.delete(request.id);
        }
      });

      const tryAgainSetAside = Effect.fn("RecordRequest.tryAgainSetAside")(
        function* () {
          for (const { request } of setAside.splice(0)) {
            const result = yield* Effect.result(
              store(yield* batchOf([request])),
            );
            if (result._tag === "Success") continue;
            yield* drop(
              request,
              "the request log's repository declined a request alone again after it stored another; the request is lost",
              { reason: result.failure.message },
            );
          }
        },
      );

      const write: (
        requests: ReadonlyArray<Request.ForwardedRequest>,
      ) => Effect.Effect<boolean> = Effect.fn("RecordRequest.write")(function* (
        requests: ReadonlyArray<Request.ForwardedRequest>,
      ) {
        const made = yield* batchOf(requests);
        const kept = made.batch.requests.map(({ request }) => request);
        if (kept.length === 0) return false;
        const result = yield* Effect.result(store(made));
        if (result._tag === "Success") {
          yield* tryAgainSetAside();
          return true;
        }
        const alone = kept.length === 1 ? kept[0] : undefined;
        if (alone !== undefined) {
          setAside.push({ request: alone, reason: result.failure.message });
          yield* Effect.logWarning(
            "the request log's repository declined a request; it is set aside until another is stored",
            { request: alone.id, reason: result.failure.message },
          );
          return false;
        }
        const half = Math.ceil(kept.length / 2);
        const first = yield* write(kept.slice(0, half));
        const second = yield* write(kept.slice(half));
        return first || second;
      });

      const writeTaken = Effect.fn("RecordRequest.writeTaken")(function* (
        taken: ReadonlyArray<Request.ForwardedRequest>,
      ) {
        for (const { id } of taken) pending.add(id);
        return yield* write(taken.map(StoredItems.wellFormed));
      });

      const takeWithoutWaiting = Effect.fn("RecordRequest.takeWithoutWaiting")(
        function* (most: number) {
          if ((yield* Queue.size(queue)) === 0 && !(yield* Ref.get(closed))) {
            return [];
          }
          return yield* Queue.takeBetween(queue, 1, most);
        },
      );

      const writeSetAside = Effect.fn("RecordRequest.writeSetAside")(
        function* () {
          const result = yield* Effect.result(
            store(yield* batchOf(setAside.map(({ request }) => request))),
          );
          if (result._tag === "Failure") return false;
          setAside.splice(0);
          return true;
        },
      );

      const dropSetAside = Effect.fn("RecordRequest.dropSetAside")(
        function* () {
          for (const { request, reason } of setAside.splice(0)) {
            yield* drop(
              request,
              "the request log closed with a request its repository declined; the request is lost",
              { reason },
            );
          }
        },
      );

      const writer = yield* Effect.gen(function* () {
        yield* persistently(repository.prepare, "create its tables");
        let pause = firstPause;
        while (true) {
          if (setAside.length === 0) {
            yield* writeTaken(
              yield* Queue.takeBetween(queue, 1, options.batchSize),
            );
            continue;
          }
          yield* Effect.sleep(pause);
          const taken = yield* takeWithoutWaiting(
            Math.max(1, options.batchSize - setAside.length),
          );
          const stored = (yield* writeTaken(taken)) || (yield* writeSetAside());
          pause = stored
            ? firstPause
            : Duration.min(Duration.times(pause, 2), longestPause);
        }
      }).pipe(
        Effect.catchTag("Done", () => dropSetAside()),
        Effect.withSpan("RecordRequest.writer"),
        Effect.forkScoped,
      );

      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          yield* Ref.set(closed, true);
          yield* Queue.end(queue);
          const drained = yield* Fiber.await(writer).pipe(
            Effect.timeoutOption(options.drainTimeout),
          );
          if (Option.isSome(drained)) return;
          const lost = (yield* Queue.size(queue)) + pending.size;
          yield* Fiber.interrupt(writer);
          yield* Metric.update(dropped, lost);
          yield* Effect.logError(
            "the request log could not write everything before shutdown; requests are lost",
            { lost },
          );
        }),
      );

      return RecordRequest.of({
        execute: Effect.fn("RecordRequest.execute")(function* (
          request: Request.ForwardedRequest,
        ) {
          if (yield* Queue.offer(queue, request)) return;
          yield* Metric.update(dropped, 1);
          if (yield* Ref.get(closed)) {
            yield* Effect.logError(
              "the request log was given a request after it closed; the request is lost",
              { request: request.id },
            );
            return;
          }
          const oldest = yield* Queue.poll(queue);
          yield* Queue.offer(queue, request);
          yield* Effect.logWarning(
            "the request log's queue is full; it dropped its oldest request",
            { request: Option.getOrNull(Option.map(oldest, ({ id }) => id)) },
          );
        }),
      });
    }),
  );
