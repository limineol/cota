import { Context, Effect, Layer } from "effect";
import { RequestLogReader } from "#modules/request-log/02-application/interfaces/request-log-reader.ts";
import * as Traffic from "#modules/request-log/03-domain/traffic.ts";
import type { RequestLogUnavailable } from "#shared/03-domain/request-log.ts";

/** How many values of each dimension the facets show. */
export const values = 100;

export class ReadFacets extends Context.Service<
  ReadFacets,
  {
    /** For every dimension, its values and how many requests have each. */
    readonly execute: (
      asked: Traffic.Asked,
    ) => Effect.Effect<
      Traffic.Facets,
      Traffic.EmptyWindow | RequestLogUnavailable
    >;
  }
>()("@cota/hub/request-log/ReadFacets") {}

export const layer: Layer.Layer<ReadFacets, never, RequestLogReader> =
  Layer.effect(
    ReadFacets,
    Effect.gen(function* () {
      const reader = yield* RequestLogReader;
      return ReadFacets.of({
        execute: Effect.fn("ReadFacets.execute")(function* (
          asked: Traffic.Asked,
        ) {
          const selection = yield* Traffic.selectionOf(asked);
          return yield* reader.facets(selection, values);
        }),
      });
    }),
  );
