import { Effect, Option } from "effect";
import type { HttpApiBuilder } from "effect/http-api";
import type { SqlUnavailable } from "#modules/request-log/02-application/interfaces/sql-console.ts";
import { ReadSchema } from "#modules/request-log/02-application/queries/read-schema.query.ts";
import { RunSql } from "#modules/request-log/02-application/queries/run-sql.query.ts";
import * as Sql from "#modules/request-log/03-domain/sql.ts";
import {
  FormatNotAllowedProblem,
  type group,
  QueryFailedProblem,
  QueryTooLongProblem,
  SqlUnavailableProblem,
} from "./sql.api.ts";

const unavailable = ({ detail }: SqlUnavailable) =>
  Effect.fail(new SqlUnavailableProblem({ detail }));

export const build = (
  handlers: HttpApiBuilder.Handlers.FromGroup<typeof group>,
) =>
  Effect.gen(function* () {
    const runSql = yield* RunSql;
    const readSchema = yield* ReadSchema;

    return handlers
      .handle("sql", ({ payload }) =>
        runSql.execute(payload.sql).pipe(
          Effect.catchTags({
            QueryTooLong: ({ characters }) =>
              Effect.fail(
                new QueryTooLongProblem({
                  detail: `The SQL is ${characters} characters long; at most ${Sql.longestText} are run.`,
                }),
              ),
            QueryFailed: ({ detail }) =>
              Effect.fail(new QueryFailedProblem({ detail })),
            FormatNotAllowed: ({ format }) =>
              Effect.fail(
                new FormatNotAllowedProblem({
                  detail: `ClickHouse answered in ${format}; remove the query's FORMAT clause, and the hub reads the answer as JSON.`,
                }),
              ),
            SqlUnavailable: unavailable,
          }),
        ),
      )
      .handle("schema", () =>
        Effect.gen(function* () {
          const schema = yield* readSchema.execute;
          return {
            database: schema.database,
            tables: schema.tables.map((table) => ({
              ...table,
              rows: Option.getOrNull(table.rows),
              bytes: Option.getOrNull(table.bytes),
            })),
          };
        }).pipe(Effect.catchTag("SqlUnavailable", unavailable)),
      );
  });
