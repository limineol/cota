import { Context, Effect, Layer, Option } from "effect";
import { Environment } from "#02-application/interfaces/environment.ts";
import { Files } from "#02-application/interfaces/files.ts";
import { StepFailed } from "#02-application/interfaces/machine-steps.ts";
import { UserPath } from "#02-application/interfaces/user-path.ts";
import { LocateShellFiles } from "#02-application/queries/locate-shell-files.query.ts";
import * as Client from "#03-domain/client.ts";
import type { Paths } from "#03-domain/paths.ts";
import * as Shims from "#03-domain/shims.ts";
import * as UserPathEntries from "#03-domain/user-path.ts";

export class RemoveShims extends Context.Service<
  RemoveShims,
  {
    /** Removes the shims of `cota`'s, and `cota`'s `PATH` line, file or `Path` entry, and nothing else; it says what it removed. */
    readonly execute: (
      paths: Paths,
    ) => Effect.Effect<ReadonlyArray<string>, StepFailed>;
  }
>()("@cota/cli/RemoveShims") {}

export const layer: Layer.Layer<
  RemoveShims,
  never,
  Environment | Files | UserPath | LocateShellFiles
> = Layer.effect(
  RemoveShims,
  Effect.gen(function* () {
    const { system } = yield* Environment;
    const files = yield* Files;
    const userPath = yield* UserPath;
    const locateShellFiles = yield* LocateShellFiles;

    return RemoveShims.of({
      execute: Effect.fn("RemoveShims.execute")(function* (paths: Paths) {
        const said: Array<string> = [];
        yield* Effect.gen(function* () {
          let removed = false;
          for (const command of Client.commands) {
            const file = `${paths.shims}${paths.separator}${Shims.shimOf(system, "", command).name}`;
            const head = yield* files.head(file, Shims.shimHeadBytes);
            if (Option.exists(head, Shims.isShim)) {
              removed = (yield* files.remove(file)) || removed;
            }
          }
          if ((yield* files.list(paths.shims)).length === 0) {
            yield* files.remove(paths.shims);
          }
          if (removed)
            said.push(`cota: removed the shims from ${paths.shims}.`);
          if (system === "win32") {
            const path = yield* userPath.read;
            const others = UserPathEntries.withoutShims(path, paths.shims);
            if (others !== path) {
              yield* userPath.write(others);
              said.push(`cota: removed ${paths.shims} from the user's Path.`);
            }
            return;
          }
          const shellFiles = yield* locateShellFiles.execute;
          for (const file of shellFiles.everyLineFile) {
            const text = yield* files.read(file);
            if (Option.isNone(text)) continue;
            const left = Shims.withoutPathLine(text.value);
            if (left === text.value) continue;
            const mode = Option.getOrElse(
              yield* files.modeOf(file),
              () => 0o644,
            );
            yield* files.write(file, left, mode);
            said.push(`cota: removed cota's PATH line from ${file}.`);
          }
          if (yield* files.remove(shellFiles.fish)) {
            said.push(`cota: removed ${shellFiles.fish}.`);
          }
        }).pipe(
          Effect.catchTags({
            FilesFailed: (error) =>
              Effect.fail(
                new StepFailed({
                  problem: `${error.path} could not be removed: ${error.reason}`,
                }),
              ),
            UserPathFailed: (error) =>
              Effect.fail(new StepFailed({ problem: error.reason })),
            DirectoryUnknown: (error) =>
              Effect.fail(
                new StepFailed({
                  problem: `where the shell's files are cannot be known: ${error.variable} is not set`,
                }),
              ),
          }),
        );
        return said;
      }),
    });
  }),
);
