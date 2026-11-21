import { Context, Effect, Layer } from "effect";
import {
  type FormatNotAllowed,
  type QueryFailed,
  SqlConsole,
  type SqlUnavailable,
} from "#modules/request-log/02-application/interfaces/sql-console.ts";
import * as Sql from "#modules/request-log/03-domain/sql.ts";
import { charactersOf } from "#shared/03-domain/text.ts";

export class RunSql extends Context.Service<
  RunSql,
  {
    readonly execute: (
      sql: string,
    ) => Effect.Effect<
      Sql.Answer,
      Sql.QueryTooLong | SqlUnavailable | QueryFailed | FormatNotAllowed
    >;
  }
>()("@cota/hub/request-log/RunSql") {}

export const layer = Layer.effect(
  RunSql,
  Effect.gen(function* () {
    const console = yield* SqlConsole;
    return RunSql.of({
      execute: Effect.fn("RunSql.execute")(function* (sql: string) {
        const characters = charactersOf(sql);
        if (characters > Sql.longestText) {
          return yield* new Sql.QueryTooLong({ characters });
        }
        return yield* console.run(sql);
      }),
    });
  }),
);
