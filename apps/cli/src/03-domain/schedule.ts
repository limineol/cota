import { Result } from "effect";
import { DirectoryUnknown, type Paths } from "./paths.ts";
import type { System, Variables } from "./system.ts";

/** How often a reporter runs. */
export const intervalSeconds = 30;

/** The reporters `cota` schedules, each by the command that runs it: the title reporter and the request reporter. */
export type Reporter = "titles" | "requests";

const whatOf: Readonly<Record<Reporter, string>> = {
  titles: "Report session titles to the Cota hub",
  requests: "Report the model calls of client records to the Cota hub",
};

/** A reporter's names in each scheduler: `cota.<reporter>`, `cota-<reporter>.timer` and `.service`, and the task `cota <reporter>`. */
export const namesOf = (reporter: Reporter) => ({
  launchAgentLabel: `cota.${reporter}`,
  systemdTimer: `cota-${reporter}.timer`,
  systemdService: `cota-${reporter}.service`,
  taskName: `cota ${reporter}`,
});

/** A file of a schedule's definition, whole. */
export interface Definition {
  readonly path: string;
  readonly text: string;
}

/** A reporter's schedule on a system, as `cota titles schedule` and `cota requests schedule` install it (ADR-0022), with the name its scheduler knows it by: the LaunchAgent's label, the systemd timer, or the task. */
export type Schedule =
  | {
      readonly _tag: "LaunchAgent";
      readonly name: string;
      readonly plist: Definition;
    }
  | {
      readonly _tag: "Systemd";
      readonly name: string;
      readonly service: Definition;
      readonly timer: Definition;
    }
  | {
      readonly _tag: "TaskScheduler";
      readonly name: string;
      /** The task's definition as Task Scheduler takes it, kept in the state's directory to compare with. */
      readonly task: Definition;
    };

/** The variables a scheduled run is given where they are set: those that say where `cota`'s files and Codex's are. No other variable of the owner's reaches a schedule. */
export const carried = [
  "XDG_CONFIG_HOME",
  "XDG_STATE_HOME",
  "XDG_DATA_HOME",
  "CODEX_HOME",
] as const;

const carriedOf = (variables: Variables) =>
  carried.flatMap((name) => {
    const value = variables[name];
    return value === undefined || value === "" ? [] : [[name, value] as const];
  });

const xml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const plistOf = (
  reporter: Reporter,
  program: string,
  variables: Variables,
): string => {
  const environment = carriedOf(variables);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "\t<key>Label</key>",
    `\t<string>${namesOf(reporter).launchAgentLabel}</string>`,
    "\t<key>ProgramArguments</key>",
    "\t<array>",
    ...[program, reporter, "report"].map(
      (argument) => `\t\t<string>${xml(argument)}</string>`,
    ),
    "\t</array>",
    ...(environment.length === 0
      ? []
      : [
          "\t<key>EnvironmentVariables</key>",
          "\t<dict>",
          ...environment.flatMap(([name, value]) => [
            `\t\t<key>${name}</key>`,
            `\t\t<string>${xml(value)}</string>`,
          ]),
          "\t</dict>",
        ]),
    "\t<key>StartInterval</key>",
    `\t<integer>${intervalSeconds}</integer>`,
    "\t<key>RunAtLoad</key>",
    "\t<true/>",
    "\t<key>ProcessType</key>",
    "\t<string>Background</string>",
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
};

/** A word of a systemd unit's line, quoted as systemd reads it: `%` is a specifier and `$` a variable unless doubled. */
const systemdQuoted = (text: string) =>
  `"${text
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("%", "%%")
    .replaceAll("$", "$$$$")}"`;

const serviceOf = (
  reporter: Reporter,
  program: string,
  variables: Variables,
): string =>
  [
    "[Unit]",
    `Description=${whatOf[reporter]}`,
    "",
    "[Service]",
    "Type=oneshot",
    `ExecStart=${[program, reporter, "report"].map(systemdQuoted).join(" ")}`,
    ...carriedOf(variables).map(
      ([name, value]) => `Environment=${systemdQuoted(`${name}=${value}`)}`,
    ),
    "",
  ].join("\n");

const timerOf = (reporter: Reporter) =>
  [
    "[Unit]",
    `Description=${whatOf[reporter]} every ${intervalSeconds} seconds`,
    "",
    "[Timer]",
    `OnActiveSec=${intervalSeconds}s`,
    `OnUnitActiveSec=${intervalSeconds}s`,
    "AccuracySec=5s",
    "",
    "[Install]",
    "WantedBy=timers.target",
    "",
  ].join("\n");

