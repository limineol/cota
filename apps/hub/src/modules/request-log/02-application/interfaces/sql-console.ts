import { Context, type Effect, Schema } from "effect";
import type * as Sql from "#modules/request-log/03-domain/sql.ts";

/**
 * SQL cannot run: the SQL user could not be made, does not have the
 * profile's settings and grant, or ClickHouse could not be reached. `detail`
 * says which, never with the hub's connection details.
 */
export class SqlUnavailable extends Schema.TaggedError<
  SqlUnavailable,
  { readonly brand: unique symbol }
>()("SqlUnavailable", { detail: Schema.String }) {}

/** ClickHouse refused or stopped the query; `detail` is its message without its version. */
export class QueryFailed extends Schema.TaggedError<
  QueryFailed,
  { readonly brand: unique symbol }
>()("QueryFailed", { detail: Schema.String }) {}

/** The query named a format of its own, which the hub cannot read. */
export class FormatNotAllowed extends Schema.TaggedError<
  FormatNotAllowed,
  { readonly brand: unique symbol }
>()("FormatNotAllowed", { format: Schema.String }) {}

/**
 * Runs text a caller wrote against the request log, as the SQL user, which
 * can only read the request log's database and cannot change a setting
 * (`docs/specs/sql/spec.md`).
 */
export class SqlConsole extends Context.Service<
  SqlConsole,
  {
    /** The text's answer, cut at the limits (X4, X5); nothing is sent while SQL is unavailable (X6). */
    readonly run: (
      sql: string,
    ) => Effect.Effect<
      Sql.Answer,
      SqlUnavailable | QueryFailed | FormatNotAllowed
    >;
    readonly schema: Effect.Effect<Sql.DatabaseSchema, SqlUnavailable>;
  }
>()("@cota/hub/request-log/SqlConsole") {}
