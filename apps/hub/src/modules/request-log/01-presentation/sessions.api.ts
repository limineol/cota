import { Schema } from "effect";
import {
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
} from "effect/http-api";
import { RequestRole } from "#modules/request-log/03-domain/request-role.ts";
import * as Search from "#modules/request-log/03-domain/search.ts";
import * as Session from "#modules/request-log/03-domain/session.ts";
import { Origin } from "#modules/request-log/03-domain/stored-protocol.ts";
import {
  CallerMiddleware,
  mayCall,
} from "#shared/01-presentation/caller.middleware.ts";
import { JsonBody } from "#shared/01-presentation/json-body.middleware.ts";
import { Money } from "#shared/01-presentation/money.ts";
import { RequestLogProblem } from "#shared/01-presentation/problems.ts";
import { Outcome, RequestId } from "#shared/03-domain/request.entity.ts";
import { charactersOf } from "#shared/03-domain/text.ts";
import { filterFields, toleranceFields } from "./filters.ts";
import { EmptyWindowProblem, NoSuchSessionProblem } from "./problems.ts";
import { Transcript } from "./requests.api.ts";
import { Snippet } from "./search.api.ts";
import { Usage } from "./traffic.api.ts";

const Time = Schema.DateTimeUtcFromString;
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Values = Schema.Array(Schema.String);

export const Title = Schema.Struct({
  text: Schema.String,
  source: Schema.Literals(["reported", "generated"]),
  at: Time,
  machine: Schema.NullOr(Schema.String),
}).annotate({ identifier: "Title" });

export const SessionRow = Schema.Struct({
  id: Schema.String,
  startedAt: Time,
  endedAt: Time,
  requests: Count,
  errors: Count,
  pools: Values,
  projects: Values,
  machines: Values,
  clients: Values,
  providers: Values,
  models: Values,
  origins: Schema.Array(Origin),
  usage: Usage,
  usageUnreported: Count,
  costUsd: Money,
  unpricedRequests: Count,
  title: Schema.NullOr(Title),
  firstPrompt: Schema.NullOr(Schema.String),
}).annotate({ identifier: "SessionRow" });

export const ListedSessionRow = Schema.Struct({
  ...SessionRow.fields,
  snippet: Schema.NullOr(Snippet),
}).annotate({ identifier: "ListedSessionRow" });

export const Sessions = Schema.Struct({
  sessions: Schema.Array(ListedSessionRow),
  total: Count,
  limit: Count,
  offset: Count,
}).annotate({ identifier: "Sessions" });

const sessions = HttpApiEndpoint.get("sessions", "/sessions", {
  query: {
    ...filterFields,
    q: Schema.optional(Search.SearchQuery),
    ...toleranceFields,
    sort: Schema.optional(Session.SessionOrder),
    limit: Schema.optional(
      Schema.Int.check(
        Schema.isBetween({ minimum: 1, maximum: Session.paging.mostLimit }),
      ),
    ),
    offset: Schema.optional(
      Schema.Int.check(
        Schema.isBetween({ minimum: 0, maximum: Session.paging.mostOffset }),
      ),
    ),
  },
  success: Sessions,
  error: [EmptyWindowProblem, RequestLogProblem],
}).annotateMerge(mayCall("reader"));

export const RequestSummary = Schema.Struct({
  id: RequestId,
  startedAt: Time,
  origin: Origin,
  requestRole: RequestRole,
  segment: Schema.NullOr(Count),
  operation: Schema.String,
  purpose: Schema.String,
  model: Schema.String,
  servedModel: Schema.String,
  stopReason: Schema.String,
  outcome: Outcome,
  upstreamStatus: Count,
  errorType: Schema.String,
  promptSize: Schema.NullOr(Count),
  outputTokens: Schema.NullOr(Count),
  costUsd: Schema.NullOr(Money),
  durationMs: Count,
  firstByteMs: Schema.NullOr(Count),
  tools: Schema.NullOr(Count),
  divertedFrom: Schema.NullOr(Schema.String),
  follows: Schema.NullOr(RequestId),
}).annotate({ identifier: "RequestSummary" });

export const Segment = Schema.Struct({
  index: Count,
  startedBy: Schema.Literals(["start", "size", "compaction"]),
  firstRequest: RequestId,
  lastRequest: RequestId,
  tip: RequestId,
  startedAt: Time,
  endedAt: Time,
  requests: Count,
  promptSize: Schema.NullOr(Count),
}).annotate({ identifier: "Segment" });

export const SessionDetail = Schema.Struct({
  session: SessionRow,
  requests: Schema.Array(RequestSummary),
  requestsCut: Count,
  segments: Schema.Array(Segment),
  transcript: Schema.NullOr(Transcript),
}).annotate({ identifier: "SessionDetail" });

const session = HttpApiEndpoint.get("session", "/sessions/:session", {
  params: { session: Schema.String },
  success: SessionDetail,
  error: [NoSuchSessionProblem, RequestLogProblem],
}).annotateMerge(mayCall("reader"));

// A record drops, rather than rejects, a key its key schema does not take, so
// the session ids are checked on the record itself.
const longestSessionId = 255;

const reportTitles = HttpApiEndpoint.put("reportTitles", "/session-titles", {
  headers: { "x-cota-machine": Schema.optional(Schema.String) },
  payload: Schema.Struct({
    titles: Schema.Record(Schema.String, Schema.String).check(
      Schema.isMinProperties(1),
      Schema.isMaxProperties(1000),
      Schema.makeFilter(
        (titles) =>
          Object.keys(titles).every(
            (session) =>
              charactersOf(session) >= 1 &&
              charactersOf(session) <= longestSessionId,
          ),
        { expected: "session ids of 1 to 255 characters" },
      ),
    ),
  }),
  success: HttpApiSchema.NoContent,
  error: RequestLogProblem,
}).annotateMerge(mayCall("any-hub-key"));

/** The sessions of the request log, and the titles machines report for them (`docs/specs/api/spec.md`). */
export const group = HttpApiGroup.make("sessions")
  .add(sessions, session, reportTitles)
  .middleware(CallerMiddleware)
  .middleware(JsonBody)
  .middleware(HttpApiMiddleware.ProblemDetails)
  .prefix("/api");
