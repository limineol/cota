import { Effect, Layer, Result } from "effect";
import { reportedLines, sentLines } from "#01-presentation/cota.ts";
import * as AddReportedFolder from "#02-application/commands/add-reported-folder.command.ts";
import * as ConfigureClients from "#02-application/commands/configure-clients.command.ts";
import * as InstallShims from "#02-application/commands/install-shims.command.ts";
import * as JoinMachine from "#02-application/commands/join-machine.command.ts";
import * as KeepMachineLogin from "#02-application/commands/keep-machine-login.command.ts";
import * as KeepReaderKey from "#02-application/commands/keep-reader-key.command.ts";
import * as LaunchClient from "#02-application/commands/launch-client.command.ts";
import * as LeaveMachine from "#02-application/commands/leave-machine.command.ts";
import * as RemoveMachineLogin from "#02-application/commands/remove-machine-login.command.ts";
import * as RemoveReportedFolder from "#02-application/commands/remove-reported-folder.command.ts";
import * as RemoveShims from "#02-application/commands/remove-shims.command.ts";
import * as ReportTitles from "#02-application/commands/report-titles.command.ts";
import * as ScheduleReporter from "#02-application/commands/schedule-reporter.command.ts";
import * as SendReportedRequests from "#02-application/commands/send-reported-requests.command.ts";
import * as SetRoutes from "#02-application/commands/set-routes.command.ts";
import { CodexProviders } from "#02-application/interfaces/codex-providers.ts";
import {
  MachineSteps,
  StepFailed,
} from "#02-application/interfaces/machine-steps.ts";
import { Terminal } from "#02-application/interfaces/terminal.ts";
import * as AsOwner from "#02-application/queries/as-owner.query.ts";
import * as AskRoute from "#02-application/queries/ask-route.query.ts";
import * as Doctor from "#02-application/queries/doctor.query.ts";
import * as FindCommand from "#02-application/queries/find-command.query.ts";
import * as LocateFiles from "#02-application/queries/locate-files.query.ts";
import * as LocateShellFiles from "#02-application/queries/locate-shell-files.query.ts";
import * as PlanClientFiles from "#02-application/queries/plan-client-files.query.ts";
import * as PlanSchedule from "#02-application/queries/plan-schedule.query.ts";
import * as ReadConfiguration from "#02-application/queries/read-configuration.query.ts";
import * as ReadHubKeys from "#02-application/queries/read-hub-keys.query.ts";
import * as ReadKeptAnswers from "#02-application/queries/read-kept-answers.query.ts";
import * as ReadMachineLogins from "#02-application/queries/read-machine-logins.query.ts";
import * as ReadMemory from "#02-application/queries/read-memory.query.ts";
import * as ReadProject from "#02-application/queries/read-project.query.ts";
import * as ShowRequests from "#02-application/queries/show-requests.query.ts";
import * as ShowRoutes from "#02-application/queries/show-routes.query.ts";
import * as WhichRoute from "#02-application/queries/which-route.query.ts";
import { configuredClients } from "#03-domain/client-files.ts";

const lines = (said: ReadonlyArray<string>) =>
  said.map((line) => `${line}\n`).join("");

