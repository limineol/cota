import { Context, type DateTime, Effect, Layer } from "effect";
import { RequestLogReader } from "#modules/request-log/02-application/interfaces/request-log-reader.ts";
import * as Traffic from "#modules/request-log/03-domain/traffic.ts";
import type { RequestLogUnavailable } from "#shared/03-domain/request-log.ts";

/** How many values of its dimension a series shows on their own. */
export const keys = 12;

export class ReadSeries extends Context.Service<
  ReadSeries,
  {
    /** The selection's traffic over time, by the values of one dimension. */
    readonly execute: (
      asked: Traffic.Asked,
      by: Traffic.Dimension,
      zone: DateTime.TimeZone.Named,
    ) => Effect.Effect<
      Traffic.Series,
      Traffic.EmptyWindow | RequestLogUnavailable
    >;
  }
>()("@cota/hub/request-log/ReadSeries") {}

export const layer: Layer.Layer<ReadSeries, never, RequestLogReader> =
  Layer.effect(
    ReadSeries,
    Effect.gen(function* () {
      const reader = yield* RequestLogReader;
      return ReadSeries.of({
        execute: Effect.fn("ReadSeries.execute")(function* (
          asked: Traffic.Asked,
          by: Traffic.Dimension,
          zone: DateTime.TimeZone.Named,
        ) {
          const selection = yield* Traffic.selectionOf(asked);
          const bucket = Traffic.bucketFor(selection.window);
          const points = yield* reader.points(selection, {
            by,
            bucket,
            zone,
            keys,
          });
          return Traffic.seriesOf(bucket, points);
        }),
      });
    }),
  );
