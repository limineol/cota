import { Effect, Layer, Redacted } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { RequestReports } from "#02-application/interfaces/request-reports.ts";
import { tagOf } from "#03-domain/launch.ts";
import { HubFailed, HubUnreachable } from "#03-domain/machine.ts";
import { answerOf } from "./request-answers.ts";

/** The reports sent over HTTP from this process. */
export const layer: Layer.Layer<RequestReports> = Layer.effect(
  RequestReports,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    return RequestReports.of({
      send: Effect.fn("RequestReports.send")(
        function* (hub, key, machine, body) {
          const response = yield* http
            .execute(
              HttpClientRequest.post(`${hub}/api/reported-requests`).pipe(
                HttpClientRequest.setHeaders({
                  "x-cota-key": Redacted.value(key),
                  "x-cota-machine": tagOf(machine),
                }),
                HttpClientRequest.bodyText(body, "application/json"),
              ),
            )
            .pipe(
              // A redirect is answered as its status, never followed: the
              // hub key and the body go to the hub and nowhere else.
              Effect.provideService(FetchHttpClient.RequestInit, {
                redirect: "manual",
              }),
              Effect.mapError((error) =>
                error.reason._tag === "TransportError"
                  ? new HubUnreachable()
                  : new HubFailed({}),
              ),
            );
          const text = yield* response.text.pipe(
            Effect.mapError(() => new HubUnreachable()),
          );
          const answer = answerOf(response.status, text);
          return "_tag" in answer ? yield* answer : answer;
        },
      ),
    });
  }),
).pipe(Layer.provide(FetchHttpClient.layer));
