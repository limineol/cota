import { Schema } from "effect";

export const arms = ["with", "without"] as const;
export const Arm = Schema.Literals(arms);
export type Arm = typeof Arm.Type;

export const runners = ["claude", "codex", "replay"] as const;
export const Runner = Schema.Literals(runners);
export type Runner = typeof Runner.Type;

export const Status = Schema.Literals(["done", "timed-out", "failed"]);
export type Status = typeof Status.Type;

export const verdictWords = ["followed", "broken", "not-applicable"] as const;
export const VerdictWord = Schema.Literals(verdictWords);
export type VerdictWord = typeof VerdictWord.Type;

export const Verdict = Schema.Struct({
  rule: Schema.String,
  verdict: Schema.Literals([...verdictWords, "unjudged"]),
  evidence: Schema.String,
});
export type Verdict = typeof Verdict.Type;

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const Judgement = Schema.Struct({
  status: Schema.Literals(["judged", "failed"]),
  error: Schema.NullOr(Schema.String),
  onDiffAlone: Schema.Boolean,
  verdicts: Schema.Array(Verdict),
  seconds: Schema.Finite,
  costUsd: Schema.NullOr(Schema.Finite),
});
export type Judgement = typeof Judgement.Type;

/** Why a gate failed: the first line of its output that says so, and the last lines it printed. */
export const GateFailure = Schema.Struct({
  firstLine: Schema.String,
  tail: Schema.String,
});
export type GateFailure = typeof GateFailure.Type;

export const Run = Schema.Struct({
  id: Schema.String,
  task: Schema.String,
  arm: Arm,
  repetition: Count,
  status: Status,
  error: Schema.NullOr(Schema.String),
  seconds: Schema.Finite,
  costUsd: Schema.NullOr(Schema.Finite),
  turns: Schema.NullOr(Count),
  model: Schema.NullOr(Schema.String),
  patch: Schema.NullOr(Schema.String),
  changedFiles: Count,
  check: Schema.NullOr(Schema.Boolean),
  checkFailure: Schema.NullOr(GateFailure),
  lintFindings: Schema.NullOr(Count),
  story: Schema.NullOr(Schema.Literals(["passed", "failed", "none"])),
  storyFailure: Schema.NullOr(GateFailure),
  rendered: Schema.NullOr(Schema.Boolean),
  leaks: Schema.Array(Schema.String),
  judgement: Schema.NullOr(Judgement),
});
export type Run = typeof Run.Type;

export const Client = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  model: Schema.String,
});
export type Client = typeof Client.Type;

export const Evaluation = Schema.Struct({
  commit: Schema.String,
  date: Schema.String,
  runner: Runner,
  client: Client,
  judge: Schema.NullOr(Client),
  tasks: Schema.Array(Schema.String),
  arms: Schema.Array(Arm),
  repetitions: Count,
  seed: Schema.Int,
  minutes: Count,
  runs: Schema.Array(Run),
});
export type Evaluation = typeof Evaluation.Type;

export const decodeEvaluation = Schema.decodeUnknownSync(
  Schema.fromJsonString(Evaluation),
);

export const runIdOf = (task: string, arm: Arm, repetition: number) =>
  `${task}-${arm}-${repetition}`;
