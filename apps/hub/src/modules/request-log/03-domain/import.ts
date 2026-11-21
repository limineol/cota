import { DateTime, Effect, Option, Order, type Schema } from "effect";
import * as Client from "#shared/03-domain/client.ts";
import * as Conversation from "#shared/03-domain/conversation.ts";
import { PoolId } from "#shared/03-domain/ids.ts";
import * as ItemText from "#shared/03-domain/item-text.ts";
import type * as Price from "#shared/03-domain/price.ts";
import type { ProtocolName } from "#shared/03-domain/protocol-name.ts";
import * as Request from "#shared/03-domain/request.entity.ts";
import { compareText, cut } from "#shared/03-domain/text.ts";
import type * as Usage from "#shared/03-domain/usage.ts";
import * as Archive from "./archive.ts";
import * as Cost from "./cost.ts";
import type * as Session from "./session.ts";
import type * as StoredItems from "./stored-items.ts";
import type { SourceForm } from "./stored-protocol.ts";
import * as Title from "./title.ts";

/** A row of Bifrost's log, as the import source holds it (`docs/specs/import/spec.md`, What is read). */
export interface SourceRequest {
  readonly id: string;
  readonly startedAt: DateTime.Utc;
  /** `session_id`, empty when it is null. */
  readonly session: string;
  readonly metadata: string;
  readonly userAgent: string;
  readonly provider: string;
  readonly model: string;
  readonly objectType: string;
  readonly params: string;
  readonly status: string;
  readonly stream: boolean;
  readonly stopReason: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly cachedReadTokens: number;
  readonly tokenUsage: string;
  readonly cost: Option.Option<number>;
  readonly latency: Option.Option<number>;
  readonly errorDetails: string;
}

/** A row of `hub.request_items`: a request's items, as hashes into its session's items. */
export interface SourceRequestItems {
  readonly requestId: string;
  readonly sessionKey: string;
  readonly startedAt: DateTime.Utc;
  readonly input: ReadonlyArray<string>;
  readonly output: ReadonlyArray<string>;
  readonly tools: ReadonlyArray<string>;
}

/** An item of `hub.messages`, its earliest copy, without its content. */
export interface ListedItem {
  readonly sessionKey: string;
  readonly hash: string;
  readonly firstSeen: DateTime.Utc;
  readonly requestId: string;
  readonly source: string;
  /** The source's position, from 1. */
  readonly position: number;
  /** When the request that first sent it started, if it is a request of Bifrost's log. */
  readonly sentAt: Option.Option<DateTime.Utc>;
}

/** The earliest request of Bifrost's log whose `hub.request_items` row names an item. */
export interface FirstNaming {
  readonly sessionKey: string;
  readonly hash: string;
  readonly requestId: string;
  readonly startedAt: DateTime.Utc;
}

/** An item's content, as the source holds it. */
export interface SourceContent {
  readonly sessionKey: string;
  readonly hash: string;
  readonly content: string;
}

/** The pool of the hub's configuration a source pool bills. */
export interface Target {
  readonly id: PoolId;
  readonly provider: string;
  readonly protocol: ProtocolName;
}

/** The import file's pool map and machines, its targets resolved from the hub's configuration. */
export interface Targets {
  readonly pools: ReadonlyMap<string, Target>;
  readonly machines: ReadonlyMap<string, string>;
}

/** A model's price for a pool, as the `Prices` port gives it. */
export type PriceOf = (
  pool: Target,
  model: string,
) => Option.Option<Price.Price>;

/** The source's day of a time: the UTC calendar day it falls in. */
export const dayOf = (at: DateTime.Utc): Archive.Day =>
  Archive.Day.make(DateTime.formatIsoDateUtc(at));

export const earlierDay = Order.min<Archive.Day>(Order.String);

const keyOf = (sessionKey: string, hash: string) =>
  `${sessionKey}\u0000${hash}`;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parsed = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const objectOf = (text: string): Record<string, unknown> => {
  const value = parsed(text);
  return isObject(value) ? value : {};
};

