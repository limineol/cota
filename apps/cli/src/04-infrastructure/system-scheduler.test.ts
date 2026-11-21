import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Result } from "effect";
import { Scheduler } from "#02-application/interfaces/scheduler.ts";
import * as Paths from "#03-domain/paths.ts";
import * as Schedule from "#03-domain/schedule.ts";
import type { System, Variables } from "#03-domain/system.ts";
import * as RecordingRun from "#05-tests/fakes/recording-run.ts";
import * as SystemScheduler from "./system-scheduler.ts";

/** A home of its own in a temporary directory, the system's scheduler a stand-in that runs nothing, and the schedule `cota` would install there. */
const onASystem = <A, E>(
  system: System,
  test: (on: {
    readonly home: string;
    readonly launchctl: ReturnType<typeof RecordingRun.make>;
    readonly scheduleOf: (program: string) => Schedule.Schedule;
    readonly scheduler: Scheduler["Service"];
  }) => Effect.Effect<A, E, Scheduler>,
  options: Parameters<typeof RecordingRun.make>[0] = {},
) =>
  Effect.acquireUseRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), "cota-scheduler-"))),
    (home) => {
      const variables: Variables =
        system === "win32"
          ? {
              APPDATA: join(home, "Roaming"),
              LOCALAPPDATA: join(home, "Local"),
            }
          : { HOME: home };
      const paths = Result.getOrThrow(Paths.pathsOf(system, variables));
      const launchctl = RecordingRun.make(options);
      const layer = SystemScheduler.layer({
        system,
        uid: 501,
        run: launchctl.run,
      });
      const scheduleOf = (program: string) => {
        const schedule = Result.getOrThrow(
          Schedule.scheduleOf(system, variables, program, paths),
        );
        return system === "win32" && schedule._tag === "TaskScheduler"
          ? {
              ...schedule,
              task: {
                ...schedule.task,
                path: join(home, "Local", "cota", "state", "titles-task.xml"),
              },
            }
          : schedule;
      };
      return Effect.flatMap(Scheduler, (scheduler) =>
        test({ home, launchctl, scheduleOf, scheduler }),
      ).pipe(Effect.provide(layer));
    },
    (home) => Effect.sync(() => rmSync(home, { recursive: true, force: true })),
  );

describe("the system's scheduler", () => {
  it.effect(
    "on macOS writes the LaunchAgent and bootstraps it, replaces one that differs after booting it out, and removes it",
    () =>
      onASystem("darwin", ({ home, launchctl, scheduleOf, scheduler }) =>
        Effect.gen(function* () {
          const plist = join(home, "Library/LaunchAgents/cota.titles.plist");
          const schedule = scheduleOf("/usr/local/bin/cota");
          expect(yield* scheduler.installed(schedule)).toBe("absent");
          yield* scheduler.install(schedule);
          expect(readFileSync(plist, "utf8")).toBe(
            Schedule.definitionsOf(schedule)[0]?.text,
          );
          expect(yield* scheduler.installed(schedule)).toBe("as given");
          const moved = scheduleOf("/opt/cota/bin/cota");
          expect(yield* scheduler.installed(moved)).toBe("otherwise");
          yield* scheduler.install(moved);
          expect(yield* scheduler.remove(moved)).toBe(true);
          expect(existsSync(plist)).toBe(false);
          expect(yield* scheduler.remove(moved)).toBe(false);
          expect(
            launchctl.commands.filter(([, verb]) => verb !== "print"),
          ).toEqual([
            ["launchctl", "bootstrap", "gui/501", plist],
            ["launchctl", "bootout", "gui/501/cota.titles"],
            ["launchctl", "bootstrap", "gui/501", plist],
            ["launchctl", "bootout", "gui/501/cota.titles"],
          ]);
        }),
      ),
  );

  it.effect(
    "on Linux writes the service and the timer, enables and restarts the timer, and disables and removes both; without a user session it says there is no scheduler",
    () =>
      Effect.gen(function* () {
        yield* onASystem(
          "linux",
          ({ home, launchctl, scheduleOf, scheduler }) =>
            Effect.gen(function* () {
              const units = join(home, ".config/systemd/user");
              const schedule = scheduleOf("/usr/local/bin/cota");
              yield* scheduler.install(schedule);
              expect(
                readFileSync(join(units, "cota-titles.service"), "utf8"),
              ).toContain(
                'ExecStart="/usr/local/bin/cota" "titles" "report"\n',
              );
              expect(
                readFileSync(join(units, "cota-titles.timer"), "utf8"),
              ).toContain("OnUnitActiveSec=30s\n");
              expect(yield* scheduler.installed(schedule)).toBe("as given");
              expect(yield* scheduler.remove(schedule)).toBe(true);
              expect(existsSync(join(units, "cota-titles.timer"))).toBe(false);
              expect(
                launchctl.commands.filter(
                  ([, , verb]) =>
                    verb !== "show-environment" &&
                    verb !== "is-enabled" &&
                    verb !== "is-active",
                ),
              ).toEqual([
                ["systemctl", "--user", "daemon-reload"],
                ["systemctl", "--user", "enable", "cota-titles.timer"],
                ["systemctl", "--user", "restart", "cota-titles.timer"],
                [
                  "systemctl",
                  "--user",
                  "disable",
                  "--now",
                  "cota-titles.timer",
                ],
                ["systemctl", "--user", "daemon-reload"],
              ]);
            }),
        );
        yield* onASystem(
          "linux",
          ({ scheduleOf, scheduler }) =>
            Effect.gen(function* () {
              const refused = yield* Effect.flip(
                scheduler.install(scheduleOf("/usr/local/bin/cota")),
              );
              expect(refused._tag).toBe("SchedulerUnavailable");
              expect(refused.reason).toBe(
                "systemctl --user has no user session: Failed to connect to bus: No medium found",
              );
            }),
          { systemd: "no user session" },
        );
      }),
  );

  it.effect(
    "on Windows keeps the task's definition in UTF-16 and registers it with schtasks, and deletes both",
    () =>
      onASystem("win32", ({ home, launchctl, scheduleOf, scheduler }) =>
        Effect.gen(function* () {
          const kept = join(home, "Local", "cota", "state", "titles-task.xml");
          const schedule = scheduleOf("C:\\Users\\me\\cota.exe");
          yield* scheduler.install(schedule);
          const bytes = readFileSync(kept);
          expect([...bytes.subarray(0, 2)]).toEqual([0xff, 0xfe]);
          expect(bytes.toString("utf16le")).toContain(
            "<Command>C:\\Users\\me\\cota.exe</Command>",
          );
          expect(yield* scheduler.installed(schedule)).toBe("as given");
          expect(yield* scheduler.remove(schedule)).toBe(true);
          expect(existsSync(kept)).toBe(false);
          expect(
            launchctl.commands.filter(([, verb]) => verb !== "/Query"),
          ).toEqual([
            ["schtasks", "/Create", "/TN", "cota titles", "/XML", kept, "/F"],
            ["schtasks", "/Delete", "/TN", "cota titles", "/F"],
          ]);
        }),
      ),
  );
});

