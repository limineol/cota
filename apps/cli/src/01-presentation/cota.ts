import { Effect, Option, Redacted, Result } from "effect";
import {
  ConfigureClients,
  leftLine,
} from "#02-application/commands/configure-clients.command.ts";
import { InstallShims } from "#02-application/commands/install-shims.command.ts";
import { JoinMachine } from "#02-application/commands/join-machine.command.ts";
import { KeepMachineLogin } from "#02-application/commands/keep-machine-login.command.ts";
import { KeepReaderKey } from "#02-application/commands/keep-reader-key.command.ts";
import { LaunchClient } from "#02-application/commands/launch-client.command.ts";
import { LeaveMachine } from "#02-application/commands/leave-machine.command.ts";
import { RemoveMachineLogin } from "#02-application/commands/remove-machine-login.command.ts";
import { RemoveShims } from "#02-application/commands/remove-shims.command.ts";
import {
  type Reported,
  ReportTitles,
} from "#02-application/commands/report-titles.command.ts";
import { ScheduleTitles } from "#02-application/commands/schedule-titles.command.ts";
import { SetRoutes } from "#02-application/commands/set-routes.command.ts";
import type { FilesFailed } from "#02-application/interfaces/files.ts";
import { MachineSteps } from "#02-application/interfaces/machine-steps.ts";
import { Terminal } from "#02-application/interfaces/terminal.ts";
import { Doctor } from "#02-application/queries/doctor.query.ts";
import { LocateFiles } from "#02-application/queries/locate-files.query.ts";
import { ReadConfiguration } from "#02-application/queries/read-configuration.query.ts";
import { ReadHubKeys } from "#02-application/queries/read-hub-keys.query.ts";
import { ReadMemory } from "#02-application/queries/read-memory.query.ts";
import { ShowRoutes } from "#02-application/queries/show-routes.query.ts";
import { WhichRoute } from "#02-application/queries/which-route.query.ts";
import * as Check from "#03-domain/check.ts";
import type * as Client from "#03-domain/client.ts";
import { configuredClients } from "#03-domain/client-files.ts";
import type * as Configuration from "#03-domain/configuration.ts";
import * as Launch from "#03-domain/launch.ts";
import * as Memory from "#03-domain/memory.ts";
import type { DirectoryUnknown, Paths } from "#03-domain/paths.ts";
import * as RouteList from "#03-domain/route-list.ts";
import cli from "#package.json" with { type: "json" };
import * as CommandLine from "./command-line.ts";
import * as DoctorReport from "./doctor-report.ts";

/** Exit statuses (`docs/specs/cli/spec.md`, Commands). */
const succeeded = 0;
const failed = 1;
const usedWrongly = 2;

const unreadConfiguration = (
  error:
    | DirectoryUnknown
    | Configuration.NotJoined
    | Configuration.ConfigurationInvalid
    | FilesFailed,
): string => {
  switch (error._tag) {
    case "DirectoryUnknown":
      return `cota: where the configuration is cannot be known: ${error.variable} is not set.\n`;
    case "NotJoined":
      return "cota: this machine has not joined a hub. Join one: cota join <hub>\n";
    case "ConfigurationInvalid":
      return `cota: ${error.file} does not read:\n${error.problems}\nFix it, or join again: cota join <hub>\n`;
    case "FilesFailed":
      return `cota: ${error.path} cannot be read: ${error.reason}\n`;
  }
};

/** What a run of the title reporter says: on standard output what the hub kept, on stderr each problem. */
export const reportedLines = ({ kept, problems }: Reported) => ({
  out:
    kept > 0
      ? `cota: the hub kept ${kept} ${kept === 1 ? "title" : "titles"}.\n`
      : problems.length === 0
        ? "cota: there was no new title to send.\n"
        : "",
  err: problems.map((problem) => `cota: ${problem}\n`).join(""),
});

const launch = Effect.fn("cota.launch")(function* (
  invocation: Extract<CommandLine.Invocation, { readonly _tag: "Launch" }>,
) {
  const launched = yield* Effect.result(
    (yield* LaunchClient).execute({
      command: invocation.client,
      pool: invocation.pool,
      args: invocation.args,
    }),
  );
  if (Result.isSuccess(launched)) return launched.success;
  yield* (yield* Terminal).printError(unreadConfiguration(launched.failure));
  return failed;
});

