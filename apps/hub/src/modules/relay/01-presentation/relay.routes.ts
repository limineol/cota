import { ByteSize, Effect, Layer, Option, Schema } from "effect";
import {
  Cookies,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import type { Rejection } from "#modules/admission/02-application/queries/admit-request.query.ts";
import { ForwardRequest } from "#modules/relay/02-application/commands/forward-request.command.ts";
import type * as Provider from "#modules/relay/02-application/interfaces/provider.ts";
import type * as ClientRequest from "#modules/relay/03-domain/client-request.ts";
import type { Limits } from "#modules/relay/03-domain/limits.ts";
import { Method } from "#modules/relay/03-domain/method.ts";
import { PoolId } from "#shared/03-domain/ids.ts";
import * as HubError from "./hub-error.ts";

interface Target {
  readonly path: string;
  readonly query: string;
}

const targetOf = (url: string): Target => {
  const afterPools = url.slice("/pools/".length);
  const segmentEnd = afterPools.search(/[/?]/);
  const rest = segmentEnd === -1 ? "" : afterPools.slice(segmentEnd);
  const queryAt = rest.indexOf("?");
  return queryAt === -1
    ? { path: rest, query: "" }
    : { path: rest.slice(0, queryAt), query: rest.slice(queryAt) };
};

const rejection = (reason: Rejection, pool: PoolId): HubError.HubError => {
  switch (reason) {
    case "NoHubKey":
    case "UnknownHubKey":
      return {
        type: "cota_hub_key_rejected",
        message:
          "The hub did not accept this request's hub key. Send a hub key from the hub's configuration in x-cota-key, or, to a keyed pool, as the bearer token or in x-api-key.",
      };
    case "UnknownPool":
      return {
        type: "cota_unknown_pool",
        message: `The hub has no pool "${pool}". Check the pool in the client's base URL against the hub's configuration.`,
      };
    case "WrongScope":
      return {
        type: "cota_hub_key_scope",
        message: `This hub key's scope does not open the pool "${pool}". Use a hub key whose scope is the pool's kind.`,
      };
  }
};

const responseOf = (
  answer: Provider.Answer,
): HttpServerResponse.HttpServerResponse => {
  if (answer._tag === "Unanswered") {
    return HubError.response(answer.reason, {
      "x-cota-request": answer.request,
    });
  }
  const { status, headers } = answer;
  const cookies = Cookies.fromSetCookie(answer.setCookies);
  return Option.match(answer.body, {
    onNone: () => HttpServerResponse.empty({ status, headers, cookies }),
    onSome: (body) =>
      HttpServerResponse.stream(body, { status, headers, cookies }),
  });
};

export const layer = (limits: Limits) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const forwardRequest = yield* ForwardRequest;

      const relay = Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const headers: ClientRequest.Headers = request.headers;
        if ((headers.upgrade ?? "").toLowerCase().includes("websocket")) {
          return HubError.response({
            type: "cota_no_websocket",
            message:
              "The hub does not relay WebSockets. The client should make its requests over HTTP.",
          });
        }

        const params = yield* HttpRouter.params;
        const pool = PoolId.make(params.pool ?? "");
        const target = targetOf(request.url);
        const handled = yield* forwardRequest.execute({
          pool,
          path: target.path,
          query: target.query,
          method: Schema.decodeUnknownOption(Method)(request.method),
          headers,
          body: request.arrayBuffer.pipe(
            Effect.map((buffer) => Option.some(new Uint8Array(buffer))),
            Effect.catchTag("HttpServerError", (error) =>
              error.reason._tag === "RequestParseError" &&
              error.reason.reason === "BodyTooLarge"
                ? Effect.succeedNone
                : Effect.fail(error),
            ),
            Effect.provideService(
              HttpServerRequest.MaxBodySize,
              ByteSize.bytes(limits.maxBodyBytes),
            ),
          ),
        });

        switch (handled._tag) {
          case "Rejected":
            return HubError.response(rejection(handled.reason, pool));
          case "UnknownPath":
            return HubError.response({
              type: "cota_unknown_path",
              message: `The pool "${pool}" speaks ${handled.protocol}, whose clients' base URL ends in ${handled.clientPrefix}. Check the client's base URL.`,
            });
          case "UnknownMethod":
            return HubError.response({
              type: "cota_unknown_path",
              message: `The hub does not relay the method ${request.method}.`,
            });
          case "BodyTooLarge":
            // Bun keeps a request whose body was left unread in flight, and a
            // graceful shutdown would wait for it; closing the connection ends it.
            return HubError.response(
              {
                type: "cota_body_too_large",
                message: `The request body is over the hub's limit of ${limits.maxBodyBytes / (1024 * 1024)} MiB. Raise relay.max_body_mib in the hub's configuration if the request is genuine.`,
              },
              { connection: "close" },
            );
          case "Forwarded":
            return responseOf(handled.answer);
        }
      }).pipe(Effect.withSpan("RelayRoutes.relay"));

      const health = HttpServerResponse.jsonUnsafe({ status: "ok" });

      return Layer.mergeAll(
        HttpRouter.add("GET", "/health", health),
        HttpRouter.add("*", "/pools/:pool/*", relay),
      );
    }),
  );