describe("the schedule's definitions", () => {
  const paths = Result.getOrThrow(Paths.pathsOf("linux", { HOME: "/home/me" }));

  it("run the cota that wrote them with titles report, carrying only the variables that say where files are", () => {
    const variables = {
      HOME: "/home/me",
      XDG_STATE_HOME: "/data/state",
      CODEX_HOME: "/data/codex & more",
      ANTHROPIC_API_KEY: "sk-ant-api03-not-carried",
      PATH: "/usr/bin",
    };
    const launchAgent = Result.getOrThrow(
      Schedule.scheduleOf("darwin", variables, "/Users/me/bin/cota", paths),
    );
    expect(Schedule.definitionsOf(launchAgent)).toEqual([
      {
        path: "/home/me/Library/LaunchAgents/cota.titles.plist",
        text: [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
          '<plist version="1.0">',
          "<dict>",
          "\t<key>Label</key>",
          "\t<string>cota.titles</string>",
          "\t<key>ProgramArguments</key>",
          "\t<array>",
          "\t\t<string>/Users/me/bin/cota</string>",
          "\t\t<string>titles</string>",
          "\t\t<string>report</string>",
          "\t</array>",
          "\t<key>EnvironmentVariables</key>",
          "\t<dict>",
          "\t\t<key>XDG_STATE_HOME</key>",
          "\t\t<string>/data/state</string>",
          "\t\t<key>CODEX_HOME</key>",
          "\t\t<string>/data/codex &amp; more</string>",
          "\t</dict>",
          "\t<key>StartInterval</key>",
          "\t<integer>30</integer>",
          "\t<key>RunAtLoad</key>",
          "\t<true/>",
          "\t<key>ProcessType</key>",
          "\t<string>Background</string>",
          "</dict>",
          "</plist>",
          "",
        ].join("\n"),
      },
    ]);
    const units = Result.getOrThrow(
      Schedule.scheduleOf(
        "linux",
        variables,
        "/home/me/my tools/100%/cota",
        paths,
      ),
    );
    expect(Schedule.definitionsOf(units)[0]).toEqual({
      path: "/home/me/.config/systemd/user/cota-titles.service",
      text: [
        "[Unit]",
        "Description=Report session titles to the Cota hub",
        "",
        "[Service]",
        "Type=oneshot",
        'ExecStart="/home/me/my tools/100%%/cota" "titles" "report"',
        'Environment="XDG_STATE_HOME=/data/state"',
        'Environment="CODEX_HOME=/data/codex & more"',
        "",
      ].join("\n"),
    });
  });
});
