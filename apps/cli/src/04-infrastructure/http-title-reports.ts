import { Effect, Layer, Redacted } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { TitleReports } from "#02-application/interfaces/title-reports.ts";
import { tagOf } from "#03-domain/launch.ts";
import {
  HubFailed,
  HubKeyUnknown,
  HubUnreachable,
} from "#03-domain/machine.ts";

/** The batches sent over HTTP from this process. */
export const layer: Layer.Layer<TitleReports> = Layer.effect(
  TitleReports,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    return TitleReports.of({
      send: Effect.fn("TitleReports.send")(
        function* (hub, key, machine, titles) {
          const response = yield* http
            .execute(
              HttpClientRequest.put(`${hub}/api/session-titles`).pipe(
                HttpClientRequest.setHeaders({
                  "x-cota-key": Redacted.value(key),
                  "x-cota-machine": tagOf(machine),
                }),
                HttpClientRequest.bodyJsonUnsafe({
                  titles: Object.fromEntries(titles),
                }),
              ),
            )
            .pipe(
              Effect.mapError((error) =>
                error.reason._tag === "TransportError"
                  ? new HubUnreachable()
                  : new HubFailed({}),
              ),
            );
          if (response.status === 204) return;
          if (response.status === 401) return yield* new HubKeyUnknown();
          return yield* new HubFailed({ status: response.status });
        },
      ),
    });
  }),
).pipe(Layer.provide(FetchHttpClient.layer));
