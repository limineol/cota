import { Effect, Layer } from "effect";
import * as Cota from "#01-presentation/cota.ts";
import * as CurlRequestReports from "#04-infrastructure/curl-request-reports.ts";
import * as CurlTitleReports from "#04-infrastructure/curl-title-reports.ts";
import * as HttpHub from "#04-infrastructure/http-hub.ts";
import * as HttpRequestReports from "#04-infrastructure/http-request-reports.ts";
import * as HttpTitleReports from "#04-infrastructure/http-title-reports.ts";
import * as NodeFiles from "#04-infrastructure/node-files.ts";
import * as NodeProcesses from "#04-infrastructure/node-processes.ts";
import * as NodeRunLock from "#04-infrastructure/node-run-lock.ts";
import * as NodeTitleSources from "#04-infrastructure/node-title-sources.ts";
import * as PowerShellUserPath from "#04-infrastructure/powershell-user-path.ts";
import * as ProcessEnvironment from "#04-infrastructure/process-environment.ts";
import * as ProcessLoginShell from "#04-infrastructure/process-login-shell.ts";
import * as ProcessTerminal from "#04-infrastructure/process-terminal.ts";
import * as SqliteClientRecords from "#04-infrastructure/sqlite-client-records.ts";
import * as SystemScheduler from "#04-infrastructure/system-scheduler.ts";
import * as Cli from "./cli.ts";

const system = ProcessEnvironment.systemOf(process.platform);

const ports = Layer.mergeAll(
  NodeFiles.layer,
  ProcessEnvironment.layer,
  ProcessTerminal.layer,
  HttpHub.layer,
  NodeProcesses.layer({ replace: true }),
  ProcessLoginShell.layer,
  PowerShellUserPath.layer,
  NodeTitleSources.layer,
  system === "darwin"
    ? CurlTitleReports.layer("/usr/bin/curl")
    : HttpTitleReports.layer,
  system === "darwin"
    ? CurlRequestReports.layer("/usr/bin/curl")
    : HttpRequestReports.layer,
  SqliteClientRecords.layer,
  NodeRunLock.layer,
  SystemScheduler.layer({
    system,
    uid: process.getuid?.() ?? 0,
    run: SystemScheduler.run,
  }),
);

const status = await Effect.runPromise(
  Cota.run(process.argv.slice(2)).pipe(
    Effect.provide(Cli.layer.pipe(Layer.provideMerge(ports))),
  ),
);
process.exit(status);
