import { Clock, Context, Effect, Layer, Option, Schema } from "effect";
import {
  ImportFiles,
  ImportSource,
  type ImportSourceFailed,
  type Listed,
  type PageKeys,
  type Range,
  type Tallies,
  type Weight,
} from "#modules/request-log/02-application/interfaces/import-source.ts";
import { Prices } from "#modules/request-log/02-application/interfaces/prices.ts";
import {
  type ArchiveSession,
  RequestLogArchive,
  type RequestLogArchiveFailed,
} from "#modules/request-log/02-application/interfaces/request-log-archive.ts";
import * as Archive from "#modules/request-log/03-domain/archive.ts";
import * as Import from "#modules/request-log/03-domain/import.ts";
import type * as StoredItems from "#modules/request-log/03-domain/stored-items.ts";
import type * as Title from "#modules/request-log/03-domain/title.ts";
import type * as Conversation from "#shared/03-domain/conversation.ts";

/** The most requests and item hashes a page of a day's sessions holds, unless one session alone is more. */
export const pageLimits = { requests: 2_000, hashes: 500_000 };
/** The most content a chunk of a page's items holds, unless one item alone is more. */
export const chunkBytes = 16 * 1024 * 1024;

/** What an import did not carry of a day, by reason (`docs/specs/import/spec.md`, The report). */
export interface NotCarried {
  readonly conversations: number;
  readonly usages: number;
  readonly requestItems: number;
  readonly items: number;
  readonly unreadable: number;
}

/** How long a day took to read from the source, to build, and to load and add, in milliseconds. */
export interface Timings {
  readonly read: number;
  readonly build: number;
  readonly load: number;
}

/** What an import did with a day. */
export type Imported =
  /** Its built rows the log did not hold were added (or, in a dry run, would be), by table. */
  | {
      readonly _tag: "Added";
      readonly added: Readonly<Record<Archive.Table, number>>;
      readonly cost: bigint;
      readonly sourceCost: number;
      readonly notCarried: NotCarried;
      readonly timings: Timings;
    }
  /** The log holds every row built for it. */
  | { readonly _tag: "Held"; readonly timings: Timings }
  /** It was not added, or not verified: the rows added before stay. */
  | { readonly _tag: "Failed"; readonly detail: string };

/** The import could not start (exit 2), or, in a dry run, found source pools the pool map does not name (exit 1). */
export class ImportRefused extends Schema.TaggedError<
  ImportRefused,
  { readonly brand: unique symbol }
>()("ImportRefused", {
  why: Schema.String,
  unmapped: Schema.Array(Schema.Tuple([Schema.String, Schema.Int])),
}) {
  override get message(): string {
    return this.why;
  }
}

export interface Options {
  readonly range: Range;
  readonly dryRun: boolean;
  readonly targets: Import.Targets;
}

export interface Done {
  readonly days: ReadonlyArray<readonly [Archive.Day, Imported]>;
  /** What a dry run lists of the source. */
  readonly tallies: Option.Option<Tallies>;
  /** The titles file's titles not carried: of a session with no request, and empty. */
  readonly titlesNotCarried: {
    readonly withoutRequest: number;
    readonly empty: number;
  };
}

export class ImportDays extends Context.Service<
  ImportDays,
  {
    /**
     * One import (the import spec's "A day"): checks the source, then builds,
     * loads, checks, adds and verifies each day of the range in ascending
     * order, stopping at the first that fails.
     */
    readonly execute: (
      options: Options,
    ) => Effect.Effect<
      Done,
      ImportRefused | ImportSourceFailed | RequestLogArchiveFailed
    >;
  }
>()("@cota/hub/request-log/ImportDays") {}

