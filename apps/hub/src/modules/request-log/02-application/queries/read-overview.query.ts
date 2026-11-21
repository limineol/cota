import { Context, Effect, Layer } from "effect";
import { RequestLogReader } from "#modules/request-log/02-application/interfaces/request-log-reader.ts";
import * as Traffic from "#modules/request-log/03-domain/traffic.ts";
import type { RequestLogUnavailable } from "#shared/03-domain/request-log.ts";

export interface Overview extends Traffic.Overview {
  readonly window: Traffic.Window;
  readonly previous: Traffic.Window;
}

export class ReadOverview extends Context.Service<
  ReadOverview,
  {
    /** The window's totals, the previous window's for deltas, and when the request log begins. */
    readonly execute: (
      asked: Traffic.Asked,
    ) => Effect.Effect<Overview, Traffic.EmptyWindow | RequestLogUnavailable>;
  }
>()("@cota/hub/request-log/ReadOverview") {}

export const layer: Layer.Layer<ReadOverview, never, RequestLogReader> =
  Layer.effect(
    ReadOverview,
    Effect.gen(function* () {
      const reader = yield* RequestLogReader;
      return ReadOverview.of({
        execute: Effect.fn("ReadOverview.execute")(function* (
          asked: Traffic.Asked,
        ) {
          const selection = yield* Traffic.selectionOf(asked);
          const previous = Traffic.previous(selection.window);
          const overview = yield* reader.overview(selection, previous);
          return { window: selection.window, previous, ...overview };
        }),
      });
    }),
  );
