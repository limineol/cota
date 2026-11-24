import { Context, Effect, Layer, Option, Result } from "effect";
import { CodexProviders } from "#02-application/interfaces/codex-providers.ts";
import { Environment } from "#02-application/interfaces/environment.ts";
import { Files, type FilesFailed } from "#02-application/interfaces/files.ts";
import { Processes } from "#02-application/interfaces/processes.ts";
import { Terminal } from "#02-application/interfaces/terminal.ts";
import { AskRoute } from "#02-application/queries/ask-route.query.ts";
import { FindCommand } from "#02-application/queries/find-command.query.ts";
import { LocateFiles } from "#02-application/queries/locate-files.query.ts";
import { ReadConfiguration } from "#02-application/queries/read-configuration.query.ts";
import { ReadHubKeys } from "#02-application/queries/read-hub-keys.query.ts";
import { ReadKeptAnswers } from "#02-application/queries/read-kept-answers.query.ts";
import { ReadMachineLogins } from "#02-application/queries/read-machine-logins.query.ts";
import { ReadProject } from "#02-application/queries/read-project.query.ts";
import * as Client from "#03-domain/client.ts";
import * as Codex from "#03-domain/codex.ts";
import type {
  Configuration,
  ConfigurationInvalid,
} from "#03-domain/configuration.ts";
import * as Launch from "#03-domain/launch.ts";
import {
  type DirectoryUnknown,
  keptAnswersFile,
  type Paths,
} from "#03-domain/paths.ts";
import * as Route from "#03-domain/route.ts";

export interface LaunchOptions {
  readonly command: Client.Command;
  /** The pool `--pool` named. */
  readonly pool: Option.Option<string>;
  /** The client's arguments, untouched. */
  readonly args: ReadonlyArray<string>;
}

/** A launch that cannot read the machine's configuration stops, as every command but the bypass does. */
export type ConfigurationUnread =
  | DirectoryUnknown
  | ConfigurationInvalid
  | FilesFailed;

export class LaunchClient extends Context.Service<
  LaunchClient,
  {
    /**
     * Launches a client (`docs/specs/cli/spec.md`, Launching): finds its real
     * command, reads the project, asks the hub for the pool, decides the
     * login and the environment, and starts the client, or says why it
     * stopped. It gives the client's exit status, or the launch's.
     */
    readonly execute: (
      options: LaunchOptions,
    ) => Effect.Effect<number, ConfigurationUnread>;
  }
>()("@cota/cli/LaunchClient") {}

/** The status of a client that was found but could not be started, as a shell gives it. */
const couldNotStart = 126;

export const layer: Layer.Layer<
  LaunchClient,
  never,
  | Environment
  | Files
  | Terminal
  | Processes
  | CodexProviders
  | LocateFiles
  | ReadConfiguration
  | ReadHubKeys
  | ReadMachineLogins
  | ReadKeptAnswers
  | FindCommand
  | ReadProject
  | AskRoute
