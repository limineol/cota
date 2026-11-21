import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Effect, Layer } from "effect";
import {
  type Installed,
  Scheduler,
  SchedulerFailed,
  SchedulerUnavailable,
} from "#02-application/interfaces/scheduler.ts";
import * as Schedule from "#03-domain/schedule.ts";
import type { System } from "#03-domain/system.ts";

/** What a program the scheduler adapter ran gave back; a program that could not start exits 127. */
export interface Ran {
  readonly exitCode: number;
  readonly output: string;
}

/** Runs a program to its end with these arguments, none of them a secret. */
export type Run = (
  command: string,
  args: ReadonlyArray<string>,
) => Promise<Ran>;

export const run: Run = async (command, args) => {
  try {
    const child = Bun.spawn([command, ...args], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { exitCode, output: `${out}${err}`.trim() };
  } catch {
    return { exitCode: 127, output: `${command} could not be started` };
  }
};

const reasonOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const failed = (reason: string) => new SchedulerFailed({ reason });

const readText = async (
  path: string,
  encoding: "utf8" | "utf16le",
): Promise<string | undefined> => {
  try {
    const text = await readFile(path, encoding);
    return encoding === "utf16le" ? text.replace(/^﻿/, "") : text;
  } catch (cause) {
    if (
      typeof cause === "object" &&
      cause !== null &&
      "code" in cause &&
      cause.code === "ENOENT"
    ) {
      return undefined;
    }
    throw cause;
  }
};

const writeText = async (
  definition: Schedule.Definition,
  encoding: "utf8" | "utf16le",
) => {
  await mkdir(dirname(definition.path), { recursive: true });
  await writeFile(
    definition.path,
    encoding === "utf16le" ? `﻿${definition.text}` : definition.text,
    { encoding, mode: 0o644 },
  );
};

/** Whether each file of a definition holds what it should, none of them being there, or some other. */
const definitionState = async (
  definitions: ReadonlyArray<Schedule.Definition>,
  encoding: "utf8" | "utf16le",
): Promise<"as given" | "otherwise" | "absent"> => {
  const read = await Promise.all(
    definitions.map(({ path }) => readText(path, encoding)),
  );
  if (read.every((text) => text === undefined)) return "absent";
  return read.every((text, index) => text === definitions[index]?.text)
    ? "as given"
    : "otherwise";
};

const attempt = <A>(
  work: () => Promise<A>,
): Effect.Effect<A, SchedulerFailed> =>
  Effect.tryPromise({ try: work, catch: (cause) => failed(reasonOf(cause)) });

const must = async (ran: Promise<Ran>, what: string): Promise<void> => {
  const { exitCode, output } = await ran;
  if (exitCode !== 0) {
    throw new Error(
      `${what} exited ${exitCode}${output === "" ? "" : `: ${output}`}`,
    );
  }
};

const launchd = (run: Run, uid: number): Scheduler["Service"] => {
  const domain = `gui/${uid}`;
  const service = `${domain}/${Schedule.launchAgentLabel}`;
  const loaded = async () =>
    (await run("launchctl", ["print", service])).exitCode === 0;
  const plistOf = (schedule: Schedule.Schedule) =>
    schedule._tag === "LaunchAgent" ? [schedule.plist] : [];
  return Scheduler.of({
    installed: (schedule) =>
      attempt(async (): Promise<Installed> => {
        const files = await definitionState(plistOf(schedule), "utf8");
        if (files === "absent")
          return (await loaded()) ? "otherwise" : "absent";
        return files === "as given" && (await loaded())
          ? "as given"
          : "otherwise";
      }),
    install: (schedule) =>
      attempt(async () => {
        for (const plist of plistOf(schedule)) {
          await writeText(plist, "utf8");
          if (await loaded()) {
            await must(
              run("launchctl", ["bootout", service]),
              "launchctl bootout",
            );
          }
          await must(
            run("launchctl", ["bootstrap", domain, plist.path]),
            "launchctl bootstrap",
          );
        }
      }),
    remove: (schedule) =>
      attempt(async () => {
        const wasLoaded = await loaded();
        if (wasLoaded) {
          await must(
            run("launchctl", ["bootout", service]),
            "launchctl bootout",
          );
        }
        let removed = wasLoaded;
        for (const plist of plistOf(schedule)) {
          if ((await readText(plist.path, "utf8")) !== undefined) {
            await rm(plist.path, { force: true });
            removed = true;
          }
        }
        return removed;
      }),
  });
};

const systemd = (run: Run): Scheduler["Service"] => {
  const user = (...args: ReadonlyArray<string>) =>
    run("systemctl", ["--user", ...args]);
  const unitsOf = (schedule: Schedule.Schedule) =>
    schedule._tag === "Systemd" ? [schedule.service, schedule.timer] : [];
  const available = Effect.tryPromise({
    try: () => user("show-environment"),
    catch: (cause) => new SchedulerUnavailable({ reason: reasonOf(cause) }),
  }).pipe(
    Effect.flatMap(({ exitCode, output }) =>
      exitCode === 0
        ? Effect.void
        : Effect.fail(
            new SchedulerUnavailable({
              reason:
                exitCode === 127
                  ? "systemctl is not installed"
                  : `systemctl --user has no user session${output === "" ? "" : `: ${output.split("\n")[0]}`}`,
            }),
          ),
    ),
  );
  return Scheduler.of({
    installed: (schedule) =>
      Effect.andThen(
        available,
        attempt(async (): Promise<Installed> => {
          const files = await definitionState(unitsOf(schedule), "utf8");
          const enabled =
            (await user("is-enabled", Schedule.systemdTimer)).exitCode === 0 &&
            (await user("is-active", Schedule.systemdTimer)).exitCode === 0;
          if (files === "absent") return enabled ? "otherwise" : "absent";
          return files === "as given" && enabled ? "as given" : "otherwise";
        }),
      ),
    install: (schedule) =>
      Effect.andThen(
        available,
        attempt(async () => {
          for (const unit of unitsOf(schedule)) await writeText(unit, "utf8");
          await must(user("daemon-reload"), "systemctl --user daemon-reload");
          await must(
            user("enable", Schedule.systemdTimer),
            "systemctl --user enable",
          );
          await must(
            user("restart", Schedule.systemdTimer),
            "systemctl --user restart",
          );
        }),
      ),
    remove: (schedule) =>
      Effect.andThen(
        available,
        attempt(async () => {
          const wasEnabled =
            (await user("is-enabled", Schedule.systemdTimer)).exitCode === 0;
          await user("disable", "--now", Schedule.systemdTimer);
          let removed = wasEnabled;
          for (const unit of unitsOf(schedule)) {
            if ((await readText(unit.path, "utf8")) !== undefined) {
              await rm(unit.path, { force: true });
              removed = true;
            }
          }
          if (removed) {
            await must(user("daemon-reload"), "systemctl --user daemon-reload");
          }
          return removed;
        }),
      ),
  });
};

const taskScheduler = (run: Run): Scheduler["Service"] => {
  const name = Schedule.taskName;
  const exists = async () =>
    (await run("schtasks", ["/Query", "/TN", name])).exitCode === 0;
  const taskOf = (schedule: Schedule.Schedule) =>
    schedule._tag === "TaskScheduler" ? [schedule.task] : [];
  return Scheduler.of({
    installed: (schedule) =>
      attempt(async (): Promise<Installed> => {
        const kept = await definitionState(taskOf(schedule), "utf16le");
        const registered = await exists();
        if (!registered) return kept === "absent" ? "absent" : "otherwise";
        return kept === "as given" ? "as given" : "otherwise";
      }),
    install: (schedule) =>
      attempt(async () => {
        for (const task of taskOf(schedule)) {
          await writeText(task, "utf16le");
          await must(
            run("schtasks", ["/Create", "/TN", name, "/XML", task.path, "/F"]),
            "schtasks /Create",
          );
        }
      }),
    remove: (schedule) =>
      attempt(async () => {
        const registered = await exists();
        if (registered) {
          await must(
            run("schtasks", ["/Delete", "/TN", name, "/F"]),
            "schtasks /Delete",
          );
        }
        let removed = registered;
        for (const task of taskOf(schedule)) {
          if ((await readText(task.path, "utf16le")) !== undefined) {
            await rm(task.path, { force: true });
            removed = true;
          }
        }
        return removed;
      }),
  });
};

/**
 * The system's own scheduler: launchd through `launchctl` in the user's GUI
 * domain on macOS, systemd's user manager through `systemctl --user` on
 * Linux, and Task Scheduler through `schtasks` on Windows. Each program it
 * runs is given only the schedule's names and paths.
 */
export const layer = (options: {
  readonly system: System;
  readonly uid: number;
  readonly run: Run;
}): Layer.Layer<Scheduler> =>
  Layer.succeed(
    Scheduler,
    options.system === "darwin"
      ? launchd(options.run, options.uid)
      : options.system === "linux"
        ? systemd(options.run)
        : taskScheduler(options.run),
  );
