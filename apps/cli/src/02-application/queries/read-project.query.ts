import { Context, Effect, Layer, Option } from "effect";
import { Environment } from "#02-application/interfaces/environment.ts";
import { Files } from "#02-application/interfaces/files.ts";
import { Processes } from "#02-application/interfaces/processes.ts";
import * as Project from "#03-domain/project.ts";
import type { Variables } from "#03-domain/system.ts";
import { FindCommand } from "./find-command.query.ts";

export class ReadProject extends Context.Service<
  ReadProject,
  {
    /** The project of a launch in the working directory (`docs/specs/cli/spec.md`, The project). */
    readonly execute: (variables: Variables) => Effect.Effect<string>;
  }
>()("@cota/cli/ReadProject") {}

export const layer: Layer.Layer<
  ReadProject,
  never,
  Environment | Files | Processes | FindCommand
> = Layer.effect(
  ReadProject,
  Effect.gen(function* () {
    const { system, workingDirectory } = yield* Environment;
    const files = yield* Files;
    const processes = yield* Processes;
    const findCommand = yield* FindCommand;
    const separator = system === "win32" ? /[\\/]/ : /\//;
    const parts = workingDirectory
      .split(separator)
      .filter((part) => part !== "");
    const join = (each: ReadonlyArray<string>) =>
      system === "win32" ? each.join("\\") : `/${each.join("/")}`;

    /** The `origin` remote read from the repository's own files, for a machine without `git`. */
    const remoteFromFiles = Effect.gen(function* () {
      for (let depth = parts.length; depth >= 0; depth--) {
        const dotGit = join([...parts.slice(0, depth), ".git"]);
        const config = yield* files
          .read(`${dotGit}${system === "win32" ? "\\" : "/"}config`)
          .pipe(Effect.orElseSucceed(() => Option.none<string>()));
        if (Option.isSome(config)) return Project.originOfConfig(config.value);
        const worktree = yield* files
          .read(dotGit)
          .pipe(Effect.orElseSucceed(() => Option.none<string>()));
        if (Option.isSome(worktree)) {
          const gitdir = worktree.value.match(/^gitdir:\s*(.*?)\s*$/m)?.[1];
          if (gitdir === undefined) return Option.none<string>();
          const common = gitdir.replace(
            /[\\/]worktrees[\\/][^\\/]+[\\/]?$/,
            "",
          );
          const shared = yield* files
            .read(`${common}${system === "win32" ? "\\" : "/"}config`)
            .pipe(Effect.orElseSucceed(() => Option.none<string>()));
          return Option.flatMap(shared, Project.originOfConfig);
        }
      }
      return Option.none<string>();
    });

    return ReadProject.of({
      execute: Effect.fn("ReadProject.execute")(function* (
        variables: Variables,
      ) {
        const directory = parts.at(-1) ?? workingDirectory;
        const given = variables.COTA_PROJECT;
        if (given !== undefined && given.trim() !== "") {
          return Project.projectOf({ given, remote: Option.none(), directory });
        }
        const git = yield* findCommand.execute("git", variables, Option.none());
        const remote = Option.isSome(git)
          ? Option.map(
              yield* processes.output(
                git.value,
                ["remote", "get-url", "origin"],
                workingDirectory,
                variables,
              ),
              (output) => output.trim(),
            )
          : yield* remoteFromFiles;
        return Project.projectOf({ given, remote, directory });
      }),
    });
  }),
);
