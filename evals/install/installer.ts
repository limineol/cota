/** What a command run in a machine gave; `exitCode` is null when it was stopped at its time limit. */
export interface Ran {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface RunOptions {
  /** The directory it runs in; the owner's home when not given. */
  readonly cwd?: string;
  /** What it reads on standard input; nothing when not given. */
  readonly stdin?: string;
}

/** One of the world's machines, as the installer reaches it: a shell of the owner's user, every command recorded. */
export interface Machine {
  readonly name: string;
  readonly home: string;
  /** Runs `command` with `bash -c`, as the owner's user, with the environment of a terminal of theirs. */
  readonly run: (command: string, options?: RunOptions) => Promise<Ran>;
}

/** The owner, as the installer reaches them: a message, and their answer. */
export interface Owner {
  readonly tell: (message: string) => Promise<string>;
  /** What its client spent, for an owner played by a model. */
  readonly spent?: () => Spend;
}

export interface Given {
  /** The install prompt, `docs/install.md` of the commit under test. */
  readonly prompt: string;
  readonly machines: ReadonlyArray<Machine>;
  readonly owner: Owner;
  /** Aborted when the eval stops the installer: at its time limit, or on an interrupt. */
  readonly stop: AbortSignal;
}

/** What a client reported spending: its model, its cost in dollars, and how many turns it took. */
export interface Spend {
  readonly who: "installer" | "owner";
  readonly model: string | null;
  readonly costUsd: number | null;
  readonly turns: number | null;
}

/** Why an installer stopped before it was done: it reached one of its limits, which `limit` names. */
export class Stopped extends Error {
  constructor(readonly limit: string) {
    super(`it was stopped at its limit of ${limit}`);
  }
}

/** What an installer that ended without saying it was done ended, quoting `said`, the first line of its last message. */
export const unfinishedOf = (said: string) =>
  `its turn without saying it was done: ${said === "" ? "it said nothing" : `"${said}"`}`;

/** Why an installer ended without saying it was done: `said` is the first line of its last message, empty when it said nothing. */
export class Unfinished extends Error {
  constructor(readonly said: string) {
    super(`it ended ${unfinishedOf(said)}`);
  }
}

/**
 * What follows the install prompt in an install eval: it acts in the machines
 * and talks to the owner, and resolves when it says it is done, or rejects
 * with why it stopped.
 */
export interface Installer {
  readonly name: string;
  readonly install: (given: Given) => Promise<void>;
  /** What its client spent, for an installer that has one. */
  readonly spent?: () => Spend;
  /** Its own transcript, for an installer that keeps one: its turns, its tool calls and what they returned. */
  readonly transcript?: () => ReadonlyArray<Turn>;
}

/** One entry of an agent installer's own transcript. */
export type Turn =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "call"; readonly tool: string; readonly input: string }
  | {
      readonly kind: "returned";
      readonly text: string;
      readonly isError: boolean;
    }
  | { readonly kind: "end"; readonly text: string };