/** A day's sessions, in the order of their keys, cut into pages (`docs/specs/import/spec.md`, A day). */
export const pagesOf = (
  day: Archive.Day,
  weights: ReadonlyArray<Weight>,
): ReadonlyArray<PageKeys> => {
  const pages: Array<PageKeys> = [];
  let page: { first: string; last: string } | undefined;
  let requests = 0;
  let hashes = 0;
  for (const weight of weights) {
    if (
      page !== undefined &&
      (requests + weight.requests > pageLimits.requests ||
        hashes + weight.hashes > pageLimits.hashes)
    ) {
      pages.push({ day, ...page });
      page = undefined;
      requests = 0;
      hashes = 0;
    }
    page = { first: page?.first ?? weight.sessionKey, last: weight.sessionKey };
    requests += weight.requests;
    hashes += weight.hashes;
  }
  if (page !== undefined) pages.push({ day, ...page });
  return pages;
};

/** A page's listed items cut, in order, into chunks of at most `chunkBytes` of content. */
export const chunksOf = (
  listed: ReadonlyArray<Listed>,
): ReadonlyArray<ReadonlyArray<Listed>> => {
  const chunks: Array<Array<Listed>> = [];
  let chunk: Array<Listed> = [];
  let bytes = 0;
  for (const item of listed) {
    if (chunk.length > 0 && bytes + item.bytes > chunkBytes) {
      chunks.push(chunk);
      chunk = [];
      bytes = 0;
    }
    chunk.push(item);
    bytes += item.bytes;
  }
  if (chunk.length > 0) chunks.push(chunk);
  return chunks;
};

const wraps = 2n ** 64n;

/** The difference of two checksums, each a sum of 64-bit hashes that wraps. */
const gainOf = (before: Archive.Logged, after: Archive.Logged) => ({
  rows: after.rows - before.rows,
  checksum: String(
    (((BigInt(after.checksum) - BigInt(before.checksum)) % wraps) + wraps) %
      wraps,
  ),
});

