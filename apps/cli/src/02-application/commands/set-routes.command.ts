import { Context, Effect, Layer, Result } from "effect";
import { Hub } from "#02-application/interfaces/hub.ts";
import { Terminal } from "#02-application/interfaces/terminal.ts";
import {
  AsOwner,
  OwnerCommandFailed,
} from "#02-application/queries/as-owner.query.ts";
import * as Client from "#03-domain/client.ts";
import type { Configuration } from "#03-domain/configuration.ts";
import { HubUnreachable, hubDeadline } from "#03-domain/machine.ts";
import * as RouteList from "#03-domain/route-list.ts";

export class SetRoutes extends Context.Service<
  SetRoutes,
  {
    /**
     * Replaces a routed client's routes with those standard input gives, in
     * the form `cota routes show` prints, signed in as the owner, from the
     * revision it reads first, so that a change made in between is refused
     * (`docs/specs/cli/spec.md`, Routes from the CLI). It gives the list
     * stored, or every reason the hub gave, a route a line.
     */
    readonly execute: (
      configuration: Configuration,
      command: Client.RoutedCommand,
    ) => Effect.Effect<RouteList.RouteList, OwnerCommandFailed>;
  }
>()("@cota/cli/SetRoutes") {}

export const layer: Layer.Layer<SetRoutes, never, Hub | Terminal | AsOwner> =
  Layer.effect(
    SetRoutes,
    Effect.gen(function* () {
      const hub = yield* Hub;
      const terminal = yield* Terminal;
      const asOwner = yield* AsOwner;

      const stop = (...problems: ReadonlyArray<string>) =>
        Effect.fail(new OwnerCommandFailed({ problems }));

      const withinDeadline = <A, E>(effect: Effect.Effect<A, E>) =>
        effect.pipe(
          Effect.timeoutOrElse({
            duration: hubDeadline,
            orElse: () => Effect.fail(new HubUnreachable()),
          }),
        );

      return SetRoutes.of({
        execute: Effect.fn("SetRoutes.execute")(function* (
          configuration: Configuration,
          command: Client.RoutedCommand,
        ) {
          const address = configuration.hub;
          const client = Client.routedClientOf[command];
          return yield* asOwner.execute(address, (signIn) =>
            Effect.gen(function* () {
              const given = RouteList.read(yield* terminal.input);
              if (Result.isFailure(given)) {
                return yield* stop(
                  `the routes given do not read: ${given.failure}; give them as cota routes show prints them`,
                );
              }
              const read = yield* Effect.result(
                withinDeadline(hub.routes(address, signIn, client)),
              );
              if (Result.isFailure(read)) {
                return yield* stop(
                  read.failure._tag === "HubUnreachable"
                    ? `${address} cannot be reached`
                    : `${address} could not say the routes of ${client}`,
                );
              }
              const stored = yield* Effect.result(
                withinDeadline(
                  hub.changeRoutes(
                    address,
                    signIn,
                    client,
                    read.success.revision,
                    given.success,
                  ),
                ),
              );
              if (Result.isSuccess(stored)) return stored.success;
              const error = stored.failure;
              switch (error._tag) {
                case "RoutesRefused":
                  return yield* stop(
                    `the routes of ${client} were not stored:`,
                    ...RouteList.refusalLines(
                      error.refusals,
                      given.success,
                      Client.protocolOf[command],
                    ),
                  );
                case "RoutesChanged":
                  return yield* stop(
                    `the routes of ${client} changed after cota read them, and were not stored; read them again with cota routes show ${command}`,
                  );
                case "HubUnreachable":
                  return yield* stop(
                    `${address} cannot be reached; the routes of ${client} may not be stored`,
                  );
                case "HubFailed":
                  return yield* stop(
                    `${address} could not store the routes of ${client}`,
                  );
              }
            }),
          );
        }),
      });
    }),
  );