const at = (value: unknown, ...path: ReadonlyArray<string>): unknown =>
  path.reduce<unknown>(
    (each, key) => (isObject(each) ? each[key] : undefined),
    value,
  );

const textAt = (value: unknown, ...path: ReadonlyArray<string>): string => {
  const found = at(value, ...path);
  return typeof found === "string" ? found : "";
};

/** A JSON value as `JSON.parse` reads it, nested no deeper than the request log reads, with no number a double cannot hold. */
const isJson = (value: unknown, depth: number): value is Schema.Json => {
  if (depth > Conversation.deepest) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value))
    return value.every((each) => isJson(each, depth + 1));
  if (isObject(value))
    return Object.values(value).every((each) => isJson(each, depth + 1));
  return false;
};

const jsonOf = (text: string): Option.Option<Schema.Json> => {
  const value = parsed(text);
  return value !== undefined && isJson(value, 0)
    ? Option.some(value)
    : Option.none();
};

const hex = (bytes: Uint8Array) =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const mostMillis = 2n ** 48n - 1n;

/**
 * A source request's id in the request log: a UUID version 7 whose time is
 * its start and whose other 74 bits are the first 74 of the SHA-256 of
 * `cota-import:bifrost:<id>`, so the same request always gives the same id (Z5).
 */
export const requestIdOf = (
  sourceId: string,
  startedAt: DateTime.Utc,
): Request.RequestId => {
  const millis = BigInt(Math.max(0, DateTime.toEpochMillis(startedAt)));
  const digest = new Bun.CryptoHasher("sha256")
    .update(`cota-import:bifrost:${sourceId}`)
    .digest();
  const first80 = BigInt(`0x${hex(digest.subarray(0, 10))}`);
  const random = first80 >> 6n;
  const value =
    (Order.min(Order.BigInt)(millis, mostMillis) << 80n) |
    (7n << 76n) |
    ((random >> 62n) << 64n) |
    (2n << 62n) |
    (random & (2n ** 62n - 1n));
  const text = value.toString(16).padStart(32, "0");
  return Request.RequestId.make(
    `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`,
  );
};

/** The source's session key of a request: its session id, or `request:<its source id>`. */
export const sessionKeyOf = (row: SourceRequest): string =>
  row.session === "" ? `request:${row.id}` : row.session;

/** The source's pool of a request: the account it was tagged with, else its provider. */
export const sourcePoolOf = (row: SourceRequest): string => {
  const account = textAt(objectOf(row.metadata), "account");
  return account === "" ? row.provider : account;
};

/** The source pool a diverted request came from, if it was diverted. */
export const divertedFromOf = (row: SourceRequest): Option.Option<string> => {
  const from = textAt(objectOf(row.metadata), "fallback-from");
  return from === "" ? Option.none() : Option.some(from);
};

/** How many of a source pool's requests carry one source provider. */
export interface PoolProvider {
  readonly sourcePool: string;
  readonly provider: string;
  readonly requests: number;
}

/** A pool whose requests carry more than one source provider: the one most of them carry, and the others with their counts. */
export interface MixedPool {
  readonly pool: PoolId;
  readonly provider: string;
  readonly others: ReadonlyArray<readonly [provider: string, requests: number]>;
}

/**
 * The pools of the hub whose imported requests carry more than one source
 * provider: a request bills its account's pool whatever its provider, so the
 * requests of another provider than most of their pool's are counted for the
 * owner to see (`docs/specs/import/spec.md`, The report).
 */
export const mixedPoolsOf = (
  providers: ReadonlyArray<PoolProvider>,
  targets: Targets,
): ReadonlyArray<MixedPool> => {
  const byPool = new Map<PoolId, Map<string, number>>();
  for (const { sourcePool, provider, requests } of providers) {
    const target = targets.pools.get(sourcePool);
    if (target === undefined) continue;
    const counts = byPool.get(target.id) ?? new Map<string, number>();
    counts.set(provider, (counts.get(provider) ?? 0) + requests);
    byPool.set(target.id, counts);
  }
  const mixed: Array<MixedPool> = [];
  for (const [pool, counts] of [...byPool].sort(([one], [other]) =>
    compareText(one, other),
  )) {
    const [most, ...others] = [...counts].sort(
      ([one, ones], [other, others]) =>
        others - ones || compareText(one, other),
    );
    if (most === undefined || others.length === 0) continue;
    mixed.push({ pool, provider: most[0], others });
  }
  return mixed;
};

