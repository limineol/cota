import { Schema } from "effect";
import {
  HttpApiEndpoint,
  HttpApiError,
  HttpApiGroup,
  HttpApiMiddleware,
} from "effect/http-api";
import {
  CallerMiddleware,
  mayCall,
} from "#shared/01-presentation/caller.middleware.ts";
import { JsonBody } from "#shared/01-presentation/json-body.middleware.ts";

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export class QueryTooLongProblem extends HttpApiError.Problem<QueryTooLongProblem>()(
  "QueryTooLongProblem",
  {
    type: "urn:cota:query-too-long",
    status: 400,
    title: "The SQL is longer than 100,000 characters.",
  },
) {}

export class QueryFailedProblem extends HttpApiError.Problem<QueryFailedProblem>()(
  "QueryFailedProblem",
  {
    type: "urn:cota:query-failed",
    status: 400,
    title: "ClickHouse refused or stopped the query.",
  },
) {}

export class FormatNotAllowedProblem extends HttpApiError.Problem<FormatNotAllowedProblem>()(
  "FormatNotAllowedProblem",
  {
    type: "urn:cota:format-not-allowed",
    status: 400,
    title: "The query names its own FORMAT; leave the format to the hub.",
  },
) {}

export class SqlUnavailableProblem extends HttpApiError.Problem<SqlUnavailableProblem>()(
  "SqlUnavailableProblem",
  {
    type: "urn:cota:sql-unavailable",
    status: 503,
    title: "SQL is unavailable.",
  },
) {}

export const Column = Schema.Struct({
  name: Schema.String,
  type: Schema.String,
}).annotate({ identifier: "Column" });

export const SqlAnswer = Schema.Struct({
  columns: Schema.Array(Column),
  rows: Schema.Array(Schema.Array(Schema.Json)),
  truncated: Schema.Boolean.annotate({
    description:
      "Whether the query had rows the answer does not hold: an answer stops at the hub's limits, by default 5,000 rows or 16 MiB of them.",
  }),
  elapsedMs: Count,
}).annotate({ identifier: "SqlAnswer" });

export const TableColumn = Schema.Struct({
  name: Schema.String,
  type: Schema.String,
  comment: Schema.String,
}).annotate({ identifier: "TableColumn" });

export const Table = Schema.Struct({
  name: Schema.String,
  engine: Schema.String,
  rows: Schema.NullOr(Count),
  bytes: Schema.NullOr(Count),
  comment: Schema.String,
  columns: Schema.Array(TableColumn),
}).annotate({ identifier: "Table" });

export const DatabaseSchema = Schema.Struct({
  database: Schema.String,
  tables: Schema.Array(Table),
}).annotate({ identifier: "DatabaseSchema" });

const sql = HttpApiEndpoint.post("sql", "/sql", {
  payload: Schema.Struct({ sql: Schema.NonEmptyString }),
  success: SqlAnswer,
  error: [
    QueryTooLongProblem,
    QueryFailedProblem,
    FormatNotAllowedProblem,
    SqlUnavailableProblem,
  ],
}).annotateMerge(mayCall("reader"));

const schema = HttpApiEndpoint.get("schema", "/schema", {
  success: DatabaseSchema,
  error: [SqlUnavailableProblem],
}).annotateMerge(mayCall("reader"));

/** Read-only SQL over the request log, as the SQL user (`docs/specs/sql/spec.md`). */
export const group = HttpApiGroup.make("sql")
  .add(sql)
  .add(schema)
  .middleware(CallerMiddleware)
  .middleware(JsonBody)
  .middleware(HttpApiMiddleware.ProblemDetails)
  .prefix("/api");
