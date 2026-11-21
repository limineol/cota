import { Context, Effect, Layer, Option, Redacted } from "effect";
import { Files, type FilesFailed } from "#02-application/interfaces/files.ts";
import { loginFile, type Paths } from "#03-domain/paths.ts";

export class ReadMachineLogins extends Context.Service<
  ReadMachineLogins,
  {
    /** The machine logins, by pool, each trimmed; a file that holds only spaces is none. */
    readonly execute: (
      paths: Paths,
    ) => Effect.Effect<
      ReadonlyMap<string, Redacted.Redacted<string>>,
      FilesFailed
    >;
  }
>()("@cota/cli/ReadMachineLogins") {}

export const layer: Layer.Layer<ReadMachineLogins, never, Files> = Layer.effect(
  ReadMachineLogins,
  Effect.gen(function* () {
    const files = yield* Files;
    return ReadMachineLogins.of({
      execute: Effect.fn("ReadMachineLogins.execute")(function* (paths: Paths) {
        const logins = new Map<string, Redacted.Redacted<string>>();
        for (const pool of yield* files.list(paths.logins)) {
          const text = yield* files.read(loginFile(paths, pool));
          const login = Option.getOrElse(text, () => "").trim();
          if (login !== "") logins.set(pool, Redacted.make(login));
        }
        return logins;
      }),
    });
  }),
);
