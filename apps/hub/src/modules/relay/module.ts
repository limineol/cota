import { BunHttpClient } from "@effect/platform-bun";
import { Duration, Effect, Layer } from "effect";
import * as RelayRoutes from "#modules/relay/01-presentation/relay.routes.ts";
import * as ForwardRequest from "#modules/relay/02-application/commands/forward-request.command.ts";
import type * as Protocol from "#modules/relay/02-application/interfaces/protocol.ts";
import * as PlanCredential from "#modules/relay/02-application/queries/plan-credential.query.ts";
import * as Fallback from "#modules/relay/03-domain/fallback.ts";
import * as ShippedProtocols from "#modules/relay/04-infrastructure/protocols/protocols.ts";
import * as HttpProvider from "#modules/relay/04-infrastructure/provider/http-provider.ts";

export interface Options extends ForwardRequest.Options {
  readonly fallback: Fallback.Policy;
}

/** Runs `Fallback.forget` once a minute for as long as the layer lives. */
export const forgetEveryMinute: Layer.Layer<never, never, Fallback.Fallback> =
  Layer.effectDiscard(
    Effect.gen(function* () {
      const fallback = yield* Fallback.Fallback;
      yield* Effect.forkScoped(
        Effect.gen(function* () {
          while (true) {
            yield* Effect.sleep(Duration.minutes(1));
            yield* fallback.forget;
          }
        }),
      );
    }),
  );

// Bun's fetch must hand over the provider's bytes as they are, follow no
// redirect, and keep a quiet stream open past its default five-minute idle
// timeout.
const upstream = BunHttpClient.layerOptions({
  decompress: false,
  redirect: "manual",
  timeout: false,
});

/**
 * The relay's routes, forwarding to the pools' providers over HTTP with the
 * given protocols, and diverting under the fallback policy.
 */
export const layer = (
  options: Options,
  protocols: Layer.Layer<Protocol.Protocols> = ShippedProtocols.layer,
) =>
  Layer.mergeAll(RelayRoutes.layer(options.limits), forgetEveryMinute).pipe(
    Layer.provide(ForwardRequest.layer(options)),
    Layer.provide(PlanCredential.layer(options.pools)),
    Layer.provide([HttpProvider.layer(options.limits), protocols]),
    Layer.provide([Fallback.layer(options.fallback), upstream]),
  );