/**
 * Task Scheduler's least interval is a minute, so the task has two triggers
 * half a minute apart, each repeating every minute; each run reports once.
 * The start is fixed, so that the definition is the same each time it is
 * written.
 */
const taskOf = (reporter: Reporter, program: string): string => {
  const trigger = (start: string) => [
    "    <TimeTrigger>",
    `      <StartBoundary>${start}</StartBoundary>`,
    "      <Repetition>",
    "        <Interval>PT1M</Interval>",
    "        <StopAtDurationEnd>false</StopAtDurationEnd>",
    "      </Repetition>",
    "      <Enabled>true</Enabled>",
    "    </TimeTrigger>",
  ];
  return [
    '<?xml version="1.0" encoding="UTF-16"?>',
    '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
    "  <RegistrationInfo>",
    `    <Description>${whatOf[reporter]}</Description>`,
    "  </RegistrationInfo>",
    "  <Triggers>",
    ...trigger("2026-01-01T00:00:00"),
    ...trigger("2026-01-01T00:00:30"),
    "  </Triggers>",
    "  <Principals>",
    '    <Principal id="Author">',
    "      <LogonType>InteractiveToken</LogonType>",
    "      <RunLevel>LeastPrivilege</RunLevel>",
    "    </Principal>",
    "  </Principals>",
    "  <Settings>",
    "    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>",
    "    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>",
    "    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>",
    "    <StartWhenAvailable>true</StartWhenAvailable>",
    "    <ExecutionTimeLimit>PT5M</ExecutionTimeLimit>",
    "    <Hidden>true</Hidden>",
    "  </Settings>",
    '  <Actions Context="Author">',
    "    <Exec>",
    `      <Command>${xml(program)}</Command>`,
    `      <Arguments>${reporter} report</Arguments>`,
    "    </Exec>",
    "  </Actions>",
    "</Task>",
    "",
  ].join("\r\n");
};

/**
 * A reporter's schedule on a system, running the `cota` given every
 * 30 seconds: a LaunchAgent in `~/Library/LaunchAgents` on macOS, a systemd
 * user service and timer in `$XDG_CONFIG_HOME/systemd/user` on Linux, and a
 * Task Scheduler task on Windows, whose definition is kept in the state's
 * directory.
 */
export const scheduleOf = (
  reporter: Reporter,
  system: System,
  variables: Variables,
  program: string,
  paths: Paths,
): Result.Result<Schedule, DirectoryUnknown> => {
  const names = namesOf(reporter);
  if (system === "win32") {
    return Result.succeed({
      _tag: "TaskScheduler",
      name: names.taskName,
      task: {
        path: `${paths.state}\\${reporter}-task.xml`,
        text: taskOf(reporter, program),
      },
    });
  }
  const home = variables.HOME;
  const absolute = (value: string | undefined): value is string =>
    value?.startsWith("/") === true;
  if (system === "darwin") {
    if (!absolute(home)) {
      return Result.fail(new DirectoryUnknown({ variable: "HOME" }));
    }
    return Result.succeed({
      _tag: "LaunchAgent",
      name: names.launchAgentLabel,
      plist: {
        path: `${home.replace(/\/+$/, "")}/Library/LaunchAgents/${names.launchAgentLabel}.plist`,
        text: plistOf(reporter, program, variables),
      },
    });
  }
  const configuration = absolute(variables.XDG_CONFIG_HOME)
    ? variables.XDG_CONFIG_HOME
    : absolute(home)
      ? `${home.replace(/\/+$/, "")}/.config`
      : undefined;
  if (configuration === undefined) {
    return Result.fail(new DirectoryUnknown({ variable: "HOME" }));
  }
  const units = `${configuration.replace(/\/+$/, "")}/systemd/user`;
  return Result.succeed({
    _tag: "Systemd",
    name: names.systemdTimer,
    service: {
      path: `${units}/${names.systemdService}`,
      text: serviceOf(reporter, program, variables),
    },
    timer: {
      path: `${units}/${names.systemdTimer}`,
      text: timerOf(reporter),
    },
  });
};

/** The files of a schedule's definition. */
export const definitionsOf = (
  schedule: Schedule,
): ReadonlyArray<Definition> => {
  switch (schedule._tag) {
    case "LaunchAgent":
      return [schedule.plist];
    case "Systemd":
      return [schedule.service, schedule.timer];
    case "TaskScheduler":
      return [schedule.task];
  }
};

/** The line that runs the reporter from a scheduler of the owner's own, where `cota` has none it can use: cron's, every minute, its least interval. */
export const cronLineOf = (program: string, reporter: Reporter): string =>
  `* * * * * '${program.replaceAll("'", "'\\''")}' ${reporter} report`;
