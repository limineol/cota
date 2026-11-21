import { Effect } from "effect";
import { HttpApiError } from "effect/http-api";
import type { HubStoreUnavailable } from "#shared/03-domain/hub-store.ts";
import type { RequestLogUnavailable } from "#shared/03-domain/request-log.ts";

export class SignInRequired extends HttpApiError.Problem<SignInRequired>()(
  "SignInRequired",
  {
    type: "urn:cota:sign-in-required",
    status: 401,
    title: "Sign in, or send a hub key the hub knows.",
  },
) {}

export class NotAllowed extends HttpApiError.Problem<NotAllowed>()(
  "NotAllowed",
  {
    type: "urn:cota:not-allowed",
    status: 403,
    title: "The caller may not call this endpoint.",
  },
) {}

export class CrossSite extends HttpApiError.Problem<CrossSite>()("CrossSite", {
  type: "urn:cota:cross-site",
  status: 403,
  title: "A browser request from another site may not change anything.",
}) {}

export class BodyTooLarge extends HttpApiError.Problem<BodyTooLarge>()(
  "BodyTooLarge",
  {
    type: "urn:cota:body-too-large",
    status: 413,
    title: "The request body is over the API's limit.",
  },
) {}

export class UnsupportedMediaType extends HttpApiError.Problem<UnsupportedMediaType>()(
  "UnsupportedMediaType",
  {
    type: "urn:cota:unsupported-media-type",
    status: 415,
    title: "The API reads only JSON bodies.",
  },
) {}

export class HubStoreProblem extends HttpApiError.Problem<HubStoreProblem>()(
  "HubStoreProblem",
  {
    type: "urn:cota:hub-store-unavailable",
    status: 503,
    title: "The hub store failed.",
  },
) {}

export class NoSuchPoolProblem extends HttpApiError.Problem<NoSuchPoolProblem>()(
  "NoSuchPoolProblem",
  {
    type: "urn:cota:no-such-pool",
    status: 404,
    title: "The hub has no such pool.",
  },
) {}

/**
 * Answers a failed hub store call as the 503 problem
 * `urn:cota:hub-store-unavailable`:
 * `Effect.catchTag("HubStoreUnavailable", hubStoreProblem)`.
 */
export const hubStoreProblem = (error: HubStoreUnavailable) =>
  Effect.fail(new HubStoreProblem({ detail: error.detail }));

export class RequestLogProblem extends HttpApiError.Problem<RequestLogProblem>()(
  "RequestLogProblem",
  {
    type: "urn:cota:request-log-unavailable",
    status: 503,
    title: "The request log is unavailable.",
  },
) {}

/**
 * Answers a failed read of the request log, or a title it failed to keep, as the 503 problem
 * `urn:cota:request-log-unavailable`, saying which failure it was (the log's
 * words not yet gathered among them) but never what ClickHouse said: `Effect.catchTag("RequestLogUnavailable", requestLogProblem)`.
 */
export const requestLogProblem = ({ reason, code }: RequestLogUnavailable) =>
  Effect.fail(
    new RequestLogProblem({
      detail:
        reason === "unreachable"
          ? "ClickHouse could not be reached, or did not answer within 30 seconds."
          : reason === "gathering"
            ? "The request log is still gathering the words a search with prefix or fuzzy widens to, once after an upgrade; search without them meanwhile."
            : `ClickHouse failed the query${code === "" ? "" : ` with error code ${code}`}.`,
    }),
  );
