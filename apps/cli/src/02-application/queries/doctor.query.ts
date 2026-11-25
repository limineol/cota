import {
  Context,
  DateTime,
  Duration,
  Effect,
  Layer,
  Option,
  Result,
} from "effect";
import { ClientRecords } from "#02-application/interfaces/client-records.ts";
import { Environment } from "#02-application/interfaces/environment.ts";
import { Files, type FilesFailed } from "#02-application/interfaces/files.ts";
import { Hub } from "#02-application/interfaces/hub.ts";
import { LoginShell } from "#02-application/interfaces/login-shell.ts";
import { Scheduler } from "#02-application/interfaces/scheduler.ts";
import { UserPath } from "#02-application/interfaces/user-path.ts";
import * as Check from "#03-domain/check.ts";
import * as Client from "#03-domain/client.ts";
import { configuredClients } from "#03-domain/client-files.ts";
import type {
  Configuration,
  ConfigurationInvalid,
  NotJoined,
} from "#03-domain/configuration.ts";
import {
  type HubFailed,
  type HubKeyUnknown,
  HubUnreachable,
  hubDeadline,
  keptScopes,
  type OpenedPool,
  type Scope,
} from "#03-domain/machine.ts";
import {
  type Paths,
  requestsErrorFile,
  requestsFile,
  requestsScratch,
  titlesErrorFile,
  titlesFile,
} from "#03-domain/paths.ts";
import * as Requests from "#03-domain/requests.ts";
import * as Schedule from "#03-domain/schedule.ts";
import * as Shims from "#03-domain/shims.ts";
import * as Titles from "#03-domain/titles.ts";
import * as UserPathEntries from "#03-domain/user-path.ts";
import { FindCommand } from "./find-command.query.ts";
import { LocateFiles } from "./locate-files.query.ts";
import { LocateShellFiles } from "./locate-shell-files.query.ts";
import { PlanClientFiles } from "./plan-client-files.query.ts";
import { PlanSchedule } from "./plan-schedule.query.ts";
import { ReadConfiguration } from "./read-configuration.query.ts";
import { ReadHubKeys } from "./read-hub-keys.query.ts";
import { ReadKeptAnswers } from "./read-kept-answers.query.ts";
import { ReadMachineLogins } from "./read-machine-logins.query.ts";

export class Doctor extends Context.Service<
  Doctor,
  {
    /** Runs every check, in order, each skipped when a check it needs failed; it reads and never writes. */
    readonly execute: Effect.Effect<ReadonlyArray<Check.Check>>;
  }
>()("@cota/cli/Doctor") {}

const joinCommand = (configuration: Option.Option<Configuration>) =>
  `cota join ${Option.match(configuration, {
    onNone: () => "<hub>",
    onSome: ({ hub }) => hub,
  })}`;

const quoted = (path: string) => `'${path.replaceAll("'", "'\\''")}'`;

/** The checks after one, skipped: a machine whose configuration does not read has nothing more to check. */
const skippedAfter = (id: Check.CheckId): ReadonlyArray<Check.Check> =>
  Check.CheckId.literals
    .slice(Check.CheckId.literals.indexOf(id) + 1)
    .map((each) => ({ id: each, ...Check.skipped }));

const octal = (mode: number) => mode.toString(8).padStart(3, "0");

const answerProblem = (
  scope: Scope,
  error: HubUnreachable | HubKeyUnknown | HubFailed,
) => {
  switch (error._tag) {
    case "HubKeyUnknown":
      return `the hub does not know the ${scope} hub key`;
    case "HubUnreachable":
      return `the hub did not say what the ${scope} hub key is within ${hubDeadline}`;
    case "HubFailed":
      return `the hub could not say what the ${scope} hub key is`;
  }
};

const unreadProblem = (
  error: NotJoined | ConfigurationInvalid | FilesFailed,
): string => {
  switch (error._tag) {
    case "NotJoined":
      return `this machine has not joined a hub: ${error.file} does not exist`;
    case "ConfigurationInvalid":
      return `${error.file} does not read:\n${error.problems}`;
    case "FilesFailed":
      return `${error.path} cannot be read: ${error.reason}`;
  }
};

const listed = (names: ReadonlyArray<string>) =>
  names.length <= 1
    ? names.join("")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

