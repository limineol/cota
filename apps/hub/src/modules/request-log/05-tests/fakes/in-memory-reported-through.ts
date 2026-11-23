import { Context, DateTime, Effect, Layer } from "effect";
import {
  ReportedThrough,
  type Through,
} from "#modules/request-log/02-application/interfaces/reported-through.ts";
import { HubStoreUnavailable } from "#shared/03-domain/hub-store.ts";

/** What a test sees of the in-memory reported through, and how it tells it to fail. */
export interface InMemory {
  readonly kept: Map<string, Through>;
  /** Whether keeping fails, as when the hub store cannot be written. */
  fails: boolean;
}

export class InMemoryReportedThrough extends Context.Service<
  InMemoryReportedThrough,
  InMemory
>()("@cota/hub/request-log/InMemoryReportedThrough") {}

/** `ReportedThrough` in memory, as the SQLite adapter keeps it. */
export const layer: Layer.Layer<ReportedThrough | InMemoryReportedThrough> =
  Layer.effectContext(
    Effect.sync(() => {
      const memory: InMemory = { kept: new Map(), fails: false };
      const keyOf = ({ machine, client, pool }: Through) =>
        JSON.stringify([machine, client, pool]);
      const ordered = () =>
        [...memory.kept.entries()]
          .sort(([one], [other]) => (one < other ? -1 : one > other ? 1 : 0))
          .map(([, through]) => through);
      const repository = ReportedThrough.of({
        keep: (through) =>
          Effect.suspend(() => {
            if (memory.fails) {
              return Effect.fail(
                new HubStoreUnavailable({ detail: "the hub store is closed" }),
              );
            }
            const before = memory.kept.get(keyOf(through));
            memory.kept.set(keyOf(through), {
              ...through,
              through:
                before === undefined
                  ? through.through
                  : DateTime.max(before.through, through.through),
            });
            return Effect.void;
          }),
        all: Effect.sync(ordered),
      });
      return Context.make(ReportedThrough, repository).pipe(
        Context.add(InMemoryReportedThrough, memory),
      );
    }),
  );