const chatTypes = new Set(["chat_completion", "chat_completion_stream"]);

/** The source form a request's items are in. */
export const sourceFormOf = (row: SourceRequest): SourceForm =>
  chatTypes.has(row.objectType) ? "bifrost-chat" : "bifrost-responses";

const operations: Readonly<Record<string, string>> = {
  responses_stream: "responses",
  responses: "responses",
  chat_completion_stream: "chat",
  chat_completion: "chat",
  count_tokens: "count_tokens",
  list_models: "models",
  image_generation: "image",
};

/** A request's operation, in the request log's own words (`docs/specs/protocols/spec.md`). */
export const operationOf = (row: SourceRequest): string => {
  if (row.objectType === "passthrough") {
    const path = textAt(objectOf(row.params), "path");
    if (path.endsWith("/models")) return "models";
    if (path.endsWith("/alpha/search")) return "search";
    return "other";
  }
  return operations[row.objectType] ?? "other";
};

const carriesConversation = (operation: string) =>
  operation === "responses" || operation === "chat";

const mostUInt32 = 4_294_967_295;
const longestErrorBody = 64 * 1024;

interface Failure {
  readonly status: number;
  readonly type: string;
  readonly message: string;
}

const codeText = (value: unknown): string =>
  typeof value === "string"
    ? value
    : typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : "";

const failureOf = (details: string): Failure => {
  const read = objectOf(details);
  const status = read.status_code;
  const outer = read.error;
  const inner = at(outer, "error");
  const typeOf = (error: unknown) =>
    textAt(error, "type") || codeText(at(error, "code"));
  return {
    status:
      typeof status === "number" &&
      Number.isInteger(status) &&
      status >= 1 &&
      status <= 65_535
        ? status
        : 0,
    type: typeOf(outer) || typeOf(inner),
    message: textAt(outer, "message") || textAt(inner, "message"),
  };
};

/** What became of a source request's usage. */
export type UsageCarried =
  /** It is the request's usage. */
  | { readonly _tag: "Carried"; readonly usage: Usage.Reported }
  /** The source has no usage object for it. */
  | { readonly _tag: "None" }
  /** Its counts do not add up, or one is past what the request log holds. */
  | { readonly _tag: "NotAddingUp" };

const isCount = (value: number) =>
  Number.isInteger(value) && value >= 0 && value <= mostUInt32;

const countAt = (value: unknown, ...path: ReadonlyArray<string>) => {
  const found = at(value, ...path);
  return typeof found === "number" ? Option.some(found) : Option.none();
};

/**
 * A source request's usage in the request log's classes: input is the prompt
 * less its cache reads and writes, and the writes are split by lifetime where
 * the usage object splits them, else all short-lived (Z9).
 */
export const usageOf = (row: SourceRequest): UsageCarried => {
  const object = parsed(row.tokenUsage);
  if (!isObject(object) || Object.keys(object).length === 0) {
    return { _tag: "None" };
  }
  const details = at(object, "prompt_tokens_details");
  const split = at(details, "cached_write_token_details");
  const short = countAt(split, "cached_write_tokens_5m");
  const long = countAt(split, "cached_write_tokens_1h");
  const splitWrites = Option.isSome(short) || Option.isSome(long);
  const shortWrites = Option.getOrElse(short, () => 0);
  const longWrites = Option.getOrElse(long, () => 0);
  const writes = Option.getOrElse(
    countAt(details, "cached_write_tokens"),
    () => shortWrites + longWrites,
  );
  const tokens: Usage.Usage = {
    input: row.promptTokens - row.cachedReadTokens - writes,
    cacheRead: row.cachedReadTokens,
    cacheWriteShort: splitWrites ? shortWrites : writes,
    cacheWriteLong: splitWrites ? longWrites : 0,
    output: row.completionTokens,
  };
  const reasoning = Option.getOrElse(
    countAt(object, "completion_tokens_details", "reasoning_tokens"),
    () => 0,
  );
  const addsUp =
    (!splitWrites || shortWrites + longWrites === writes) &&
    isCount(writes) &&
    isCount(reasoning) &&
    Object.values(tokens).every(isCount);
  if (!addsUp) return { _tag: "NotAddingUp" };
  return {
    _tag: "Carried",
    usage: { tokens, reasoning, reported: row.tokenUsage.toWellFormed() },
  };
};

