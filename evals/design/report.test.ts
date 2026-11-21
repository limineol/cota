import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Schema } from "effect";
import { reportOf, ruleCountsOf, totalsOf } from "./report.ts";
import type { Rule } from "./rubric.ts";
import {
  type Arm,
  type Evaluation,
  type Run,
  runIdOf,
  Status,
  type Verdict,
  verdictWords,
} from "./runs.ts";

const rule = (id: string, heldByLint: boolean): Rule => ({
  id,
  scope: "screens.",
  heldBy: heldByLint ? "`bun run lint:design`." : "review.",
  text: `The rule ${id}.`,
  bad: "`bad`",
  good: "`good`",
  heldByLint,
});
const rules = [
  rule("colour-is-data", false),
  rule("screens-compose", true),
  rule("roles-are-words", false),
];

const runOf = (
  arm: Arm,
  repetition: number,
  status: Run["status"],
  verdicts: ReadonlyArray<Verdict["verdict"]> | null,
): Run => ({
  id: runIdOf("keys", arm, repetition),
  task: "keys",
  arm,
  repetition,
  status,
  error: status === "done" ? null : "usage limit reached",
  seconds: 600,
  costUsd: null,
  turns: null,
  model: null,
  patch: status === "done" ? `keys-${arm}-${repetition}.patch` : null,
  changedFiles: 2,
  check: true,
  checkFailure: null,
  lintFindings: 0,
  story: "passed",
  storyFailure: null,
  rendered: true,
  leaks: [],
  judgement:
    verdicts === null
      ? null
      : {
          status: "judged",
          error: null,
          onDiffAlone: false,
          verdicts: rules.map((each, index) => ({
            rule: each.id,
            verdict: verdicts[index] ?? "unjudged",
            evidence: "",
          })),
          seconds: 90,
          costUsd: 0.5,
        },
});

const evaluationOf = (runs: ReadonlyArray<Run>): Evaluation => ({
  commit: "abc123",
  date: "2026-11-17",
  runner: "claude",
  client: { name: "claude", version: "2.1.325", model: "claude-sonnet-5-5" },
  judge: { name: "claude", version: "2.1.325", model: "claude-sonnet-5-5" },
  tasks: ["keys"],
  arms: ["with", "without"],
  repetitions: 3,
  seed: 7,
  minutes: 20,
  runs,
});

const word = Schema.Literals([...verdictWords, "unjudged"]);
const generated = Arbitrary.schema(
  Schema.Array(
    Schema.Struct({
      arm: Schema.Literals(["with", "without"]),
      status: Status,
      judgedIfDone: Schema.Boolean,
      verdicts: Schema.Tuple([word, word, word]),
    }),
  ),
);

describe("the report", () => {
  it("says under a task's runs why a gate failed, by the first line that names the failure", () => {
    const failed = runOf("with", 1, "done", null);
    const report = reportOf(
      evaluationOf([
        {
          ...failed,
          check: false,
          checkFailure: {
            firstLine: "src/pool.tsx(3,1): error TS2304: Cannot find name 'x'.",
            tail: "…",
          },
          story: "failed",
          storyFailure: {
            firstLine: "× src/pool.stories.tsx > Pool > Loading | `play`",
            tail: "…",
          },
        },
      ]),
      rules,
    );
    expect(report).toContain(
      "- keys-with-1, check: `src/pool.tsx(3,1): error TS2304: Cannot find name 'x'.`\n- keys-with-1, stories: `× src/pool.stories.tsx > Pool > Loading \\| 'play'`",
    );
  });

  it.prop(
    "counts every run once, by its status, and only a finished run's verdicts",
    { generated },
    ({ generated }) => {
      const runs = generated.map((each, index) =>
        runOf(
          each.arm,
          index + 1,
          each.status,
          each.status === "done" && each.judgedIfDone ? each.verdicts : null,
        ),
      );
      for (const arm of ["with", "without"] as const) {
        const ofArm = runs.filter((run) => run.arm === arm);
        const totals = totalsOf(ofArm);
        expect(totals.runs).toBe(ofArm.length);
        expect(totals.done + totals.timedOut + totals.failed).toBe(totals.runs);
        expect(totals.judged).toBeLessThanOrEqual(totals.done);
      }
      const counts = ruleCountsOf(runs, rules);
      for (const [index, count] of counts.entries()) {
        for (const arm of ["with", "without"] as const) {
          const verdicts = generated
            .filter(
              (each) =>
                each.arm === arm && each.status === "done" && each.judgedIfDone,
            )
            .map((each) => each.verdicts[index]);
          const counted = arm === "with" ? count.with : count.without;
          expect(counted.broken).toBe(
            verdicts.filter((verdict) => verdict === "broken").length,
          );
          expect(counted.applicable).toBe(
            verdicts.filter(
              (verdict) => verdict === "broken" || verdict === "followed",
            ).length,
          );
          expect(counted.judged).toBe(
            verdicts.filter((verdict) => verdict !== "unjudged").length,
          );
        }
      }
    },
  );

  it("counts a failed run as failed, never as judged, and sorts the rules by what the document changed", () => {
    const report = reportOf(
      evaluationOf([
        runOf("with", 1, "done", ["followed", "followed", "not-applicable"]),
        runOf("without", 1, "done", ["broken", "followed", "not-applicable"]),
        runOf("with", 2, "done", ["followed", "followed", "not-applicable"]),
        runOf("without", 2, "failed", null),
      ]),
      rules,
    );
    expect(report).toContain(
      "With the document: 2 runs, 2 done, 0 timed out, 0 failed; 2 judged.",
    );
    expect(report).toContain(
      "Without it: 2 runs, 1 done, 0 timed out, 1 failed; 1 judged.",
    );
    expect(report).toContain("| `colour-is-data` | no | 0 of 2 | 1 of 1 |");
    expect(report).toContain(
      "| without | 2 | failed: usage limit reached | 10.0 | — | passes | 0 | passed | not judged |",
    );
    expect(report).not.toContain("Where a gate failed");
    expect(report).toContain(
      "Judging: 3 calls, 4.5 minutes, $1.50, as the judge's client reported them.",
    );
    const section = (title: string) =>
      report.slice(report.indexOf(title)).split("\n\n")[1];
    expect(section("**Rules that showed a difference.**")).toBe(
      "- `colour-is-data`: with the document, broken in 0 of 2; without it, broken in 1 of 1.",
    );
    expect(section("**Rules that showed none and that the lint holds,**")).toBe(
      "- `screens-compose`: with the document, broken in 0 of 2; without it, broken in 0 of 1.",
    );
    expect(section("**Rules no run in one of the arms")).toBe(
      "- `roles-are-words`: with the document, it applied to no run; without it, it applied to no run.",
    );
  });
});
