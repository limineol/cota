import { Context, Effect, Layer } from "effect";
import {
  ReportedThrough,
  type Through,
} from "#modules/request-log/02-application/interfaces/reported-through.ts";
import { isLate } from "#modules/request-log/03-domain/reported-through.ts";
import type { HubStoreUnavailable } from "#shared/03-domain/hub-store.ts";

export interface Reporter extends Through {
  readonly late: boolean;
}

export class ReadReportedThrough extends Context.Service<
  ReadReportedThrough,
  {
    /** Every machine's, client's and pool's reported through, in that order, each said late or not by the hub's clock. */
    readonly execute: Effect.Effect<
      ReadonlyArray<Reporter>,
      HubStoreUnavailable
    >;
  }
>()("@cota/hub/request-log/ReadReportedThrough") {}

export const layer: Layer.Layer<ReadReportedThrough, never, ReportedThrough> =
  Layer.effect(
    ReadReportedThrough,
    Effect.gen(function* () {
      const reportedThrough = yield* ReportedThrough;
      return ReadReportedThrough.of({
        execute: Effect.gen(function* () {
          const all = yield* reportedThrough.all;
          return yield* Effect.forEach(all, (through) =>
            Effect.map(isLate(through.through), (late) => ({
              ...through,
              late,
            })),
          );
        }).pipe(Effect.withSpan("ReadReportedThrough.execute")),
      });
    }),
  );