const outcomes: Readonly<Record<string, Request.Outcome>> = {
  success: "ok",
  error: "error",
  cancelled: "cancelled",
};

const unfinished = {
  type: "cota_import_unfinished",
  message: "the prototype's log never recorded how this request ended",
};

/** A source request built into the request log's row, with what the report counts of it. */
export interface BuiltRequest {
  readonly source: SourceRequest;
  readonly record: Session.RequestRecord;
  readonly usage: UsageCarried["_tag"];
  /** Whether its operation carries a conversation, which it has only with a `request_items` row. */
  readonly conversational: boolean;
}

const durationOf = (latency: Option.Option<number>): number =>
  Option.match(latency, {
    onNone: () => 0,
    onSome: (millis) =>
      Number.isFinite(millis) && millis > 0
        ? Math.min(Math.round(millis), mostUInt32)
        : 0,
  });

/** The pool a source pool bills; the start of an import refuses a source pool the map does not name. */
const targetOf = (targets: Targets, sourcePool: string): Target =>
  targets.pools.get(sourcePool) ?? {
    id: PoolId.make(sourcePool === "" ? "unmapped" : sourcePool),
    provider: "",
    protocol: "openai-chat",
  };

/** A source request as an imported request: its columns, usage and cost (`docs/specs/import/spec.md`, Building rows). */
export const requestOf = Effect.fn("Import.requestOf")(function* (
  row: SourceRequest,
  targets: Targets,
  priceOf: PriceOf,
) {
  const id = requestIdOf(row.id, row.startedAt);
  const metadata = objectOf(row.metadata);
  const target = targetOf(targets, sourcePoolOf(row));
  const host = textAt(metadata, "host");
  const usage = usageOf(row);
  const reported =
    usage._tag === "Carried" ? Option.some(usage.usage) : Option.none();
  const outcome = outcomes[row.status] ?? "error";
  const failure = failureOf(row.errorDetails);
  const isUnfinished = outcomes[row.status] === undefined;
  const client = Client.of("", row.userAgent);
  const operation = operationOf(row);
  const cost = Option.isSome(reported)
    ? yield* Cost.of(reported.value.tokens, priceOf(target, row.model))
    : Option.none();
  const request: StoredItems.StoredRequest = {
    id,
    startedAt: row.startedAt,
    firstByteMs: Option.none(),
    durationMs: durationOf(row.latency),
    session: (row.session === ""
      ? `request:${id}`
      : row.session
    ).toWellFormed(),
    sessionSource: "",
    machine: (targets.machines.get(host) ?? host).toWellFormed(),
    project: textAt(metadata, "project").toWellFormed(),
    client: client.client.toWellFormed(),
    clientVersion: client.version.toWellFormed(),
    userAgent: row.userAgent.toWellFormed(),
    hubKey: "",
    pool: target.id,
    divertedFrom: Option.map(
      divertedFromOf(row),
      (from) => targetOf(targets, from).id,
    ),
    follows: Option.none(),
    loginFingerprint: Option.none(),
    refusalReset: Option.none(),
    provider: target.provider.toWellFormed(),
    protocol: sourceFormOf(row),
    operation,
    purpose: "",
    model: row.model.toWellFormed(),
    servedModel: "",
    stream: row.stream,
    outcome,
    upstreamStatus: outcome === "ok" ? 200 : failure.status,
    errorType: (isUnfinished ? unfinished.type : failure.type).toWellFormed(),
    errorMessage: (isUnfinished
      ? unfinished.message
      : failure.message
    ).toWellFormed(),
    stopReason: row.stopReason.toWellFormed(),
    usage: reported,
    serviceTier: "",
    providerRequestId: "",
    rateLimits: {},
    clientHeaders: {},
    errorBody: cut(row.errorDetails, longestErrorBody).toWellFormed(),
    requestBytes: 0,
    responseBytes: 0,
    readingComplete: true,
  };
  return {
    source: row,
    record: { request, cost },
    usage: usage._tag,
    conversational: carriesConversation(operation),
  } satisfies BuiltRequest;
});

