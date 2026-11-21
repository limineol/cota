/** What a command run in the world's machine gave; `exitCode` is null when it was stopped at its time limit. */
export interface Ran {
  readonly command: string;
  readonly stdin: string | null;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** The world's machine, as an answerer reaches it: a shell of the owner's, every command recorded. */
export interface Machine {
  /** Runs `command` with `sh -c` in the machine, reading `stdin` when given. */
  readonly run: (command: string, stdin?: string) => Promise<Ran>;
  /** Runs the machine's `cota` with `args`, without a shell, reading `stdin` when given. */
  readonly cota: (args: ReadonlyArray<string>, stdin?: string) => Promise<Ran>;
}

export interface Given {
  /** The owner's words. */
  readonly question: string;
  /** The skill, `skills/cota-memory/SKILL.md` of the commit under test. */
  readonly skill: string;
  readonly machine: Machine;
  /** Aborted when the eval stops the answerer: at its time limit, or on an interrupt. */
  readonly stop: AbortSignal;
}

/** What an answerer reported spending: its model, its cost in dollars, and how many turns it took. */
export interface Spend {
  readonly model: string | null;
  readonly costUsd: number | null;
  readonly turns: number | null;
}

/** Why an answerer stopped before it answered: it reached one of its limits, which `limit` names. */
export class Stopped extends Error {
  constructor(readonly limit: string) {
    super(`it was stopped at its limit of ${limit}`);
  }
}

/** The first line of an answer that says the log holds what was asked. */
export const found = "FOUND";
/** The first line of an answer that says it does not. */
export const notFound = "NOT FOUND";

/**
 * What answers a memory eval's questions: given a question, the skill and
 * the world's machine, it resolves with its answer, plain text whose first
 * line is `FOUND` or `NOT FOUND`, or rejects with why it stopped.
 */
export interface Answerer {
  readonly name: string;
  readonly answer: (given: Given) => Promise<string>;
  /** What its client spent on the last question, for an answerer that has one. */
  readonly spent?: () => Spend;
}
