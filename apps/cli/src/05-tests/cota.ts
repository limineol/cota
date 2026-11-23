import { Effect, Layer } from "effect";
import * as Cota from "#01-presentation/cota.ts";
import type { ClientRecords } from "#02-application/interfaces/client-records.ts";
import { Environment } from "#02-application/interfaces/environment.ts";
import type { Files } from "#02-application/interfaces/files.ts";
import type { Hub } from "#02-application/interfaces/hub.ts";
import type { LoginShell } from "#02-application/interfaces/login-shell.ts";
import type { Processes } from "#02-application/interfaces/processes.ts";
import type { RequestReports } from "#02-application/interfaces/request-reports.ts";
import type { RunLock } from "#02-application/interfaces/run-lock.ts";
import type { Scheduler } from "#02-application/interfaces/scheduler.ts";
import type { Terminal } from "#02-application/interfaces/terminal.ts";
import type { TitleReports } from "#02-application/interfaces/title-reports.ts";
import type { TitleSources } from "#02-application/interfaces/title-sources.ts";
import type { UserPath } from "#02-application/interfaces/user-path.ts";
import type { System, Variables } from "#03-domain/system.ts";
import * as Cli from "#cli.ts";
import * as InMemoryClientRecords from "./fakes/in-memory-client-records.ts";
import * as InMemoryRunLock from "./fakes/in-memory-run-lock.ts";
import * as InMemoryScheduler from "./fakes/in-memory-scheduler.ts";
import * as InMemoryTitleSources from "./fakes/in-memory-title-sources.ts";
import * as InMemoryUserPath from "./fakes/in-memory-user-path.ts";
import * as ScriptedLoginShell from "./fakes/scripted-login-shell.ts";
import * as ScriptedProcesses from "./fakes/scripted-processes.ts";
import * as ScriptedRequestReports from "./fakes/scripted-request-reports.ts";
import * as ScriptedTitleReports from "./fakes/scripted-title-reports.ts";

export const environment = (
  variables: Variables,
  system: System = "linux",
  hostName = "Studio.local",
  where: { readonly workingDirectory?: string; readonly program?: string } = {},
): Layer.Layer<Environment> =>
  Layer.succeed(
    Environment,
    Environment.of({
      system,
      variables,
      hostName,
      workingDirectory: where.workingDirectory ?? "/home/me/acme-api",
      program: where.program ?? "/usr/local/bin/cota",
    }),
  );

export interface Ports {
  readonly files: Layer.Layer<Files>;
  readonly environment: Layer.Layer<Environment>;
  readonly terminal: Layer.Layer<Terminal>;
  readonly hub: Layer.Layer<Hub>;
  /** By default, a stand-in that starts nothing. */
  readonly processes?: Layer.Layer<Processes>;
  /** By default, a login shell that finds nothing. */
  readonly loginShell?: Layer.Layer<LoginShell>;
  /** By default, an empty user's `Path`. */
  readonly userPath?: Layer.Layer<UserPath>;
  /** By default, no client has written a title. */
  readonly titleSources?: Layer.Layer<TitleSources>;
  /** By default, a hub that keeps every batch. */
  readonly titleReports?: Layer.Layer<TitleReports>;
  /** By default, a scheduler that keeps what it is given in memory. */
  readonly scheduler?: Layer.Layer<Scheduler>;
  /** By default, no data folder exists. */
  readonly clientRecords?: Layer.Layer<ClientRecords>;
  /** By default, a hub that stores every report. */
  readonly requestReports?: Layer.Layer<RequestReports>;
  /** By default, a lock no other run holds. */
  readonly runLock?: Layer.Layer<RunLock>;
}

/** Runs `cota` in this process with the arguments given, through the ports given, and gives its exit status. */
export const run = (argv: ReadonlyArray<string>, ports: Ports) =>
  Cota.run(argv).pipe(
    Effect.provide(
      Cli.layer.pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            ports.files,
            ports.environment,
            ports.terminal,
            ports.hub,
            ports.processes ?? ScriptedProcesses.make().layer,
            ports.loginShell ?? ScriptedLoginShell.make(),
            ports.userPath ?? InMemoryUserPath.make().layer,
            ports.titleSources ?? InMemoryTitleSources.make().layer,
            ports.titleReports ?? ScriptedTitleReports.make().layer,
            ports.scheduler ?? InMemoryScheduler.make().layer,
            ports.clientRecords ?? InMemoryClientRecords.make().layer,
            ports.requestReports ?? ScriptedRequestReports.make().layer,
            ports.runLock ?? InMemoryRunLock.make().layer,
          ),
        ),
      ),
    ),
  );
