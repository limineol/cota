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

/**
 * Answers 415 to an API request whose body is not said to be JSON, and 413 to
 * one whose body is over 1 MiB, before or while it is read.
 */
export class JsonBody extends HttpApiMiddleware.Service<JsonBody>()(
  "@cota/hub/api/JsonBody",
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

const tooLarge = refused(
  new BodyTooLarge({
    detail: `The API takes a body of at most ${maxBodyBytes / (1024 * 1024)} MiB.`,
  }),
);

export const layer: Layer.Layer<JsonBody> = Layer.succeed(
  JsonBody,
  (httpEffect) =>
    Effect.gen(function* () {
      const { headers } = yield* HttpServerRequest.HttpServerRequest;
      if (hasBody(headers) && !isJson(headers["content-type"])) {
        return yield* refused(
          new UnsupportedMediaType({
            detail:
              "Send the body as JSON, with content-type: application/json.",
          }),
        );
      }
      if (Number(headers["content-length"] ?? 0) > maxBodyBytes) {
        return yield* tooLarge;
      }
      return yield* httpEffect.pipe(
        Effect.provideService(
          HttpServerRequest.MaxBodySize,
          ByteSize.bytes(maxBodyBytes),
        ),
        Effect.catchDefect((defect) =>
          isTooLarge(defect) ? tooLarge : Effect.die(defect),
        ),
      );
    }),
);
