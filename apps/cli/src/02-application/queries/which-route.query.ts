import { Context, Effect, Layer, Option } from "effect";
import { Environment } from "#02-application/interfaces/environment.ts";
import type { FilesFailed } from "#02-application/interfaces/files.ts";
import * as Client from "#03-domain/client.ts";
import type {
  Configuration,
  ConfigurationInvalid,
  NotJoined,
} from "#03-domain/configuration.ts";
import * as Launch from "#03-domain/launch.ts";
import type { DirectoryUnknown } from "#03-domain/paths.ts";
import * as Route from "#03-domain/route.ts";
import { AskRoute } from "./ask-route.query.ts";
import { LocateFiles } from "./locate-files.query.ts";
import { ReadConfiguration } from "./read-configuration.query.ts";
import { ReadHubKeys } from "./read-hub-keys.query.ts";
import { ReadKeptAnswers } from "./read-kept-answers.query.ts";
import { ReadProject } from "./read-project.query.ts";

/** What the hub said of a launch here, without launching. */
export interface WhichRouteAnswer {
  readonly configuration: Configuration;
  readonly client: Client.RoutedClient;
  readonly project: string;
  readonly override: Option.Option<string>;
  readonly asked: Route.Asked;
}

export class WhichRoute extends Context.Service<
  WhichRoute,
  {
    /** Asks the question of a launch's step 4 for the working directory, as a launch would, and keeps nothing (`docs/specs/cli/spec.md`, Routes from the CLI). */
    readonly execute: (
      command: Client.RoutedCommand,
      pool: Option.Option<string>,
    ) => Effect.Effect<
      WhichRouteAnswer,
      DirectoryUnknown | NotJoined | ConfigurationInvalid | FilesFailed
    >;
  }
>()("@cota/cli/WhichRoute") {}

export const layer: Layer.Layer<
  WhichRoute,
  never,
  | Environment
  | LocateFiles
  | ReadConfiguration
  | ReadHubKeys
  | ReadKeptAnswers
  | ReadProject
  | AskRoute
> = Layer.effect(
  WhichRoute,
  Effect.gen(function* () {
    const { variables } = yield* Environment;
    const locate = yield* LocateFiles;
    const readConfiguration = yield* ReadConfiguration;
    const readHubKeys = yield* ReadHubKeys;
    const readKept = yield* ReadKeptAnswers;
    const readProject = yield* ReadProject;
    const askRoute = yield* AskRoute;
    return WhichRoute.of({
      execute: Effect.fn("WhichRoute.execute")(function* (
        command: Client.RoutedCommand,
        pool: Option.Option<string>,
      ) {
        const paths = yield* locate.execute;
        const configuration = yield* readConfiguration.execute(paths);
        const project = yield* readProject.execute(variables);
        const keys = yield* readHubKeys.execute(paths);
        const kept = yield* readKept.execute(paths);
        const client = Client.routedClientOf[command];
        const override = Option.orElse(pool, () =>
          Option.filter(
            Option.fromUndefinedOr(variables.COTA_POOL),
            (each) => each.trim() !== "",
          ),
        );
        const asked = yield* askRoute.execute(
          configuration.hub,
          keys,
          { client, project, pool: override },
          Launch.deadlineOf(
            command,
            configuration,
            Route.keptFor(kept.answers, client, project),
          ),
        );
        return { configuration, client, project, override, asked };
      }),
    });
  }),
);