const partOf = (source: string): Conversation.Part =>
  source === "tool" || source === "tools"
    ? "tools"
    : source === "output"
      ? "output"
      : "input";

/** What a page does with an item it lists. */
export type ItemPlan =
  /** It is built on this day, first seen by this request, where it has it. */
  | {
      readonly _tag: "Build";
      readonly firstSeen: DateTime.Utc;
      readonly request: BuiltRequest;
      readonly part: Conversation.Part;
      readonly position: number;
    }
  /** It is built on another day, its first request's; the page only resolves hashes to it. */
  | { readonly _tag: "Resolve"; readonly day: Archive.Day }
  /** No imported request names it. */
  | { readonly _tag: "NotCarried" };

/** A page of sessions of one day, planned: its requests, and what becomes of each item it lists. */
export interface Page {
  readonly day: Archive.Day;
  readonly requests: ReadonlyArray<BuiltRequest>;
  /** The request log's session of each of the page's source session keys. */
  readonly sessions: ReadonlyMap<string, string>;
  readonly items: ReadonlyMap<string, ItemPlan>;
  /** The page's request items whose request is imported, by its source id. */
  readonly requestItems: ReadonlyMap<string, SourceRequestItems>;
  /** Its request items of the day whose request is not in Bifrost's log. */
  readonly withoutRequest: number;
  /** Its items first seen on the day, which the source's summary counts. */
  readonly itemsOfDay: number;
  /** Its items first seen on the day that no imported request names. */
  readonly unnamed: number;
}

const partsOf = (row: SourceRequestItems) =>
  [
    ["tools", row.tools],
    ["input", row.input],
    ["output", row.output],
  ] as const;

/** Where a request's row first names a hash, in the order tools, input, output. */
const placeIn = (
  row: SourceRequestItems,
  hash: string,
): Option.Option<{ part: Conversation.Part; position: number }> => {
  for (const [part, hashes] of partsOf(row)) {
    const position = hashes.indexOf(hash);
    if (position !== -1) return Option.some({ part, position });
  }
  return Option.none();
};

const byStart = (one: BuiltRequest, other: BuiltRequest) =>
  DateTime.toEpochMillis(one.source.startedAt) -
    DateTime.toEpochMillis(other.source.startedAt) ||
  compareText(one.source.id, other.source.id);

/**
 * Plans a page of a day: each listed item is built on the day of its first
 * request, the source's when that is imported, else the earliest imported
 * request naming it; and again on an earlier day one of whose requests names
 * it, so that no request is added before its items.
 */