const route = Effect.fn("cota.route")(function* (
  command: Client.RoutedCommand,
  pool: Option.Option<string>,
) {
  const terminal = yield* Terminal;
  const answered = yield* Effect.result(
    (yield* WhichRoute).execute(command, pool),
  );
  if (Result.isFailure(answered)) {
    yield* terminal.printError(unreadConfiguration(answered.failure));
    return failed;
  }
  const { configuration, client, project, override, asked } = answered.success;
  const { hub } = configuration;
  switch (asked._tag) {
    case "Answered": {
      const { pool: billed, by } = asked.answer;
      const why =
        by._tag === "Route"
          ? `route ${by.position} of ${client}, ${by.pattern}`
          : by._tag === "Default"
            ? `the default pool of ${client}`
            : "the override";
      yield* terminal.print(
        `project  ${project}\npool     ${billed.id}, a ${billed.kind} pool of ${billed.protocol}\nby       ${why}\n`,
      );
      return succeeded;
    }
    case "Refused":
      yield* terminal.printError(
        `${Launch.refusedLine(command, project, asked, Option.isSome(override))}\n`,
      );
      return failed;
    case "KeyUnknown":
      yield* terminal.printError(
        `cota: ${hub} does not know this machine's hub key. Join again: cota join ${hub}\n`,
      );
      return failed;
    case "NoHubKey":
      yield* terminal.printError(
        `cota: this machine keeps no hub key to ask with. Join again: cota join ${hub}\n`,
      );
      return failed;
    case "Unsure":
      yield* terminal.printError(
        `cota: ${hub} could not say which pool ${project} bills.\n`,
      );
      return failed;
    case "Unreachable":
      yield* terminal.printError(`cota: ${hub} cannot be reached.\n`);
      return failed;
  }
});

const login = Effect.fn("cota.login")(function* (pool: string) {
  const terminal = yield* Terminal;
  const kept = yield* Effect.result((yield* KeepMachineLogin).execute(pool));
  if (Result.isFailure(kept)) {
    yield* terminal.printError(`cota: ${kept.failure.problem}\n`);
    return failed;
  }
  yield* terminal.print(`cota: kept the machine login for ${pool}.\n`);
  return succeeded;
});

const logout = Effect.fn("cota.logout")(function* (pool: string) {
  const terminal = yield* Terminal;
  const removed = yield* Effect.result(
    (yield* RemoveMachineLogin).execute(pool),
  );
  if (Result.isFailure(removed)) {
    yield* terminal.printError(`cota: ${removed.failure.problem}\n`);
    return failed;
  }
  yield* terminal.print(
    removed.success
      ? `cota: removed the machine login for ${pool}.\n`
      : `cota: this machine has no login for ${pool}; nothing was removed.\n`,
  );
  return succeeded;
});

const shims = Effect.fn("cota.shims")(function* (remove: boolean) {
  const terminal = yield* Terminal;
  const located = yield* Effect.result((yield* LocateFiles).execute);
  if (Result.isFailure(located)) {
    yield* terminal.printError(unreadConfiguration(located.failure));
    return failed;
  }
  const done = yield* Effect.result(
    remove
      ? (yield* RemoveShims).execute(located.success)
      : (yield* InstallShims).execute(located.success),
  );
  if (Result.isFailure(done)) {
    yield* terminal.printError(`cota: ${done.failure.problem}\n`);
    return failed;
  }
  const said =
    remove && done.success.length === 0
      ? ["cota: there were no shims or PATH line of cota's to remove."]
      : done.success;
  yield* terminal.print(said.map((line) => `${line}\n`).join(""));
  return succeeded;
});

const doctor = Effect.fn("cota.doctor")(function* (json: boolean) {
  const terminal = yield* Terminal;
  const checks = yield* (yield* Doctor).execute;
  yield* terminal.print(
    json ? DoctorReport.jsonOf(checks) : DoctorReport.textOf(checks),
  );
  return Check.isOk(checks) ? succeeded : failed;
});

const join = Effect.fn("cota.join")(function* (
  invocation: Extract<CommandLine.Invocation, { readonly _tag: "Join" }>,
) {
  const terminal = yield* Terminal;
  const joined = yield* Effect.result((yield* JoinMachine).execute(invocation));
  if (Result.isFailure(joined)) {
    yield* terminal.printError(
      [...joined.failure.problems, "the join stopped, and nothing was written."]
        .map((line) => `cota: ${line}\n`)
        .join(""),
    );
    return failed;
  }
  const { joined: machine, kept, changed } = joined.success;
  const { hub, machine: name } = machine.configuration;
  yield* terminal.print(
    changed
      ? `cota: joined ${hub} as ${name}, keeping its ${kept.join(" and ")} hub ${kept.length === 1 ? "key" : "keys"}.\n`
      : `cota: this machine had joined ${hub} as ${name} with these keys already; nothing changed.\n`,
  );
  for (const step of (yield* MachineSteps).join) yield* step.run(machine);
  yield* doctor(false);
  return succeeded;
});

