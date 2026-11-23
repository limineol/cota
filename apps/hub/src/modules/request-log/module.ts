import { BunHttpClient } from "@effect/platform-bun";
import { Duration, Effect, type HashMap, Layer, Option } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { Api } from "#api.ts";
import * as ReportsHandlers from "#modules/request-log/01-presentation/reports.handlers.ts";
import * as RequestsHandlers from "#modules/request-log/01-presentation/requests.handlers.ts";
import * as SearchHandlers from "#modules/request-log/01-presentation/search.handlers.ts";
import * as SessionsHandlers from "#modules/request-log/01-presentation/sessions.handlers.ts";
import * as SqlHandlers from "#modules/request-log/01-presentation/sql.handlers.ts";
import * as TrafficHandlers from "#modules/request-log/01-presentation/traffic.handlers.ts";
import * as ArchiveDays from "#modules/request-log/02-application/commands/archive-days.command.ts";
import * as RecordRequest from "#modules/request-log/02-application/commands/record-request.command.ts";
import * as ReportRequests from "#modules/request-log/02-application/commands/report-requests.command.ts";
import * as ReportSessionTitles from "#modules/request-log/02-application/commands/report-session-titles.command.ts";
import type { RequestLogReader } from "#modules/request-log/02-application/interfaces/request-log-reader.ts";
import type { RequestsRepository } from "#modules/request-log/02-application/interfaces/requests.repository.ts";
import type { SessionTitles } from "#modules/request-log/02-application/interfaces/session-titles.ts";
import type { SqlConsole } from "#modules/request-log/02-application/interfaces/sql-console.ts";
import type { Transcripts } from "#modules/request-log/02-application/interfaces/transcripts.ts";
import * as GroupErrors from "#modules/request-log/02-application/queries/group-errors.query.ts";
import * as InspectRequest from "#modules/request-log/02-application/queries/inspect-request.query.ts";
import * as ListPoolModels from "#modules/request-log/02-application/queries/list-pool-models.query.ts";
import * as ListSessions from "#modules/request-log/02-application/queries/list-sessions.query.ts";
import * as ReadBreakdown from "#modules/request-log/02-application/queries/read-breakdown.query.ts";
import * as ReadFacets from "#modules/request-log/02-application/queries/read-facets.query.ts";
import * as ReadOverview from "#modules/request-log/02-application/queries/read-overview.query.ts";
import * as ReadQuotaHeaders from "#modules/request-log/02-application/queries/read-quota-headers.query.ts";
import * as ReadSchema from "#modules/request-log/02-application/queries/read-schema.query.ts";
import * as ReadSeries from "#modules/request-log/02-application/queries/read-series.query.ts";
import * as ReadSession from "#modules/request-log/02-application/queries/read-session.query.ts";
import * as ReadSnippets from "#modules/request-log/02-application/queries/read-snippets.query.ts";
import * as RebuildConversation from "#modules/request-log/02-application/queries/rebuild-conversation.query.ts";
import * as RunSql from "#modules/request-log/02-application/queries/run-sql.query.ts";
import * as SearchItems from "#modules/request-log/02-application/queries/search-items.query.ts";
import type * as SqlLimits from "#modules/request-log/03-domain/sql.ts";
import * as FileSystemArchiveDirectory from "#modules/request-log/04-infrastructure/archive/file-system-archive-directory.ts";
import * as ClickHouseRequestLogArchive from "#modules/request-log/04-infrastructure/persistence/clickhouse/clickhouse-request-log-archive.ts";
import * as ClickHouseRequestLogReader from "#modules/request-log/04-infrastructure/persistence/clickhouse/clickhouse-request-log-reader.ts";
import * as ClickHouseRequests from "#modules/request-log/04-infrastructure/persistence/clickhouse/clickhouse-requests.repository.ts";
import * as ClickHouseSessionTitles from "#modules/request-log/04-infrastructure/persistence/clickhouse/clickhouse-session-titles.ts";
import * as ClickHouseSqlConsole from "#modules/request-log/04-infrastructure/persistence/clickhouse/clickhouse-sql-console.ts";
import * as ClickHouse from "#modules/request-log/04-infrastructure/persistence/clickhouse/client.ts";
import * as SqliteReportedThrough from "#modules/request-log/04-infrastructure/persistence/sqlite/sqlite-reported-through.ts";
import * as PriceLists from "#modules/request-log/04-infrastructure/prices/prices.ts";
import * as RenderedTranscripts from "#modules/request-log/04-infrastructure/transcripts/transcripts.ts";
import type { PoolId } from "#shared/03-domain/ids.ts";
import type * as Pool from "#shared/03-domain/pool.entity.ts";
import type { HubStore } from "#shared/04-infrastructure/hub-store/hub-store.ts";

export interface Options {
  readonly clickhouse: ClickHouse.Connection;
  readonly pools: HashMap.HashMap<PoolId, Pool.Pool>;
  readonly sql: SqlLimits.Limits;
  /** The archive directory, which turns the archiver on (`docs/specs/archive/spec.md`). */
  readonly archive: Option.Option<{ readonly directory: string }>;
}

export type Traffic =
  | ReadOverview.ReadOverview
  | ReadSeries.ReadSeries
  | ReadBreakdown.ReadBreakdown
  | ReadFacets.ReadFacets
  | GroupErrors.GroupErrors;

