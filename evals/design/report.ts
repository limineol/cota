import type { Rule } from "./rubric.ts";
import type { Arm, Evaluation, Run } from "./runs.ts";

export interface ArmTotals {
  readonly runs: number;
  readonly done: number;
  readonly timedOut: number;
  readonly failed: number;
  readonly judged: number;
}

export interface Count {
  readonly broken: number;
  readonly applicable: number;
  readonly judged: number;
}

export type Finding = "differs" | "same, held by the lint" | "same" | "untried";

export interface RuleCount {
  readonly rule: Rule;
  readonly with: Count;
  readonly without: Count;
  readonly finding: Finding;
}

const judgedRuns = (runs: ReadonlyArray<Run>) =>
  runs.filter(({ judgement }) => judgement?.status === "judged");

export const totalsOf = (runs: ReadonlyArray<Run>): ArmTotals => ({
  runs: runs.length,
  done: runs.filter(({ status }) => status === "done").length,
  timedOut: runs.filter(({ status }) => status === "timed-out").length,
  failed: runs.filter(({ status }) => status === "failed").length,
  judged: judgedRuns(runs).length,
});

const countOf = (runs: ReadonlyArray<Run>, rule: string): Count => {
  const verdicts = judgedRuns(runs).flatMap(
    ({ judgement }) =>
      judgement?.verdicts.filter((verdict) => verdict.rule === rule) ?? [],
  );
  return {
    broken: verdicts.filter(({ verdict }) => verdict === "broken").length,
    applicable: verdicts.filter(
      ({ verdict }) => verdict === "broken" || verdict === "followed",
    ).length,
    judged: verdicts.filter(({ verdict }) => verdict !== "unjudged").length,
  };
};

const findingOf = (rule: Rule, withIt: Count, without: Count): Finding => {
  if (withIt.applicable === 0 || without.applicable === 0) return "untried";
  const differs =
    withIt.broken * without.applicable !== without.broken * withIt.applicable;
  if (differs) return "differs";
  return rule.heldByLint ? "same, held by the lint" : "same";
};

const ofArm = (runs: ReadonlyArray<Run>, arm: Arm) =>
  runs.filter((run) => run.arm === arm);

export const ruleCountsOf = (
  runs: ReadonlyArray<Run>,
  rules: ReadonlyArray<Rule>,
): ReadonlyArray<RuleCount> =>
  rules.map((rule) => {
    const withIt = countOf(ofArm(runs, "with"), rule.id);
    const without = countOf(ofArm(runs, "without"), rule.id);
    return {
      rule,
      with: withIt,
      without,
      finding: findingOf(rule, withIt, without),
    };
  });

const cell = (text: string) =>
  text.replaceAll("|", "\\|").replaceAll("\n", " ");

const quoted = (line: string) =>
  `\`${cell(line.slice(0, 300)).replaceAll("`", "'")}\``;

const yesNo = (value: boolean | null, yes: string, no: string) =>
  value === null ? "—" : value ? yes : no;

const brokenIn = (run: Run) =>
  run.judgement?.status === "judged"
    ? run.judgement.verdicts
        .filter(({ verdict }) => verdict === "broken")
        .map(({ rule }) => rule)
    : [];

const judgementCell = (run: Run) => {
  if (run.judgement === null) return "not judged";
  if (run.judgement.status === "failed") {
    return `judge failed: ${run.judgement.error ?? ""}`;
  }
  const broken = brokenIn(run);
  return `${broken.length}${broken.length === 0 ? "" : `: ${broken.join(", ")}`}${run.judgement.onDiffAlone ? " (on the patch alone)" : ""}`;
};

/** Under a task's runs, the first line of each failed gate; the rest of what it printed is in `runs.json`. */
const failuresOf = (runs: ReadonlyArray<Run>) => {
  const lines = runs.flatMap((run) => [
    ...(run.checkFailure === null
      ? []
      : [`- ${run.id}, check: ${quoted(run.checkFailure.firstLine)}`]),
    ...(run.storyFailure === null
      ? []
      : [`- ${run.id}, stories: ${quoted(run.storyFailure.firstLine)}`]),
  ]);
  return lines.length === 0
    ? []
    : [
        "Where a gate failed, the first line it printed that says so (the last 60 lines are in `runs.json`):",
        "",
        ...lines,
        "",
      ];
};

const countCell = ({ broken, applicable }: Count) =>
  applicable === 0 ? "—" : `${broken} of ${applicable}`;

const armWords: Readonly<Record<Arm, string>> = {
  with: "with the document",
  without: "without it",
};

const totalsSentence = (arm: Arm, totals: ArmTotals) =>
  `${armWords[arm][0]?.toUpperCase()}${armWords[arm].slice(1)}: ${totals.runs} ${totals.runs === 1 ? "run" : "runs"}, ${totals.done} done, ${totals.timedOut} timed out, ${totals.failed} failed; ${totals.judged} judged.`;

const judgingSentence = (runs: ReadonlyArray<Run>) => {
  const judgements = runs.flatMap(({ judgement }) =>
    judgement === null ? [] : [judgement],
  );
  const costs = judgements.flatMap(({ costUsd }) =>
    costUsd === null ? [] : [costUsd],
  );
  const minutes =
    judgements.reduce((total, { seconds }) => total + seconds, 0) / 60;
  const cost =
    costs.length === 0
      ? "cost not reported"
      : `$${costs.reduce((total, each) => total + each, 0).toFixed(2)}${costs.length < judgements.length ? ` for the ${costs.length} that reported one` : ""}`;
  return `Judging: ${judgements.length} ${judgements.length === 1 ? "call" : "calls"}, ${minutes.toFixed(1)} minutes, ${cost}, as the judge's client reported them.`;
};