export const pageOf = (
  day: Archive.Day,
  requests: ReadonlyArray<BuiltRequest>,
  requestItems: ReadonlyArray<SourceRequestItems>,
  listed: ReadonlyArray<ListedItem>,
  firstNamings: ReadonlyArray<FirstNaming>,
): Page => {
  const bySourceId = new Map(requests.map((built) => [built.source.id, built]));
  const sessions = new Map(
    requests.map((built) => [
      sessionKeyOf(built.source),
      built.record.request.session,
    ]),
  );
  const imported = new Map<string, SourceRequestItems>();
  let withoutRequest = 0;
  for (const row of requestItems) {
    if (bySourceId.has(row.requestId)) imported.set(row.requestId, row);
    else withoutRequest++;
  }
  const earliestNaming = new Map<string, BuiltRequest>();
  for (const row of imported.values()) {
    const built = bySourceId.get(row.requestId);
    if (built === undefined) continue;
    for (const [, hashes] of partsOf(row)) {
      for (const hash of hashes) {
        const key = keyOf(row.sessionKey, hash);
        const kept = earliestNaming.get(key);
        if (kept === undefined || byStart(built, kept) < 0) {
          earliestNaming.set(key, built);
        }
      }
    }
  }
  const namings = new Map(
    firstNamings.map((naming) => [
      keyOf(naming.sessionKey, naming.hash),
      naming,
    ]),
  );

  const builtBy = (
    request: BuiltRequest,
    hash: string,
  ): Option.Option<ItemPlan> =>
    Option.flatMap(
      Option.fromUndefinedOr(imported.get(request.source.id)),
      (row) =>
        Option.map(placeIn(row, hash), ({ part, position }) => ({
          _tag: "Build" as const,
          firstSeen: request.source.startedAt,
          request,
          part,
          position,
        })),
    );

  const items = new Map<string, ItemPlan>();
  let itemsOfDay = 0;
  let unnamed = 0;
  for (const item of listed) {
    const key = keyOf(item.sessionKey, item.hash);
    const ofDay = dayOf(item.firstSeen) === day;
    if (ofDay) itemsOfDay++;
    const sent = Option.map(item.sentAt, (startedAt) => ({
      requestId: item.requestId,
      startedAt,
    }));
    const first = Option.isSome(sent)
      ? sent
      : Option.fromUndefinedOr(namings.get(key));
    if (Option.isNone(first)) {
      if (ofDay) unnamed++;
      items.set(key, { _tag: "NotCarried" });
      continue;
    }
    const firstDay = dayOf(first.value.startedAt);
    const naming = earliestNaming.get(key);
    if (firstDay < day) {
      items.set(key, { _tag: "Resolve", day: firstDay });
      continue;
    }
    if (firstDay === day) {
      const own = bySourceId.get(first.value.requestId);
      const plan: Option.Option<ItemPlan> =
        own !== undefined && Option.isSome(sent)
          ? Option.some({
              _tag: "Build",
              firstSeen: own.source.startedAt,
              request: own,
              part: partOf(item.source),
              position: Math.max(0, item.position - 1),
            })
          : own === undefined
            ? Option.none()
            : builtBy(own, item.hash);
      items.set(
        key,
        Option.getOrElse(plan, (): ItemPlan => ({ _tag: "Resolve", day })),
      );
      continue;
    }
    items.set(
      key,
      naming === undefined
        ? { _tag: "Resolve", day: firstDay }
        : Option.getOrElse(
            builtBy(naming, item.hash),
            (): ItemPlan => ({ _tag: "Resolve", day: firstDay }),
          ),
    );
  }
  return {
    day,
    requests,
    sessions,
    items,
    requestItems: imported,
    withoutRequest,
    itemsOfDay,
    unnamed,
  };
};

/** An item's text for search, by its source form's rule. */
const textOf = (form: Session.RequestRecord["request"]["protocol"]) =>
  form === "bifrost-chat" ? ItemText.chatTextOf : ItemText.responsesTextOf;

/**
 * What a chunk of contents gives: the items built on the page's day, each
 * once in its session (two hashes of one canonical value are one item), and
 * each content's digest.
 */
export interface Chunk {
  readonly items: ReadonlyArray<StoredItems.StoredItem>;
  readonly digests: ReadonlyArray<readonly [string, Conversation.Digest]>;
  /** Items of the day whose content is not JSON. */
  readonly unreadable: number;
}

