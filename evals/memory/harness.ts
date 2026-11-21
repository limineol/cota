import { existsSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { agentAnswerer, defaultAnswererModel } from "./agent.ts";
import type { Answerer } from "./answerer.ts";
import { evaluate, passed, reportPathOf } from "./evaluation.ts";
import { reportOf } from "./report.ts";
import { scripted } from "./scripted.ts";
import { makeWorld } from "./world.ts";

const { values } = parseArgs({
  options: {
    answerer: { type: "string", default: "scripted" },
    model: { type: "string", default: defaultAnswererModel },
    turns: { type: "string", default: "30" },
    "budget-usd": { type: "string", default: "0.5" },
  },
});

const positive = (flag: string, text: string) => {
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`--${flag} is a number above 0, not ${text}.`);
  return value;
};

const answererOf = (name: string): Answerer => {
  if (name === "scripted") return scripted;
  if (name === "claude")
    return agentAnswerer({
      model: values.model,
      turns: Math.floor(positive("turns", values.turns)),
      budgetUsd: positive("budget-usd", values["budget-usd"]),
    });
  throw new Error("--answerer is scripted or claude.");
};

const answerer = answererOf(values.answerer);
const stop = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => stop.abort());

const world = await makeWorld();
let status = 1;
try {
  const evaluation = await evaluate({
    answerer,
    world,
    stop: stop.signal,
    say: (line) => console.error(line),
  });
  const date = new Date().toISOString().slice(0, 10);
  const report = reportOf(evaluation, date, world.secrets);
  const path = reportPathOf(answerer.name, date, existsSync);
  writeFileSync(path, report);
  console.log(report);
  console.error(`The report is ${path}.`);
  status = passed(evaluation) ? 0 : 1;
} finally {
  await world.remove();
}
process.exit(status);