const claudeProtocol = "anthropic-messages";

/** How lately the title reporter must have run, which it does every 30 seconds. */
const reportersLately = "5 minutes";

const reporterNames: Readonly<Record<Schedule.Reporter, string>> = {
  titles: "title reporter",
  requests: "request reporter",
};

export const layer: Layer.Layer<
  Doctor,
  never,
  | Environment
  | Files
  | Hub
  | LoginShell
  | LocateFiles
  | LocateShellFiles
  | ReadConfiguration
  | ReadHubKeys
  | ReadMachineLogins
  | ReadKeptAnswers
  | FindCommand
  | PlanClientFiles
  | PlanSchedule
  | Scheduler
  | UserPath
  | ClientRecords
> = Layer.effect(
  Doctor,
  Effect.gen(function* () {
    const { system, variables, program } = yield* Environment;
    const files = yield* Files;
    const hub = yield* Hub;
    const loginShell = yield* LoginShell;
    const locate = yield* LocateFiles;
    const locateShellFiles = yield* LocateShellFiles;
    const read = yield* ReadConfiguration;
    const readHubKeys = yield* ReadHubKeys;
    const readLogins = yield* ReadMachineLogins;
    const readKept = yield* ReadKeptAnswers;
    const findCommand = yield* FindCommand;
    const planClientFiles = yield* PlanClientFiles;
    const userPath = yield* UserPath;
    const planSchedule = yield* PlanSchedule;
    const scheduler = yield* Scheduler;
    const records = yield* ClientRecords;

    const withinDeadline = <A, E>(effect: Effect.Effect<A, E>) =>
      effect.pipe(
        Effect.timeoutOrElse({
          duration: hubDeadline,
          orElse: () => Effect.fail(new HubUnreachable()),
        }),
      );

    const configCheck = Effect.fn(function* (paths: Paths) {
      const configuration = yield* Effect.result(read.execute(paths));
      if (Result.isSuccess(configuration)) {
        return {
          outcome: Check.passed,
          configuration: Option.some(configuration.success),
        };
      }
      const fix = joinCommand(Option.none());
      return {
        outcome: Check.failed(unreadProblem(configuration.failure), fix),
        configuration: Option.none<Configuration>(),
      };
    });

    const hubCheck = Effect.fn(function* (configuration: Configuration) {
      const answered = yield* Effect.result(
        withinDeadline(hub.health(configuration.hub)),
      );
      if (Result.isSuccess(answered)) return Check.passed;
      const fix = `check the address and the network; ${joinCommand(Option.some(configuration))} to change it`;
      const error = answered.failure;
      return error._tag === "HubFailed" && error.status !== undefined
        ? Check.failed(
            `${configuration.hub} answers GET /health with ${error.status}`,
            fix,
          )
        : Check.failed(
            `${configuration.hub} does not answer GET /health within ${hubDeadline}`,
            fix,
          );
    });

    const hubKeysCheck = Effect.fn(function* (
      paths: Paths,
      configuration: Configuration,
    ) {
      const fix = joinCommand(Option.some(configuration));
      const pools: Array<OpenedPool> = [];
      const observedPools: Array<string> = [];
      const keys = yield* Effect.result(readHubKeys.execute(paths));
      if (Result.isFailure(keys)) {
        return {
          outcome: Check.failed(
            `${keys.failure.path} cannot be read: ${keys.failure.reason}`,
            fix,
          ),
          pools,
          observedPools,
        };
      }
      const problems: Array<string> = [];
      for (const scope of keptScopes) {
        const key = keys.success[scope];
        if (Option.isNone(key)) continue;
        const answer = yield* Effect.result(
          withinDeadline(hub.machine(configuration.hub, key.value)),
        );
        if (Result.isFailure(answer)) {
          problems.push(answerProblem(scope, answer.failure));
        } else if (answer.success.hubKey.scope !== scope) {
          problems.push(
            `the hub key kept as the ${scope} one is a ${answer.success.hubKey.scope} key`,
          );
        } else {
          pools.push(...answer.success.pools);
          observedPools.push(...answer.success.observedPools);
        }
      }
      if (problems.length > 0) {
        return {
          outcome: Check.failed(problems.join("; "), fix),
          pools,
          observedPools,
        };
      }
      if (
        Option.isNone(keys.success.subscription) &&
        Option.isNone(keys.success.keyed)
      ) {
        return {
          outcome: Check.failed("this machine keeps no hub key", fix),
          pools,
          observedPools,
        };
      }
      if (Option.isNone(keys.success.keyed)) {
        return {
          outcome: Check.warned(
            "this machine has no keyed hub key, so OpenCode and Pi reach no pool through the hub",
            `${fix}, with a keyed hub key among the keys`,
          ),
          pools,
          observedPools,
        };
      }
      return { outcome: Check.passed, pools, observedPools };
    });

    const filesCheck = Effect.fn(function* (paths: Paths) {
      if (system === "win32") return Check.skipped;
      const inside = (directory: string) =>
        Effect.map(files.list(directory), (names) =>
          names.map((name) => `${directory}${paths.separator}${name}`),
        );
      const scratch = requestsScratch(paths);
      const expected: ReadonlyArray<readonly [string, number]> = [
        ...[
          paths.configuration,
          paths.hubKeys,
          paths.logins,
          paths.state,
          scratch,
        ].map((directory) => [directory, 0o700] as const),
        ...[
          paths.configurationFile,
          ...(yield* inside(paths.hubKeys)),
          ...(yield* inside(paths.logins)),
          ...(yield* inside(paths.state)).filter((path) => path !== scratch),
        ].map((file) => [file, 0o600] as const),
      ];
      const wrong: Array<{ path: string; mode: number; wanted: number }> = [];
      for (const [path, wanted] of expected) {
        const mode = yield* files.modeOf(path);
        if (Option.isSome(mode) && (mode.value & 0o777) !== wanted) {
          wrong.push({ path, mode: mode.value & 0o777, wanted });
        }
      }
      if (wrong.length === 0) return Check.passed;
      return Check.failed(
        wrong
          .map(
            ({ path, mode, wanted }) =>
              `${path} is ${octal(mode)}, not ${octal(wanted)}`,
          )
          .join("; "),
        wrong
          .map(({ path, wanted }) => `chmod ${octal(wanted)} ${quoted(path)}`)
          .join(" && "),
      );
    });

    const home = (
      (system === "win32" ? variables.USERPROFILE : variables.HOME) ?? ""
    ).replace(/[\\/]+$/, "");

    /**
     * The Git checkout a path is inside: the nearest directory above it that
     * holds a `.git`, a file in a worktree. The walk stops below the home
     * directory, which may itself be a repository of the owner's dotfiles.
     */
    const checkoutOf = Effect.fn(function* (path: string, paths: Paths) {
      const parts = path.split(paths.separator);
      for (let end = parts.length - 1; end > 0; end--) {
        const directory = parts.slice(0, end).join(paths.separator);
        if (home !== "" && directory === home) break;
        const git = yield* files
          .modeOf(`${directory}${paths.separator}.git`)
          .pipe(Effect.orElseSucceed(() => Option.none<number>()));
        if (Option.isSome(git)) return Option.some(directory);
      }
      return Option.none<string>();
    });

    const stableFix = (cota: string) =>
      system === "win32"
        ? `copy "${cota}" to %LOCALAPPDATA%\\Programs\\cota\\cota.exe, then run cota shims with that one`
        : `install -m 0755 ${quoted(cota)} ~/.local/bin/cota && ~/.local/bin/cota shims`;

    const shimsCheck = Effect.fn(function* (paths: Paths) {
      const problems: Array<string> = [];
      const inCheckouts = new Map<string, string>();
      let missing = 0;
      for (const command of Client.commands) {
        const file = `${paths.shims}${paths.separator}${Shims.shimOf(system, "", command).name}`;
        const head = yield* files
          .head(file, Shims.shimHeadBytes)
          .pipe(Effect.orElseSucceed(() => Option.none<string>()));
        if (Option.isNone(head)) {
          missing++;
          problems.push(`${file} is missing`);
          continue;
        }
        if (!Shims.isShim(head.value)) {
          problems.push(`${file} is not a shim of cota's`);
          continue;
        }
        const cota = Shims.cotaOf(head.value);
        if (Option.isNone(cota) || !(yield* files.executable(cota.value))) {
          problems.push(
            `${file} runs ${Option.getOrElse(cota, () => "no cota")}, which does not exist`,
          );
          continue;
        }
        if (!inCheckouts.has(cota.value)) {
          const checkout = yield* checkoutOf(cota.value, paths);
          if (Option.isSome(checkout))
            inCheckouts.set(cota.value, checkout.value);
        }
      }
      if (missing === Client.commands.length) {
        return {
          installed: false,
          outcome: Check.warned(
            "no shims are installed, so a client started by its own name skips cota: only cota <client> launches through the hub",
            "cota shims",
          ),
        };
      }
      if (problems.length > 0) {
        return {
          installed: false,
          outcome: Check.failed(problems.join("; "), "cota shims"),
        };
      }
      const [inCheckout] = inCheckouts;
      if (inCheckout === undefined) {
        return { installed: true, outcome: Check.passed };
      }
      const [cota, checkout] = inCheckout;
      return {
        installed: true,
        outcome: Check.warned(
          `the shims run ${cota}, inside the Git checkout ${checkout}, so a rebuild, a switch of branch or a git clean there changes or removes what every launch runs`,
          stableFix(cota),
        ),
      };
    });

    const userPathCheck = Effect.fn(function* (paths: Paths) {
      const path = yield* Effect.result(userPath.read);
      if (Result.isFailure(path)) {
        return Check.failed(path.failure.reason, "cota shims");
      }
      return UserPathEntries.startsWithShims(path.success, paths.shims)
        ? Check.passed
        : Check.failed(
            `the user's Path does not start with ${paths.shims}, so a new terminal does not find the shims first`,
            "cota shims",
          );
    });

    const pathCheck = Effect.fn(function* (paths: Paths) {
      if (system === "win32") return yield* userPathCheck(paths);
      const shellFiles = yield* Effect.result(locateShellFiles.execute);
      if (Result.isFailure(shellFiles)) {
        return Check.failed(
          `where the shell's files are cannot be known: ${shellFiles.failure.variable} is not set`,
          `set ${shellFiles.failure.variable}, then cota shims`,
        );
      }
      const problems: Array<string> = [];
      for (const file of shellFiles.success.lineFiles) {
        const text = yield* files
          .read(file)
          .pipe(Effect.orElseSucceed(() => Option.none<string>()));
        if (!Option.exists(text, Shims.isPathLineLast)) {
          problems.push(`cota's PATH line is not the last line of ${file}`);
        }
      }
      if (shellFiles.success.shell === "fish") {
        const text = yield* files
          .read(shellFiles.success.fish)
          .pipe(Effect.orElseSucceed(() => Option.none<string>()));
        if (!Option.contains(text, Shims.fishFileOf(paths.shims))) {
          problems.push(
            `${shellFiles.success.fish} does not put ${paths.shims} first on PATH`,
          );
        }
      }
      const shell =
        variables.SHELL === undefined || variables.SHELL === ""
          ? "/bin/sh"
          : variables.SHELL;
      for (const command of Client.commands) {
        const found = yield* loginShell.find(shell, command, variables);
        const shim = `${paths.shims}${paths.separator}${command}`;
        if (!Option.contains(found, shim)) {
          problems.push(
            `a new login shell (${shell}) finds ${command} ${Option.match(
              found,
              {
                onNone: () => "nowhere",
                onSome: (path) => `at ${path}`,
              },
            )}, not at ${shim}`,
          );
        }
      }
      return problems.length === 0
        ? Check.passed
        : Check.failed(problems.join("; "), "cota shims");
    });

    // Another gateway's wrapper is a script of its own; a client a package
    // manager installed is a program, or a link to the package's own script.
    const isScript = Effect.fn(function* (path: string) {
      if (yield* files.isLink(path)) return false;
      const head = yield* files
        .head(path, 2)
        .pipe(Effect.orElseSucceed(() => Option.none<string>()));
      return Option.exists(head, (text) => text.startsWith("#!"));
    });

    const pathLinesAfterCotas = Effect.fn(function* () {
      if (system === "win32") return [];
      const shellFiles = yield* Effect.result(locateShellFiles.execute);
      if (Result.isFailure(shellFiles)) return [];
      const after: Array<{ readonly file: string; readonly line: string }> = [];
      for (const file of shellFiles.success.lineFiles) {
        const text = yield* files
          .read(file)
          .pipe(Effect.orElseSucceed(() => Option.none<string>()));
        if (Option.isNone(text)) continue;
        for (const line of Shims.pathLinesAfterCotas(text.value)) {
          after.push({ file, line: line.trim() });
        }
      }
      return after;
    });

    const clientsCheck = Effect.fn(function* (paths: Paths) {
      const missing: Array<string> = [];
      const found: Array<string> = [];
      const scripts: Array<string> = [];
      for (const command of Client.commands) {
        const path = yield* findCommand.execute(
          command,
          variables,
          Option.some(paths.shims),
        );
        if (Option.isNone(path)) {
          missing.push(command);
          continue;
        }
        found.push(`${command} at ${path.value}`);
        if (yield* isScript(path.value)) scripts.push(path.value);
      }
      const after = yield* pathLinesAfterCotas();
      const problems: Array<string> = [];
      const fixes: Array<string> = [];
      if (missing.length > 0) {
        problems.push(
          `no ${listed(missing)} on PATH beyond cota's shims, so ${missing.length === 1 ? "it does" : "they do"} not launch`,
        );
        fixes.push(`install ${listed(missing)}, then run cota doctor`);
      }
      if (scripts.length > 0) {
        const one = scripts.length === 1;
        problems.push(
          `${listed(scripts)} ${one ? "is a script, not the client itself" : "are scripts, not the clients themselves"}, and every launch through cota runs ${one ? "it" : "them"}: another gateway's wrapper is such a script (it sets a provider's base URL or key), and then the owner takes that gateway's directory off PATH or removes its setup; a version manager's shim, such as asdf's, is such a script too, and is fine`,
        );
        fixes.push(
          `head -n 20 ${scripts.map(quoted).join(" ")} to see which ${one ? "it is" : "each is"}, then cota doctor`,
        );
      }
      for (const { file, line } of after) {
        problems.push(
          `${file} changes PATH after cota's line (${line}), so the directories it adds come before cota's shims`,
        );
      }
      if (after.length > 0) {
        fixes.push("cota shims, which moves cota's line back to the end");
      }
      if (problems.length === 0) {
        return found.length === 0
          ? Check.passed
          : Check.passedFinding(found.join(", "));
      }
      if (found.length > 0) problems.push(`found ${found.join(", ")}`);
      return Check.warned(problems.join("; "), fixes.join(", and "));
    });

    const ownPoolsCheck = (
      paths: Paths,
      configuration: Configuration,
      pools: ReadonlyArray<OpenedPool>,
    ) => {
      const problems: Array<string> = [];
      for (const command of Client.routedCommands) {
        const client = Client.routedClientOf[command];
        const own = configuration.clients?.[client]?.own_pool;
        if (own === undefined) continue;
        const pool = pools.find((each) => each.id === own);
        const protocol = Client.protocolOf[command];
        if (pool === undefined) {
          problems.push(
            `clients.${client}.own_pool is ${own}, which is not a pool this machine's hub keys open`,
          );
        } else if (pool.kind !== "subscription" || pool.protocol !== protocol) {
          problems.push(
            `clients.${client}.own_pool is ${own}, a ${pool.kind} pool of ${pool.protocol}, not a subscription pool of ${protocol}`,
          );
        }
      }
      return problems.length === 0
        ? Check.passed
        : Check.failed(
            problems.join("; "),
            `edit own_pool in ${quoted(paths.configurationFile)} to a pool of the client's own login, or remove it`,
          );
    };

    const loginsCheck = Effect.fn(function* (
      paths: Paths,
      pools: ReadonlyArray<OpenedPool>,
    ) {
      const logins = yield* Effect.result(readLogins.execute(paths));
      if (Result.isFailure(logins)) {
        return Check.failed(
          `${logins.failure.path} cannot be read: ${logins.failure.reason}`,
          `chmod 700 ${quoted(paths.logins)}`,
        );
      }
      const wrong = [...logins.success.keys()].filter(
        (login) =>
          !pools.some(
            (pool) =>
              pool.id === login &&
              pool.kind === "subscription" &&
              pool.protocol === claudeProtocol,
          ),
      );
      return wrong.length === 0
        ? Check.passed
        : Check.failed(
            `the machine ${wrong.length === 1 ? "login" : "logins"} of ${listed(wrong)} ${wrong.length === 1 ? "is" : "are"} not for a subscription pool of ${claudeProtocol} this machine's hub keys open`,
            wrong.map((pool) => `cota logout ${pool}`).join(" && "),
          );
    });

    const keptRoutesCheck = Effect.fn(function* (paths: Paths) {
      const kept = yield* Effect.result(readKept.execute(paths));
      if (Result.isFailure(kept)) {
        return Check.failed(
          `${kept.failure.path} cannot be read: ${kept.failure.reason}`,
          `chmod 600 ${quoted(kept.failure.path)}`,
        );
      }
      return Option.match(kept.success.problem, {
        onNone: () => Check.passed,
        onSome: (problem) =>
          Check.warned(
            `${kept.success.file} does not read (${problem.split("\n")[0]}), so a launch whose hub cannot be reached goes direct as if this machine had never launched there`,
            `rm ${quoted(kept.success.file)}`,
          ),
      });
    });

    const configuredCheck = Effect.fn(function* (
      paths: Paths,
      configuration: Configuration,
    ) {
      const { plans } = yield* planClientFiles.execute(paths, {
        _tag: "Asked",
        configuration,
        clients: configuredClients,
      });
      if (plans.length === 0) return Check.skipped;
      const behind: Array<string> = [];
      const refused: Array<{
        file: string;
        reason: string;
        theFiles: boolean;
      }> = [];
      for (const plan of plans) {
        if (Result.isFailure(plan.after)) {
          refused.push({ file: plan.file, ...plan.after.failure });
        } else if (
          plan.after.success !== Option.getOrElse(plan.before, () => "")
        ) {
          behind.push(plan.file);
        }
      }
      const problems = [
        ...behind.map(
          (file) => `${file} is not what cota configure would write now`,
        ),
        ...refused.map(
          ({ file, reason }) =>
            `cota configure cannot rewrite ${file}: ${reason}`,
        ),
      ];
      if (problems.length === 0) return Check.passed;
      const toEdit = refused.filter(({ theFiles }) => theFiles);
      return Check.failed(
        problems.join("; "),
        toEdit.length === 0
          ? "cota configure"
          : `edit ${toEdit.map(({ file }) => quoted(file)).join(" and ")} as the problem says, then cota configure`,
      );
    });

    /** Whether a reporter is scheduled as `cota <reporter> schedule` installs it, ran lately, and did not fail; its problems and fixes. */
    const reporterProblems = Effect.fn(function* (
      paths: Paths,
      reporter: Schedule.Reporter,
      ranAt: Option.Option<DateTime.Utc>,
      errorFile: string,
    ) {
      const named = reporterNames[reporter];
      const problems: Array<string> = [];
      const fixes: Array<string> = [];
      const reschedule = `cota ${reporter} schedule`;
      const planned = yield* Effect.result(
        planSchedule.execute(paths, reporter),
      );
      if (Result.isFailure(planned)) {
        const { variable } = planned.failure;
        problems.push(
          `where the ${named}'s schedule goes cannot be known: ${variable} is not set`,
        );
        fixes.push(`set ${variable}, then ${reschedule}`);
        return { problems, fixes };
      }
      const now = yield* DateTime.now;
      const ranLately = Option.exists(ranAt, (at) =>
        Duration.isLessThan(DateTime.distance(at, now), Duration.minutes(5)),
      );
      const installed = yield* Effect.result(
        scheduler.installed(planned.success),
      );
      if (Result.isFailure(installed)) {
        const error = installed.failure;
        if (error._tag === "SchedulerFailed") {
          problems.push(
            `whether the ${named} is scheduled cannot be known: ${error.reason}`,
          );
          fixes.push(reschedule);
        } else if (!ranLately) {
          problems.push(
            `this system has no scheduler cota can use (${error.reason}), and the ${named} has not run in the last ${reportersLately}`,
          );
          fixes.push(
            `edit your crontab (crontab -e) to add ${Schedule.cronLineOf(program, reporter)}`,
          );
        }
      } else if (installed.success === "absent") {
        problems.push(`the ${named} is not scheduled`);
        fixes.push(reschedule);
      } else if (installed.success === "otherwise") {
        problems.push(
          `the ${named}'s schedule is not the one ${reschedule} installs`,
        );
        fixes.push(reschedule);
      }
      if (Result.isSuccess(installed) && !ranLately) {
        problems.push(
          Option.match(ranAt, {
            onNone: () => `the ${named} has not run yet`,
            onSome: (at) =>
              `the ${named} last ran at ${DateTime.formatIso(at)}, over ${reportersLately} ago`,
          }),
        );
        if (fixes.length === 0) fixes.push(reschedule);
      }
      const error = yield* files
        .read(errorFile)
        .pipe(Effect.orElseSucceed(() => Option.none<string>()));
      if (Option.isSome(error)) {
        problems.push(`the ${named}'s last run failed: ${error.value.trim()}`);
        fixes.push(`fix what that says, then cota ${reporter} report`);
      }
      return { problems, fixes };
    });

    const titlesCheck = Effect.fn(function* (paths: Paths) {
      const ranAt = Option.map(
        Option.flatMap(
          yield* files
            .read(titlesFile(paths))
            .pipe(Effect.orElseSucceed(() => Option.none<string>())),
          Titles.stateOf,
        ),
        ({ ranAt }) => ranAt,
      );
      const { problems, fixes } = yield* reporterProblems(
        paths,
        "titles",
        ranAt,
        titlesErrorFile(paths),
      );
      return problems.length === 0
        ? Check.passed
        : Check.failed(problems.join("; "), fixes.join(", and "));
    });

    const requestsCheck = Effect.fn(function* (
      paths: Paths,
      configuration: Configuration,
      observedPools: ReadonlyArray<string>,
    ) {
      const folders = configuration.clients?.antigravity?.reported ?? [];
      if (folders.length === 0) return Check.skipped;
      const state = Requests.stateOf(
        yield* files
          .read(requestsFile(paths))
          .pipe(Effect.orElseSucceed(() => Option.none<string>())),
      );
      const ranAt = Option.flatMap(state, (each) =>
        Option.flatMap(
          Option.fromUndefinedOr(
            [...each.values()]
              .flatMap((folder) => Option.toArray(folder.ranAt))
              .sort()
              .at(-1),
          ),
          (at) => Option.map(DateTime.make(at), DateTime.toUtc),
        ),
      );
      const { problems, fixes } = yield* reporterProblems(
        paths,
        "requests",
        ranAt,
        requestsErrorFile(paths),
      );
      for (const { folder, pool } of folders) {
        if (
          Option.isNone(
            yield* records
              .folder(folder)
              .pipe(Effect.orElseSucceed(() => Option.none<string>())),
          )
        ) {
          problems.push(`the data folder ${folder} does not exist`);
          fixes.push(`cota requests remove antigravity ${quoted(folder)}`);
        } else if (!observedPools.includes(pool)) {
          problems.push(
            `the hub has no observed pool ${pool}, which ${folder} bills`,
          );
          fixes.push(
            `cota requests add antigravity ${quoted(folder)} <an observed pool>`,
          );
        }
      }
      const notReported = Option.match(state, {
        onNone: () => [],
        onSome: (each) =>
          [...each].flatMap(([folder, kept]) =>
            [...kept.conversations].flatMap(([conversation, cursor]) =>
              Option.match(cursor.notReported, {
                onNone: () => [],
                onSome: ({ reason }) => [
                  `${folder}'s conversation ${conversation} is not reported (${reason})`,
                ],
              }),
            ),
          ),
      });
      const show =
        "cota requests show; where the reason is schema or unreadable-step, Antigravity's record changed: open an issue";
      if (problems.length > 0) {
        return Check.failed(
          [...problems, ...notReported].join("; "),
          [...fixes, ...(notReported.length > 0 ? [show] : [])].join(", and "),
        );
      }
      return notReported.length === 0
        ? Check.passed
        : Check.warned(notReported.join("; "), show);
    });

    const memoryCheck = Effect.fn(function* (
      paths: Paths,
      configuration: Configuration,
    ) {
      const fix = "cota memory key";
      const key = yield* Effect.result(readHubKeys.reader(paths));
      if (Result.isFailure(key)) {
        return Check.failed(
          `${key.failure.path} cannot be read: ${key.failure.reason}`,
          fix,
        );
      }
      if (Option.isNone(key.success)) {
        return Check.warned(
          "this machine keeps no reader key, so coding agents on it cannot read the request log with cota memory",
          `${fix}, if the owner wants this machine's agents to read the request log`,
        );
      }
      const answer = yield* Effect.result(
        withinDeadline(hub.machine(configuration.hub, key.success.value)),
      );
      if (Result.isFailure(answer)) {
        return Check.failed(answerProblem("reader", answer.failure), fix);
      }
      const { scope } = answer.success.hubKey;
      return scope === "reader"
        ? Check.passed
        : Check.failed(
            `the hub key kept as the reader one is a ${scope} key`,
            fix,
          );
    });

    return Doctor.of({
      execute: Effect.gen(function* () {
        const located = yield* Effect.result(locate.execute);
        if (Result.isFailure(located)) {
          const { variable } = located.failure;
          return [
            {
              id: "config",
              ...Check.failed(
                `where the configuration is cannot be known: ${variable} is not set`,
                `set ${variable}, then ${joinCommand(Option.none())}`,
              ),
            },
            ...skippedAfter("config"),
          ] satisfies ReadonlyArray<Check.Check>;
        }
        const paths = located.success;
        const config = yield* configCheck(paths);
        const hubOutcome = yield* Option.match(config.configuration, {
          onNone: () => Effect.succeed(Check.skipped),
          onSome: hubCheck,
        });
        const hubKeys =
          hubOutcome.outcome === "passed" && Option.isSome(config.configuration)
            ? yield* hubKeysCheck(paths, config.configuration.value)
            : { outcome: Check.skipped, pools: [], observedPools: [] };
        const filesOutcome = Option.isNone(config.configuration)
          ? Check.skipped
          : yield* filesCheck(paths).pipe(
              Effect.catchTag("FilesFailed", (error) =>
                Effect.succeed(
                  Check.failed(
                    `${error.path} cannot be read: ${error.reason}`,
                    `chmod 700 ${quoted(paths.configuration)}`,
                  ),
                ),
              ),
            );
        const head = [
          { id: "config", ...config.outcome },
          { id: "hub", ...hubOutcome },
          { id: "hub-keys", ...hubKeys.outcome },
          { id: "files", ...filesOutcome },
        ] satisfies ReadonlyArray<Check.Check>;
        if (Option.isNone(config.configuration)) {
          return [...head, ...skippedAfter("files")];
        }
        const configuration = config.configuration.value;
        const shims =
          configuration.shims === false
            ? { installed: false, outcome: Check.skipped }
            : yield* shimsCheck(paths);
        const pathOutcome = shims.installed
          ? yield* pathCheck(paths)
          : Check.skipped;
        const answered =
          hubKeys.outcome.outcome === "passed" ||
          hubKeys.outcome.outcome === "warned";
        return [
          ...head,
          { id: "shims", ...shims.outcome },
          { id: "path", ...pathOutcome },
          { id: "clients", ...(yield* clientsCheck(paths)) },
          {
            id: "own-pools",
            ...(answered
              ? ownPoolsCheck(paths, configuration, hubKeys.pools)
              : Check.skipped),
          },
          {
            id: "logins",
            ...(answered
              ? yield* loginsCheck(paths, hubKeys.pools)
              : Check.skipped),
          },
          { id: "kept-routes", ...(yield* keptRoutesCheck(paths)) },
          {
            id: "configured",
            ...(answered
              ? yield* configuredCheck(paths, configuration)
              : Check.skipped),
          },
          { id: "titles", ...(yield* titlesCheck(paths)) },
          {
            id: "requests",
            ...(answered
              ? yield* requestsCheck(
                  paths,
                  configuration,
                  hubKeys.observedPools,
                )
              : Check.skipped),
          },
          {
            id: "memory",
            ...(hubOutcome.outcome === "passed"
              ? yield* memoryCheck(paths, configuration)
              : Check.skipped),
          },
        ] satisfies ReadonlyArray<Check.Check>;
      }).pipe(Effect.withSpan("Doctor.execute")),
    });
  }),
);
