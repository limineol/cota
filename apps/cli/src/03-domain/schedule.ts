import { Result } from "effect";
import { DirectoryUnknown, type Paths } from "./paths.ts";
import type { System, Variables } from "./system.ts";

/** How often the title reporter runs. */
export const intervalSeconds = 30;

export const launchAgentLabel = "cota.titles";
export const systemdTimer = "cota-titles.timer";
export const systemdService = "cota-titles.service";
export const taskName = "cota titles";

/** A file of a schedule's definition, whole. */
export interface Definition {
  readonly path: string;
  readonly text: string;
}

/** The title reporter's schedule on a system, as `cota titles schedule` installs it (ADR-0022). */
export type Schedule =
  | { readonly _tag: "LaunchAgent"; readonly plist: Definition }
  | {
      readonly _tag: "Systemd";
      readonly service: Definition;
      readonly timer: Definition;
    }
  | {
      readonly _tag: "TaskScheduler";
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

const reportArguments = ["titles", "report"] as const;

const plistOf = (program: string, variables: Variables): string => {
  const environment = carriedOf(variables);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "\t<key>Label</key>",
    `\t<string>${launchAgentLabel}</string>`,
    "\t<key>ProgramArguments</key>",
    "\t<array>",
    ...[program, ...reportArguments].map(
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

const serviceOf = (program: string, variables: Variables): string =>
  [
    "[Unit]",
    "Description=Report session titles to the Cota hub",
    "",
    "[Service]",
    "Type=oneshot",
    `ExecStart=${[program, ...reportArguments].map(systemdQuoted).join(" ")}`,
    ...carriedOf(variables).map(
      ([name, value]) => `Environment=${systemdQuoted(`${name}=${value}`)}`,
    ),
    "",
  ].join("\n");

const timerText = [
  "[Unit]",
  `Description=Report session titles to the Cota hub every ${intervalSeconds} seconds`,
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
const taskOf = (program: string): string => {
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
    "    <Description>Report session titles to the Cota hub</Description>",
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
    `      <Arguments>${reportArguments.join(" ")}</Arguments>`,
    "    </Exec>",
    "  </Actions>",
    "</Task>",
    "",
  ].join("\r\n");
};

/**
 * The title reporter's schedule on a system, running the `cota` given every
 * 30 seconds: a LaunchAgent in `~/Library/LaunchAgents` on macOS, a systemd
 * user service and timer in `$XDG_CONFIG_HOME/systemd/user` on Linux, and a
 * Task Scheduler task on Windows, whose definition is kept in the state's
 * directory.
 */
export const scheduleOf = (
  system: System,
  variables: Variables,
  program: string,
  paths: Paths,
): Result.Result<Schedule, DirectoryUnknown> => {
  if (system === "win32") {
    return Result.succeed({
      _tag: "TaskScheduler",
      task: { path: `${paths.state}\\titles-task.xml`, text: taskOf(program) },
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
      plist: {
        path: `${home.replace(/\/+$/, "")}/Library/LaunchAgents/${launchAgentLabel}.plist`,
        text: plistOf(program, variables),
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
    service: {
      path: `${units}/${systemdService}`,
      text: serviceOf(program, variables),
    },
    timer: { path: `${units}/${systemdTimer}`, text: timerText },
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
export const cronLineOf = (program: string): string =>
  `* * * * * '${program.replaceAll("'", "'\\''")}' titles report`;
