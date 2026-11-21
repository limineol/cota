import { Context, Effect, Layer } from "effect";
import { Hub } from "#02-application/interfaces/hub.ts";
import * as Client from "#03-domain/client.ts";
import type { Configuration } from "#03-domain/configuration.ts";
import { HubUnreachable, hubDeadline } from "#03-domain/machine.ts";
import type { RouteList } from "#03-domain/route-list.ts";
import { AsOwner, OwnerCommandFailed } from "./as-owner.query.ts";

export class ShowRoutes extends Context.Service<
  ShowRoutes,
  {
    /** A routed client's routes, read signed in as the owner (`docs/specs/cli/spec.md`, Routes from the CLI). */
    readonly execute: (
      configuration: Configuration,
      command: Client.RoutedCommand,
    ) => Effect.Effect<RouteList, OwnerCommandFailed>;
  }
>()("@cota/cli/ShowRoutes") {}

export const layer: Layer.Layer<ShowRoutes, never, Hub | AsOwner> =
  Layer.effect(
    ShowRoutes,
    Effect.gen(function* () {
      const hub = yield* Hub;
      const asOwner = yield* AsOwner;
      return ShowRoutes.of({
        execute: Effect.fn("ShowRoutes.execute")(function* (
          configuration: Configuration,
          command: Client.RoutedCommand,
        ) {
          const address = configuration.hub;
          return yield* asOwner.execute(address, (signIn) =>
            hub.routes(address, signIn, Client.routedClientOf[command]).pipe(
              Effect.timeoutOrElse({
                duration: hubDeadline,
                orElse: () => Effect.fail(new HubUnreachable()),
              }),
              Effect.mapError(
                (error) =>
                  new OwnerCommandFailed({
                    problems: [
                      error._tag === "HubUnreachable"
                        ? `${address} cannot be reached`
                        : `${address} could not say the routes of ${Client.routedClientOf[command]}`,
                    ],
                  }),
              ),
            ),
          );
        }),
      });
    }),
  );