> = Layer.effect(
  LaunchClient,
  Effect.gen(function* () {
    const environment = yield* Environment;
    const files = yield* Files;
    const terminal = yield* Terminal;
    const processes = yield* Processes;
    const codexProviders = yield* CodexProviders;
    const locate = yield* LocateFiles;
    const readConfiguration = yield* ReadConfiguration;
    const readHubKeys = yield* ReadHubKeys;
    const readLogins = yield* ReadMachineLogins;
    const readKept = yield* ReadKeptAnswers;
    const findCommand = yield* FindCommand;
    const readProject = yield* ReadProject;
    const askRoute = yield* AskRoute;
    const { system, variables } = environment;

    const keep = Effect.fn(function* (
      paths: Paths,
      kept: ReadonlyArray<Route.KeptAnswer>,
      answer: Route.KeptAnswer,
    ) {
      const before = Route.keptFor(kept, answer.client, answer.project);
      if (
        Option.isSome(before) &&
        kept.at(-1) === before.value &&
        JSON.stringify(before.value) === JSON.stringify(answer)
      ) {
        return;
      }
      const written = yield* Effect.result(
        Effect.gen(function* () {
          yield* files.makeDirectory(paths.state, 0o700);
          yield* files.write(
            keptAnswersFile(paths),
            Route.keptText(Route.keeping(kept, answer)),
            0o600,
          );
        }),
      );
      if (Result.isFailure(written)) {
        yield* terminal.printError(
          `cota: ${written.failure.path} could not be written: ${written.failure.reason}\n`,
        );
      }
    });

    const codexConfigurationOf = () => {
      const home = variables.CODEX_HOME;
      if (home !== undefined && home !== "") return Option.some(home);
      const user = system === "win32" ? variables.USERPROFILE : variables.HOME;
      return user === undefined || user === ""
        ? Option.none<string>()
        : Option.some(`${user}${system === "win32" ? "\\" : "/"}.codex`);
    };

    const ensureCodexProvider = Effect.fn(function* (
      configuration: Configuration,
      paths: Paths,
      pool: string,
    ) {
      const directory = codexConfigurationOf();
      const text = Option.isNone(directory)
        ? Option.none<string>()
        : yield* files
            .read(
              `${directory.value}${system === "win32" ? "\\" : "/"}config.toml`,
            )
            .pipe(Effect.orElseSucceed(() => Option.none<string>()));
      if (Option.exists(text, (each) => Codex.hasProviderTable(each, pool))) {
        return;
      }
      yield* codexProviders.provide(
        { configuration, paths, shims: true },
        pool,
      );
    });

    const joinedFacts = Effect.fn(function* (
      options: LaunchOptions,
      paths: Paths,
      configuration: Configuration,
    ) {
      const { command } = options;
      const project = yield* readProject.execute(variables);
      const hubKeys = yield* readHubKeys.execute(paths);
      const logins = yield* readLogins.execute(paths);
      const kept = yield* readKept.execute(paths).pipe(
        Effect.orElseSucceed(() => ({
          file: "",
          answers: [],
          problem: Option.none<string>(),
        })),
      );
      const override = Option.orElse(options.pool, () =>
        Option.filter(
          Option.fromUndefinedOr(variables.COTA_POOL),
          (pool) => pool.trim() !== "",
        ),
      );
      if (!Client.isRouted(command)) {
        return {
          configuration,
          project,
          hubKeys,
          logins,
          override,
          asked: Option.none(),
          kept: Option.none(),
        } satisfies Launch.Joined;
      }
      const client = Client.routedClientOf[command];
      const keptAnswer = Route.keptFor(kept.answers, client, project);
      const asked = yield* askRoute.execute(
        configuration.hub,
        hubKeys,
        { client, project, pool: override },
        Launch.deadlineOf(command, configuration, keptAnswer),
      );
      if (asked._tag === "Answered") {
        yield* keep(paths, kept.answers, Route.keptOf(client, asked.answer));
      }
      return {
        configuration,
        project,
        hubKeys,
        logins,
        override,
        asked: Option.some(asked),
        kept: keptAnswer,
      } satisfies Launch.Joined;
    });

    return LaunchClient.of({
      execute: Effect.fn("LaunchClient.execute")(function* (
        options: LaunchOptions,
      ) {
        const { command } = options;
        const given = { args: options.args, variables };
        const located = yield* Effect.result(locate.execute);
        const bypass = Launch.isBypass(variables);
        if (Result.isFailure(located) && !bypass) {
          return yield* located.failure;
        }
        const paths = Result.getSuccess(located);
        const realClient = yield* findCommand.execute(
          command,
          variables,
          Option.map(paths, ({ shims }) => shims),
        );
        let machine = Option.none<Launch.Joined>();
        let configuration = Option.none<Configuration>();
        if (!bypass && Option.isSome(paths) && Option.isSome(realClient)) {
          const read = yield* Effect.result(
            readConfiguration.execute(paths.value),
          );
          if (Result.isFailure(read) && read.failure._tag !== "NotJoined") {
            return yield* read.failure;
          }
          configuration = Result.getSuccess(read);
          if (Option.isSome(configuration)) {
            machine = Option.some(
              yield* joinedFacts(options, paths.value, configuration.value),
            );
          }
        }
        const decision = Launch.decide({
          command,
          given,
          realClient,
          machine,
        });
        if (decision._tag === "Stop") {
          yield* terminal.printError(`${decision.line}\n`);
          return decision.status;
        }
        if (Option.isSome(decision.notice)) {
          yield* terminal.printError(`${decision.notice.value}\n`);
        }
        if (
          command === "codex" &&
          Option.isSome(decision.throughHub) &&
          Option.isSome(configuration) &&
          Option.isSome(paths)
        ) {
          yield* ensureCodexProvider(
            configuration.value,
            paths.value,
            decision.throughHub.value,
          );
        }
        const started = yield* Effect.result(
          processes.start(decision.command, decision.args, decision.variables),
        );
        if (Result.isFailure(started)) {
          yield* terminal.printError(
            `cota: ${started.failure.command} could not be started: ${started.failure.reason}\n`,
          );
          return couldNotStart;
        }
        return started.success;
      }),
    });
  }),
);