const leave = Effect.gen(function* () {
  const terminal = yield* Terminal;
  const { removed, failed: problems } = yield* (yield* LeaveMachine).execute;
  for (const directory of removed) {
    yield* terminal.print(`cota: removed ${directory}\n`);
  }
  if (removed.length === 0 && problems.length === 0) {
    yield* terminal.print(
      "cota: this machine had not joined a hub; there was nothing to remove.\n",
    );
  }
  for (const problem of problems)
    yield* terminal.printError(`cota: ${problem}\n`);
  return problems.length === 0 ? succeeded : failed;
});

const joinedMachine = Effect.gen(function* () {
  const paths = yield* (yield* LocateFiles).execute;
  const configuration = yield* (yield* ReadConfiguration).execute(paths);
  return { paths, configuration };
});

const configure = Effect.gen(function* () {
  const terminal = yield* Terminal;
  const machine = yield* Effect.result(joinedMachine);
  if (Result.isFailure(machine)) {
    yield* terminal.printError(unreadConfiguration(machine.failure));
    return failed;
  }
  const { paths, configuration } = machine.success;
  const { said, left } = yield* (yield* ConfigureClients).execute(paths, {
    _tag: "Asked",
    configuration,
    clients: configuredClients,
  });
  yield* terminal.print(said.map((line) => `${line}\n`).join(""));
  yield* terminal.printError(
    left.map((each) => `${leftLine(each)}\n`).join(""),
  );
  return left.length === 0 ? succeeded : failed;
});

const titles = Effect.fn("cota.titles")(function* (
  invocation: Extract<
    CommandLine.Invocation,
    { readonly _tag: "TitlesReport" | "TitlesSchedule" }
  >,
) {
  const terminal = yield* Terminal;
  if (invocation._tag === "TitlesSchedule" && invocation.remove) {
    const located = yield* Effect.result((yield* LocateFiles).execute);
    if (Result.isFailure(located)) {
      yield* terminal.printError(unreadConfiguration(located.failure));
      return failed;
    }
    return yield* schedule(located.success, true);
  }
  const machine = yield* Effect.result(joinedMachine);
  if (Result.isFailure(machine)) {
    yield* terminal.printError(unreadConfiguration(machine.failure));
    return failed;
  }
  const { paths, configuration } = machine.success;
  if (invocation._tag === "TitlesSchedule") {
    return yield* schedule(paths, false);
  }
  const reported = yield* (yield* ReportTitles).execute(paths, configuration);
  const { out, err } = reportedLines(reported);
  yield* terminal.print(out);
  yield* terminal.printError(err);
  return reported.problems.length === 0 ? succeeded : failed;
});

const schedule = Effect.fn("cota.schedule")(function* (
  paths: Paths,
  remove: boolean,
) {
  const terminal = yield* Terminal;
  const done = yield* Effect.result(
    (yield* ScheduleTitles).execute(paths, remove),
  );
  if (Result.isFailure(done)) {
    yield* terminal.printError(`cota: ${done.failure.problem}\n`);
    return failed;
  }
  const said =
    remove && done.success.length === 0
      ? [
          "cota: the title reporter was not scheduled; there was nothing to remove.",
        ]
      : done.success;
  yield* terminal.print(said.map((line) => `${line}\n`).join(""));
  return succeeded;
});

const routes = Effect.fn("cota.routes")(function* (
  action: "show" | "set",
  command: Client.RoutedCommand,
) {
  const terminal = yield* Terminal;
  const machine = yield* Effect.result(joinedMachine);
  if (Result.isFailure(machine)) {
    yield* terminal.printError(unreadConfiguration(machine.failure));
    return failed;
  }
  const { configuration } = machine.success;
  const done = yield* Effect.result(
    action === "show"
      ? (yield* ShowRoutes).execute(configuration, command)
      : (yield* SetRoutes).execute(configuration, command),
  );
  if (Result.isFailure(done)) {
    yield* terminal.printError(
      done.failure.problems.map((problem) => `cota: ${problem}\n`).join(""),
    );
    return failed;
  }
  if (action === "set") {
    yield* terminal.printError(
      `cota: stored the routes of ${done.success.client}, revision ${done.success.revision}.\n`,
    );
  }
  yield* terminal.print(RouteList.textOf(done.success));
  return succeeded;
});

