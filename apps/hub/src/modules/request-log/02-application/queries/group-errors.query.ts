import { Context, Effect, Layer } from "effect";
import { RequestLogReader } from "#modules/request-log/02-application/interfaces/request-log-reader.ts";
import * as Traffic from "#modules/request-log/03-domain/traffic.ts";
import type { RequestLogUnavailable } from "#shared/03-domain/request-log.ts";

/** How many error groups are shown. */
export const groups = 200;

export class GroupErrors extends Context.Service<
  GroupErrors,
  {
    /**
     * Failed requests grouped by cause: those whose outcome is `error`, unless
     * the outcomes asked for say otherwise.
     */
    readonly execute: (
      asked: Traffic.Asked,
    ) => Effect.Effect<
      Traffic.ErrorGroups,
      Traffic.EmptyWindow | RequestLogUnavailable
    >;
  }
>()("@cota/hub/request-log/GroupErrors") {}

export const layer: Layer.Layer<GroupErrors, never, RequestLogReader> =
  Layer.effect(
    GroupErrors,
    Effect.gen(function* () {
      const reader = yield* RequestLogReader;
      return GroupErrors.of({
        execute: Effect.fn("GroupErrors.execute")(function* (
          asked: Traffic.Asked,
        ) {
          const selection = yield* Traffic.selectionOf(asked);
          const { outcome } = selection.filters;
          return yield* reader.errorGroups(
            {
              ...selection,
              filters: {
                ...selection.filters,
                outcome: outcome.length === 0 ? ["error"] : outcome,
              },
            },
            groups,
          );
        }),
      });
    }),
  );