const phrase = ({ broken, applicable }: Count) =>
  applicable === 0
    ? "it applied to no run"
    : `broken in ${broken} of ${applicable}`;

const list = (counts: ReadonlyArray<RuleCount>, empty: string) =>
  counts.length === 0
    ? [empty]
    : counts.map(
        ({ rule, with: withIt, without }) =>
          `- \`${rule.id}\`: with the document, ${phrase(withIt)}; without it, ${phrase(without)}.`,
      );

/** The report of an evaluation: its runs, rule by rule what the document changed, and what the numbers cannot carry. */
export const reportOf = (
  evaluation: Evaluation,
  rules: ReadonlyArray<Rule>,
): string => {
  const counts = ruleCountsOf(evaluation.runs, rules);
  const withFinding = (finding: Finding) =>
    counts.filter((count) => count.finding === finding);
  const judge = evaluation.judge;
  const leaks = evaluation.runs.filter(({ leaks }) => leaks.length > 0);
  return [
    `# Design eval, ${evaluation.date}`,
    "",
    `Commit \`${evaluation.commit}\`. Runs made by ${evaluation.client.name} ${evaluation.client.version} with ${evaluation.client.model}, at most ${evaluation.minutes} minutes each; judged by ${judge === null ? "no judge" : `${judge.name} ${judge.version} with ${judge.model}`}, blind to the arm, in an order drawn from seed ${evaluation.seed}. Tasks: ${evaluation.tasks.map((task) => `\`${task}\``).join(", ")}; arms: ${evaluation.arms.join(", ")}; ${evaluation.repetitions} repetition${evaluation.repetitions === 1 ? "" : "s"} of each. The patch each run made, and every figure below as JSON (\`runs.json\`), are in the folder of this report's name beside it; the transcripts and the scratch copies are not kept.`,
    "",
    ...evaluation.arms.map((arm) =>
      totalsSentence(arm, totalsOf(ofArm(evaluation.runs, arm))),
    ),
    "",
    judgingSentence(evaluation.runs),
    "",
    "## Runs",
    "",
    ...evaluation.tasks.flatMap((task) => [
      `### \`${task}\``,
      "",
      "| Arm | Repetition | Status | Minutes | Cost | Check | Lint findings | Story | Rules broken |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      ...evaluation.runs
        .filter((run) => run.task === task)
        .map(
          (run) =>
            `| ${run.arm} | ${run.repetition} | ${cell(run.status === "done" ? "done" : `${run.status}: ${run.error ?? ""}`)} | ${(run.seconds / 60).toFixed(1)} | ${run.costUsd === null ? "—" : `$${run.costUsd.toFixed(2)}`} | ${yesNo(run.check, "passes", "fails")} | ${run.lintFindings ?? "—"} | ${run.story ?? "—"}${run.rendered === false && run.story !== "none" ? ", not drawn" : ""} | ${cell(judgementCell(run))} |`,
        ),
      "",
      ...failuresOf(evaluation.runs.filter((run) => run.task === task)),
    ]),
    "## Rules",
    "",
    "Each cell is the runs that broke the rule, of the judged runs it applied to (followed or broken); — where it applied to none.",
    "",
    "| Rule | Held by the lint | With the document | Without it |",
    "| --- | --- | --- | --- |",
    ...counts.map(
      ({ rule, with: withIt, without }) =>
        `| \`${rule.id}\` | ${rule.heldByLint ? "yes" : "no"} | ${countCell(withIt)} | ${countCell(without)} |`,
    ),
    "",
    "## What the document changed",
    "",
    "**Rules that showed a difference.**",
    "",
    ...list(withFinding("differs"), "None."),
    "",
    "**Rules that showed none and that the lint holds,** so the document is not what holds them:",
    "",
    ...list(withFinding("same, held by the lint"), "None."),
    "",
    "**Rules that showed none and that the lint does not hold:** in these runs the document changed nothing about them, so each is a candidate to cut or to rewrite.",
    "",
    ...list(withFinding("same"), "None."),
    "",
    "**Rules no run in one of the arms gave a chance to break,** so these runs say nothing about them:",
    "",
    ...list(withFinding("untried"), "None."),
    "",
    "## Leaks",
    "",
    ...(leaks.length === 0
      ? [
          "No run's patch quotes the document or a rule by its id, so nothing in what the judge read gave an arm away.",
        ]
      : [
          "These lines of a run's patch quote the document or a rule by its id. The judge read them as they are:",
          "",
          ...leaks.flatMap((run) =>
            run.leaks.map((leak) => `- ${run.id}: ${cell(leak)}`),
          ),
        ]),
    "",
    "## What these numbers cannot carry",
    "",
    `${evaluation.runs.length} runs of ${evaluation.tasks.length} task${evaluation.tasks.length === 1 ? "" : "s"}, by one model, judged by one model reading a patch and screenshots, with no person checking its verdicts: a difference of a run or two is what chance gives, and a rule that showed none may simply not have been tempted hard enough by these tasks. The without arm still has the design system's code, its stories, the lint, ADR-0020 and the dashboard spec, which carry some of the rules on their own, so what is measured is what the document adds to them.`,
    "",
  ].join("\n");
};
