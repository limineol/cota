import { Schema } from "effect";
import {
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
} from "effect/http-api";
import * as Search from "#modules/request-log/03-domain/search.ts";
import {
  CallerMiddleware,
  mayCall,
} from "#shared/01-presentation/caller.middleware.ts";
import { JsonBody } from "#shared/01-presentation/json-body.middleware.ts";
import { RequestLogProblem } from "#shared/01-presentation/problems.ts";
import { Part } from "#shared/03-domain/conversation.ts";
import { RequestId } from "#shared/03-domain/request.entity.ts";
import { filterFields, toleranceFields } from "./filters.ts";
import { EmptyWindowProblem, StaleCursorProblem } from "./problems.ts";

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const Snippet = Schema.Struct({
  text: Schema.String,
  start: Count,
}).annotate({ identifier: "Snippet" });

export const Hit = Schema.Struct({
  session: Schema.String,
  item: Schema.String,
  request: RequestId,
  part: Part,
  role: Schema.String,
  at: Schema.DateTimeUtcFromString,
  snippet: Snippet,
}).annotate({ identifier: "Hit" });

export const Hits = Schema.Struct({
  hits: Schema.Array(Hit),
  next: Schema.NullOr(Schema.String),
}).annotate({ identifier: "Hits" });

const search = HttpApiEndpoint.get("search", "/search", {
  query: {
    ...filterFields,
    q: Search.SearchQuery,
    ...toleranceFields,
    limit: Schema.optional(
      Schema.Int.check(
        Schema.isBetween({ minimum: 1, maximum: Search.paging.mostLimit }),
      ),
    ),
    cursor: Schema.optional(
      Schema.String.check(Schema.isMaxLength(Search.longestCursor)),
    ),
  },
  success: Hits,
  error: [EmptyWindowProblem, StaleCursorProblem, RequestLogProblem],
}).annotateMerge(mayCall("reader"));

/** Searching the request log's conversation items for words (`docs/specs/search/spec.md`). */
export const group = HttpApiGroup.make("search")
  .add(search)
  .middleware(CallerMiddleware)
  .middleware(JsonBody)
  .middleware(HttpApiMiddleware.ProblemDetails)
  .prefix("/api");
