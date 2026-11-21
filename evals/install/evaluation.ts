import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Home, passedOf, type Unread, verdictsOf } from "./criteria.ts";
import {
  type Installer,
  type Machine,
  type Owner,
  Stopped,
  Unfinished,
} from "./installer.ts";
import { homeOf, observe } from "./observe.ts";
import {
  fakeSecrets,
  type MakeOwner,
  ownersHands,
  ownersSecretValues,
  scriptedOwner,
} from "./owner.ts";
import { reportOf, transcriptOf } from "./report.ts";
import {
  type Actor,
  type Ending,
  type Entry,
  maskedOf,
  type Run,
  type Secret,
} from "./runs.ts";
import type { Task } from "./tasks.ts";
import { home, makeWorld, type World } from "./world.ts";

export const root = fileURLToPath(new URL("../..", import.meta.url));

/** How long an installer has before it is stopped. */
export const limitMinutes = 30;

/** How long the title reporter's schedule is given, after the installer ends, to send each launch's title. */
const titleWaitMs = 150_000;

const git = (...args: ReadonlyArray<string>) => {
  const ran = Bun.spawnSync(["git", ...args], { cwd: root });
  if (ran.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed`);
  return ran.stdout.toString().trim();
};

const recorded = (
  world: World,
  task: Task,
  actor: Actor,
  transcript: Array<Entry>,
): ReadonlyMap<string, Machine> =>
  new Map(
    task.machines.map(({ name }) => [
      name,
      {
        name,
        home,
        run: async (command, options = {}) => {
          const started = performance.now();
          const at = new Date().toISOString();
          const ran = await world.shell(name, command, {
            ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
            ...(options.stdin === undefined ? {} : { stdin: options.stdin }),
          });
          transcript.push({
            kind: "command",
            at,
            actor,
            machine: name,
            command,
            cwd: options.cwd ?? home,
            stdin: options.stdin !== undefined,
            exitCode: ran.exitCode,
            stdout: ran.stdout,
            stderr: ran.stderr,
            seconds: (performance.now() - started) / 1000,
          });
          return ran;
        },
      } satisfies Machine,
    ]),
  );

const talking = (owner: Owner, transcript: Array<Entry>): Owner => ({
  tell: async (message) => {
    transcript.push({
      kind: "message",
      at: new Date().toISOString(),
      from: "installer",
      text: message,
    });
    const answer = await owner.tell(message);
    transcript.push({
      kind: "message",
      at: new Date().toISOString(),
      from: "owner",
      text: answer,
    });
    return answer;
  },
});

const runId = () =>
  `${new Date().toISOString().replace(/[-:]/g, "").slice(0, 13).toLowerCase()}-${crypto.randomUUID().slice(0, 4)}`;

/** How long an installer stopped at its time limit is given to stop before the criteria are read. */
const stoppingMs = 20_000;

const within = async (
  work: Promise<void>,
  minutes: number,
  stop: AbortController,
): Promise<{ ending: Ending; error: string | null }> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<{ ending: Ending; error: string | null }>(
    (resolve) => {
      timer = setTimeout(
        () => resolve({ ending: "stopped", error: `${minutes} minutes` }),
        minutes * 60_000,
      );
    },
  );
  const done = work.then(
    () => ({ ending: "done" as const, error: null }),
    (error: unknown) =>
      error instanceof Stopped
        ? { ending: "stopped" as const, error: error.limit }
        : error instanceof Unfinished
          ? { ending: "unfinished" as const, error: error.said }
          : {
              ending: "failed" as const,
              error: error instanceof Error ? error.message : String(error),
            },
  );
  const ended = await Promise.race([done, limit]);
  clearTimeout(timer);
  if (ended.ending === "stopped" && ended.error === `${minutes} minutes`) {
    stop.abort();
    await Promise.race([done, Bun.sleep(stoppingMs)]);
  }
  return ended;
};

/**
 * One install eval: the world made, the installer given the prompt, the
 * machines and the scripted owner, the criteria read, and the world removed
 * whole on every path, an interrupt included.
 */
export const evaluate = async (options: {
  readonly task: Task;
  readonly installer: Installer;
  /** The scripted owner unless another is given. */
  readonly owner?: MakeOwner;
  readonly say: (line: string) => void;
}): Promise<Run> => {
  const { task, installer, say } = options;
  const makeOwner = options.owner ?? scriptedOwner;
  const stop = new AbortController();
  let owner: Owner | undefined;
  const commit = git("rev-parse", "HEAD");
  const dirty = git("status", "--porcelain") !== "";
  const run = runId();
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const transcript: Array<Entry> = [];
  let secrets: ReadonlyArray<Secret> = [];
  let world: World | undefined;
  const removeAndLeave = (signal: NodeJS.Signals) => {
    say(`${signal}: removing the world`);
    stop.abort();
    world?.remove();
    process.exit(130);
  };
  process.once("SIGINT", removeAndLeave);
  process.once("SIGTERM", removeAndLeave);
  const finished = (
    ending: Ending,
    error: string | null,
    verdicts: Run["verdicts"],
  ): Run =>
    maskedOf(
      {
        id: run,
        commit,
        dirty,
        task: task.id,
        installer: installer.name,
        startedAt,
        minutes: (performance.now() - started) / 60_000,
        limitMinutes,
        ending,
        error,
        verdicts,
        passed: passedOf(verdicts),
        transcript,
        spend: [
          ...(installer.spent === undefined ? [] : [installer.spent()]),
          ...(owner?.spent === undefined ? [] : [owner.spent()]),
        ],
        installerTranscript: installer.transcript?.() ?? [],
      },
      secrets,
    );
  try {
    const made = await makeWorld({
      run,
      task,
      commit,
      folder: join(tmpdir(), "cota-install-evals", run),
      say,
      made: (each) => {
        world = each;
      },
    });
    const ownersSecrets = fakeSecrets();
    secrets = ownersSecretValues(task, ownersSecrets);
    const before: Record<string, Home | Unread> = {};
    for (const { name } of task.machines)
      before[name] = await homeOf(made, name);
    owner = makeOwner({
      task,
      hands: ownersHands({
        task,
        machines: recorded(made, task, "owner", transcript),
        secrets: ownersSecrets,
      }),
    });
    say(`${made.project}: the ${installer.name} installs Cota for ${task.id}`);
    const { ending, error } = await within(
      installer.install({
        prompt: git("show", `${commit}:docs/install.md`),
        machines: [...recorded(made, task, "installer", transcript).values()],
        owner: talking(owner, transcript),
        stop: stop.signal,
      }),
      limitMinutes,
      stop,
    );
    say(
      `${made.project}: the ${installer.name} ${ending === "done" ? "is done" : `ended ${ending}${error === null ? "" : `: ${error}`}`}; reading the criteria`,
    );
    const observed = await observe({
      world: made,
      task,
      ending,
      error,
      transcript,
      before,
      ownersSecrets: secrets,
      ownerPassword: ownersSecrets.ownerPassword,
      titleWaitMs,
    });
    if (!("unread" in observed.secrets)) secrets = observed.secrets;
    return finished(ending, error, verdictsOf(task, observed));
  } catch (error) {
    return finished(
      "failed",
      `the eval itself failed: ${error instanceof Error ? error.message : String(error)}`,
      [],
    );
  } finally {
    stop.abort();
    say(`${world?.project ?? `cota-install-${run}`}: removing the world`);
    world?.remove();
    process.off("SIGINT", removeAndLeave);
    process.off("SIGTERM", removeAndLeave);
  }
};

const shortened = (text: string) =>
  text.length > 4000 ? `…${text.slice(-4000)}` : text;

/** Writes a run's report, `<date>-<installer>.md`, and beside it a folder of the same name with `run.json`; returns the report's path. */
export const writeReport = (folder: string, run: Run): string => {
  const base = `${run.startedAt.slice(0, 10)}-${run.task}-${run.installer}`;
  const name = [
    base,
    ...Array.from({ length: 98 }, (_, at) => `${base}-${at + 2}`),
  ].find((each) => !existsSync(join(folder, `${each}.md`)));
  if (name === undefined) throw new Error(`Too many reports named ${base}.`);
  mkdirSync(join(folder, name), { recursive: true });
  const { installerTranscript, ...kept } = {
    ...run,
    transcript: run.transcript.map((entry) =>
      entry.kind === "command"
        ? {
            ...entry,
            stdout: shortened(entry.stdout),
            stderr: shortened(entry.stderr),
          }
        : entry,
    ),
  };
  writeFileSync(
    join(folder, name, "run.json"),
    `${JSON.stringify(kept, null, 2)}\n`,
  );
  if (installerTranscript.length > 0)
    writeFileSync(
      join(folder, name, "transcript.md"),
      transcriptOf(run.installer, installerTranscript),
    );
  const report = join(folder, `${name}.md`);
  writeFileSync(report, reportOf(run));
  return report;
};
