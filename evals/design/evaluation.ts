import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Outcome } from "./clients.ts";
import { applyPatch, changeIn, copyOf, run } from "./copy.ts";
import { type Judged, judgedOf, leaksOf, shuffled } from "./judge.ts";
import { reportOf } from "./report.ts";
import type { Rule } from "./rubric.ts";
import {
  type Arm,
  type Evaluation,
  type Judgement,
  type Run,
  runIdOf,
} from "./runs.ts";
import { mechanicalOf } from "./scores.ts";
import { type Shot, shotsOf } from "./shots.ts";

export const root = fileURLToPath(new URL("../..", import.meta.url));
export const tasksFolder = fileURLToPath(new URL("tasks", import.meta.url));

export const taskText = (task: string) =>
  readFileSync(join(tasksFolder, `${task}.md`), "utf8");

/** What a runner did in a copy; the copy's diff is read after it. */
export type Work = (
  dir: string,
  id: string,
) => Promise<Omit<Outcome, "answer">>;

/** The replay runner: a kept patch applied in place of a client's work. */
export const replay =
  (patchFile: string, kept: Omit<Outcome, "answer"> | undefined): Work =>
  async (dir) => {
    const started = performance.now();
    try {
      await applyPatch(dir, patchFile);
      return (
        kept ?? {
          status: "done",
          seconds: Math.round((performance.now() - started) / 1000),
          error: null,
          costUsd: null,
          turns: null,
          model: null,
        }
      );
    } catch (error) {
      return {
        status: "failed",
        seconds: Math.round((performance.now() - started) / 1000),
        error: `The patch did not apply: ${String(error).slice(0, 600)}`,
        costUsd: null,
        turns: null,
        model: null,
      };
    }
  };

export interface Made {
  readonly run: Run;
  readonly patch: string;
  readonly shots: ReadonlyArray<Shot>;
}

/**
 * One run in a fresh copy of the arm: the runner's work, its patch kept, its
 * mechanical scores and its screenshots. A runner that ran commands in its
 * copy could have changed what is not in the patch (its installed
 * dependencies, say), so its patch is scored in another fresh copy. The
 * copies are removed after.
 */
export const makeRun = async (options: {
  readonly source: string;
  readonly commit: string;
  readonly task: string;
  readonly arm: Arm;
  readonly repetition: number;
  readonly folder: string;
  readonly scratch: string;
  readonly work: Work;
  readonly scoreInAFreshCopy: boolean;
  readonly say: (line: string) => void;
}): Promise<Made> => {
  const id = runIdOf(options.task, options.arm, options.repetition);
  options.say(`${id}: making the copy`);
  const copy = await copyOf(options.source, options.commit, options.arm);
  let scored = copy;
  try {
    options.say(`${id}: running in ${copy.dir}`);
    const outcome = await options.work(copy.dir, id);
    options.say(
      `${id}: ${outcome.status} after ${outcome.seconds}s${outcome.error === null ? "" : `: ${outcome.error}`}`,
    );
    const change = await changeIn(copy);
    const patchFile = `${id}.patch`;
    if (change.patch !== "") {
      writeFileSync(join(options.folder, patchFile), change.patch);
    }
    if (options.scoreInAFreshCopy && change.patch !== "") {
      copy.remove();
      options.say(`${id}: applying the patch to a fresh copy to score it`);
      scored = await copyOf(options.source, options.commit, options.arm);
      await applyPatch(scored.dir, join(options.folder, patchFile));
    }
    options.say(`${id}: scoring ${change.files.length} changed files`);
    const mechanical =
      change.files.length === 0
        ? undefined
        : await mechanicalOf(scored, change);
    const shots =
      mechanical === undefined
        ? undefined
        : await shotsOf(
            scored,
            mechanical.storyFiles,
            join(options.scratch, "shots", id),
            join(options.scratch, `${id}.storybook.log`),
          );
    for (const problem of shots?.problems ?? []) {
      options.say(`${id}: ${problem}`);
    }
    return {
      patch: change.patch,
      shots: shots?.shots ?? [],
      run: {
        id,
        task: options.task,
        arm: options.arm,
        repetition: options.repetition,
        status: outcome.status,
        error: outcome.error,
        seconds: outcome.seconds,
        costUsd: outcome.costUsd,
        turns: outcome.turns,
        model: outcome.model,
        patch: change.patch === "" ? null : patchFile,
        changedFiles: change.files.length,
        check: mechanical?.check ?? null,
        checkFailure: mechanical?.checkFailure ?? null,
        lintFindings: mechanical?.lintFindings ?? null,
        story: mechanical?.story ?? null,
        storyFailure: mechanical?.storyFailure ?? null,
        rendered: shots?.rendered ?? null,
        leaks: leaksOf(change.patch, copy.ruleIds),
        judgement: null,
      },
    };
  } finally {
    copy.remove();
    scored.remove();
  }
};

/** Judges every run that finished with a patch, one at a time in an order drawn from the evaluation's seed, recording each judgement as it comes. */
export const judgeRuns = async (options: {
  readonly evaluation: Evaluation;
  readonly made: ReadonlyArray<Made>;
  readonly judge: (judged: Judged, index: number) => Promise<Judgement>;
  readonly recorded: (evaluation: Evaluation) => Promise<void>;
  readonly say: (line: string) => void;
}): Promise<Evaluation> => {
  let current = options.evaluation;
  const order = shuffled(
    options.made.filter(
      ({ run }) => run.status === "done" && run.patch !== null,
    ),
    current.seed,
  );
  for (const [index, { run, patch, shots }] of order.entries()) {
    options.say(`judging ${index + 1} of ${order.length}`);
    const judgement = await options.judge(
      judgedOf({ task: taskText(run.task), patch, shots }),
      index,
    );
    current = {
      ...current,
      runs: current.runs.map((each) =>
        each.id === run.id ? { ...each, judgement } : each,
      ),
    };
    await options.recorded(current);
  }
  return current;
};

/** Writes the evaluation's figures beside its report, and the report. */
export const writeEvaluation = async (
  folder: string,
  evaluation: Evaluation,
  rules: ReadonlyArray<Rule>,
) => {
  const file = join(folder, "runs.json");
  writeFileSync(file, `${JSON.stringify(evaluation, null, 2)}\n`);
  await run(
    [join(root, "node_modules/.bin/biome"), "format", "--write", file],
    root,
  );
  writeFileSync(`${folder}.md`, reportOf(evaluation, rules));
};
