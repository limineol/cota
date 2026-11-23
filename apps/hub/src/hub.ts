import { BunHttpServer } from "@effect/platform-bun";
import { Duration, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { HttpApiBuilder, HttpApiMiddleware } from "effect/http-api";
import { Api } from "#api.ts";
import * as HubConfig from "#config/config.ts";
import * as Admission from "#modules/admission/module.ts";
import * as Dashboard from "#modules/dashboard/module.ts";
import * as DisplayNames from "#modules/display-names/module.ts";
import * as Quota from "#modules/quota/module.ts";
import type * as Protocol from "#modules/relay/02-application/interfaces/protocol.ts";
import * as Relay from "#modules/relay/module.ts";
import * as RequestLog from "#modules/request-log/module.ts";
import * as Routes from "#modules/routes/module.ts";
import * as SignIn from "#modules/sign-in/module.ts";
import * as JsonBody from "#shared/01-presentation/json-body.middleware.ts";
import * as Pool from "#shared/03-domain/pool.entity.ts";
import type * as HubStore from "#shared/04-infrastructure/hub-store/hub-store.ts";
import * as Shutdown from "#shared/04-infrastructure/shutdown.ts";

export const grace = Duration.seconds(20);

/** How long the hub waits, once its server has stopped, for requests to reach the request log. */
export const finishing = Duration.seconds(6);

/** Every module's steps in the hub store, in the order they run. */
export const storeSteps: ReadonlyArray<HubStore.Step> = [
  ...SignIn.steps,
  ...DisplayNames.steps,
  ...Quota.steps,
  ...Routes.steps,
];

/**
 * The API's routes (ADR-0011): each module's groups, given the middleware
 * every group declares.
 */
const api = (config: HubConfig.HubConfig, quota: Quota.Endpoints | undefined) =>
  HttpApiBuilder.layer(Api, { openapiPath: "/api/openapi.json" }).pipe(
    Layer.provide([
      SignIn.api,
      RequestLog.api,
      DisplayNames.api,
      Quota.api,
      Admission.api,
      Routes.api,
    ]),
    Layer.provide([
      SignIn.callers,
      JsonBody.layer,
      HttpApiMiddleware.layerProblemDetails({ includeDetails: true }),
    ]),
    Layer.provide(
      Admission.machine(config.pools).pipe(
        Layer.provide(RequestLog.poolModels(config.pools)),
      ),
    ),
    Layer.provide([
      SignIn.layer(config.signIn),
      DisplayNames.layer({ models: RequestLog.modelNames }),
      Quota.layer({ pools: config.pools, endpoints: quota }),
      Routes.layer(config.pools),
    ]),
  );

export interface Options {
  readonly protocols?: Layer.Layer<Protocol.Protocols> | undefined;
  /** Where the quota module reads and refreshes quota logins; the providers' own unless a test says otherwise. */
  readonly quota?: Quota.Endpoints | undefined;
}

export const layer = (config: HubConfig.HubConfig, options: Options = {}) =>
  Shutdown.beginOnRelease.pipe(
    Layer.provideMerge(
      HttpRouter.serve(
        Layer.mergeAll(
          Relay.layer(
            {
              pools: Pool.forwarded(config.pools),
              limits: config.limits,
              fallback: HubConfig.fallbackPolicy(config),
            },
            options.protocols,
          ),
          api(config, options.quota),
          Dashboard.layer(config.dashboard),
        ),
        {
          disableLogger: true,
          disableListenLog: true,
          // The router answers a bare 404 to a path parameter over 100
          // characters; a display name's key may be 255, and is checked by
          // its Schema.
          routerConfig: { maxParamLength: Number.MAX_SAFE_INTEGER },
        },
      ),
    ),
    Layer.provide([
      Admission.layer(HubConfig.admissionPolicy(config)),
      Shutdown.finishers(finishing),
    ]),
    Layer.provideMerge(Shutdown.layer(grace)),
    Layer.provideMerge(
      BunHttpServer.layer({
        hostname: config.hub.host,
        port: config.hub.port,
        idleTimeout: 0,
        // Bun answers a body over 128 MiB with a bare 413 of its own; the
        // relay's limit, and its error, apply instead.
        maxRequestBodySize: Number.MAX_SAFE_INTEGER,
        gracefulShutdownTimeout: grace,
      }),
    ),
  );
