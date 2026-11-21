import {
  Context,
  type DateTime,
  type Effect,
  type Option,
  type Schema,
} from "effect";
import type * as Search from "#modules/request-log/03-domain/search.ts";
import type * as Session from "#modules/request-log/03-domain/session.ts";
import type { StoredProtocol } from "#modules/request-log/03-domain/stored-protocol.ts";
import type * as Traffic from "#modules/request-log/03-domain/traffic.ts";
import type * as Conversation from "#shared/03-domain/conversation.ts";
import type { PoolId } from "#shared/03-domain/ids.ts";
import type * as Request from "#shared/03-domain/request.entity.ts";
import type { RequestLogUnavailable } from "#shared/03-domain/request-log.ts";

/** A request's items, the parts asked for in order, each with its content. */
export type PartsOf = Readonly<
  Record<Conversation.Part, ReadonlyArray<Session.StoredContent>>
>;

/** The parts of one request of a session whose items are asked for. */
export interface Wanted {
  readonly session: string;
  readonly id: Request.RequestId;
  readonly parts: ReadonlyArray<Conversation.Part>;
}

/** A request the inspector asked for, with what its session's other reads do not give. */
export interface FoundRequest {
  readonly record: Session.RequestRecord;
  /** Its body without its conversation's parts; none without a conversation. */
  readonly params: Option.Option<Schema.JsonObject>;
  /** The request sent again after this one was refused, the earliest when there are several. */
  readonly followedBy: Option.Option<Request.RequestId>;
}

/** A conversation item asked for by its session and digest. */
export interface ItemKey {
  readonly session: string;
  readonly item: Conversation.Digest;
}

/** An item's content, with the protocol that reads it. */
export interface FoundItem extends ItemKey {
  readonly protocol: StoredProtocol;
  readonly content: string;
}

/** A quota header asked of a pool's latest answers, by its name. */
export interface QuotaHeaderAsked {
  readonly pool: PoolId;
  readonly name: string;
}

/** The latest request of a pool whose quota headers hold a name: when it started, and all its quota headers. */
export interface LatestQuotaHeaders {
  readonly pool: PoolId;
  readonly name: string;
  readonly startedAt: DateTime.Utc;
  readonly headers: Readonly<Record<string, string>>;
}

/** What reading the traffic, the sessions and the quota sources needs of the request log, in its terms. */
export class RequestLogReader extends Context.Service<
  RequestLogReader,
  {
    /** The totals of the selection, of the same filters over `previous`, and when the earliest traffic request started. */
    readonly overview: (
      selection: Traffic.Selection,
      previous: Traffic.Window,
    ) => Effect.Effect<Traffic.Overview, RequestLogUnavailable>;
    /**
     * The selection's traffic by bucket and by the `keys` values of `by` with
     * the most requests, most first and then by text, the rest under no key,
     * in no order. Buckets under an hour start at whole multiples of their
     * length since 1970-01-01 UTC; longer ones at whole multiples of their
     * length since midnight in `zone`, days at midnight and weeks on Monday.
     */
    readonly points: (
      selection: Traffic.Selection,
      series: {
        readonly by: Traffic.Dimension;
        readonly bucket: Traffic.Bucket;
        readonly zone: DateTime.TimeZone.Named;
        readonly keys: number;
      },
    ) => Effect.Effect<ReadonlyArray<Traffic.Point>, RequestLogUnavailable>;
    /** The selection by the values of `by`, the `limit` rows with the most requests. */
    readonly breakdown: (
      selection: Traffic.Selection,
      by: Traffic.Dimension,
      limit: number,
    ) => Effect.Effect<Traffic.Breakdown, RequestLogUnavailable>;
    /** At most `limit` values of each dimension. */
    readonly facets: (
      selection: Traffic.Selection,
      limit: number,
    ) => Effect.Effect<Traffic.Facets, RequestLogUnavailable>;
    /** The selected requests grouped by cause, the `limit` groups whose last request is latest. */
    readonly errorGroups: (
      selection: Traffic.Selection,
      limit: number,
    ) => Effect.Effect<Traffic.ErrorGroups, RequestLogUnavailable>;
    /**
     * The sessions with a request in the selection, and with an item that
     * matches the search when one is given, each over all its traffic:
     * one page of them in the order asked, the greatest first and ties by id,
     * and how many there are.
     */
    readonly sessions: (
      selection: Traffic.Selection,
      order: Session.SessionOrder,
      page: Session.Page,
      search: Option.Option<Search.Asked>,
    ) => Effect.Effect<Session.SessionRows, RequestLogUnavailable>;
    /**
     * The items of the sessions with a request in the selection that match
     * the search query, each word of it widened under its tolerance among the
     * log's words, each item once, in the order of hits: the first `limit` of
     * them after `after`, when given.
     */
    readonly hits: (
      selection: Traffic.Selection,
      search: Search.Asked,
      limit: number,
      after: Option.Option<Search.After>,
    ) => Effect.Effect<ReadonlyArray<Search.Hit>, RequestLogUnavailable>;
    /** The first hit, in the order of hits, of each session given that has one. */
    readonly newestHits: (
      sessions: ReadonlyArray<string>,
      search: Search.Asked,
    ) => Effect.Effect<ReadonlyMap<string, Search.Hit>, RequestLogUnavailable>;
    /** The content of each item asked for that its session has, by session and then by digest. */
    readonly contents: (
      items: ReadonlyArray<ItemKey>,
    ) => Effect.Effect<ReadonlyArray<FoundItem>, RequestLogUnavailable>;
    /** A session's row, over all its traffic; none when no traffic request has it. */
    readonly session: (
      session: string,
    ) => Effect.Effect<
      Option.Option<Session.SessionRow>,
      RequestLogUnavailable
    >;
    /** The latest `limit` of a session's traffic requests, in the session's order, and how many older ones there are. */
    readonly summaries: (
      session: string,
      limit: number,
    ) => Effect.Effect<Session.RequestSummaries, RequestLogUnavailable>;
    /** A request, whatever its operation; none when the request log has no request with that id. */
    readonly request: (
      id: Request.RequestId,
    ) => Effect.Effect<Option.Option<FoundRequest>, RequestLogUnavailable>;
    /**
     * The latest `limit` of each session's traffic requests, in the session's
     * order, with the headers, params and input item types `read` names.
     */
    readonly sessionRequests: (
      sessions: ReadonlyArray<string>,
      read: Session.Read,
      limit: number,
    ) => Effect.Effect<
      ReadonlyMap<string, ReadonlyArray<Session.SessionRequest>>,
      RequestLogUnavailable
    >;
    /**
     * The items of the parts asked for of each request, in order, with their
     * content; an item its session does not have is left out, a part not
     * asked for is empty, a request asked for under a session that is not its
     * own gives nothing, and one asked for twice gives the parts of both.
     */
    readonly items: (
      wanted: ReadonlyArray<Wanted>,
    ) => Effect.Effect<
      ReadonlyMap<Request.RequestId, PartsOf>,
      RequestLogUnavailable
    >;
    /**
     * For each pool and name asked, the latest request of the pool, by when
     * it started and then by id, that started at or after `since` and whose
     * quota headers hold the name, whatever its operation and outcome; by
     * pool and then by name, a pair with no such request left out.
     */
    readonly latestQuotaHeaders: (
      asked: ReadonlyArray<QuotaHeaderAsked>,
      since: DateTime.Utc,
    ) => Effect.Effect<
      ReadonlyArray<LatestQuotaHeaders>,
      RequestLogUnavailable
    >;
  }
>()("@cota/hub/request-log/RequestLogReader") {}
