import { DateTime, Duration, Effect, Layer, Option } from "effect";
import {
  type LatestQuotaHeaders,
  type PartsOf,
  RequestLogReader,
} from "#modules/request-log/02-application/interfaces/request-log-reader.ts";
import type { PricedRequest } from "#modules/request-log/02-application/interfaces/requests.repository.ts";
import * as Search from "#modules/request-log/03-domain/search.ts";
import * as Session from "#modules/request-log/03-domain/session.ts";
import * as StoredItems from "#modules/request-log/03-domain/stored-items.ts";
import * as Traffic from "#modules/request-log/03-domain/traffic.ts";
import type * as Conversation from "#shared/03-domain/conversation.ts";
import type * as Request from "#shared/03-domain/request.entity.ts";
import { RequestLogUnavailable } from "#shared/03-domain/request-log.ts";
import { compareText } from "#shared/03-domain/text.ts";
import { InMemoryRequests } from "./in-memory-requests.repository.ts";

const millis = DateTime.toEpochMillis;

const offsetAt = (at: number, zone: DateTime.TimeZone.Named): number =>
  DateTime.zonedOffset(DateTime.makeZonedUnsafe(at, { timeZone: zone }));

/** The instant whose wall-clock time in `zone` is `wall`, read as UTC, at the offset `preferred` where both are valid. */
const instantOf = (
  wall: number,
  preferred: number,
  zone: DateTime.TimeZone.Named,
): number => {
  const first = wall - preferred;
  if (offsetAt(first, zone) === preferred) return first;
  const other = offsetAt(first, zone);
  return wall - other;
};

/** Where a bucket starts, as ClickHouse's `toStartOfInterval`, `toStartOfDay` and `toMonday` place it. */
export const bucketStart = (
  at: DateTime.Utc,
  bucket: Traffic.Bucket,
  zone: DateTime.TimeZone.Named,
): DateTime.Utc => {
  const length = Duration.toMillis(Traffic.lengthOf[bucket]);
  const epoch = millis(at);
  if (length < Duration.toMillis(Duration.hours(1))) {
    return DateTime.makeUnsafe(epoch - (epoch % length));
  }
  const offset = offsetAt(epoch, zone);
  const wall = epoch + offset;
  const day = 24 * 60 * 60 * 1000;
  const midnight = wall - (((wall % day) + day) % day);
  if (bucket === "7d") {
    const weekday = (new Date(midnight).getUTCDay() + 6) % 7;
    return DateTime.makeUnsafe(
      instantOf(midnight - weekday * day, offset, zone),
    );
  }
  const since = wall - midnight;
  return DateTime.makeUnsafe(
    instantOf(midnight + since - (since % length), offset, zone),
  );
};

const noUsage: Traffic.UsageSums = {
  input: 0,
  cacheRead: 0,
  cacheWriteShort: 0,
  cacheWriteLong: 0,
  output: 0,
  reasoning: 0,
};

/** The order of a session's requests: by when they started, then by id. */
const byStart = (
  one: StoredItems.StoredRequest,
  other: StoredItems.StoredRequest,
): number =>
  millis(one.startedAt) - millis(other.startedAt) ||
  compareText(one.id, other.id);

const sumsOf = (priced: ReadonlyArray<Session.RequestRecord>): Traffic.Sums => {
  let usage = noUsage;
  let cost = 0n;
  let unpricedRequests = 0;
  for (const { request, cost: known } of priced) {
    if (Option.isSome(request.usage)) {
      const { tokens, reasoning } = request.usage.value;
      usage = {
        input: usage.input + tokens.input,
        cacheRead: usage.cacheRead + tokens.cacheRead,
        cacheWriteShort: usage.cacheWriteShort + tokens.cacheWriteShort,
        cacheWriteLong: usage.cacheWriteLong + tokens.cacheWriteLong,
        output: usage.output + tokens.output,
        reasoning: usage.reasoning + reasoning,
      };
      if (Option.isNone(known)) unpricedRequests++;
    }
    if (Option.isSome(known)) cost += known.value;
  }
  return { requests: priced.length, usage, cost, unpricedRequests };
};

