import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { parseArgs } from "node:util";
import { Glob } from "bun";
import type { Mutant } from "./mutants.table.ts";

interface TestResult {
  readonly title: string;
  readonly status: string;
  readonly failureMessages: ReadonlyArray<string>;
}

interface Test extends TestResult {
  readonly file: string;
}

interface Run {
  readonly tests: ReadonlyArray<Test>;
  readonly errors: ReadonlyArray<string>;
}

type Outcome = "killed" | "SURVIVED" | "STALE" | "BROKEN";

export interface Verdict {
  readonly name: string;
  readonly law: string;
  readonly file: string;
  readonly killedBy: string;
  readonly outcome: Outcome;
  readonly counterexample: string;
}

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: { json: { type: "string" } },
  allowPositionals: true,
});
const root = positionals[0] ?? join(import.meta.dir, "..");
const toolchain = join(import.meta.dir, "..", "node_modules");
const notCopied = [".git", "node_modules", ".tools", "evidence"];

const table: { readonly mutants: ReadonlyArray<Mutant> } = await import(
  join(root, "tooling", "mutants.table.ts")
);

const copyOf = (mutant?: Mutant): string => {
  const copy = realpathSync(mkdtempSync(join(tmpdir(), "cota-mutant-")));
  for (const entry of readdirSync(root)) {
    if (notCopied.includes(entry)) continue;
    cpSync(join(root, entry), join(copy, entry), {
      recursive: true,
      verbatimSymlinks: true,
    });
  }
  mkdirSync(join(copy, "node_modules"));
  for (const entry of readdirSync(toolchain)) {
    if (entry.startsWith(".vite")) continue;
    symlinkSync(join(toolchain, entry), join(copy, "node_modules", entry));
  }
  if (mutant !== undefined) {
    const file = join(copy, mutant.file);
    writeFileSync(
      file,
      readFileSync(file, "utf8").replace(mutant.find, () => mutant.replace),
    );
  }
  return copy;
};

