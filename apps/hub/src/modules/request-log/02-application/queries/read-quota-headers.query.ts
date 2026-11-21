import { Context, type DateTime, Effect, Layer } from "effect";
import {
  type LatestQuotaHeaders,
  type QuotaHeaderAsked,
  RequestLogReader,
} from "#modules/request-log/02-application/interfaces/request-log-reader.ts";
import type { RequestLogUnavailable } from "#shared/03-domain/request-log.ts";

export class ReadQuotaHeaders extends Context.Service<
  ReadQuotaHeaders,
  {
    /**
     * For each pool and quota header asked, the latest request of the pool
     * that started at or after `since` and whose quota headers hold it: when
     * it started, and all its quota headers.
     */
    readonly execute: (
      asked: ReadonlyArray<QuotaHeaderAsked>,
      since: DateTime.Utc,
    ) => Effect.Effect<
      ReadonlyArray<LatestQuotaHeaders>,
      RequestLogUnavailable
    >;
  }
>()("@cota/hub/request-log/ReadQuotaHeaders") {}

export const layer: Layer.Layer<ReadQuotaHeaders, never, RequestLogReader> =
  Layer.effect(
    ReadQuotaHeaders,
    Effect.gen(function* () {
      const reader = yield* RequestLogReader;
      return ReadQuotaHeaders.of({
        execute: Effect.fn("ReadQuotaHeaders.execute")(function* (
          asked: ReadonlyArray<QuotaHeaderAsked>,
          since: DateTime.Utc,
        ) {
          return yield* reader.latestQuotaHeaders(asked, since);
        }),
      });
    }),
  );
