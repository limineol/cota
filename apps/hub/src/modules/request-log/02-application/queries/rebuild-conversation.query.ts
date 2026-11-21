import { Context, Effect, Layer, Option, type Schema } from "effect";
import {
  RequestsRepository,
  type RequestsRepositoryFailed,
} from "#modules/request-log/02-application/interfaces/requests.repository.ts";
import * as Conversation from "#shared/03-domain/conversation.ts";
import type * as Request from "#shared/03-domain/request.entity.ts";

export class RebuildConversation extends Context.Service<
  RebuildConversation,
  {
    /**
     * Rebuilds a request's body, and gives nothing for a request without items
     * or whose session lacks one of them.
     */
    readonly execute: (
      id: Request.RequestId,
    ) => Effect.Effect<
      Option.Option<Schema.JsonObject>,
      RequestsRepositoryFailed
    >;
  }
>()("@cota/hub/request-log/RebuildConversation") {}

export const layer: Layer.Layer<
  RebuildConversation,
  never,
  RequestsRepository
> = Layer.effect(
  RebuildConversation,
  Effect.gen(function* () {
    const repository = yield* RequestsRepository;
    return RebuildConversation.of({
      execute: Effect.fn("RebuildConversation.execute")(function* (
        id: Request.RequestId,
      ) {
        const stored = yield* repository.conversationOf(id);
        if (Option.isNone(stored)) return Option.none<Schema.JsonObject>();
        const { requestItems, contents } = stored.value;
        return Conversation.rebuild(requestItems, (digest) =>
          Option.fromUndefinedOr(contents.get(digest)),
        );
      }),
    });
  }),
);
