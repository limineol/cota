import { DateTime, Effect } from "effect";
import { HttpApiError } from "effect/http-api";
import type * as Traffic from "#modules/request-log/03-domain/traffic.ts";

export class EmptyWindowProblem extends HttpApiError.Problem<EmptyWindowProblem>()(
  "EmptyWindowProblem",
  {
    type: "urn:cota:empty-window",
    status: 400,
    title: "The window is empty: from must be before to.",
  },
) {}

/**
 * Answers a window that holds no instant as the 400 problem
 * `urn:cota:empty-window`: `Effect.catchTag("EmptyWindow", emptyWindowProblem)`.
 */
export const emptyWindowProblem = ({ from, to }: Traffic.EmptyWindow) =>
  Effect.fail(
    new EmptyWindowProblem({
      detail: `The window from ${DateTime.formatIso(from)} to ${DateTime.formatIso(to)} holds no instant.`,
    }),
  );

export class NoSuchSessionProblem extends HttpApiError.Problem<NoSuchSessionProblem>()(
  "NoSuchSessionProblem",
  {
    type: "urn:cota:no-such-session",
    status: 404,
    title: "There is no such session.",
  },
) {}

export class NoSuchRequestProblem extends HttpApiError.Problem<NoSuchRequestProblem>()(
  "NoSuchRequestProblem",
  {
    type: "urn:cota:no-such-request",
    status: 404,
    title: "There is no such request.",
  },
) {}

export class NoConversationProblem extends HttpApiError.Problem<NoConversationProblem>()(
  "NoConversationProblem",
  {
    type: "urn:cota:no-conversation",
    status: 404,
    title: "The request log kept no body for this request.",
  },
) {}

export class StaleCursorProblem extends HttpApiError.Problem<StaleCursorProblem>()(
  "StaleCursorProblem",
  {
    type: "urn:cota:stale-cursor",
    status: 400,
    title: "The cursor does not continue this search.",
  },
) {}

export class ReportRefusedProblem extends HttpApiError.Problem<ReportRefusedProblem>()(
  "ReportRefusedProblem",
  {
    type: "urn:cota:report-refused",
    status: 400,
    title: "The report was not stored.",
  },
) {}

export class PoolNotObservedProblem extends HttpApiError.Problem<PoolNotObservedProblem>()(
  "PoolNotObservedProblem",
  {
    type: "urn:cota:pool-not-observed",
    status: 400,
    title: "That pool is not an observed pool.",
  },
) {}

export class ReportOutOfOrderProblem extends HttpApiError.Problem<ReportOutOfOrderProblem>()(
  "ReportOutOfOrderProblem",
  {
    type: "urn:cota:report-out-of-order",
    status: 409,
    title: "A call's call before was never stored.",
  },
) {}