/** Builds the items of a chunk of a page's contents, in their canonical form, leaving out those `built` holds by `builtKeyOf`. */
export const chunkOf = (
  page: Page,
  contents: ReadonlyArray<SourceContent>,
  built: ReadonlySet<string>,
): Chunk => {
  const kept = new Set<string>();
  const items: Array<StoredItems.StoredItem> = [];
  const digests: Array<readonly [string, Conversation.Digest]> = [];
  let unreadable = 0;
  for (const { sessionKey, hash, content } of contents) {
    const key = keyOf(sessionKey, hash);
    const plan = page.items.get(key);
    if (plan === undefined) continue;
    const json = jsonOf(content);
    if (Option.isNone(json)) {
      if (plan._tag === "Build") unreadable++;
      continue;
    }
    const canonical = Conversation.canonical(json.value);
    const digest = Conversation.digestOf(canonical);
    digests.push([key, digest]);
    if (plan._tag !== "Build") continue;
    const { request } = plan.request.record;
    const builtKey = keyOf(request.session, digest);
    if (built.has(builtKey) || kept.has(builtKey)) continue;
    kept.add(builtKey);
    items.push({
      digest,
      type: Conversation.stringOf(json.value, "type").toWellFormed(),
      role: Conversation.stringOf(json.value, "role").toWellFormed(),
      content: canonical,
      text: textOf(request.protocol)(json.value).toWellFormed(),
      session: request.session,
      protocol: request.protocol,
      firstSeen: plan.firstSeen,
      requestId: request.id,
      part: plan.part,
      position: plan.position,
    });
  }
  return { items, digests, unreadable };
};

/** A page's request items, resolved to digests, and what it could not carry. */
export interface Conversations {
  readonly requestItems: ReadonlyArray<StoredItems.RequestItems>;
  /** Requests with a `request_items` row one of whose hashes does not resolve to a carried item. */
  readonly unresolved: number;
  /** Requests of an operation that carries a conversation, with no `request_items` row. */
  readonly withoutRow: number;
  /** The earliest day an item a request of the page names was first seen on, before the page's day. */
  readonly earliest: Option.Option<Archive.Day>;
}

const layout: ReadonlyArray<Conversation.Placement> = [
  { part: "tools", field: "tools", layout: "list" },
  { part: "input", field: "input", layout: "list" },
];

const paramsOf = (text: string): Schema.JsonObject => {
  const json = jsonOf(text);
  if (Option.isNone(json)) return {};
  const value = json.value;
  if (!isObject(value)) return {};
  const { tools: _, ...rest } = value;
  return rest;
};

/**
 * Each imported request's `request_items` row: its hashes resolved, in order,
 * through its session's items (Z8); a request one of whose hashes does not
 * resolve has none.
 */
export const conversationsOf = (
  page: Page,
  digests: ReadonlyMap<string, Conversation.Digest>,
): Conversations => {
  const requestItems: Array<StoredItems.RequestItems> = [];
  let unresolved = 0;
  let withoutRow = 0;
  let earliest: Option.Option<Archive.Day> = Option.none();
  for (const built of page.requests) {
    const row = page.requestItems.get(built.source.id);
    const resolved =
      row === undefined
        ? Option.none()
        : Option.all(
            partsOf(row).map(([, hashes]) =>
              Option.all(
                hashes.map((hash) => {
                  const key = keyOf(row.sessionKey, hash);
                  const plan = page.items.get(key);
                  if (plan?._tag === "Resolve" && plan.day < page.day) {
                    earliest = Option.some(
                      Option.match(earliest, {
                        onNone: () => plan.day,
                        onSome: (day) => earlierDay(plan.day, day),
                      }),
                    );
                  }
                  return plan === undefined || plan._tag === "NotCarried"
                    ? Option.none()
                    : Option.fromUndefinedOr(digests.get(key));
                }),
              ),
            ),
          );
    if (row === undefined) {
      if (built.conversational) withoutRow++;
      continue;
    }
    if (Option.isNone(resolved)) {
      unresolved++;
      continue;
    }
    const [tools = [], input = [], output = []] = resolved.value;
    const { request } = built.record;
    requestItems.push({
      requestId: request.id,
      session: request.session,
      startedAt: request.startedAt,
      system: [],
      tools,
      input,
      output,
      layout,
      overlay: [],
      params: paramsOf(built.source.params),
    });
  }
  return { requestItems, unresolved, withoutRow, earliest };
};

/** A row of the prototype dashboard's titles file. */
export interface SourceTitle {
  readonly session: string;
  readonly title: string;
}

