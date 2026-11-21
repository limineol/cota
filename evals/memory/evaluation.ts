import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Answerer,
  type Machine,
  type Ran,
  type Spend,
  Stopped,
} from "./answerer.ts";
import { type Question, questions } from "./questions.ts";
import { type Answered, type Verdict, verdictOf } from "./verdicts.ts";
import { checkout, type World } from "./world.ts";

/** How long any answerer has for one question. */
export const questionLimitMs = 5 * 60_000;

/** One question of a run, and what came of it: a verdict, or the answerer's failure, which is the eval's error. */
export interface Asked {
  readonly question: Question;
  readonly answered: Answered | null;
  readonly verdict: Verdict | { readonly kind: "error"; readonly why: string };
  readonly spent: Spend | null;
}

export interface Evaluation {
  readonly answerer: string;
  readonly commit: string;
  readonly changed: boolean;
  readonly asked: ReadonlyArray<Asked>;
}

export const passed = (evaluation: Evaluation): boolean =>
  evaluation.asked.every(({ verdict }) => verdict.kind === "right");

const recording = (machine: Machine, ran: Array<Ran>): Machine => ({
  run: async (command, stdin) => {
    const done = await machine.run(command, stdin);
    ran.push(done);
    return done;
  },
  cota: async (args, stdin) => {
    const done = await machine.cota(args, stdin);
    ran.push(done);
    return done;
  },
});

const git = (...args: ReadonlyArray<string>) =>
  Bun.spawnSync(["git", ...args], { cwd: checkout })
    .stdout.toString()
    .trim();

/** The skill of the checkout under test. */
export const skillText = () =>
  readFileSync(join(checkout, "skills/cota-memory/SKILL.md"), "utf8");

/** Asks the answerer each question in order against the world, stopping each at its limit, and gives every verdict. */
export const evaluate = async (options: {
  readonly answerer: Answerer;
  readonly world: World;
  readonly stop: AbortSignal;
  readonly say: (line: string) => void;
  readonly limitMs?: number;
}): Promise<Evaluation> => {
  const skill = skillText();
  const asked: Array<Asked> = [];
  for (const question of questions) {
    if (options.stop.aborted) break;
    const ran: Array<Ran> = [];
    const stop = new AbortController();
    const limit = setTimeout(
      () => stop.abort(new Stopped("5 minutes")),
      options.limitMs ?? questionLimitMs,
    );
    const onStop = () => stop.abort(new Stopped("the eval's interrupt"));
    options.stop.addEventListener("abort", onStop);
    const stopped = new Promise<never>((_, reject) =>
      stop.signal.addEventListener("abort", () => reject(stop.signal.reason)),
    );
    let answered: Answered | null = null;
    let failure: string | null = null;
    try {
      const text = await Promise.race([
        options.answerer.answer({
          question: question.asked,
          skill,
          machine: recording(options.world.machine, ran),
          stop: stop.signal,
        }),
        stopped,
      ]);
      answered = { kind: "answer", text, ran: [...ran] };
    } catch (error) {
      if (error instanceof Stopped)
        answered = { kind: "stopped", limit: error.limit, ran: [...ran] };
      else failure = error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(limit);
      options.stop.removeEventListener("abort", onStop);
    }
    const verdict =
      answered === null
        ? { kind: "error" as const, why: `the answerer failed: ${failure}` }
        : verdictOf(question, answered, options.world.secrets);
    options.say(`${question.id}: ${verdict.kind}`);
    asked.push({
      question,
      answered,
      verdict,
      spent: options.answerer.spent?.() ?? null,
    });
  }
  return {
    answerer: options.answerer.name,
    commit: git("rev-parse", "--short", "HEAD"),
    changed: git("status", "--porcelain") !== "",
    asked,
  };
};

/** Where a run's report is written: `evals/memory/reports/<date>-<answerer>.md`, `-2` and on for a later run that day. */
export const reportPathOf = (
  answerer: string,
  date: string,
  exists: (path: string) => boolean,
): string => {
  const directory = join(checkout, "evals/memory/reports");
  mkdirSync(directory, { recursive: true });
  for (let n = 1; ; n++) {
    const path = join(
      directory,
      `${date}-${answerer}${n === 1 ? "" : `-${n}`}.md`,
    );
    if (!exists(path)) return path;
  }
};