/** The steps of joining and leaving that are not the machine's own files: the shims, the clients' configuration and the reporters' schedules. */
const machineSteps = Layer.effect(
  MachineSteps,
  Effect.gen(function* () {
    const install = yield* InstallShims.InstallShims;
    const remove = yield* RemoveShims.RemoveShims;
    const configure = yield* ConfigureClients.ConfigureClients;
    const schedule = yield* ScheduleReporter.ScheduleReporter;
    const report = yield* ReportTitles.ReportTitles;
    const send = yield* SendReportedRequests.SendReportedRequests;
    const terminal = yield* Terminal;
    return MachineSteps.of({
      join: [
        {
          name: "the shims",
          run: (joined) =>
            joined.shims
              ? install.execute(joined.paths).pipe(
                  Effect.flatMap((said) => terminal.print(lines(said))),
                  Effect.catchTag("StepFailed", (error) =>
                    terminal.printError(
                      `cota: the shims were not installed: ${error.problem}\n`,
                    ),
                  ),
                )
              : Effect.void,
        },
        {
          name: "the clients' configuration",
          run: (joined) =>
            Effect.gen(function* () {
              const { said, left } = yield* configure.execute(joined.paths, {
                _tag: "Asked",
                configuration: joined.configuration,
                clients: configuredClients,
              });
              yield* terminal.print(lines(said));
              yield* terminal.printError(
                lines(left.map(ConfigureClients.leftLine)),
              );
            }),
        },
        {
          name: "the title reporter",
          run: (joined) =>
            Effect.gen(function* () {
              const scheduled = yield* Effect.result(
                schedule.execute(joined.paths, "titles", false),
              );
              if (Result.isFailure(scheduled)) {
                yield* terminal.printError(
                  `cota: the title reporter was not scheduled: ${scheduled.failure.problem}\n`,
                );
              } else {
                yield* terminal.print(lines(scheduled.success));
              }
              const { out, err } = reportedLines(
                yield* report.execute(joined.paths, joined.configuration),
              );
              yield* terminal.print(out);
              yield* terminal.printError(err);
            }),
        },
        {
          name: "the request reporter",
          run: (joined) =>
            Effect.gen(function* () {
              const folders =
                joined.configuration.clients?.antigravity?.reported ?? [];
              if (folders.length === 0) return;
              const scheduled = yield* Effect.result(
                schedule.execute(joined.paths, "requests", false),
              );
              if (Result.isFailure(scheduled)) {
                yield* terminal.printError(
                  `cota: the request reporter was not scheduled: ${scheduled.failure.problem}\n`,
                );
              } else {
                yield* terminal.print(lines(scheduled.success));
              }
              const { out, err } = sentLines(
                yield* send.execute(joined.paths, joined.configuration),
              );
              yield* terminal.print(out);
              yield* terminal.printError(err);
            }),
        },
      ],
      leave: [
        {
          name: "the request reporter's schedule",
          run: (paths) =>
            schedule
              .execute(paths, "requests", true)
              .pipe(Effect.flatMap((said) => terminal.print(lines(said)))),
        },
        {
          name: "the title reporter's schedule",
          run: (paths) =>
            schedule
              .execute(paths, "titles", true)
              .pipe(Effect.flatMap((said) => terminal.print(lines(said)))),
        },
        {
          name: "the clients' configuration",
          run: (paths) =>
            Effect.gen(function* () {
              const { said, left } = yield* configure.execute(paths, {
                _tag: "None",
              });
              yield* terminal.print(lines(said));
              if (left.length > 0) {
                return yield* new StepFailed({
                  problem: left
                    .map(
                      ({ file, reason }) =>
                        `${file} was left as it was: ${reason}`,
                    )
                    .join("; "),
                });
              }
            }),
        },
        {
          name: "the shims",
          run: (paths) =>
            remove
              .execute(paths)
              .pipe(Effect.flatMap((said) => terminal.print(lines(said)))),
        },
      ],
    });
  }),
);

/** Codex's provider tables, written by `cota configure` for Codex alone when a launch finds its pool's table missing; it says what it did on stderr. */
const codexProviders = Layer.effect(
  CodexProviders,
  Effect.gen(function* () {
    const configure = yield* ConfigureClients.ConfigureClients;
    const terminal = yield* Terminal;
    return CodexProviders.of({
      provide: (joined) =>
        Effect.gen(function* () {
          const { said, left } = yield* configure.execute(joined.paths, {
            _tag: "Asked",
            configuration: joined.configuration,
            clients: ["codex"],
          });
          yield* terminal.printError(
            lines([...said, ...left.map(ConfigureClients.leftLine)]),
          );
        }),
    });
  }),
);

const queries = Layer.mergeAll(
  ReadProject.layer,
  Doctor.layer,
  ShowRoutes.layer,
  ReadMemory.layer,
  ShowRequests.layer,
).pipe(
  Layer.provideMerge(Layer.mergeAll(PlanClientFiles.layer, AsOwner.layer)),
  Layer.provideMerge(
    Layer.mergeAll(
      LocateFiles.layer,
      ReadConfiguration.layer,
      ReadHubKeys.layer,
      ReadMachineLogins.layer,
      ReadKeptAnswers.layer,
      FindCommand.layer,
      LocateShellFiles.layer,
      AskRoute.layer,
      PlanSchedule.layer,
    ),
  ),
);

const steps = Layer.mergeAll(machineSteps, codexProviders).pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      InstallShims.layer,
      RemoveShims.layer,
      ConfigureClients.layer,
      ScheduleReporter.layer,
      ReportTitles.layer,
      SendReportedRequests.layer,
    ).pipe(Layer.provideMerge(queries)),
  ),
);

/** `cota`'s commands and queries over whichever ports are given. */
export const layer = Layer.mergeAll(
  JoinMachine.layer,
  LeaveMachine.layer,
  LaunchClient.layer,
  KeepMachineLogin.layer,
  KeepReaderKey.layer,
  RemoveMachineLogin.layer,
  WhichRoute.layer,
  SetRoutes.layer,
  AddReportedFolder.layer,
  RemoveReportedFolder.layer,
).pipe(Layer.provideMerge(steps));
