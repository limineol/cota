import { Schema } from "effect";
import {
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
} from "effect/http-api";
import {
  CallerMiddleware,
  mayCall,
} from "#shared/01-presentation/caller.middleware.ts";
import { ReportBody } from "#shared/01-presentation/json-body.middleware.ts";
import {
  HubStoreProblem,
  NoSuchPoolProblem,
  RequestLogProblem,
} from "#shared/01-presentation/problems.ts";
import { ReportedClient } from "#shared/03-domain/client.ts";
import { PoolId } from "#shared/03-domain/ids.ts";
import { charactersOf } from "#shared/03-domain/text.ts";
import {
  PoolNotObservedProblem,
  ReportOutOfOrderProblem,
  ReportRefusedProblem,
} from "./problems.ts";

const Time = Schema.DateTimeUtcFromString;
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const Text = (shortest: number, longest: number) =>
  Schema.String.check(
    Schema.makeFilter(
      (text: string) =>
        charactersOf(text) >= shortest && charactersOf(text) <= longest,
      { expected: `a string of ${shortest} to ${longest} characters` },
    ),
  );

const Tokens = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: 4_294_967_295 }),
);

const longestReported = 64 * 1024;

const encoder = new TextEncoder();

export const ReportedUsage = Schema.Struct({
  input: Tokens,
  cacheRead: Tokens,
  cacheWriteShort: Tokens,
  cacheWriteLong: Tokens,
  output: Tokens,
  reasoning: Tokens,
  reported: Schema.JsonObject.check(
    Schema.makeFilter(
      (reported: Schema.JsonObject) =>
        encoder.encode(JSON.stringify(reported)).length <= longestReported,
      { expected: "a JSON object of at most 64 KiB written out" },
    ),
  ),
}).annotate({ identifier: "ReportedUsage" });

export const ReportedCall = Schema.Struct({
  call: Text(1, 255),
  after: Schema.NullOr(Schema.Struct({ call: Text(1, 255), startedAt: Time })),
  session: Text(1, 255),
  project: Text(0, 200),
  clientVersion: Text(0, 200),
  model: Text(0, 200),
  startedAt: Time,
  finishedAt: Time,
  outcome: Schema.Literals(["ok", "error", "cancelled"]),
  errorType: Schema.String,
  errorMessage: Schema.String,
  stopReason: Text(0, 200),
  providerRequestId: Text(0, 255),
  usage: Schema.NullOr(ReportedUsage),
  input: Schema.Array(Schema.JsonObject),
  output: Schema.Array(Schema.JsonObject),
}).annotate({ identifier: "ReportedCall" });

export const Report = Schema.Struct({
  client: ReportedClient,
  pool: PoolId,
  through: Schema.NullOr(Time),
  calls: Schema.Array(ReportedCall).check(Schema.isMaxLength(500)),
}).annotate({ identifier: "Report" });

const reportRequests = HttpApiEndpoint.post(
  "reportRequests",
  "/reported-requests",
  {
    headers: { "x-cota-machine": Schema.optional(Schema.String) },
    payload: Report,
    success: Schema.Struct({ stored: Count, held: Count }),
    error: [
      ReportRefusedProblem,
      PoolNotObservedProblem,
      ReportOutOfOrderProblem,
      NoSuchPoolProblem,
      RequestLogProblem,
      HubStoreProblem,
    ],
  },
).annotateMerge(mayCall("any-hub-key"));

/** The model calls machines report (`docs/specs/reported-requests/spec.md`), with a body of up to 64 MiB. */
export const group = HttpApiGroup.make("reports")
  .add(reportRequests)
  .middleware(CallerMiddleware)
  .middleware(ReportBody)
  .middleware(HttpApiMiddleware.ProblemDetails)
  .prefix("/api");
