import { Context, DateTime, Deferred, Effect, Layer, Option } from "effect";
import {
  type PricedRequest,
  RequestsRepository,
  RequestsRepositoryDeclined,
  RequestsRepositoryFailed,
} from "#modules/request-log/02-application/interfaces/requests.repository.ts";
import type * as StoredItems from "#modules/request-log/03-domain/stored-items.ts";
import type * as Conversation from "#shared/03-domain/conversation.ts";

export type Fault = "none" | "unreached" | "lost" | "declined";

export interface Attempt {
  readonly token: string;
  readonly stored: boolean;
}

/** What a test sees of the in-memory repository, and how it tells it to fail. */
export interface InMemory {
  readonly items: Array<StoredItems.StoredItem>;
  readonly requestItems: Array<StoredItems.RequestItems>;
  readonly requests: Array<PricedRequest>;
  readonly attempts: Array<Attempt>;
  readonly asked: Array<ReadonlyArray<string>>;
  readonly faults: Array<Fault>;
  /** Whether asking what the log holds fails. */
  questionFails: boolean;
  /** Whether reading the request log fails, as when ClickHouse cannot be reached. */
  readingFails: boolean;
  holds: (request: PricedRequest) => boolean;
  /** Whether it declines every batch that holds the request. */
  declines: (request: PricedRequest) => boolean;
  /** Lets `prepare` finish, for a repository made closed. */
  readonly open: Effect.Effect<void>;
}

export class InMemoryRequests extends Context.Service<
  InMemoryRequests,
  InMemory
>()("@cota/hub/request-log/InMemoryRequests") {}

/**
 * A repository that keeps what it stores in memory, skips a batch whose token
 * it has stored, and fails as it is told, batch by batch: one `unreached` is
 * not stored and fails, one `lost` is stored but answered with a failure, and
 * one `declined` is declined. It declines a batch that holds a request
 * `declines` names too, and stores nothing of a declined batch.
 */
export const make = (ready = true) =>
  Effect.gen(function* () {
    const opened = yield* Deferred.make<void>();
    if (ready) yield* Deferred.succeed(opened, undefined);
    const tokens = new Set<string>();
    const memory: InMemory = {
      items: [],
      requestItems: [],
      requests: [],
      attempts: [],
      asked: [],
      faults: [],
      questionFails: false,
      readingFails: false,
      holds: () => true,
      declines: () => false,
      open: Deferred.succeed(opened, undefined).pipe(Effect.asVoid),
    };
    const failed = (detail: string) => new RequestsRepositoryFailed({ detail });

    const contentsOf = (
      session: string,
      digests: ReadonlyArray<Conversation.Digest>,
    ) => {
      const contents = new Map<Conversation.Digest, string>();
      for (const digest of digests) {
        const item = memory.items.find(
          (each) => each.session === session && each.digest === digest,
        );
        if (item !== undefined) contents.set(digest, item.content);
      }
      return contents;
    };

    const repository = RequestsRepository.of({
      prepare: Deferred.await(opened),
      holds: (request) => memory.holds(request),
      store: (batch, token) =>
        Effect.gen(function* () {
          const fault = memory.faults.shift() ?? "none";
          if (
            fault === "declined" ||
            batch.requests.some((request) => memory.declines(request))
          ) {
            memory.attempts.push({ token, stored: false });
            return yield* new RequestsRepositoryDeclined({
              detail: "the batch was declined",
              code: "117",
            });
          }
          const stored = fault !== "unreached" && !tokens.has(token);
          memory.attempts.push({ token, stored });
          if (stored) {
            tokens.add(token);
            memory.items.push(...batch.items);
            memory.requestItems.push(...batch.requestItems);
            memory.requests.push(...batch.requests);
          }
          if (fault !== "none") return yield* failed(`the batch was ${fault}`);
        }),
      known: (sessions) =>
        Effect.gen(function* () {
          memory.asked.push(sessions);
          if (memory.questionFails) return yield* failed("no answer");
          return memory.items
            .filter((item) => sessions.includes(item.session))
            .map(({ session, digest }) => ({ session, digest }));
        }),
      held: (asked) =>
        Effect.gen(function* () {
          if (memory.questionFails) return yield* failed("no answer");
          const within = (at: DateTime.Utc) =>
            !DateTime.isLessThan(at, asked.from) &&
            !DateTime.isGreaterThan(at, asked.to);
          return {
            requests: new Set(
              asked.requests
                .filter(({ id }) =>
                  memory.requests.some(
                    ({ request }) =>
                      request.id === id && within(request.startedAt),
                  ),
                )
                .map(({ id }) => id),
            ),
            requestItems: new Set(
              asked.requests
                .filter(({ id, session }) =>
                  memory.requestItems.some(
                    (each) => each.requestId === id && each.session === session,
                  ),
                )
                .map(({ id }) => id),
            ),
          };
        }),
      partsOf: (id, session, startedAt) =>
        Effect.gen(function* () {
          if (memory.questionFails) return yield* failed("no answer");
          const at = DateTime.toEpochMillis(startedAt);
          const request = memory.requests.find(
            ({ request }) =>
              request.id === id &&
              request.session === session &&
              DateTime.toEpochMillis(request.startedAt) === at,
          );
          const requestItems = memory.requestItems.find(
            (each) =>
              each.requestId === id &&
              each.session === session &&
              DateTime.toEpochMillis(each.startedAt) === at,
          );
          if (request === undefined || requestItems === undefined) {
            return Option.none();
          }
          const contents = contentsOf(session, requestItems.output);
          const output = requestItems.output.flatMap((digest) => {
            const content = contents.get(digest);
            return content === undefined ? [] : [content];
          });
          return output.length === requestItems.output.length
            ? Option.some({ requestItems, output })
            : Option.none();
        }),
      conversationOf: (id) =>
        Effect.suspend(() =>
          memory.readingFails
            ? Effect.fail(failed("unreadable"))
            : Effect.succeed(
                Option.map(
                  Option.fromUndefinedOr(
                    memory.requestItems.find(
                      ({ requestId }) => requestId === id,
                    ),
                  ),
                  (requestItems) => ({
                    requestItems,
                    contents: contentsOf(requestItems.session, [
                      ...requestItems.system,
                      ...requestItems.tools,
                      ...requestItems.input,
                    ]),
                  }),
                ),
              ),
        ),
    });
    return { memory, repository };
  });

export const layer: Layer.Layer<RequestsRepository | InMemoryRequests> =
  Layer.effectContext(
    Effect.map(make(), ({ memory, repository }) =>
      Context.make(RequestsRepository, repository).pipe(
        Context.add(InMemoryRequests, memory),
      ),
    ),
  );
