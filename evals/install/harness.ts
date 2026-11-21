import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { agentInstaller, defaultInstallerModel } from "./agent.ts";
import { evaluate, writeReport } from "./evaluation.ts";
import { askClaude, defaultOwnerModel, modelOwner } from "./model-owner.ts";
import { rehearsal } from "./rehearsal.ts";
import { tasks } from "./tasks.ts";

const { values } = parseArgs({
  options: {
    task: { type: "string", default: tasks[0]?.id ?? "" },
    installer: { type: "string", default: "rehearsal" },
    model: { type: "string", default: defaultInstallerModel },
    "owner-model": { type: "string", default: defaultOwnerModel },
    turns: { type: "string", default: "200" },
    "budget-usd": { type: "string", default: "5" },
    "owner-budget-usd": { type: "string", default: "0.5" },
  },
});

const task = tasks.find(({ id }) => id === values.task);
if (task === undefined) {
  throw new Error(`--task is one of ${tasks.map(({ id }) => id).join(", ")}.`);
}
if (values.installer !== "rehearsal" && values.installer !== "claude") {
  throw new Error("--installer is rehearsal or claude.");
}

const positive = (flag: string, text: string) => {
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`--${flag} is a number above 0, not ${text}.`);
  return value;
};

const say = (line: string) => console.log(line);
const run =
  values.installer === "rehearsal"
    ? await evaluate({ task, installer: rehearsal(task), say })
    : await evaluate({
        task,
        installer: agentInstaller({
          task,
          model: values.model,
          turns: Math.floor(positive("turns", values.turns)),
          budgetUsd: positive("budget-usd", values["budget-usd"]),
        }),
        owner: ({ hands }) =>
          modelOwner({
            task,
            hands,
            ask: askClaude(values["owner-model"]),
            budgetUsd: positive("owner-budget-usd", values["owner-budget-usd"]),
          }),
        say,
      });
const report = writeReport(
  fileURLToPath(new URL("reports", import.meta.url)),
  run,
);
console.log(await Bun.file(report).text());
console.log(`The report is ${report}`);
process.exit(run.passed ? 0 : 1);
