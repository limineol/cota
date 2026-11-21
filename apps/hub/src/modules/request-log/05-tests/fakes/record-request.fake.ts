import { Context, Effect, Layer, Option, Queue } from "effect";
import { RecordRequest } from "#modules/request-log/02-application/commands/record-request.command.ts";
import { RequestsRepository } from "#modules/request-log/02-application/interfaces/requests.repository.ts";
import type { Transcripts } from "#modules/request-log/02-application/interfaces/transcripts.ts";
import * as RebuildConversation from "#modules/request-log/02-application/queries/rebuild-conversation.query.ts";
import * as StoredItems from "#modules/request-log/03-domain/stored-items.ts";
import * as RenderedTranscripts from "#modules/request-log/04-infrastructure/transcripts/transcripts.ts";
import * as RequestLog from "#modules/request-log/module.ts";
import type * as Request from "#shared/03-domain/request.entity.ts";
import * as InMemoryRequestLogReader from "./in-memory-request-log-reader.ts";
import * as InMemoryRequests from "./in-memory-requests.repository.ts";
import * as InMemorySessionTitles from "./in-memory-session-titles.ts";

export class Recorded extends Context.Service<
  Recorded,
  {
    readonly take: Effect.Effect<Request.Request>;
    readonly drain: Effect.Effect<ReadonlyArray<Request.Request>>;
  }
>()("@cota/hub/request-log/Recorded") {}

const recordRequest: Layer.Layer<
  RecordRequest | Recorded,
  never,
  RequestsRepository
> = Layer.effectContext(
  Effect.gen(function* () {
    const repository = yield* RequestsRepository;
    const queue = yield* Queue.unbounded<Request.Request>();

    const store = Effect.fn("RecordRequestFake.store")(function* (
      finished: Request.Request,
    ) {
      const request = StoredItems.wellFormed(finished);
      const known = yield* repository.known([request.session]);
      const items = StoredItems.newItems(
        new Set(known.map(({ digest }) => digest)),
        request,
      );
      yield* repository.store(
        {
          items,
          requestItems: Option.toArray(StoredItems.requestItemsOf(request)),
          requests: [{ request, cost: Option.none() }],
        },
        request.id,
      );
    });

    return Context.make(
      RecordRequest,
      RecordRequest.of({
        execute: (request) =>
          store(request).pipe(
            Effect.orDie,
            Effect.andThen(Queue.offer(queue, request)),
            Effect.asVoid,
          ),
      }),
    ).pipe(
      Context.add(
        Recorded,
        Recorded.of({ take: Queue.take(queue), drain: Queue.clear(queue) }),
      ),
    );
  }),
);

/**
 * The request log in memory: it keeps each request for tests to take, and
 * stores it at once as the command does, a session's new items, then the
 * request's items, in the in-memory repository the queries read from, with
 * the titles machines report kept in memory.
 */
export const layer: Layer.Layer<
  | RecordRequest
  | Recorded
  | RebuildConversation.RebuildConversation
  | RequestLog.Traffic
  | RequestLog.Sessions
  | RequestLog.QuotaSources
  | RequestsRepository
  | Transcripts
  | InMemoryRequests.InMemoryRequests
  | InMemorySessionTitles.InMemorySessionTitles
> = Layer.mergeAll(
  recordRequest,
  RebuildConversation.layer,
  Layer.mergeAll(
    RequestLog.traffic,
    RequestLog.sessions,
    RequestLog.quotaSources,
  ).pipe(Layer.provide(InMemoryRequestLogReader.layer)),
).pipe(
  Layer.provideMerge(InMemorySessionTitles.layer),
  Layer.provideMerge(RenderedTranscripts.layer),
  Layer.provideMerge(InMemoryRequests.layer),
);
