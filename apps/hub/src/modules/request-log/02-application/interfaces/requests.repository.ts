import { Context, type Effect, type Option, Schema } from "effect";
import type * as Cost from "#modules/request-log/03-domain/cost.ts";
import type * as StoredItems from "#modules/request-log/03-domain/stored-items.ts";
import type * as Conversation from "#shared/03-domain/conversation.ts";
import type * as Request from "#shared/03-domain/request.entity.ts";

export class RequestsRepositoryFailed extends Schema.TaggedError<
  RequestsRepositoryFailed,
  { readonly brand: unique symbol }
>()("RequestsRepositoryFailed", { detail: Schema.String }) {
  override get message(): string {
    return this.detail;
  }
}

export class RequestsRepositoryDeclined extends Schema.TaggedError<
  RequestsRepositoryDeclined,
  { readonly brand: unique symbol }
>()("RequestsRepositoryDeclined", { detail: Schema.String }) {
  override get message(): string {
    return this.detail;
  }
}

export interface PricedRequest {
  readonly request: Request.ForwardedRequest;
  readonly cost: Option.Option<Cost.Cost>;
}

/** What a batch stores: the items its sessions lacked, its requests' items, and its requests. */
export interface Batch {
  readonly items: ReadonlyArray<StoredItems.StoredItem>;
  readonly requestItems: ReadonlyArray<StoredItems.RequestItems>;
  readonly requests: ReadonlyArray<PricedRequest>;
}

export interface Known {
  readonly session: string;
  readonly digest: Conversation.Digest;
}

export interface StoredConversation {
  readonly requestItems: StoredItems.RequestItems;
  /** The content the session has for each digest of the request's system, tools and input. */
  readonly contents: ReadonlyMap<Conversation.Digest, string>;
}

/** Where the request log keeps requests and the items of their sessions. */
export class RequestsRepository extends Context.Service<
  RequestsRepository,
  {
    /** Creates what storing needs and is missing; doing it again changes nothing. */
    readonly prepare: Effect.Effect<void, RequestsRepositoryFailed>;
    /** Whether it can keep every value of the request as it is. */
    readonly holds: (request: PricedRequest) => boolean;
    /**
     * Stores a batch, its items before its requests' items before its requests.
     * A batch given again with the token of one it stored, in whole or in part,
     * is not stored twice. It fails as `RequestsRepositoryFailed` when the
     * repository could not be reached or did not answer, and as
     * `RequestsRepositoryDeclined` when it answered that it will not keep the
     * batch as it is, which it answers again for the same batch; a request of a
     * declined batch given again in a smaller one keeps one `request_items` row.
     */
    readonly store: (
      batch: Batch,
      token: string,
    ) => Effect.Effect<
      void,
      RequestsRepositoryFailed | RequestsRepositoryDeclined
    >;
    /** The digests each of the sessions already has. */
    readonly known: (
      sessions: ReadonlyArray<string>,
    ) => Effect.Effect<ReadonlyArray<Known>, RequestsRepositoryFailed>;
    /** A request's items with their contents; nothing for a request without items. */
    readonly conversationOf: (
      id: Request.RequestId,
    ) => Effect.Effect<
      Option.Option<StoredConversation>,
      RequestsRepositoryFailed
    >;
  }
>()("@cota/hub/request-log/RequestsRepository") {}
