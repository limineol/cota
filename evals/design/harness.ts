import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  buildCommand,
  chooseRunner,
  defaultModels,
  minutes,
  onPath,
  runClient,
  versionOf,
} from "./clients.ts";
import { run } from "./copy.ts";
import {
  judgeRuns,
  type Made,
  makeRun,
  replay,
  root,
  tasksFolder,
  taskText,
  writeEvaluation,
} from "./evaluation.ts";
import { judgeWith } from "./judge.ts";
import { type Rule, rulesOf } from "./rubric.ts";
import { arms, decodeEvaluation, type Evaluation, runners } from "./runs.ts";

const reportsFolder = fileURLToPath(new URL("reports", import.meta.url));

const allTasks = readdirSync(tasksFolder)
  .filter((file) => file.endsWith(".md"))
  .map((file) => file.slice(0, -".md".length))
  .sort();

const listOf = <A extends string>(
  given: string | undefined,
  all: ReadonlyArray<A>,
  what: string,
): ReadonlyArray<A> => {
  if (given === undefined) return all;
  const asked = given.split(",").map((item) => item.trim());
  const unknown = asked.filter((item) => !all.some((each) => each === item));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown ${what}: ${unknown.join(", ")}. Known: ${all.join(", ")}.`,
    );
  }
  return all.filter((item) => asked.includes(item));
};

const { values } = parseArgs({
  options: {
    tasks: { type: "string" },
    arms: { type: "string" },
    repetitions: { type: "string", default: "1" },
    runner: { type: "string" },
    model: { type: "string" },
    seed: { type: "string" },
    "judge-only": { type: "string" },
  },
});

const asked = runners.find((runner) => runner === values.runner);
if (values.runner !== undefined && asked === undefined) {
  throw new Error(`--runner is one of ${runners.join(", ")}.`);
}
const judgeOnly = values["judge-only"];
const choice = chooseRunner({
  asked,
  judgeOnly: judgeOnly !== undefined,
  onPath,
});
const repetitions = Number.parseInt(values.repetitions, 10);
if (!(repetitions >= 1))
  throw new Error("--repetitions is a whole number from 1.");
const seed =
  values.seed === undefined
    ? Math.floor(Math.random() * 2 ** 31)
    : Number.parseInt(values.seed, 10);
if (Number.isNaN(seed)) throw new Error("--seed is a whole number.");

const say = (line: string) => console.log(line);
const git = async (...args: ReadonlyArray<string>) =>
  (await run(["git", ...args], root)).stdout;
const rulesAt = async (commit: string) =>
  rulesOf(await git("show", `${commit}:DESIGN.md`));
const judgeModel = values.model ?? defaultModels[choice.judge];
const judgeClient = {
  name: choice.judge,
  version: await versionOf(choice.judge),
  model: judgeModel ?? `${choice.judge}'s default`,
};

const scratchOf = (name: string) => {
  const scratch = join(tmpdir(), "cota-design-evals", name);
  mkdirSync(scratch, { recursive: true });
  return scratch;
};

const judge = (
  folder: string,
  scratch: string,
  rules: ReadonlyArray<Rule>,
  evaluation: Evaluation,
  made: ReadonlyArray<Made>,
) =>
  judgeRuns({
    evaluation,
    made,
    judge: (judged, index) =>
      judgeWith({
        client: choice.judge,
        model: judgeModel,
        rules,
        judged,
        transcript: join(scratch, `judge-${index + 1}.jsonl`),
      }),
    recorded: (current) => writeEvaluation(folder, current, rules),
    say,
  });

const evaluate = async () => {
  const runner = choice.runner === "replay" ? choice.judge : choice.runner;
  const model = values.model ?? defaultModels[runner];
  const tasks = listOf(values.tasks, allTasks, "tasks");
  const chosenArms = listOf(values.arms, arms, "arms");
  const commit = (await git("rev-parse", "HEAD")).trim();
  const rules = await rulesAt(commit);
  if ((await git("status", "--porcelain")).trim() !== "") {
    say(
      `The working tree has changes: the runs use the commit ${commit.slice(0, 12)} without them.`,
    );
  }
  const date = new Date().toISOString().slice(0, 10);
  const base = `${date}-${runner}-${model ?? "default"}`;
  const name = [
    base,
    ...[2, 3, 4, 5, 6, 7, 8, 9].map((n) => `${base}-${n}`),
  ].find((each) => !existsSync(join(reportsFolder, each)));
  if (name === undefined) throw new Error(`Too many reports named ${base}.`);
  const folder = join(reportsFolder, name);
  mkdirSync(folder, { recursive: true });
  const scratch = scratchOf(name);
  say(
    `${name}: ${tasks.join(", ")} in ${chosenArms.join(" and ")}, ${repetitions} repetition(s); transcripts and screenshots in ${scratch}`,
  );
  let evaluation: Evaluation = {
    commit,
    date,
    runner,
    client: {
      name: runner,
      version: await versionOf(runner),
      model: model ?? `${runner}'s default`,
    },
    judge: judgeClient,
    tasks,
    arms: chosenArms,
    repetitions,
    seed,
    minutes,
    runs: [],
  };
  const made: Array<Made> = [];
  for (let repetition = 1; repetition <= repetitions; repetition++) {
    for (const task of tasks) {
      for (const arm of chosenArms) {
        const one = await makeRun({
          source: root,
          commit,
          task,
          arm,
          repetition,
          folder,
          scratch,
          say,
          scoreInAFreshCopy: true,
          work: async (dir, id) => {
            const lastMessage = join(scratch, `${id}.last.txt`);
            const { answer: _, ...outcome } = await runClient({
              client: runner,
              command: buildCommand(runner, model, dir, lastMessage),
              cwd: dir,
              stdin: taskText(task),
              transcript: join(scratch, `${id}.jsonl`),
              lastMessage,
              limitMs: minutes * 60_000,
            });
            return outcome;
          },
        });
        made.push(one);
        evaluation = { ...evaluation, runs: [...evaluation.runs, one.run] };
        await writeEvaluation(folder, evaluation, rules);
      }
    }
  }
  await judge(folder, scratch, rules, evaluation, made);
  say(`The report is ${folder}.md`);
};

/** Remakes a report from its kept patches: each replayed in a fresh copy of its arm, scored and judged again. */
const judgeAgain = async (given: string) => {
  const folder = resolve(given);
  const kept = decodeEvaluation(
    readFileSync(join(folder, "runs.json"), "utf8"),
  );
  const rules = await rulesAt(kept.commit);
  const scratch = scratchOf(`${basename(folder)}-again`);
  const made: Array<Made> = [];
  for (const old of kept.runs) {
    if (old.patch === null) {
      made.push({ run: { ...old, judgement: null }, patch: "", shots: [] });
      continue;
    }
    const one = await makeRun({
      source: root,
      commit: kept.commit,
      task: old.task,
      arm: old.arm,
      repetition: old.repetition,
      folder: scratch,
      scratch,
      say,
      scoreInAFreshCopy: false,
      work: replay(join(folder, old.patch), old),
    });
    made.push({ ...one, run: { ...one.run, patch: old.patch } });
  }
  const evaluation: Evaluation = {
    ...kept,
    judge: judgeClient,
    seed,
    runs: made.map(({ run }) => run),
  };
  await writeEvaluation(folder, evaluation, rules);
  await judge(folder, scratch, rules, evaluation, made);
  say(`The report is ${folder}.md`);
};

if (judgeOnly === undefined) await evaluate();
else await judgeAgain(judgeOnly);