/** The queries the `traffic` group answers, over the reader given. */
export const traffic: Layer.Layer<Traffic, never, RequestLogReader> =
  Layer.mergeAll(
    ReadOverview.layer,
    ReadSeries.layer,
    ReadBreakdown.layer,
    ReadFacets.layer,
    GroupErrors.layer,
  );

export type Sessions =
  | ListSessions.ListSessions
  | ReadSession.ReadSession
  | ReportSessionTitles.ReportSessionTitles
  | InspectRequest.InspectRequest
  | SearchItems.SearchItems;

/** The queries and the command the `sessions`, `requests` and `search` groups answer, over the reader, the titles and the renderers given. */
export const sessions: Layer.Layer<
  Sessions,
  never,
  RequestLogReader | SessionTitles | Transcripts
> = Layer.mergeAll(
  ListSessions.layer,
  ReadSession.layer,
  ReportSessionTitles.layer,
  InspectRequest.layer,
  SearchItems.layer,
).pipe(Layer.provide(ReadSnippets.layer));

export type QuotaSources = ReadQuotaHeaders.ReadQuotaHeaders;

/** The query the quota module reads the quota headers through, over the reader given. */
export const quotaSources: Layer.Layer<QuotaSources, never, RequestLogReader> =
  ReadQuotaHeaders.layer;

export type Sql = RunSql.RunSql | ReadSchema.ReadSchema;

/** The queries the `sql` group answers, over the SQL console given. */
export const sql: Layer.Layer<Sql, never, SqlConsole> = Layer.mergeAll(
  RunSql.layer,
  ReadSchema.layer,
);

/**
 * The command the `reports` group answers, over the repository given, priced
 * from each pool's prices, with reported through in the hub store.
 */
export const reports = (
  pools: HashMap.HashMap<PoolId, Pool.Pool>,
): Layer.Layer<
  ReportRequests.ReportRequests,
  never,
  RequestsRepository | HubStore
> =>
  ReportRequests.layer(pools).pipe(
    Layer.provide([PriceLists.layer(pools), SqliteReportedThrough.layer]),
  );

/** The request log's steps in the hub store. */
export const steps = SqliteReportedThrough.steps;

export const archiverStarts = Duration.minutes(1);
export const archiverPause = Duration.hours(1);

/**
 * Runs the archiver a minute after it starts, then an hour after each run
 * ended, until its scope closes. Shutdown does not wait for it.
 */
export const archiver: Layer.Layer<never, never, ArchiveDays.ArchiveDays> =
  Layer.effectDiscard(
    Effect.gen(function* () {
      const archiveDays = yield* ArchiveDays.ArchiveDays;
      const runs = Effect.fn("archiver.runs")(function* () {
        yield* Effect.sleep(archiverStarts);
        while (true) {
          yield* archiveDays.execute;
          yield* Effect.sleep(archiverPause);
        }
      });
      yield* Effect.forkScoped(runs());
    }),
  );

const archiving = (directory: string) =>
  archiver.pipe(
    Layer.provide(ArchiveDays.layer),
    Layer.provide([
      FileSystemArchiveDirectory.layer(directory),
      ClickHouseRequestLogArchive.layer,
    ]),
  );

/** The request log, kept in ClickHouse and priced from each pool's prices, and archived when the options have an archive directory. */
export const layer = (
  options: Options,
): Layer.Layer<
  | RecordRequest.RecordRequest
  | RebuildConversation.RebuildConversation
  | Traffic
  | Sessions
  | QuotaSources
  | Sql
  | RequestsRepository
> =>
  Layer.mergeAll(
    Option.match(options.archive, {
      onNone: () => Layer.empty,
      onSome: ({ directory }) => archiving(directory),
    }),
    Layer.mergeAll(RecordRequest.layer(), RebuildConversation.layer).pipe(
      Layer.provide(PriceLists.layer(options.pools)),
      Layer.provide(ClickHouseRequests.layer),
    ),
    Layer.mergeAll(traffic, sessions, quotaSources).pipe(
      Layer.provide([
        ClickHouseRequestLogReader.layer,
        ClickHouseSessionTitles.layer,
        RenderedTranscripts.layer,
      ]),
    ),
    sql.pipe(Layer.provide(ClickHouseSqlConsole.layer(options.sql))),
    ClickHouseRequests.layer,
  ).pipe(
    Layer.provide(ClickHouse.layer(options.clickhouse)),
    Layer.provide(BunHttpClient.layer),
  );

/** The query the admission module reads the models of each pool's prices through. */
export const poolModels = (
  pools: HashMap.HashMap<PoolId, Pool.Pool>,
): Layer.Layer<ListPoolModels.ListPoolModels> =>
  ListPoolModels.layer.pipe(Layer.provide(PriceLists.pricedModels(pools)));

/** The name models.dev gives each model of the shipped price lists, by model id, for the display names. */
export const modelNames = PriceLists.modelNames;

/** The handlers of the `traffic`, `sessions`, `requests`, `search`, `sql` and `reports` groups. */
export const api = Layer.mergeAll(
  HttpApiBuilder.group(Api, "traffic", TrafficHandlers.build),
  HttpApiBuilder.group(Api, "sessions", SessionsHandlers.build),
  HttpApiBuilder.group(Api, "requests", RequestsHandlers.build),
  HttpApiBuilder.group(Api, "search", SearchHandlers.build),
  HttpApiBuilder.group(Api, "sql", SqlHandlers.build),
  HttpApiBuilder.group(Api, "reports", ReportsHandlers.build),
);
