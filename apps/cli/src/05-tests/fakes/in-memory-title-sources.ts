import { Effect, Layer, Option } from "effect";
import {
  SourceUnreadable,
  TitleSources,
} from "#02-application/interfaces/title-sources.ts";

/** A file of a source: its bytes, and when it last changed, in milliseconds since the epoch. */
export interface SourceBytes {
  bytes: Uint8Array;
  changedAt: number;
}

/** The clients' files in memory, by path, and T3 Code's thread titles, which a test changes between runs. */
export interface InMemoryTitleSources {
  readonly files: Map<string, SourceBytes>;
  /** T3 Code's database: absent, its rows, or one that cannot be read. */
  t3: "absent" | "unreadable" | ReadonlyArray<readonly [string, string]>;
}

const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const parentOf = (path: string) => path.slice(0, path.lastIndexOf("/"));

export const make = (): {
  readonly sources: InMemoryTitleSources;
  readonly layer: Layer.Layer<TitleSources>;
} => {
  const sources: InMemoryTitleSources = { files: new Map(), t3: "absent" };
  const fileOf = (path: string, held: SourceBytes) => ({
    path,
    size: held.bytes.length,
    changedAt: held.changedAt,
  });
  const layer = Layer.succeed(
    TitleSources,
    TitleSources.of({
      transcripts: (projects) =>
        Effect.sync(() =>
          [...sources.files]
            .filter(
              ([path]) =>
                parentOf(parentOf(path)) === projects &&
                nameOf(path).endsWith(".jsonl"),
            )
            .map(([path, held]) => fileOf(path, held)),
        ),
      file: (path) =>
        Effect.sync(() =>
          Option.map(Option.fromUndefinedOr(sources.files.get(path)), (held) =>
            fileOf(path, held),
          ),
        ),
      bytesFrom: (path, offset) =>
        Effect.sync(() =>
          Option.map(Option.fromUndefinedOr(sources.files.get(path)), (held) =>
            held.bytes.slice(offset),
          ),
        ),
      threadTitles: (database) =>
        Effect.suspend(() => {
          const t3 = sources.t3;
          if (t3 === "absent") return Effect.succeedNone;
          if (t3 === "unreadable") {
            return Effect.fail(
              new SourceUnreadable({
                source: database,
                reason: "no such table: orchestration_v2_projection_threads",
              }),
            );
          }
          return Effect.succeedSome(t3);
        }),
    }),
  );
  return { sources, layer };
};
