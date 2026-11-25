import type { Spend, Turn } from "./installer.ts";
import type { Task } from "./tasks.ts";

export type Actor = "installer" | "owner";

/** A command run in a machine through the installer's port, and what it gave. */
export interface Command {
  readonly kind: "command";
  readonly at: string;
  readonly actor: Actor;
  readonly machine: string;
  readonly command: string;
  readonly cwd: string;
  readonly stdin: boolean;
  /** Null when it was stopped at its time limit. */
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly seconds: number;
}

export interface Message {
  readonly kind: "message";
  readonly at: string;
  readonly from: Actor;
  readonly text: string;
}

export type Entry = Command | Message;

export const criterionIds = [
  "ended",
  "doctor",
  "requests",
  "titles",
  "routes",
  "memory",
  "secrets",
  "untouched",
] as const;
export type CriterionId = (typeof criterionIds)[number];

export interface Verdict {
  readonly id: CriterionId;
  readonly passed: boolean;
  /** What was wrong, one line each; empty when it passed. */
  readonly problems: ReadonlyArray<string>;
}

/** How the installer ended: it said it was done, it ended without saying so (the run's `error` holds the first line of its last message), it failed, or it was stopped at a limit, which `error` names. */
export type Ending = "done" | "unfinished" | "failed" | "stopped";

export interface Run {
  readonly id: string;
  readonly commit: string;
  readonly dirty: boolean;
  readonly task: Task["id"];
  readonly installer: string;
  readonly startedAt: string;
  readonly minutes: number;
  readonly limitMinutes: number;
  readonly ending: Ending;
  readonly error: string | null;
  readonly verdicts: ReadonlyArray<Verdict>;
  readonly passed: boolean;
  readonly transcript: ReadonlyArray<Entry>;
  /** What each client reported spending; empty for a rehearsal with a scripted owner. */
  readonly spend: ReadonlyArray<Spend>;
  /** The agent installer's own transcript; empty for the rehearsal. */
  readonly installerTranscript: ReadonlyArray<Turn>;
}

export interface Secret {
  readonly name: string;
  readonly value: string;
}

/** The run with each secret's value, wherever it is, in place of its name: a report names where a secret was, never what it is. */
export const maskedOf = (run: Run, secrets: ReadonlyArray<Secret>): Run => {
  const known = secrets
    .filter(({ value }) => value !== "")
    .toSorted((a, b) => b.value.length - a.value.length);
  const mask = (text: string) =>
    known.reduce(
      (masked, { name, value }) => masked.replaceAll(value, `‹${name}›`),
      text,
    );
  return {
    ...run,
    error: run.error === null ? null : mask(run.error),
    verdicts: run.verdicts.map((verdict) => ({
      ...verdict,
      problems: verdict.problems.map(mask),
    })),
    transcript: run.transcript.map((entry) =>
      entry.kind === "command"
        ? {
            ...entry,
            command: mask(entry.command),
            stdout: mask(entry.stdout),
            stderr: mask(entry.stderr),
          }
        : { ...entry, text: mask(entry.text) },
    ),
    installerTranscript: run.installerTranscript.map((turn) =>
      turn.kind === "call"
        ? { ...turn, input: mask(turn.input) }
        : { ...turn, text: mask(turn.text) },
    ),
  };
};
