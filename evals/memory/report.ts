import { type Evaluation, passed } from "./evaluation.ts";
import type { Secrets } from "./verdicts.ts";

const cell = (text: string) =>
  text.replaceAll("|", "\\|").replaceAll("\n", " ");

const code = (text: string) => `\`${cell(text).replaceAll("`", "'")}\``;

const firstLine = (text: string, most = 160) => {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > most ? `${line.slice(0, most)}…` : line;
};

/** Text with the world's secrets written by their names. */
export const withoutSecrets = (text: string, secrets: Secrets): string =>
  text
    .split(secrets.readerKey)
    .join("<the reader key>")
    .split(secrets.planted)
    .join("<the planted secret>");

/** The report of one memory eval: each question's verdict, why when it is not right, the answer's first lines, and every command, each on one line. */
export const reportOf = (
  evaluation: Evaluation,
  date: string,
  secrets: Secrets,
): string => {
  const counts = new Map<string, number>();
  for (const { verdict } of evaluation.asked)
    counts.set(verdict.kind, (counts.get(verdict.kind) ?? 0) + 1);
  const spent = evaluation.asked.flatMap(({ spent }) =>
    spent === null || spent.costUsd === null ? [] : [spent.costUsd],
  );
  const lines = [
    `# Memory eval, ${date}: the ${evaluation.answerer} answerer`,
    "",
    `Commit \`${evaluation.commit}\`${evaluation.changed ? ", with the working tree's changes" : ""}. ${[...counts].map(([kind, count]) => `${count} ${kind}`).join(", ")} of ${evaluation.asked.length} questions.${spent.length === 0 ? "" : ` As its client reported it, the run cost $${spent.reduce((sum, each) => sum + each, 0).toFixed(2)}.`}`,
    "",
    passed(evaluation)
      ? "**Passed**: every answer is right."
      : "**Failed**: not every answer is right.",
    "",
    "| Question | Found by | Verdict |",
    "| --- | --- | --- |",
    ...evaluation.asked.map(
      ({ question, verdict }) =>
        `| \`${question.id}\` | ${cell(question.foundBy)} | ${verdict.kind}${verdict.kind === "right" ? "" : `: ${cell(verdict.why)}`} |`,
    ),
  ];
  for (const { question, answered } of evaluation.asked) {
    lines.push(
      "",
      `## \`${question.id}\``,
      "",
      `> ${cell(question.asked)}`,
      "",
    );
    if (answered === null) {
      lines.push("It gave no answer.");
      continue;
    }
    lines.push(
      answered.kind === "answer"
        ? `Its answer: ${code(answered.text.trim().split("\n").slice(0, 3).join(" / "))}`
        : `It was stopped at ${answered.limit}.`,
      "",
      ...answered.ran.map(
        (ran, at) =>
          `${at + 1}. ${code(firstLine(ran.command))}${ran.stdin === null ? "" : ", with standard input"}${ran.command.includes("\n") ? `, ${ran.command.split("\n").length} lines` : ""}: ${ran.exitCode === null ? "stopped at its time limit" : `exit ${ran.exitCode}`}`,
      ),
    );
  }
  return `${withoutSecrets(lines.join("\n"), secrets)}\n`;
};
