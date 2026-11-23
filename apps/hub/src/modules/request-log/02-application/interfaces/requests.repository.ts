import {
  Context,
  type DateTime,
  type Effect,
  type Option,
  Schema,
} from "effect";
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
>()("RequestsRepositoryDeclined", {
  detail: Schema.String,
  /** The repository's own code for why, when it gives one. */
  code: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

export interface PricedRequest<R extends Request.Request = Request.Request> {
  readonly request: R;
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

/** Requests asked about by id, within their sessions and the span of their starts. */
export interface Asked {
  readonly requests: ReadonlyArray<{
    readonly id: Request.RequestId;
    readonly session: string;
  }>;
  readonly from: DateTime.Utc;
  readonly to: DateTime.Utc;
}

/** Of the requests asked about, those whose row the log holds, and those whose items' row it holds. */
export interface Held {
  readonly requests: ReadonlySet<Request.RequestId>;
  readonly requestItems: ReadonlySet<Request.RequestId>;
}

/** A request the log holds in a session, with its items' row and the content of its output's items. */
export interface HeldParts {
  readonly requestItems: StoredItems.RequestItems;
  readonly output: ReadonlyArray<string>;
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
    /**
     * Which of the requests asked about the log holds, by the archive's rule
     * (`docs/specs/archive/spec.md`, Held): a request row by its id, read
     * within the span of starts asked; an items' row by its request id,
     * within its session.
     */
    readonly held: (
      asked: Asked,
    ) => Effect.Effect<Held, RequestsRepositoryFailed>;
    /**
     * A request the log holds in the session given, started at the instant
     * given: its row and its items' row both, with the content of its output's
     * items in order; nothing when it holds no such request.
     */
    readonly partsOf: (
      id: Request.RequestId,
      session: string,
      startedAt: DateTime.Utc,
    ) => Effect.Effect<Option.Option<HeldParts>, RequestsRepositoryFailed>;
    /** A request's items with their contents; nothing for a request without items. */
    readonly conversationOf: (
      id: Request.RequestId,
    ) => Effect.Effect<
      Option.Option<StoredConversation>,
      RequestsRepositoryFailed
    >;
  }
>()("@cota/hub/request-log/RequestsRepository") {}
