import { Context, Effect, Layer, Schema } from "effect";
import { Files } from "#02-application/interfaces/files.ts";
import { LocateFiles } from "#02-application/queries/locate-files.query.ts";
import { isPoolId } from "#03-domain/machine.ts";
import { loginFile } from "#03-domain/paths.ts";

export class LogoutFailed extends Schema.TaggedError<
  LogoutFailed,
  { readonly brand: unique symbol }
>()("LogoutFailed", { problem: Schema.String }) {}

export class RemoveMachineLogin extends Context.Service<
  RemoveMachineLogin,
  {
    /** Removes the machine login of a pool, and says whether there was one. */
    readonly execute: (pool: string) => Effect.Effect<boolean, LogoutFailed>;
  }
>()("@cota/cli/RemoveMachineLogin") {}

export const layer: Layer.Layer<
  RemoveMachineLogin,
  never,
  Files | LocateFiles
> = Layer.effect(
  RemoveMachineLogin,
  Effect.gen(function* () {
    const files = yield* Files;
    const locate = yield* LocateFiles;
    return RemoveMachineLogin.of({
      execute: Effect.fn("RemoveMachineLogin.execute")(function* (
        pool: string,
      ) {
        if (!isPoolId(pool)) {
          return yield* new LogoutFailed({
            problem: `${pool} is not a pool's id: letters, digits, '.', '_', '~' and '-', starting with a letter or digit`,
          });
        }
        const paths = yield* locate.execute.pipe(
          Effect.mapError(
            (error) =>
              new LogoutFailed({
                problem: `where the configuration is cannot be known: ${error.variable} is not set`,
              }),
          ),
        );
        return yield* files.remove(loginFile(paths, pool)).pipe(
          Effect.mapError(
            (error) =>
              new LogoutFailed({
                problem: `${error.path} could not be removed: ${error.reason}`,
              }),
          ),
        );
      }),
    });
  }),
);