/** Prints the keyed hub key: the one command that prints a secret, for Pi's configuration to run (`!cota hub-key keyed`). */
const keyedHubKey = Effect.gen(function* () {
  const terminal = yield* Terminal;
  const read = yield* Effect.result(
    Effect.gen(function* () {
      const paths = yield* (yield* LocateFiles).execute;
      yield* (yield* ReadConfiguration).execute(paths);
      return (yield* (yield* ReadHubKeys).execute(paths)).keyed;
    }),
  );
  if (Result.isFailure(read)) {
    yield* terminal.printError(unreadConfiguration(read.failure));
    return failed;
  }
  if (Option.isNone(read.success)) {
    yield* terminal.printError(
      "cota: this machine has no keyed hub key. Join again with one: cota join <hub>\n",
    );
    return failed;
  }
  yield* terminal.print(`${Redacted.value(read.success.value)}\n`);
  return succeeded;
});

const memory = Effect.fn("cota.memory")(function* (
  invocation: Extract<
    CommandLine.Invocation,
    {
      readonly _tag:
        | "MemoryKey"
        | "MemoryGet"
        | "MemorySql"
        | "MemoryTranscript";
    }
  >,
) {
  const terminal = yield* Terminal;
  if (invocation._tag === "MemoryKey") {
    const kept = yield* Effect.result((yield* KeepReaderKey).execute);
    if (Result.isFailure(kept)) {
      yield* terminal.printError(`cota: ${kept.failure.problem}\n`);
      return failed;
    }
    yield* terminal.print(
      "cota: kept the reader key; cota memory reads the request log with it.\n",
    );
    return succeeded;
  }
  const read = yield* ReadMemory;
  if (invocation._tag === "MemoryTranscript") {
    const transcript = yield* Effect.result(read.transcript(invocation.of));
    if (Result.isFailure(transcript)) {
      yield* terminal.printError(`cota: ${transcript.failure.problem}\n`);
      return failed;
    }
    yield* terminal.print(
      Memory.transcriptText(transcript.success, invocation.page),
    );
    return succeeded;
  }
  let ask: Memory.Ask;
  if (invocation._tag === "MemoryGet") {
    ask = { _tag: "Get", path: invocation.path, query: invocation.query };
  } else {
    const sql = (yield* terminal.input).trim();
    if (sql === "") {
      yield* terminal.printError(
        "cota: cota memory sql reads its query on standard input, and was given none.\n",
      );
      return usedWrongly;
    }
    ask = { _tag: "Sql", sql };
  }
  const answered = yield* Effect.result(read.ask(ask));
  if (Result.isFailure(answered)) {
    yield* terminal.printError(`cota: ${answered.failure.problem}\n`);
    return failed;
  }
  yield* terminal.print(
    answered.success.endsWith("\n")
      ? answered.success
      : `${answered.success}\n`,
  );
  return succeeded;
});

/** Runs `cota` with its arguments, without the program's own path, and gives its exit status. */
export const run = Effect.fn("cota")(function* (argv: ReadonlyArray<string>) {
  const terminal = yield* Terminal;
  const parsed = CommandLine.parse(argv);
  if (Result.isFailure(parsed)) {
    yield* terminal.printError(
      `cota: ${parsed.failure}.\n\n${CommandLine.usage}`,
    );
    return usedWrongly;
  }
  const invocation = parsed.success;
  switch (invocation._tag) {
    case "Version":
      yield* terminal.print(`${cli.version}\n`);
      return succeeded;
    case "Help":
      yield* terminal.print(CommandLine.usage);
      return succeeded;
    case "Launch":
      return yield* launch(invocation);
    case "Route":
      return yield* route(invocation.client, invocation.pool);
    case "Login":
      return yield* login(invocation.pool);
    case "Logout":
      return yield* logout(invocation.pool);
    case "Shims":
      return yield* shims(invocation.remove);
    case "Join":
      return yield* join(invocation);
    case "Leave":
      return yield* leave;
    case "Doctor":
      return yield* doctor(invocation.json);
    case "HubKey":
      return yield* keyedHubKey;
    case "Routes":
      return yield* routes(invocation.action, invocation.client);
    case "Configure":
      return yield* configure;
    case "TitlesReport":
    case "TitlesSchedule":
      return yield* titles(invocation);
    case "MemoryKey":
    case "MemoryGet":
    case "MemorySql":
    case "MemoryTranscript":
      return yield* memory(invocation);
  }
});
