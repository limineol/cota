import { ByteSize, Effect, Layer } from "effect";
import {
  HttpEffect,
  HttpServerError,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import { HttpApiMiddleware } from "effect/http-api";
import { BodyTooLarge, UnsupportedMediaType } from "./problems.ts";

export const maxBodyBytes = 1024 * 1024;

/** The limit of the request log's `reports` group, whose reports carry conversations. */
export const maxReportBytes = 64 * 1024 * 1024;

/**
 * Answers 415 to an API request whose body is not said to be JSON, and 413 to
 * one whose body is over 1 MiB, before or while it is read.
 */
export class JsonBody extends HttpApiMiddleware.Service<JsonBody>()(
  "@cota/hub/api/JsonBody",
  { error: [UnsupportedMediaType, BodyTooLarge] },
) {}

/** `JsonBody` with the `reports` group's limit, 64 MiB. */
export class ReportBody extends HttpApiMiddleware.Service<ReportBody>()(
  "@cota/hub/api/ReportBody",
  { error: [UnsupportedMediaType, BodyTooLarge] },
) {}

const hasBody = (headers: HttpServerRequest.HttpServerRequest["headers"]) =>
  Number(headers["content-length"] ?? 0) > 0 ||
  headers["transfer-encoding"] !== undefined;

const isJson = (contentType: string | undefined) =>
  contentType?.split(";")[0]?.trim().toLowerCase() === "application/json";

const isTooLarge = (defect: unknown): boolean =>
  HttpServerError.isHttpServerError(defect) &&
  defect.reason._tag === "RequestParseError" &&
  defect.reason.reason === "BodyTooLarge";

const refused = <E>(problem: E) =>
  Effect.gen(function* () {
    // Bun keeps a request whose body was left unread in flight, and a graceful
    // shutdown would wait for it; closing the connection ends it.
    yield* HttpEffect.appendPreResponseHandler((_request, response) =>
      Effect.succeed(
        HttpServerResponse.setHeader(response, "connection", "close"),
      ),
    );
    return yield* Effect.fail(problem);
  });

const limitedTo =
  (maxBytes: number) =>
  <A, E, R>(httpEffect: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const tooLarge = refused(
        new BodyTooLarge({
          detail: `The API takes a body of at most ${maxBytes / (1024 * 1024)} MiB.`,
        }),
      );
      const { headers } = yield* HttpServerRequest.HttpServerRequest;
      if (hasBody(headers) && !isJson(headers["content-type"])) {
        return yield* refused(
          new UnsupportedMediaType({
            detail:
              "Send the body as JSON, with content-type: application/json.",
          }),
        );
      }
      if (Number(headers["content-length"] ?? 0) > maxBytes) {
        return yield* tooLarge;
      }
      return yield* httpEffect.pipe(
        Effect.provideService(
          HttpServerRequest.MaxBodySize,
          ByteSize.bytes(maxBytes),
        ),
        Effect.catchDefect((defect) =>
          isTooLarge(defect) ? tooLarge : Effect.die(defect),
        ),
      );
    });

export const layer: Layer.Layer<JsonBody> = Layer.succeed(
  JsonBody,
  limitedTo(maxBodyBytes),
);

export const reportLayer: Layer.Layer<ReportBody> = Layer.succeed(
  ReportBody,
  limitedTo(maxReportBytes),
);