const percentilesOf = (
  values: ReadonlyArray<number>,
): Option.Option<Traffic.Percentiles> => {
  if (values.length === 0) return Option.none();
  const sorted = [...values].sort((one, other) => one - other);
  const at = (level: number) =>
    sorted[Math.min(Math.floor(level * sorted.length), sorted.length - 1)] ?? 0;
  return Option.some({ p50: at(0.5), p95: at(0.95) });
};

const distinct = (values: ReadonlyArray<string>) => new Set(values).size;

const errorsOf = (priced: ReadonlyArray<Session.RequestRecord>) =>
  priced.filter(({ request }) => request.outcome === "error").length;

const latest = (
  priced: ReadonlyArray<Session.RequestRecord>,
): StoredItems.StoredRequest =>
  priced
    .map(({ request }) => request)
    .reduce((best, each) =>
      (millis(each.startedAt) - millis(best.startedAt) ||
        compareText(each.id, best.id)) > 0
        ? each
        : best,
    );

const totalsOf = (
  priced: ReadonlyArray<Session.RequestRecord>,
): Traffic.Totals => {
  const requests = priced.map(({ request }) => request);
  const outcome = (value: Request.Outcome) =>
    requests.filter((request) => request.outcome === value).length;
  return {
    ...sumsOf(priced),
    sessions: distinct(requests.map(({ session }) => session)),
    outcomes: {
      ok: outcome("ok"),
      error: outcome("error"),
      refused: outcome("refused"),
      cancelled: outcome("cancelled"),
    },
    usageUnreported: requests.filter(({ usage }) => Option.isNone(usage))
      .length,
    durationMs: percentilesOf(
      requests
        .filter((request) => request.outcome === "ok")
        .map(({ durationMs }) => durationMs),
    ),
    firstByteMs: percentilesOf(
      requests.flatMap(({ firstByteMs }) => Option.toArray(firstByteMs)),
    ),
  };
};

const groupBy = <K>(
  priced: ReadonlyArray<Session.RequestRecord>,
  keyOf: (request: StoredItems.StoredRequest) => K,
  identity: (key: K) => string = String,
) => {
  const groups = new Map<
    string,
    { key: K; priced: Array<Session.RequestRecord> }
  >();
  for (const each of priced) {
    const key = keyOf(each.request);
    const group = groups.get(identity(key));
    if (group === undefined) groups.set(identity(key), { key, priced: [each] });
    else group.priced.push(each);
  }
  return [...groups.values()];
};

const byRequestsThenText = (
  one: { readonly requests: number; readonly text: string },
  other: { readonly requests: number; readonly text: string },
) => other.requests - one.requests || compareText(one.text, other.text);

const sortedText = (values: ReadonlyArray<string>) =>
  [...new Set(values)].sort(compareText);

/** What the in-memory reader reads: the requests, their items' digests and the sessions' items, as the repository stored them. */
export interface Held {
  readonly requests: ReadonlyArray<PricedRequest>;
  readonly requestItems: ReadonlyArray<StoredItems.RequestItems>;
  readonly items: ReadonlyArray<StoredItems.StoredItem>;
}

const sessionOrder =
  (order: Session.SessionOrder) =>
  (one: Session.SessionRow, other: Session.SessionRow): number => {
    const most = (a: number | bigint, b: number | bigint) =>
      a === b ? 0 : a > b ? -1 : 1;
    const first = {
      recent: () => most(millis(one.endedAt), millis(other.endedAt)),
      requests: () => most(one.requests, other.requests),
      tokens: () =>
        most(Session.tokensOf(one.usage), Session.tokensOf(other.usage)),
      cost: () => most(one.cost, other.cost),
    }[order]();
    return first || compareText(one.id, other.id);
  };

