import { DateTime, Option, Schema } from "effect";
import type { StoredProtocol } from "#modules/request-log/03-domain/stored-protocol.ts";
import type * as Conversation from "#shared/03-domain/conversation.ts";
import type { PoolId } from "#shared/03-domain/ids.ts";
import type * as Request from "#shared/03-domain/request.entity.ts";
import { compareText } from "#shared/03-domain/text.ts";
import type { Reported } from "#shared/03-domain/usage.ts";
import type { Cost } from "./cost.ts";
import type { StoredRequest } from "./stored-items.ts";
import type { Sums, UsageSums } from "./traffic.ts";

/**
 * What the session rules read of a request, besides its columns: the kept
 * headers, the fields of its params and the types of its input items they
 * ask about (`docs/specs/sessions/spec.md`).
 */
export const read = {
  headers: ["x-claude-code-agent-id", "x-openai-subagent"],
  params: ["output_config"],
  inputTypes: ["additional_tools"],
} as const;

export type Read = {
  readonly [K in keyof typeof read]: ReadonlyArray<string>;
};

/** What the session rules read of a request's conversation. */
export interface Shape {
  readonly system: ReadonlyArray<Conversation.Digest>;
  readonly firstInput: Option.Option<Conversation.Digest>;
  /** How many items its `tools` part has. */
  readonly tools: number;
  /** Those of `read.inputTypes` that an item of its `input` part has, sorted. */
  readonly inputTypes: ReadonlyArray<string>;
  /** The fields of its params that `read.params` names. */
  readonly params: Schema.JsonObject;
}

/** One of a session's requests, as the session rules read it. */
export interface SessionRequest {
  readonly id: Request.RequestId;
  readonly startedAt: DateTime.Utc;
  readonly protocol: StoredProtocol;
  readonly purpose: string;
  readonly outcome: Request.Outcome;
  readonly promptSize: Option.Option<number>;
  /** The kept headers that `read.headers` names. */
  readonly clientHeaders: Readonly<Record<string, string>>;
  /** None for a request without a `request_items` row. */
  readonly conversation: Option.Option<Shape>;
}

/** Input, cache read and both cache writes; none when usage was not reported. */
export const promptSizeOf = (
  usage: Option.Option<Reported>,
): Option.Option<number> =>
  Option.map(
    usage,
    ({ tokens }) =>
      tokens.input +
      tokens.cacheRead +
      tokens.cacheWriteShort +
      tokens.cacheWriteLong,
  );

/** The order of a session's requests: by `startedAt`, then by id. */
export const byStart = (one: SessionRequest, other: SessionRequest): number =>
  DateTime.toEpochMillis(one.startedAt) -
    DateTime.toEpochMillis(other.startedAt) || compareText(one.id, other.id);

/** The digests of its `system` part, when it has any; else the digest of its first input item; else none. */
export const threadKeyOf = (shape: Shape): Option.Option<string> =>
  shape.system.length > 0
    ? Option.some(`system ${shape.system.join(" ")}`)
    : Option.map(shape.firstInput, (digest) => `input ${digest}`);

/** Its `tools` part has an item; for `chatgpt-codex` and the Responses source form, also an `additional_tools` input item, which is how Codex 0.167 sends its tools. */
export const hasTools = (protocol: StoredProtocol, shape: Shape): boolean =>
  shape.tools > 0 ||
  ((protocol === "chatgpt-codex" || protocol === "bifrost-responses") &&
    shape.inputTypes.includes("additional_tools"));

/** A conversation item as the request log keeps it, without its text. */
export type StoredContent = Pick<
  Conversation.Item,
  "digest" | "type" | "role" | "content"
>;

export const SessionOrder = Schema.Literals([
  "recent",
  "requests",
  "tokens",
  "cost",
]);
export type SessionOrder = typeof SessionOrder.Type;

/** The sessions list's paging: `limit` 1 to 200, 50 unless asked; `offset` 0 to 10,000. */
export const paging = { defaultLimit: 50, mostLimit: 200, mostOffset: 10_000 };

export interface Page {
  readonly limit: number;
  readonly offset: number;
}

/** A session as the sessions list counts it: over all its traffic, in and out of the window. */
export interface SessionRow extends Sums {
  readonly id: string;
  /** When its first traffic request started. */
  readonly startedAt: DateTime.Utc;
  /** When its last traffic request started. */
  readonly endedAt: DateTime.Utc;
  readonly errors: number;
  readonly usageUnreported: number;
  /** The distinct non-empty values, sorted. */
  readonly pools: ReadonlyArray<string>;
  readonly projects: ReadonlyArray<string>;
  readonly machines: ReadonlyArray<string>;
  readonly clients: ReadonlyArray<string>;
  readonly providers: ReadonlyArray<string>;
  readonly models: ReadonlyArray<string>;
  /** The distinct protocols its requests are stored in, sorted. */
  readonly protocols: ReadonlyArray<StoredProtocol>;
}

export interface SessionRows {
  /** One page, in the order asked, ties by id. */
  readonly rows: ReadonlyArray<SessionRow>;
  /** How many sessions are selected. */
  readonly total: number;
}

/** Every usage class summed, which `tokens` orders sessions by. */
export const tokensOf = (usage: UsageSums): number =>
  usage.input +
  usage.cacheRead +
  usage.cacheWriteShort +
  usage.cacheWriteLong +
  usage.output;

/** How many of a session's requests its detail lists: the latest. */
export const mostListedRequests = 10_000;

/** One of a session's requests as its detail lists it. */
export interface RequestSummary {
  readonly id: Request.RequestId;
  readonly startedAt: DateTime.Utc;
  readonly protocol: StoredProtocol;
  readonly operation: string;
  readonly purpose: string;
  readonly model: string;
  readonly servedModel: string;
  readonly stopReason: string;
  readonly outcome: Request.Outcome;
  readonly upstreamStatus: number;
  readonly errorType: string;
  readonly promptSize: Option.Option<number>;
  /** None when usage was not reported. */
  readonly outputTokens: Option.Option<number>;
  readonly cost: Option.Option<Cost>;
  readonly durationMs: number;
  readonly firstByteMs: Option.Option<number>;
  readonly divertedFrom: Option.Option<PoolId>;
  readonly follows: Option.Option<Request.RequestId>;
}

export interface RequestSummaries {
  /** The latest of a session's traffic requests, in the session's order. */
  readonly summaries: ReadonlyArray<RequestSummary>;
  /** How many older ones were left out. */
  readonly cut: number;
}

/** A request as the request log keeps it, but its conversation, with its cost. */
export interface RequestRecord {
  readonly request: StoredRequest;
  readonly cost: Option.Option<Cost>;
}
