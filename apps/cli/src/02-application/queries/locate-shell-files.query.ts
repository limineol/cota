import { Context, Effect, Layer, Option } from "effect";
import { Environment } from "#02-application/interfaces/environment.ts";
import { Files } from "#02-application/interfaces/files.ts";
import { DirectoryUnknown } from "#03-domain/paths.ts";
import * as Shims from "#03-domain/shims.ts";

/** The files of the owner's shells that `cota`'s `PATH` line goes in. */
export interface ShellFiles {
  readonly shell: Shims.Shell;
  /** The files of `$SHELL` that hold the line: none for fish, whose file is `fish`. */
  readonly lineFiles: ReadonlyArray<string>;
  /** `cota`'s own file in fish's `conf.d`. */
  readonly fish: string;
  /** Every file `cota` may have written its line to, whatever the shell, for removing it. */
  readonly everyLineFile: ReadonlyArray<string>;
}

export class LocateShellFiles extends Context.Service<
  LocateShellFiles,
  {
    /**
     * zsh's `~/.zshrc`; bash's `~/.bashrc`, and the first of
     * `~/.bash_profile`, `~/.bash_login` and `~/.profile` that exists when it
     * does not read `~/.bashrc`; another POSIX shell's `~/.profile`; and
     * fish's `conf.d/cota.fish` (`docs/specs/cli/spec.md`, Shims).
     */
    readonly execute: Effect.Effect<ShellFiles, DirectoryUnknown>;
  }
>()("@cota/cli/LocateShellFiles") {}

export const layer: Layer.Layer<LocateShellFiles, never, Environment | Files> =
  Layer.effect(
    LocateShellFiles,
    Effect.gen(function* () {
      const { variables } = yield* Environment;
      const files = yield* Files;
      return LocateShellFiles.of({
        execute: Effect.gen(function* () {
          const home = (variables.HOME ?? "").replace(/\/+$/, "");
          if (!home.startsWith("/")) {
            return yield* new DirectoryUnknown({ variable: "HOME" });
          }
          const config = variables.XDG_CONFIG_HOME?.startsWith("/")
            ? variables.XDG_CONFIG_HOME.replace(/\/+$/, "")
            : `${home}/.config`;
          const inHome = (name: string) => `${home}/${name}`;
          const shell = Shims.shellOf(variables.SHELL);
          const readOrNone = (path: string) =>
            files
              .read(path)
              .pipe(Effect.orElseSucceed(() => Option.none<string>()));
          const lineFiles: Array<string> = [];
          switch (shell) {
            case "zsh":
              lineFiles.push(inHome(".zshrc"));
              break;
            case "bash": {
              lineFiles.push(inHome(".bashrc"));
              for (const name of Shims.bashLoginFiles) {
                const text = yield* readOrNone(inHome(name));
                if (Option.isNone(text)) continue;
                if (!Shims.readsBashrc(text.value))
                  lineFiles.push(inHome(name));
                break;
              }
              break;
            }
            case "posix":
              lineFiles.push(inHome(".profile"));
              break;
            case "fish":
              break;
          }
          return {
            shell,
            lineFiles,
            fish: `${config}/fish/conf.d/cota.fish`,
            everyLineFile: [".zshrc", ".bashrc", ...Shims.bashLoginFiles].map(
              inHome,
            ),
          };
        }),
      });
    }),
  );
