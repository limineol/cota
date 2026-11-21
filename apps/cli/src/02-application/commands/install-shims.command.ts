import { Context, Effect, Layer, Option, Result } from "effect";
import { Environment } from "#02-application/interfaces/environment.ts";
import { Files } from "#02-application/interfaces/files.ts";
import { StepFailed } from "#02-application/interfaces/machine-steps.ts";
import { UserPath } from "#02-application/interfaces/user-path.ts";
import { LocateShellFiles } from "#02-application/queries/locate-shell-files.query.ts";
import { ReadConfiguration } from "#02-application/queries/read-configuration.query.ts";
import * as Client from "#03-domain/client.ts";
import * as Configuration from "#03-domain/configuration.ts";
import type { Paths } from "#03-domain/paths.ts";
import * as Shims from "#03-domain/shims.ts";
import * as UserPathEntries from "#03-domain/user-path.ts";

export class InstallShims extends Context.Service<
  InstallShims,
  {
    /**
     * Writes a shim per client in the shims' directory and puts the
     * directory first on `PATH` (`docs/specs/cli/spec.md`, Shims), changing
     * only what is not so already, and says what it changed.
     */
    readonly execute: (
      paths: Paths,
    ) => Effect.Effect<ReadonlyArray<string>, StepFailed>;
  }
>()("@cota/cli/InstallShims") {}

const fileMode = 0o644;
const programMode = 0o755;

export const layer: Layer.Layer<
  InstallShims,
  never,
  Environment | Files | UserPath | LocateShellFiles | ReadConfiguration
> = Layer.effect(
  InstallShims,
  Effect.gen(function* () {
    const { system, program } = yield* Environment;
    const files = yield* Files;
    const userPath = yield* UserPath;
    const locateShellFiles = yield* LocateShellFiles;
    const readConfiguration = yield* ReadConfiguration;

    /** A machine joined with `--no-shims` has them again: its configuration no longer says it has none. */
    const recordShims = Effect.fn(function* (paths: Paths) {
      const read = yield* Effect.result(readConfiguration.execute(paths));
      if (Result.isFailure(read) || read.success.shims !== false) return false;
      const { shims: _, ...withShims } = read.success;
      yield* files.write(
        paths.configurationFile,
        Configuration.textOf(withShims),
        0o600,
      );
      return true;
    });

    const writeIfChanged = Effect.fn(function* (
      path: string,
      text: string,
      mode: (before: Option.Option<number>) => number,
    ) {
      const before = yield* files.read(path);
      if (Option.contains(before, text)) return false;
      yield* files.write(path, text, mode(yield* files.modeOf(path)));
      return true;
    });

    const putFirstOnUserPath = Effect.fn(function* (shims: string) {
      const path = yield* userPath.read;
      const first = UserPathEntries.withShimsFirst(path, shims);
      if (first === path) return false;
      yield* userPath.write(first);
      return true;
    });

    return InstallShims.of({
      execute: Effect.fn("InstallShims.execute")(function* (paths: Paths) {
        const said: Array<string> = [];
        yield* Effect.gen(function* () {
          yield* files.makeDirectory(paths.shims, programMode);
          const written: Array<boolean> = [];
          for (const command of Client.commands) {
            const shim = Shims.shimOf(system, program, command);
            written.push(
              yield* writeIfChanged(
                `${paths.shims}${paths.separator}${shim.name}`,
                shim.text,
                () => programMode,
              ),
            );
          }
          if (written.includes(true)) {
            said.push(
              `cota: wrote the shims of claude, codex, opencode and pi in ${paths.shims}.`,
            );
          }
          if (yield* recordShims(paths)) {
            said.push(
              `cota: ${paths.configurationFile} no longer says this machine has no shims.`,
            );
          }
          if (system === "win32") {
            if (yield* putFirstOnUserPath(paths.shims)) {
              said.push(
                `cota: the user's Path now starts with ${paths.shims}; a new terminal finds the shims.`,
              );
            }
            return;
          }
          const shellFiles = yield* locateShellFiles.execute;
          const line = Shims.pathLineOf(paths.shims);
          for (const file of shellFiles.lineFiles) {
            const text = Option.getOrElse(yield* files.read(file), () => "");
            if (
              yield* writeIfChanged(
                file,
                Shims.withPathLineLast(text, line),
                (mode) => Option.getOrElse(mode, () => fileMode),
              )
            ) {
              said.push(
                `cota: ${file} now puts ${paths.shims} first on PATH, in its last line; a new shell finds the shims.`,
              );
            }
          }
          if (shellFiles.shell === "fish") {
            yield* files.makeDirectory(
              shellFiles.fish.slice(0, shellFiles.fish.lastIndexOf("/")),
              programMode,
            );
            if (
              yield* writeIfChanged(
                shellFiles.fish,
                Shims.fishFileOf(paths.shims),
                () => fileMode,
              )
            ) {
              said.push(
                `cota: ${shellFiles.fish} now puts ${paths.shims} first on PATH; a new shell finds the shims.`,
              );
            }
          }
        }).pipe(
          Effect.catchTags({
            FilesFailed: (error) =>
              Effect.fail(
                new StepFailed({
                  problem: `${error.path} could not be written: ${error.reason}`,
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
        return said.length === 0
          ? ["cota: the shims and their PATH line were in place already."]
          : said;
      }),
    });
  }),
);