const sessionRowOf = (
  id: string,
  priced: ReadonlyArray<Session.RequestRecord>,
): Session.SessionRow => {
  const requests = priced.map(({ request }) => request);
  const starts = requests.map(({ startedAt }) => millis(startedAt));
  const valuesOf = (value: (request: StoredItems.StoredRequest) => string) =>
    sortedText(requests.map(value).filter((each) => each !== ""));
  return {
    id,
    ...sumsOf(priced),
    startedAt: DateTime.makeUnsafe(Math.min(...starts)),
    endedAt: DateTime.makeUnsafe(Math.max(...starts)),
    errors: errorsOf(priced),
    usageUnreported: requests.filter(({ usage }) => Option.isNone(usage))
      .length,
    pools: valuesOf(({ pool }) => pool),
    projects: valuesOf(({ project }) => project),
    machines: valuesOf(({ machine }) => machine),
    clients: valuesOf(({ client }) => client),
    providers: valuesOf(({ provider }) => provider),
    models: valuesOf(({ model }) => model),
  };
};

/**
 * The reader over a request log held in memory: it answers every query as
 * plain code over what `held` gives when asked, and fails as an unreachable
 * ClickHouse would while `fails` says so. A search widens each word of its
 * query up to `bounds`.
 */
export const make = (
  held: () => Held,
  fails: () => boolean = () => false,
  bounds: Search.Bounds = Search.bounds,
) => {
  const requests = () =>
    held().requests.map(({ request, cost }) => ({
      request: StoredItems.storedOf(request),
      cost,
    }));

  const itemOf = (session: string, digest: Conversation.Digest) =>
    held().items.find(
      (item) => item.session === session && item.digest === digest,
    );

  const selected = (selection: Traffic.Selection, except?: Traffic.Dimension) =>
    requests().filter(({ request }) =>
      Traffic.isSelected(selection, request, except),
    );

  const sessionTraffic = (session: string) =>
    requests().filter(
      ({ request }) =>
        request.session === session && Traffic.isTraffic(request),
    );

  /** Whether an item's text matches the search, its words widened among the log's when its tolerance widens them. */
  const matcherOf = ({ query, tolerance }: Search.Asked) => {
    if (!Search.widens(query, tolerance)) {
      return (text: string) => Search.matches(text, query);
    }
    const logWords = new Set(
      held().items.flatMap((item) => Search.wordsOf(item.text)),
    );
    const each = Search.wordsOf(query).map((word) =>
      Search.widened(word, logWords, tolerance, bounds),
    );
    return (text: string) => Search.matchesWidened(text, each);
  };

  /** The items of the sessions selected that match, each once, as the request that first carried it has it, in the order of hits. */
  const hitsOf = (
    sessions: (session: string) => boolean,
    search: Search.Asked,
  ): ReadonlyArray<Search.Hit> => {
    const first = new Map<string, StoredItems.StoredItem>();
    const matching = matcherOf(search);
    for (const item of held().items) {
      if (!sessions(item.session) || !matching(item.text)) {
        continue;
      }
      const key = `${item.session}\u0000${item.digest}`;
      const kept = first.get(key);
      if (
        kept === undefined ||
        (millis(item.firstSeen) - millis(kept.firstSeen) ||
          compareText(item.requestId, kept.requestId)) < 0
      ) {
        first.set(key, item);
      }
    }
    return [...first.values()]
      .map(
        (item): Search.Hit => ({
          session: item.session,
          item: item.digest,
          request: item.requestId,
          part: item.part,
          role: item.role,
          at: item.firstSeen,
        }),
      )
      .sort(Search.byNewest);
  };

  const selectedSessions = (selection: Traffic.Selection) =>
    new Set(selected(selection).map(({ request }) => request.session));

  const answer = <A>(compute: () => A) =>
    Effect.suspend(() =>
      fails()
        ? Effect.fail(
            new RequestLogUnavailable({ reason: "unreachable", code: "" }),
          )
        : Effect.sync(compute),
    );

  return RequestLogReader.of({
    overview: (selection, previous) =>
      answer(() => {
        const traffic = requests()
          .map(({ request }) => request)
          .filter(Traffic.isTraffic)
          .map(({ startedAt }) => millis(startedAt));
        return {
          totals: totalsOf(selected(selection)),
          previousTotals: totalsOf(
            selected({ ...selection, window: previous }),
          ),
          firstRequestAt:
            traffic.length === 0
              ? Option.none()
              : Option.some(DateTime.makeUnsafe(Math.min(...traffic))),
        };
      }),
    points: (selection, { by, bucket, zone, keys }) =>
      answer(() => {
        const chosen = selected(selection);
        const top = new Set(
          groupBy(chosen, (request) => Traffic.valueIn(request, by))
            .map(({ key, priced }) => ({ text: key, requests: priced.length }))
            .sort(byRequestsThenText)
            .slice(0, keys)
            .map(({ text }) => text),
        );
        return groupBy(
          chosen,
          (request) => {
            const value = Traffic.valueIn(request, by);
            return {
              at: bucketStart(request.startedAt, bucket, zone),
              key: top.has(value) ? Option.some(value) : Option.none<string>(),
            };
          },
          ({ at, key }) =>
            `${millis(at)}\u0000${Option.getOrElse(key, () => "\u0001")}`,
        ).map(({ key, priced }) => ({
          ...key,
          ...sumsOf(priced),
          errors: errorsOf(priced),
        }));
      }),
    breakdown: (selection, by, limit) =>
      answer(() => {
        const groups = groupBy(selected(selection), (request) =>
          Traffic.valueIn(request, by),
        );
        return {
          rows: groups
            .map(({ key, priced }) => ({
              key,
              ...sumsOf(priced),
              sessions: distinct(priced.map(({ request }) => request.session)),
              errors: errorsOf(priced),
              lastAt: DateTime.makeUnsafe(
                Math.max(
                  ...priced.map(({ request }) => millis(request.startedAt)),
                ),
              ),
            }))
            .sort((one, other) =>
              byRequestsThenText(
                { requests: one.requests, text: one.key },
                { requests: other.requests, text: other.key },
              ),
            )
            .slice(0, limit),
          distinctKeys: groups.length,
        };
      }),
    facets: (selection, limit) =>
      answer(() => {
        const facetOf = (dimension: Traffic.Dimension) =>
          groupBy(selected(selection, dimension), (request) =>
            Traffic.valueIn(request, dimension),
          )
            .filter(({ key }) => key !== "")
            .map(({ key, priced }) => ({ text: key, requests: priced.length }))
            .sort(byRequestsThenText)
            .slice(0, limit)
            .map(({ text, requests }) => ({ value: text, requests }));
        return {
          pool: facetOf("pool"),
          model: facetOf("model"),
          client: facetOf("client"),
          machine: facetOf("machine"),
          project: facetOf("project"),
          provider: facetOf("provider"),
          hub_key: facetOf("hub_key"),
          outcome: facetOf("outcome"),
        };
      }),
    errorGroups: (selection, limit) =>
      answer(() => {
        const chosen = selected(selection);
        const groups = groupBy(
          chosen,
          (request) => ({
            provider: request.provider,
            model: request.model,
            outcome: request.outcome,
            upstreamStatus: request.upstreamStatus,
            errorType: request.errorType,
            message: Traffic.messageOf(request.errorMessage),
          }),
          (key) => JSON.stringify(key),
        ).map(({ key, priced }): Traffic.ErrorGroup => {
          const starts = priced.map(({ request }) => millis(request.startedAt));
          return {
            ...key,
            requests: priced.length,
            firstAt: DateTime.makeUnsafe(Math.min(...starts)),
            lastAt: DateTime.makeUnsafe(Math.max(...starts)),
            pools: sortedText(priced.map(({ request }) => request.pool)),
            clients: sortedText(priced.map(({ request }) => request.client)),
            latestRequest: latest(priced).id,
          };
        });
        return {
          groups: groups
            .sort(
              (one, other) =>
                millis(other.lastAt) - millis(one.lastAt) ||
                compareText(other.latestRequest, one.latestRequest),
            )
            .slice(0, limit),
          requests: chosen.length,
          distinctGroups: groups.length,
        };
      }),
    sessions: (selection, order, { limit, offset }, search) =>
      answer(() => {
        const inWindow = selectedSessions(selection);
        const chosen = Option.match(search, {
          onNone: () => inWindow,
          onSome: (searched) =>
            new Set(
              hitsOf((session) => inWindow.has(session), searched).map(
                ({ session }) => session,
              ),
            ),
        });
        const rows = groupBy(
          requests().filter(
            ({ request }) =>
              Traffic.isTraffic(request) && chosen.has(request.session),
          ),
          (request) => request.session,
        )
          .map(({ key, priced }) => sessionRowOf(key, priced))
          .sort(sessionOrder(order));
        return { rows: rows.slice(offset, offset + limit), total: rows.length };
      }),
    hits: (selection, search, limit, after) =>
      answer(() => {
        const inWindow = selectedSessions(selection);
        return hitsOf((session) => inWindow.has(session), search)
          .filter((hit) =>
            Option.match(after, {
              onNone: () => true,
              onSome: (last) => Search.isAfter(hit, last),
            }),
          )
          .slice(0, limit);
      }),
    newestHits: (sessions, search) =>
      answer(() => {
        const newest = new Map<string, Search.Hit>();
        for (const hit of hitsOf(
          (session) => sessions.includes(session),
          search,
        )) {
          if (!newest.has(hit.session)) newest.set(hit.session, hit);
        }
        return newest;
      }),
    contents: (wanted) =>
      answer(() =>
        wanted
          .flatMap(({ session, item }) =>
            Option.toArray(
              Option.map(
                Option.fromUndefinedOr(itemOf(session, item)),
                ({ protocol, content }) => ({
                  session,
                  item,
                  protocol,
                  content,
                }),
              ),
            ),
          )
          .filter(
            (each, index, all) =>
              all.findIndex(
                (other) =>
                  other.session === each.session && other.item === each.item,
              ) === index,
          )
          .sort(
            (one, other) =>
              compareText(one.session, other.session) ||
              compareText(one.item, other.item),
          ),
      ),
    session: (session) =>
      answer(() => {
        const priced = sessionTraffic(session);
        return priced.length === 0
          ? Option.none()
          : Option.some(sessionRowOf(session, priced));
      }),
    summaries: (session, limit) =>
      answer(() => {
        const ordered = sessionTraffic(session)
          .map(({ request, cost }) => ({ request, cost }))
          .sort((one, other) => byStart(one.request, other.request));
        const kept = ordered.slice(Math.max(0, ordered.length - limit));
        return {
          summaries: kept.map(
            ({ request, cost }): Session.RequestSummary => ({
              id: request.id,
              startedAt: request.startedAt,
              operation: request.operation,
              purpose: request.purpose,
              model: request.model,
              servedModel: request.servedModel,
              stopReason: request.stopReason,
              outcome: request.outcome,
              upstreamStatus: request.upstreamStatus,
              errorType: request.errorType,
              promptSize: Session.promptSizeOf(request.usage),
              outputTokens: Option.map(
                request.usage,
                ({ tokens }) => tokens.output,
              ),
              cost,
              durationMs: request.durationMs,
              firstByteMs: request.firstByteMs,
              divertedFrom: request.divertedFrom,
              follows: request.follows,
            }),
          ),
          cut: ordered.length - kept.length,
        };
      }),
    request: (id) =>
      answer(() =>
        Option.map(
          Option.fromUndefinedOr(
            requests().find(({ request }) => request.id === id),
          ),
          ({ request, cost }) => ({
            record: { request, cost },
            params: Option.map(
              Option.fromUndefinedOr(
                held().requestItems.find(
                  (each) =>
                    each.requestId === id && each.session === request.session,
                ),
              ),
              ({ params }) => params,
            ),
            followedBy: Option.map(
              Option.fromUndefinedOr(
                requests()
                  .map((each) => each.request)
                  .filter(
                    (each) =>
                      each.session === request.session &&
                      Option.contains(each.follows, id),
                  )
                  .sort(byStart)[0],
              ),
              (each) => each.id,
            ),
          }),
        ),
      ),
    sessionRequests: (sessions, read, limit) =>
      answer(
        () =>
          new Map(
            sessions.flatMap((session) => {
              const traffic = requests()
                .map(({ request }) => request)
                .filter(
                  (request) =>
                    request.session === session && Traffic.isTraffic(request),
                )
                .sort(byStart);
              const found = traffic
                .slice(Math.max(0, traffic.length - limit))
                .map(
                  (request): Session.SessionRequest => ({
                    id: request.id,
                    startedAt: request.startedAt,
                    protocol: request.protocol,
                    purpose: request.purpose,
                    outcome: request.outcome,
                    promptSize: Session.promptSizeOf(request.usage),
                    clientHeaders: Object.fromEntries(
                      Object.entries(request.clientHeaders).filter(([name]) =>
                        read.headers.includes(name),
                      ),
                    ),
                    conversation: Option.map(
                      Option.fromUndefinedOr(
                        held().requestItems.find(
                          ({ requestId }) => requestId === request.id,
                        ),
                      ),
                      (stored): Session.Shape => ({
                        system: stored.system,
                        firstInput: Option.fromUndefinedOr(stored.input[0]),
                        tools: stored.tools.length,
                        inputTypes: read.inputTypes
                          .filter((type) =>
                            stored.input.some(
                              (digest) =>
                                itemOf(session, digest)?.type === type,
                            ),
                          )
                          .sort(compareText),
                        params: Object.fromEntries(
                          Object.entries(stored.params).filter(([field]) =>
                            read.params.includes(field),
                          ),
                        ),
                      }),
                    ),
                  }),
                );
              return found.length === 0 ? [] : [[session, found] as const];
            }),
          ),
      ),
    items: (wanted) =>
      answer(() => {
        const found = new Map<Request.RequestId, PartsOf>();
        const asked = new Map<
          Request.RequestId,
          {
            readonly stored: StoredItems.RequestItems;
            readonly parts: Set<Conversation.Part>;
          }
        >();
        for (const { session, id, parts } of wanted) {
          const stored = held().requestItems.find(
            (each) => each.requestId === id && each.session === session,
          );
          if (stored === undefined) continue;
          const each = asked.get(id) ?? { stored, parts: new Set() };
          for (const part of parts) each.parts.add(part);
          asked.set(id, each);
        }
        for (const [id, { stored, parts }] of asked) {
          const each: Record<
            Conversation.Part,
            Array<Session.StoredContent>
          > = { system: [], tools: [], input: [], output: [] };
          for (const part of parts) {
            for (const digest of stored[part]) {
              const item = itemOf(stored.session, digest);
              if (item === undefined) continue;
              const { type, role, content } = item;
              each[part].push({ digest, type, role, content });
            }
          }
          if ([...parts].some((part) => each[part].length > 0)) {
            found.set(id, each);
          }
        }
        return found;
      }),
    latestQuotaHeaders: (asked, since) =>
      answer(() => {
        const found = new Map<string, LatestQuotaHeaders>();
        for (const { pool, name } of asked) {
          const holding = requests().filter(
            ({ request }) =>
              request.pool === pool &&
              Object.hasOwn(request.rateLimits, name) &&
              millis(request.startedAt) >= millis(since),
          );
          if (holding.length === 0) continue;
          const { startedAt, rateLimits } = latest(holding);
          found.set(`${pool}\u0000${name}`, {
            pool,
            name,
            startedAt,
            headers: rateLimits,
          });
        }
        return [...found.values()].sort(
          (one, other) =>
            compareText(one.pool, other.pool) ||
            compareText(one.name, other.name),
        );
      }),
  });
};

/** The reader over what the in-memory repository holds. */
export const layer: Layer.Layer<RequestLogReader, never, InMemoryRequests> =
  Layer.effect(
    RequestLogReader,
    Effect.map(InMemoryRequests, (memory) =>
      make(
        () => memory,
        () => memory.readingFails,
      ),
    ),
  );
