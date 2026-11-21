import { Context, Effect, Layer } from "effect";
import { RequestLogReader } from "#modules/request-log/02-application/interfaces/request-log-reader.ts";
import * as Traffic from "#modules/request-log/03-domain/traffic.ts";
import type { RequestLogUnavailable } from "#shared/03-domain/request-log.ts";

export class ReadBreakdown extends Context.Service<
  ReadBreakdown,
  {
    /** The selection by the values of one dimension, the `limit` with the most requests. */
    readonly execute: (
      asked: Traffic.Asked,
      by: Traffic.Dimension,
      limit: number,
    ) => Effect.Effect<
      Traffic.Breakdown,
      Traffic.EmptyWindow | RequestLogUnavailable
    >;
  }
>()("@cota/hub/request-log/ReadBreakdown") {}

export const layer: Layer.Layer<ReadBreakdown, never, RequestLogReader> =
  Layer.effect(
    ReadBreakdown,
    Effect.gen(function* () {
      const reader = yield* RequestLogReader;
      return ReadBreakdown.of({
        execute: Effect.fn("ReadBreakdown.execute")(function* (
          asked: Traffic.Asked,
          by: Traffic.Dimension,
          limit: number,
        ) {
          const selection = yield* Traffic.selectionOf(asked);
          return yield* reader.breakdown(selection, by, limit);
        }),
      });
    }),
  );
