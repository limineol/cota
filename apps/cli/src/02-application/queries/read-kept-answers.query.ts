import { Context, Effect, Layer, Option, Result } from "effect";
import { Files, type FilesFailed } from "#02-application/interfaces/files.ts";
import { keptAnswersFile, type Paths } from "#03-domain/paths.ts";
import * as Route from "#03-domain/route.ts";

/** The answers kept in `routes.json`, and why the file does not read when it does not: it is then as if empty. */
export interface Kept {
  readonly file: string;
  readonly answers: ReadonlyArray<Route.KeptAnswer>;
  readonly problem: Option.Option<string>;
}

export class ReadKeptAnswers extends Context.Service<
  ReadKeptAnswers,
  {
    readonly execute: (paths: Paths) => Effect.Effect<Kept, FilesFailed>;
  }
>()("@cota/cli/ReadKeptAnswers") {}

export const layer: Layer.Layer<ReadKeptAnswers, never, Files> = Layer.effect(
  ReadKeptAnswers,
  Effect.gen(function* () {
    const files = yield* Files;
    return ReadKeptAnswers.of({
      execute: Effect.fn("ReadKeptAnswers.execute")(function* (paths: Paths) {
        const file = keptAnswersFile(paths);
        const text = yield* files.read(file);
        if (Option.isNone(text)) {
          return { file, answers: [], problem: Option.none() };
        }
        const decoded = Route.decodeKept(text.value);
        return Result.isSuccess(decoded)
          ? { file, answers: decoded.success, problem: Option.none() }
          : { file, answers: [], problem: Option.some(decoded.failure) };
      }),
    });
  }),
);