const plural = (count: number, one: string, many: string) =>
  `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

class DayFailed extends Schema.TaggedError<
  DayFailed,
  { readonly brand: unique symbol }
>()("DayFailed", { detail: Schema.String }) {}

const nothing: Readonly<Record<Archive.Table, number>> = {
  items: 0,
  request_items: 0,
  requests: 0,
  session_titles: 0,
};

export const layer: Layer.Layer<
  ImportDays,
  never,
  ImportSource | ImportFiles | RequestLogArchive | Prices
> = Layer.effect(
  ImportDays,
  Effect.gen(function* () {
    const source = yield* ImportSource;
    const files = yield* ImportFiles;
    const log = yield* RequestLogArchive;
    const prices = yield* Prices;

    const priceOf: Import.PriceOf = (pool, model) =>
      prices.of({
        pool: pool.id,
        protocol: pool.protocol,
        model,
        servedModel: "",
        serviceTier: "",
      });

    const importDay = Effect.fn("ImportDays.day")(function* (
      day: Archive.Day,
      options: Options,
      titles: ReadonlyArray<Title.Report>,
      columns: Readonly<Record<Archive.Table, ReadonlyArray<string>>>,
      session: ArchiveSession,
    ) {
      const timings = { read: 0, build: 0, load: 0 };
      const timed =
        (kind: keyof typeof timings) =>
        <A, E, R>(effect: Effect.Effect<A, E, R>) =>
          Effect.gen(function* () {
            const start = yield* Clock.currentTimeMillis;
            const result = yield* effect;
            timings[kind] += (yield* Clock.currentTimeMillis) - start;
            return result;
          });
      const read = timed("read");
      const build = timed("build");
      const load = timed("load");

      const before = yield* read(source.summary(day));
      for (const table of Archive.tables) yield* session.make(table);

      const built = { ...nothing };
      const notCarried = {
        conversations: 0,
        usages: 0,
        requestItems: 0,
        items: 0,
        unreadable: 0,
      };
      let requestsRead = 0;
      let itemsOfDay = 0;
      let requestItemsRead = 0;
      let cost = 0n;
      let sourceCost = 0;
      let earliest: Option.Option<Archive.Day> = Option.none();

      const weights = yield* read(source.sessions(day));
      for (const keys of pagesOf(day, weights)) {
        const requests = yield* read(source.requests(keys));
        const builtRequests = yield* build(
          Effect.forEach(requests, (row) =>
            Import.requestOf(row, options.targets, priceOf),
          ),
        );
        const rows = yield* read(source.requestItems(keys));
        const listed = yield* read(source.listed(keys));
        const orphans = listed.filter(({ sentAt }) => Option.isNone(sentAt));
        const namings =
          orphans.length === 0 ? [] : yield* read(source.firstNamings(orphans));
        const page = yield* build(
          Effect.sync(() =>
            Import.pageOf(day, builtRequests, rows, listed, namings),
          ),
        );
        requestsRead += requests.length;
        itemsOfDay += page.itemsOfDay;
        requestItemsRead += page.requestItems.size + page.withoutRequest;
        notCarried.requestItems += page.withoutRequest;
        notCarried.items += page.unnamed;

        const digests = new Map<string, Conversation.Digest>();
        const builtItems = new Set<string>();
        for (const chunk of chunksOf(listed)) {
          const first = chunk[0];
          const last = chunk[chunk.length - 1];
          if (first === undefined || last === undefined) continue;
          const contents = yield* read(source.contents(keys, first, last));
          const items: ReadonlyArray<StoredItems.StoredItem> = yield* build(
            Effect.sync(() => {
              const done = Import.chunkOf(page, contents, builtItems);
              for (const [key, digest] of done.digests)
                digests.set(key, digest);
              for (const item of done.items) {
                builtItems.add(Import.builtKeyOf(item));
              }
              notCarried.unreadable += done.unreadable;
              return done.items;
            }),
          );
          built.items += items.length;
          yield* load(session.append({ table: "items", rows: items }));
        }
        const conversations = yield* build(
          Effect.sync(() => Import.conversationsOf(page, digests)),
        );
        notCarried.conversations +=
          conversations.unresolved + conversations.withoutRow;
        earliest = Option.match(conversations.earliest, {
          onNone: () => earliest,
          onSome: (found) =>
            Option.some(
              Option.match(earliest, {
                onNone: () => found,
                onSome: (kept) => Import.earlierDay(kept, found),
              }),
            ),
        });
        for (const each of builtRequests) {
          if (each.usage === "NotAddingUp") notCarried.usages++;
          cost += Option.getOrElse(each.record.cost, () => 0n);
          sourceCost += Option.getOrElse(each.source.cost, () => 0);
        }
        built.request_items += conversations.requestItems.length;
        built.requests += builtRequests.length;
        yield* load(
          session.append({
            table: "request_items",
            rows: conversations.requestItems,
          }),
        );
        yield* load(
          session.append({
            table: "requests",
            rows: builtRequests.map(({ record }) => record),
          }),
        );
      }
      const titlesOfDay = titles.filter(
        ({ reportedAt }) => Import.dayOf(reportedAt) === day,
      );
      built.session_titles = titlesOfDay.length;
      yield* load(
        session.append({ table: "session_titles", rows: titlesOfDay }),
      );

      const after = yield* read(source.summary(day));
      if (
        after.requests !== before.requests ||
        after.fingerprint !== before.fingerprint ||
        after.items !== before.items ||
        after.requestItems !== before.requestItems
      ) {
        return yield* new DayFailed({
          detail: "the source changed while it was read",
        });
      }
      if (requestsRead !== before.requests) {
        return yield* new DayFailed({
          detail: `the source gave ${requestsRead} of its ${plural(before.requests, "request", "requests")}`,
        });
      }
      if (itemsOfDay !== before.items) {
        return yield* new DayFailed({
          detail: `the source gave ${itemsOfDay} of its ${plural(before.items, "item", "items")}`,
        });
      }
      if (requestItemsRead !== before.requestItems) {
        return yield* new DayFailed({
          detail: `the source gave ${requestItemsRead} of its ${plural(before.requestItems, "request item", "request items")}`,
        });
      }

      const lacking = { ...nothing };
      const lackingMeasures = new Map<Archive.Table, Archive.Logged>();
      for (const table of Archive.tables) {
        const measure = yield* session.measure(table);
        if (measure.loaded.rows !== built[table]) {
          return yield* new DayFailed({
            detail: `archive_${table} holds ${measure.loaded.rows} of the ${built[table]} rows built`,
          });
        }
        lacking[table] = measure.lacking.rows;
        lackingMeasures.set(table, measure.lacking);
      }
      const unresolved = yield* session.unresolved;
      if (unresolved > 0) {
        return yield* new DayFailed({
          detail: `${plural(unresolved, "request carries", "requests carry")} items the log does not hold; import from ${Option.getOrElse(earliest, () => day)}`,
        });
      }
      const report = { cost, sourceCost, notCarried, timings };
      if (Archive.tables.every((table) => lacking[table] === 0)) {
        return { _tag: "Held", timings } satisfies Imported;
      }

      const requestsBefore = yield* session.ofLoaded("requests");
      const requestItemsBefore = yield* session.ofLoaded("request_items");
      const added = { ...nothing };
      for (const table of Archive.tables) {
        added[table] = yield* load(session.add(table, columns[table]));
      }
      for (const table of Archive.tables) {
        const still = yield* session.measure(table);
        if (still.lacking.rows > 0) {
          return yield* new DayFailed({
            detail: `${plural(still.lacking.rows, "row", "rows")} of ${table} are still not held after they were added`,
          });
        }
      }
      const gained = {
        requests: gainOf(requestsBefore, yield* session.ofLoaded("requests")),
        request_items: gainOf(
          requestItemsBefore,
          yield* session.ofLoaded("request_items"),
        ),
      };
      for (const table of ["requests", "request_items"] as const) {
        const wanted = lackingMeasures.get(table);
        if (
          wanted === undefined ||
          gained[table].rows !== wanted.rows ||
          gained[table].checksum !== wanted.checksum
        ) {
          return yield* new DayFailed({
            detail: `the log's ${table} did not gain the rows it lacked`,
          });
        }
      }
      return { _tag: "Added", added, ...report } satisfies Imported;
    });

    return ImportDays.of({
      execute: Effect.fn("ImportDays.execute")(function* (options: Options) {
        const problems = yield* source.columnProblems;
        if (problems.length > 0) {
          return yield* new ImportRefused({
            why: `the source is not the prototype's log: ${problems.join("; ")}`,
            unmapped: [],
          });
        }
        const pools = yield* source.pools(options.range);
        const unmapped = pools.filter(
          ([pool]) => !options.targets.pools.has(pool),
        );
        if (unmapped.length > 0) {
          return yield* new ImportRefused({
            why: `the pool map does not name ${unmapped.map(([pool, count]) => `${pool} (${plural(count, "request", "requests")})`).join(", ")}`,
            unmapped,
          });
        }
        const tallies = options.dryRun
          ? Option.some(yield* source.tallies(options.range))
          : Option.none();
        yield* log.prepare;
        const logSource = yield* log.source;
        const columns = yield* Archive.eachTable((table) =>
          Effect.succeed(
            logSource.tables[table].columns.map(({ name }) => name),
          ),
        );

        const titleRows = yield* files.titles;
        const latest = yield* source.latest([
          ...new Set(titleRows.map(({ session }) => session)),
        ]);
        const titles = Import.titlesOf(titleRows, latest);

        const days = yield* source.days(options.range);
        const outcomes: Array<readonly [Archive.Day, Imported]> = [];
        // One session for the run: a dry run's holds what its earlier days added.
        const session = yield* log.importing(options.dryRun);
        for (const day of days) {
          const outcome = yield* importDay(
            day,
            options,
            titles.reports,
            columns,
            session,
          ).pipe(
            Effect.catch((error) =>
              Effect.succeed<Imported>({
                _tag: "Failed",
                detail:
                  error._tag === "DayFailed" ? error.detail : error.message,
              }),
            ),
            Effect.ensuring(
              Effect.forEach(Archive.tables, (table) =>
                Effect.ignore(session.drop(table)),
              ),
            ),
          );
          outcomes.push([day, outcome]);
          if (outcome._tag === "Failed") break;
        }
        return {
          days: outcomes,
          tallies,
          titlesNotCarried: {
            withoutRequest: titles.withoutRequest,
            empty: titles.empty,
          },
        };
      }),
    });
  }),
);
