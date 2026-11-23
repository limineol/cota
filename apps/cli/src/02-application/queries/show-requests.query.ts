import { Context, Effect, Layer, Option } from "effect";
import { ClientRecords } from "#02-application/interfaces/client-records.ts";
import { Environment } from "#02-application/interfaces/environment.ts";
import { Files } from "#02-application/interfaces/files.ts";
import type { Reason } from "#03-domain/antigravity-record.ts";
import type { Configuration } from "#03-domain/configuration.ts";
import { type Paths, requestsFile } from "#03-domain/paths.ts";
import * as Requests from "#03-domain/requests.ts";

/** A kept folder as `cota requests show` prints it. */
export interface FolderShown {
  readonly folder: string;
  readonly pool: string;
  /** When the last run that caught up with it began. */
  readonly through: Option.Option<string>;
  readonly ranAt: Option.Option<string>;
  readonly notReported: ReadonlyArray<{
    readonly conversation: string;
    readonly reason: Reason;
    readonly step: Option.Option<number>;
  }>;
}

export interface Shown {
  readonly folders: ReadonlyArray<FolderShown>;
  /** Whether `requests.json` read; when it did not, nothing of the folders' runs is shown. */
  readonly stateRead: boolean;
  /** The default data folders that hold conversations and are not kept. */
  readonly notKept: ReadonlyArray<string>;
}

export class ShowRequests extends Context.Service<
  ShowRequests,
  {
    /** What the request reporter reports and how far, read and never written; it never calls the hub. */
    readonly execute: (
      paths: Paths,
      configuration: Configuration,
    ) => Effect.Effect<Shown>;
  }
>()("@cota/cli/ShowRequests") {}

export const layer: Layer.Layer<
  ShowRequests,
  never,
  Environment | Files | ClientRecords
> = Layer.effect(
  ShowRequests,
  Effect.gen(function* () {
    const { system, variables } = yield* Environment;
    const files = yield* Files;
    const records = yield* ClientRecords;
    const realOf = (folder: string) =>
      records.folder(folder).pipe(Effect.orElseSucceed(() => Option.none()));
    return ShowRequests.of({
      execute: Effect.fn("ShowRequests.execute")(
        function* (paths, configuration) {
          const kept = configuration.clients?.antigravity?.reported ?? [];
          const state = Requests.stateOf(
            yield* files
              .read(requestsFile(paths))
              .pipe(Effect.orElseSucceed(() => Option.none<string>())),
          );
          const folders = kept.map(({ folder, pool }): FolderShown => {
            const each = Option.flatMap(state, (read) =>
              Option.fromUndefinedOr(read.get(folder)),
            );
            return {
              folder,
              pool,
              through: Option.flatMap(each, (read) => read.through),
              ranAt: Option.flatMap(each, (read) => read.ranAt),
              notReported: Option.match(each, {
                onNone: () => [],
                onSome: (read) =>
                  [...read.conversations].flatMap(([conversation, cursor]) =>
                    Option.match(cursor.notReported, {
                      onNone: () => [],
                      onSome: ({ reason, step }) => [
                        { conversation, reason, step },
                      ],
                    }),
                  ),
              }),
            };
          });
          const keptReal = new Set<string>();
          for (const { folder } of kept) {
            keptReal.add(folder);
            const real = yield* realOf(folder);
            if (Option.isSome(real)) keptReal.add(real.value);
          }
          const notKept: Array<string> = [];
          for (const folder of Requests.defaultFoldersOf(system, variables)) {
            const real = yield* realOf(folder);
            if (Option.isNone(real) || keptReal.has(folder)) continue;
            if (keptReal.has(real.value)) continue;
            const separator = system === "win32" ? "\\" : "/";
            if (
              Option.isSome(yield* realOf(`${folder}${separator}conversations`))
            ) {
              notKept.push(folder);
            }
          }
          return { folders, stateRead: Option.isSome(state), notKept };
        },
      ),
    });
  }),
);