/** The titles of the titles file, each reported at its session's latest source request (Z13). */
export const titlesOf = (
  titles: ReadonlyArray<SourceTitle>,
  latest: ReadonlyMap<string, DateTime.Utc>,
): {
  readonly reports: ReadonlyArray<Title.Report>;
  readonly withoutRequest: number;
  readonly empty: number;
} => {
  const reports: Array<Title.Report> = [];
  let withoutRequest = 0;
  let empty = 0;
  for (const { session, title } of titles) {
    const reportedAt = latest.get(session);
    if (reportedAt === undefined) {
      withoutRequest++;
      continue;
    }
    const kept = Title.keptOf(title);
    if (kept === "") {
      empty++;
      continue;
    }
    reports.push({
      session: session.toWellFormed(),
      title: kept,
      reportedAt,
      machine: "",
      reportedBy: "import",
    });
  }
  return { reports, withoutRequest, empty };
};

/** A kind of display name, as the display-names module names them. */
export type NameKind = "pool" | "model" | "client" | "machine" | "project";

/** A display name an import sets. */
export interface Rename {
  readonly kind: NameKind;
  readonly key: string;
  readonly name: string;
}

/** What an import does with the names file's renames. */
export interface Renames {
  readonly toSet: ReadonlyArray<Rename>;
  readonly alreadyNamed: number;
  readonly notCarried: ReadonlyArray<string>;
}

const kinds: Readonly<Record<string, NameKind>> = {
  pool: "pool",
  model: "model",
  client: "client",
  host: "machine",
  project: "project",
};

const longestName = 80;
const longestKey = 255;

const lengthOf = (text: string) => [...text].length;

/**
 * The renames of the names file as display names: a pool's key through the
 * pool map, a machine's through `[machines]`, and only for a kind and key
 * the owner has not named (Z12).
 */
export const renamesOf = (
  file: unknown,
  targets: Targets,
  named: ReadonlySet<string>,
): Renames => {
  const toSet: Array<Rename> = [];
  const notCarried: Array<string> = [];
  const given = new Set<string>();
  let alreadyNamed = 0;
  const renames = at(file, "renames");
  if (!isObject(renames)) return { toSet, alreadyNamed, notCarried };
  for (const [sourceKind, entries] of Object.entries(renames)) {
    const kind = kinds[sourceKind];
    if (kind === undefined || !isObject(entries)) {
      notCarried.push(`${sourceKind} is not a kind of name`);
      continue;
    }
    for (const [sourceKey, value] of Object.entries(entries)) {
      const key =
        kind === "pool"
          ? targets.pools.get(sourceKey)?.id
          : kind === "machine"
            ? (targets.machines.get(sourceKey) ?? sourceKey)
            : sourceKey;
      if (key === undefined) {
        notCarried.push(`pool ${sourceKey} is not in the pool map`);
        continue;
      }
      const name = typeof value === "string" ? value.trim() : "";
      if (lengthOf(name) < 1 || lengthOf(name) > longestName) {
        notCarried.push(
          `the name of ${sourceKind} ${sourceKey} is not 1 to 80 characters`,
        );
        continue;
      }
      if (lengthOf(key) < 1 || lengthOf(key) > longestKey) {
        notCarried.push(
          `the key ${sourceKind} ${sourceKey} is not 1 to 255 characters`,
        );
        continue;
      }
      if (name === key) {
        notCarried.push(`the name of ${sourceKind} ${sourceKey} is its key`);
        continue;
      }
      const id = `${kind}\u0000${key}`;
      if (given.has(id)) {
        notCarried.push(`${kind} ${key} is named twice`);
        continue;
      }
      given.add(id);
      if (named.has(id)) {
        alreadyNamed++;
        continue;
      }
      toSet.push({ kind, key, name });
    }
  }
  return { toSet, alreadyNamed, notCarried };
};

/** The key `renamesOf` reads the owner's names by. */
/** The key an item built in a page is kept by: its session's and its digest. */
export const builtKeyOf = (item: StoredItems.StoredItem): string =>
  keyOf(item.session, item.digest);

export const nameKeyOf = (kind: NameKind, key: string): string =>
  `${kind}\u0000${key}`;
