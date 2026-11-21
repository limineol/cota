import { type Spend, type Turn, unfinishedOf } from "./installer.ts";
import type { Actor, Entry, Run } from "./runs.ts";

const cell = (text: string) =>
  text.replaceAll("|", "\\|").replaceAll("\n", " ");

const code = (text: string) => `\`${cell(text).replaceAll("`", "'")}\``;

const firstLine = (text: string, most = 160) => {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > most ? `${line.slice(0, most)}…` : line;
};

const entryLine = (entry: Entry, at: number) =>
  entry.kind === "message"
    ? `${at + 1}. ${entry.from === "installer" ? "The installer said" : "The owner answered"}: ${cell(firstLine(entry.text))}`
    : `${at + 1}. ${entry.actor === "installer" ? "The installer" : "The owner"} ran ${code(firstLine(entry.command))} on ${entry.machine}${entry.cwd.endsWith("/cota") ? ", in the checkout" : ""}${entry.stdin ? ", with standard input" : ""}: ${entry.exitCode === null ? "stopped at its time limit" : `exit ${entry.exitCode}`}`;

const dollars = (usd: number) => `$${usd.toFixed(2)}`;

const spendLine = ({ who, model, costUsd, turns }: Spend) =>
  `the ${who} ${costUsd === null ? "reported no cost" : dollars(costUsd)}${model === null ? "" : `, ${model}`}${turns === null ? "" : `, ${turns} ${who === "owner" ? "answers" : "turns"}`}`;

/** The report of one install eval: its verdicts, what was wrong, and every command and message, each on one line. */
export const reportOf = (run: Run): string => {
  const failed = run.verdicts.filter(({ passed }) => !passed);
  const count = (actor: Actor) =>
    run.transcript.filter(
      (entry) => entry.kind === "command" && entry.actor === actor,
    ).length;
  const messages = run.transcript.filter(
    (entry) => entry.kind === "message" && entry.from === "installer",
  ).length;
  return [
    `# Install eval, ${run.startedAt.slice(0, 10)}: \`${run.task}\` by the ${run.installer}`,
    "",
    `Commit \`${run.commit}\`${run.dirty ? ", without the working tree's changes" : ""}. The ${run.installer} ran ${count("installer")} commands and sent the owner ${messages} messages; the owner ran ${count("owner")} commands. It took ${run.minutes.toFixed(1)} minutes, of at most ${run.limitMinutes}, and ended ${run.ending === "done" ? "saying it was done" : run.ending === "unfinished" ? cell(unfinishedOf(run.error ?? "")) : run.ending === "stopped" ? `stopped at its limit of ${cell(run.error ?? "its time")}` : `failing${run.error === null ? "" : `: ${cell(run.error)}`}`}.`,
    ...(run.spend.length === 0
      ? []
      : [
          "",
          `As its clients reported it, the run cost ${dollars(run.spend.reduce((sum, { costUsd }) => sum + (costUsd ?? 0), 0))}: ${run.spend.map(spendLine).join("; ")}.`,
        ]),
    "",
    run.passed
      ? "**Passed**: every criterion passed."
      : `**Failed**: ${run.verdicts.length === 0 ? "no criterion was read" : `${failed.length} of ${run.verdicts.length} criteria failed`}.`,
    "",
    "| Criterion | Verdict |",
    "| --- | --- |",
    ...run.verdicts.map(
      ({ id, passed }) => `| \`${id}\` | ${passed ? "passed" : "failed"} |`,
    ),
    "",
    ...(failed.length === 0
      ? []
      : [
          "## What was wrong",
          "",
          ...failed.flatMap(({ id, problems }) => [
            `**\`${id}\`**`,
            "",
            ...problems.map((problem) => `- ${cell(problem)}`),
            "",
          ]),
        ]),
    "## What was done",
    "",
    "Each command and message, in order; what each printed is in `run.json`, in the folder of this report's name beside it.",
    "",
    ...run.transcript.map(entryLine),
    "",
  ].join("\n");
};

const fenced = (text: string) => {
  const fence = "`".repeat(
    Math.max(3, ...[...text.matchAll(/`+/g)].map(([run]) => run.length + 1)),
  );
  return `${fence}text\n${text}\n${fence}`;
};

/** An agent installer's own transcript: what it wrote, each tool it called with what it gave, and what each returned. */
export const transcriptOf = (
  installer: string,
  turns: ReadonlyArray<Turn>,
): string =>
  [
    `# The ${installer}'s transcript`,
    "",
    "What it wrote, each tool it called and what it returned, in order; every secret the eval knows is written as its name.",
    "",
    ...turns.flatMap((turn) =>
      turn.kind === "text"
        ? [turn.text, ""]
        : turn.kind === "call"
          ? [`**Called \`${turn.tool}\`**`, "", fenced(turn.input), ""]
          : turn.kind === "returned"
            ? [
                turn.isError ? "**It returned an error:**" : "**It returned:**",
                "",
                fenced(turn.text),
                "",
              ]
            : [`**The client ended:** ${turn.text}`, ""],
    ),
  ].join("\n");
