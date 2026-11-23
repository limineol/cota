import { Context, Effect, Layer, Option, Result } from "effect";
import { ClientRecords } from "#02-application/interfaces/client-records.ts";
import { Files } from "#02-application/interfaces/files.ts";
import type { ReportedClient } from "#03-domain/client.ts";
import * as Configuration from "#03-domain/configuration.ts";
import { type Paths, requestsFile } from "#03-domain/paths.ts";
import * as Requests from "#03-domain/requests.ts";
import { FolderRefused } from "./add-reported-folder.command.ts";

export interface Removed {
  readonly said: ReadonlyArray<string>;
  /** Whether it was the configuration's last reported folder, whose schedule goes with it. */
  readonly last: boolean;
}

export class RemoveReportedFolder extends Context.Service<
  RemoveReportedFolder,
  {
    /** Forgets a kept data folder and its report cursors; what it reported stays on the hub. */
    readonly execute: (
      paths: Paths,
      configuration: Configuration.Configuration,
      asked: { readonly client: ReportedClient; readonly folder: string },
    ) => Effect.Effect<Removed, FolderRefused>;
  }
>()("@cota/cli/RemoveReportedFolder") {}

export const layer: Layer.Layer<
  RemoveReportedFolder,
  never,
  Files | ClientRecords
> = Layer.effect(
  RemoveReportedFolder,
  Effect.gen(function* () {
    const files = yield* Files;
    const records = yield* ClientRecords;
    const realOf = (folder: string) =>
      records.folder(folder).pipe(Effect.orElseSucceed(() => Option.none()));
    return RemoveReportedFolder.of({
      execute: Effect.fn("RemoveReportedFolder.execute")(function* (
        paths,
        configuration,
        { folder },
      ) {
        const kept = configuration.clients?.antigravity?.reported ?? [];
        const real = yield* realOf(folder);
        let found: Option.Option<Configuration.ReportedFolder> = Option.none();
        for (const each of kept) {
          if (
            each.folder === folder ||
            (Option.isSome(real) &&
              Option.contains(yield* realOf(each.folder), real.value))
          ) {
            found = Option.some(each);
          }
        }
        if (Option.isNone(found)) {
          return yield* new FolderRefused({
            problem: `${folder} is not a reported data folder; cota requests show lists them`,
          });
        }
        const gone = found.value;
        const folders = kept.filter((each) => each !== gone);
        yield* files
          .write(
            paths.configurationFile,
            Configuration.textOf(Requests.withFolders(configuration, folders)),
            0o600,
          )
          .pipe(
            Effect.mapError(
              (error) =>
                new FolderRefused({
                  problem: `${error.path} cannot be written: ${error.reason}`,
                }),
            ),
          );
        const said = [
          `cota: ${gone.folder} is no longer reported; what it reported stays on the hub.`,
        ];
        const stateFile = requestsFile(paths);
        const state = Requests.stateOf(
          yield* files
            .read(stateFile)
            .pipe(Effect.orElseSucceed(() => Option.none<string>())),
        );
        if (Option.isSome(state) && state.value.has(gone.folder)) {
          const without = new Map(state.value);
          without.delete(gone.folder);
          const written = yield* Effect.result(
            files.write(stateFile, Requests.textOf(without), 0o600),
          );
          if (Result.isFailure(written)) {
            said.push(
              `cota: ${written.failure.path} cannot be written (${written.failure.reason}); its report cursors for ${gone.folder} are forgotten when it is next written.`,
            );
          }
        }
        return { said, last: folders.length === 0 };
      }),
    });
  }),
);
