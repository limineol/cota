import { Context, Effect, Layer, Option } from "effect";
import { Environment } from "#02-application/interfaces/environment.ts";
import { Files } from "#02-application/interfaces/files.ts";
import { pathWithout } from "#03-domain/launch.ts";
import { isShim, shimHeadBytes } from "#03-domain/shims.ts";
import type { Variables } from "#03-domain/system.ts";

export class FindCommand extends Context.Service<
  FindCommand,
  {
    /**
     * The first file named for a command on `PATH`, `PATH` lacking the shims'
     * directory, that this user may run and that is not a shim of `cota`'s; on
     * Windows each of `PATHEXT`'s extensions is tried, `.exe` before `.cmd`.
     */
    readonly execute: (
      command: string,
      variables: Variables,
      shims: Option.Option<string>,
    ) => Effect.Effect<Option.Option<string>>;
  }
>()("@cota/cli/FindCommand") {}

const windowsExtensions = (pathext: string | undefined) => {
  const listed = (pathext ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .filter((extension) => extension !== "")
    .map((extension) => extension.toLowerCase());
  return [
    ...listed.filter((extension) => extension === ".exe"),
    ...listed.filter((extension) => extension !== ".exe"),
  ];
};

export const layer: Layer.Layer<FindCommand, never, Environment | Files> =
  Layer.effect(
    FindCommand,
    Effect.gen(function* () {
      const { system } = yield* Environment;
      const files = yield* Files;
      const separator = system === "win32" ? "\\" : "/";
      return FindCommand.of({
        execute: Effect.fn("FindCommand.execute")(function* (
          command: string,
          variables: Variables,
          shims: Option.Option<string>,
        ) {
          const directories = pathWithout(
            system,
            variables.PATH ?? variables.Path ?? "",
            Option.getOrElse(shims, () => ""),
          );
          const names =
            system === "win32"
              ? windowsExtensions(variables.PATHEXT).map(
                  (extension) => `${command}${extension}`,
                )
              : [command];
          for (const directory of directories) {
            for (const name of names) {
              const path = `${directory.replace(/[\\/]+$/, "")}${separator}${name}`;
              if (!(yield* files.executable(path))) continue;
              const head = yield* files
                .head(path, shimHeadBytes)
                .pipe(Effect.orElseSucceed(() => Option.none<string>()));
              if (Option.exists(head, isShim)) continue;
              return Option.some(path);
            }
          }
          return Option.none<string>();
        }),
      });
    }),
  );