const inCopyOf = async <A>(
  mutant: Mutant | undefined,
  f: (copy: string) => Promise<A>,
): Promise<A> => {
  const copy = copyOf(mutant);
  try {
    return await f(copy);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
};

const projectOf = (copy: string, file: string): string | undefined => {
  for (let dir = dirname(file); ; dir = dirname(dir)) {
    if (existsSync(join(copy, dir, "tsconfig.json"))) return dir;
    if (dir === ".") return undefined;
  }
};

const typeErrorsOf = async (
  copy: string,
  files: ReadonlyArray<string>,
): Promise<string> => {
  const projects = new Set(files.map((file) => projectOf(copy, file)));
  const outputs = await Promise.all(
    [...projects].map(async (project) => {
      if (project === undefined) return "a file has no tsconfig.json over it";
      const typeCheck = Bun.spawn(
        [process.execPath, "--bun", "effect-tsgo", "tsc", "-p", project],
        { cwd: copy, stdout: "pipe", stderr: "pipe" },
      );
      const output = await new Response(typeCheck.stdout).text();
      return (await typeCheck.exited) === 0 ? "" : output.trim();
    }),
  );
  return outputs.filter((output) => output !== "").join("\n");
};

/**
 * Every property draws the same cases in every run of the gate (ADR-0004), so
 * a verdict says what the test does and not what it happened to draw.
 */
const propertySeed = "1";

const exactly = (titles: ReadonlyArray<string>) =>
  `(?:${titles.map((title) => title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`;

const declaring = (copy: string, titles: ReadonlyArray<string>) =>
  [...new Glob("**/*.test.ts").scanSync(copy)].filter(
    (file) =>
      !file.split("/").includes("node_modules") &&
      titles.some((title) =>
        readFileSync(join(copy, file), "utf8").includes(JSON.stringify(title)),
      ),
  );

/**
 * The clickhouse tier runs under its own configuration, which the default one
 * excludes; every other test runs under the default.
 */
const configsOf = (files: ReadonlyArray<string>) =>
  [
    {
      files: files.filter((file) => !file.endsWith(".clickhouse.test.ts")),
      config: [],
    },
    {
      files: files.filter((file) => file.endsWith(".clickhouse.test.ts")),
      config: ["--config=vitest.clickhouse.config.ts"],
    },
  ].filter(({ files }) => files.length > 0);

const runOf = async (
  copy: string,
  files: ReadonlyArray<string>,
  config: ReadonlyArray<string>,
  titles: ReadonlyArray<string>,
  workers: number,
  report: string,
): Promise<Run> => {
  const vitest = Bun.spawn(
    [
      process.execPath,
      "--bun",
      "vitest",
      "run",
      ...config,
      ...files,
      `--testNamePattern=${exactly(titles)}`,
      `--maxWorkers=${workers}`,
      "--reporter=json",
      `--outputFile=${report}`,
    ],
    {
      cwd: copy,
      env: { ...process.env, COTA_PROPERTY_SEED: propertySeed },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const output = await new Response(vitest.stderr).text();
  await vitest.exited;
  const parsed: {
    readonly testResults?: ReadonlyArray<{
      readonly name: string;
      readonly message: string;
      readonly assertionResults: ReadonlyArray<TestResult>;
    }>;
  } = await Bun.file(report)
    .json()
    .catch(() => ({}));
  if (parsed.testResults === undefined) {
    return { tests: [], errors: [output.trim()] };
  }
  return {
    tests: parsed.testResults.flatMap((file) =>
      file.assertionResults.map((test) => ({
        ...test,
        file: relative(copy, file.name),
      })),
    ),
    errors: parsed.testResults
      .map((file) => file.message)
      .filter((message) => message !== ""),
  };
};

const testsOf = async (
  copy: string,
  titles: ReadonlyArray<string>,
  workers: number,
): Promise<Run> => {
  const files = declaring(copy, titles);
  if (files.length === 0) {
    return { tests: [], errors: ["no test file declares it"] };
  }
  // One tier at a time: each run takes every worker, and two at once made
  // the slowest clickhouse test pass its time limit on a small machine.
  const runs: Array<Run> = [];
  for (const [index, tier] of configsOf(files).entries()) {
    runs.push(
      await runOf(
        copy,
        tier.files,
        tier.config,
        titles,
        workers,
        join(copy, `report-${index}.json`),
      ),
    );
  }
  return {
    tests: runs.flatMap(({ tests }) => tests),
    errors: runs.flatMap(({ errors }) => errors),
  };
};

const occurrences = (mutant: Mutant): number =>
  readFileSync(join(root, mutant.file), "utf8").split(mutant.find).length - 1;

const counterexampleOf = (failure: string): string => {
  const shrunk = failure.match(/Shrunk input: ([\s\S]*?)\nFailure:/)?.[1];
  if (shrunk !== undefined) return shrunk;
  return failure.split("\n    at ")[0]?.trim() ?? failure;
};

const verdictOf = async (mutant: Mutant): Promise<Verdict> => {
  const verdict = {
    name: mutant.name,
    law: mutant.law ?? "—",
    file: mutant.file,
    killedBy: mutant.killedBy,
    counterexample: "",
  };
  const found = occurrences(mutant);
  if (found !== 1) {
    return {
      ...verdict,
      outcome: "STALE",
      counterexample: `its text is found ${found} times in ${mutant.file}, not once`,
    };
  }
  const { killer, errors, typeErrors } = await inCopyOf(
    mutant,
    async (copy) => {
      const run = await testsOf(copy, [mutant.killedBy], 1);
      // A law can be tested under its one title in several files: the mutant
      // is killed when any of those tests fails.
      const named = run.tests.filter(
        ({ title, status }) =>
          title === mutant.killedBy && status !== "skipped",
      );
      const killer =
        named.find(({ status }) => status === "failed") ?? named[0];
      const typeErrors = await typeErrorsOf(copy, [
        mutant.file,
        ...named.map(({ file }) => file),
      ]);
      return { killer, errors: run.errors, typeErrors };
    },
  );
  if (typeErrors !== "") {
    return {
      ...verdict,
      outcome: "BROKEN",
      counterexample: `the mutant does not type-check:\n${typeErrors}`,
    };
  }
  if (killer === undefined) {
    return {
      ...verdict,
      outcome: "BROKEN",
      counterexample: `the test did not run: ${errors.join("\n") || "no test has that name"}`,
    };
  }
  if (killer.status !== "failed") {
    return { ...verdict, outcome: "SURVIVED" };
  }
  return {
    ...verdict,
    outcome: "killed",
    counterexample: counterexampleOf(killer.failureMessages[0] ?? ""),
  };
};

const inParallel = async <A, B>(
  items: ReadonlyArray<A>,
  f: (item: A) => Promise<B>,
): Promise<Array<B>> => {
  const results: Array<B> = [];
  let next = 0;
  const worker = async () => {
    for (let index = next++; index < items.length; index = next++) {
      const item = items[index];
      if (item !== undefined) results[index] = await f(item);
    }
  };
  await Promise.all(Array.from({ length: availableParallelism() }, worker));
  return results;
};

const indented = (text: string) => text.replace(/^/gm, "        ");

const printed = (verdict: Verdict) => {
  const lines = [
    `${verdict.outcome.padEnd(9)}${verdict.law.padEnd(4)}${verdict.name}`,
  ];
  if (verdict.outcome === "killed") {
    lines.push(
      indented(`by "${verdict.killedBy}"`),
      indented(`counterexample: ${verdict.counterexample}`),
    );
  }
  if (verdict.outcome === "SURVIVED") {
    lines.push(indented(`"${verdict.killedBy}" still passes`));
  }
  if (verdict.outcome === "STALE" || verdict.outcome === "BROKEN") {
    lines.push(indented(verdict.counterexample));
  }
  return lines.join("\n");
};

const started = performance.now();
const baseline = await inCopyOf(undefined, (copy) =>
  testsOf(
    copy,
    table.mutants.map(({ killedBy }) => killedBy),
    availableParallelism(),
  ),
);
const baselineFailures = baseline.tests.filter(
  ({ status }) => status === "failed",
);
if (baseline.errors.length > 0 || baselineFailures.length > 0) {
  console.error(
    [
      "mutants: a named test fails on the unmutated code, so no mutant can be judged:",
      ...baselineFailures.flatMap(({ title, failureMessages }) => [
        `  ${title}`,
        ...failureMessages.map((failure) =>
          indented(counterexampleOf(failure)),
        ),
      ]),
      ...baseline.errors.map(indented),
    ].join("\n"),
  );
  process.exit(2);
}

const verdicts = await inParallel(table.mutants, verdictOf);
for (const verdict of verdicts) console.log(printed(verdict));

const seconds = ((performance.now() - started) / 1000).toFixed(1);
const count = (outcome: Outcome) =>
  verdicts.filter((verdict) => verdict.outcome === outcome).length;
console.log(
  `mutants: ${count("killed")} killed, ${count("SURVIVED")} survived, ${count("STALE")} stale, ${count("BROKEN")} broken, in ${seconds}s`,
);
if (values.json !== undefined) {
  writeFileSync(values.json, JSON.stringify(verdicts, null, 2));
}
process.exitCode = verdicts.every(({ outcome }) => outcome === "killed")
  ? 0
  : 1;
