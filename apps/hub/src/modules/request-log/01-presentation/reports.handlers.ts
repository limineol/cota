import { Effect, Option } from "effect";
import type { HttpApiBuilder } from "effect/http-api";
import { ReportRequests } from "#modules/request-log/02-application/commands/report-requests.command.ts";
import type * as Report from "#modules/request-log/03-domain/report.ts";
import { CurrentCaller } from "#shared/01-presentation/caller.middleware.ts";
import {
  hubStoreProblem,
  NoSuchPoolProblem,
  requestLogProblem,
} from "#shared/01-presentation/problems.ts";
import {
  PoolNotObservedProblem,
  ReportOutOfOrderProblem,
  ReportRefusedProblem,
} from "./problems.ts";
import type * as ReportsApi from "./reports.api.ts";

const callOf = (call: typeof ReportsApi.ReportedCall.Type): Report.Call => ({
  ...call,
  after: Option.fromNullOr(call.after),
  usage: Option.map(Option.fromNullOr(call.usage), (usage) => ({
    tokens: {
      input: usage.input,
      cacheRead: usage.cacheRead,
      cacheWriteShort: usage.cacheWriteShort,
      cacheWriteLong: usage.cacheWriteLong,
      output: usage.output,
    },
    reasoning: usage.reasoning,
    reported: JSON.stringify(usage.reported),
  })),
});

export const build = (
  handlers: HttpApiBuilder.Handlers.FromGroup<typeof ReportsApi.group>,
) =>
  Effect.gen(function* () {
    const reportRequests = yield* ReportRequests;

    return handlers.handle("reportRequests", ({ headers, payload }) =>
      Effect.gen(function* () {
        const caller = yield* CurrentCaller;
        return yield* reportRequests.execute(
          {
            client: payload.client,
            pool: payload.pool,
            through: Option.fromNullOr(payload.through),
            calls: payload.calls.map(callOf),
          },
          {
            reporter:
              caller._tag === "Owner"
                ? { _tag: "Owner" }
                : { _tag: "HubKey", name: caller.hubKey.name },
            machine: headers["x-cota-machine"] ?? "",
          },
        );
      }).pipe(
        Effect.catchTags({
          NoSuchPool: ({ pool }) =>
            Effect.fail(
              new NoSuchPoolProblem({
                detail: `The hub has no pool ${JSON.stringify(pool)}.`,
              }),
            ),
          PoolNotObserved: ({ pool }) =>
            Effect.fail(
              new PoolNotObservedProblem({
                detail: `The pool ${JSON.stringify(pool)} is not observed: a report bills an observed pool only.`,
              }),
            ),
          ReportRefused: ({ detail }) =>
            Effect.fail(new ReportRefusedProblem({ detail })),
          ReportOutOfOrder: ({ detail }) =>
            Effect.fail(new ReportOutOfOrderProblem({ detail })),
          RequestLogUnavailable: requestLogProblem,
          HubStoreUnavailable: hubStoreProblem,
        }),
      ),
    );
  });
