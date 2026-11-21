import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { bendVersion, leanVersion } from "./bend.ts";
import {
  problemsOf,
  rowsOf,
  statusOf,
  type TestOutcome,
  type Tier,
  testsOf,
  tiers,
} from "./laws.ts";
import type { Verdict } from "./mutants.ts";

interface Gate {
  readonly name: string;
  readonly command: string;
  readonly exitCode: number;
  readonly seconds: number;
  readonly output: string;
}

interface Law {
  readonly id: string;
  readonly sentence: string;
  readonly heldBy: ReadonlyArray<string>;
  readonly ran: Readonly<Partial<Record<Tier, string>>>;
  readonly problems: ReadonlyArray<string>;
  readonly mutantsKilled: number;
}

interface TestReport {
  readonly testResults?: ReadonlyArray<{
    readonly name: string;
    readonly assertionResults: ReadonlyArray<{
      readonly title: string;
      readonly status: string;
    }>;
  }>;
}

const root = join(import.meta.dir, "..");
const verdict =
  process.argv.includes("--verdict") || process.env.CI !== undefined;

const git = (...args: ReadonlyArray<string>) =>
  Bun.spawnSync(["git", ...args], { cwd: root })
    .stdout.toString()
    .trim();

const versionOf = (manifest: string): string =>
  String(JSON.parse(readFileSync(join(root, manifest), "utf8")).version);

const readJson = async <A>(path: string, otherwise: A): Promise<A> =>
  existsSync(path) ? Bun.file(path).json() : otherwise;

const commit = git("rev-parse", "--short", "HEAD");
const dirty = git("status", "--porcelain") !== "";
const startedAt = new Date().toISOString();
const evidence = join(
  root,
  "evidence",
  `${startedAt.replace(/[-:]|\.\d+/g, "")}-${commit}`,
);
mkdirSync(evidence, { recursive: true });
const testsJson = relative(root, join(evidence, "tests.json"));
const clickhouseJson = relative(root, join(evidence, "clickhouse.json"));
const slowJson = relative(root, join(evidence, "slow.json"));
const mutantsJson = relative(root, join(evidence, "mutants.json"));

const tools: Record<string, string> = {
  Bun: Bun.version,
  TypeScript: versionOf("node_modules/typescript/package.json"),
  Effect: versionOf("apps/hub/node_modules/effect/package.json"),
  Bend: bendVersion,
  ...(verdict ? { "Lean, for the BendTT kernel": leanVersion } : {}),
};

const commands: ReadonlyArray<readonly [string, string]> = [
  ["check", "bun run check"],
  [
    "test",
    `bun run test --reporter=default --reporter=json --outputFile.json=${testsJson}`,
  ],
  [
    "clickhouse",
    `bun run test:clickhouse --reporter=default --reporter=json --outputFile.json=${clickhouseJson}`,
  ],
  ["stories", "bun run stories"],
  [
    "evals",
    `bun run test:evals --reporter=default --reporter=json --outputFile.json=${slowJson}`,
  ],
  ["prove", verdict ? "bun run prove --verdict" : "bun run prove"],
  ["prove:models", "bun run prove:models"],
  ["mutants", `bun run mutants --json ${mutantsJson}`],
];

const run = async (name: string, command: string): Promise<Gate> => {
  const started = performance.now();
  const gate = Bun.spawn(["sh", "-c", `${command} 2>&1`], {
    cwd: root,
    env: { ...process.env, NO_COLOR: "1" },
    stdout: "pipe",
  });
  const output = await new Response(gate.stdout).text();
  const exitCode = await gate.exited;
  const seconds = (performance.now() - started) / 1000;
  return { name, command, exitCode, seconds, output: output.trimEnd() };
};

const gates: Array<Gate> = [];
for (const [name, command] of commands) {
  const gate = await run(name, command);
  gates.push(gate);
  console.log(
    `${gate.exitCode === 0 ? "ok  " : "FAIL"}  ${name.padEnd(13)}${gate.seconds.toFixed(1).padStart(5)}s  ${command}`,
  );
  if (gate.exitCode !== 0) console.log(gate.output.replace(/^/gm, "      "));
}

const tests: ReadonlyArray<TestReport> = [
  await readJson(join(root, testsJson), {}),
  await readJson(join(root, clickhouseJson), {}),
  await readJson(join(root, slowJson), {}),
];
const mutants: ReadonlyArray<Verdict> = await readJson(
  join(root, mutantsJson),
  [],
);
const passed = (name: string) =>
  gates.find((gate) => gate.name === name)?.exitCode === 0;

const outcomes: ReadonlyArray<TestOutcome> = tests.flatMap((report) =>
  (report.testResults ?? []).flatMap((file) =>
    file.assertionResults.map(({ title, status }) => ({
      file: relative(root, file.name),
      title,
      status,
    })),
  ),
);

const proofOf = (id: string) =>
  readdirSync(join(root, "proofs"), { withFileTypes: true })
    .filter((entry) =>
      existsSync(join(root, "proofs", entry.name, "LAWS.bend")),
    )
    .flatMap((entry) => {
      const laws = readFileSync(
        join(root, "proofs", entry.name, "LAWS.bend"),
        "utf8",
      );
      const name = laws.match(
        new RegExp(`^law (${id.toLowerCase()}_\\w+):$`, "m"),
      )?.[1];
      return name === undefined ? [] : [{ directory: entry.name, name }];
    })[0];

const namesNoCode = /^code: \[\]$/m;
const specOf = (concept: string) =>
  readFileSync(join(root, "docs", "specs", concept, "spec.md"), "utf8");

const laws: ReadonlyArray<Law> = readdirSync(join(root, "docs", "specs"))
  .sort()
  .filter((concept) => !namesNoCode.test(specOf(concept)))
  .flatMap((concept) =>
    rowsOf(specOf(concept)).map((row) => {
      const { id } = row;
      const proof = proofOf(id);
      const ran: Partial<Record<Tier, string>> = {};
      if (row.claims.includes("types")) {
        ran.types = passed("check") ? "passed, bun run check" : "failed";
      }
      for (const tier of [
        "property",
        "replay",
        "contract",
        "clickhouse",
        "slow",
      ] as const) {
        const status = statusOf(testsOf(id, tier, outcomes));
        if (status !== undefined) ran[tier] = status;
      }
      if (proof !== undefined) {
        ran.proof = `${passed("prove") ? "checked" : "failed"}${verdict ? " with --verdict" : ""}, ${proof.name}`;
        const agreement = statusOf(
          outcomes.filter(
            ({ file, title }) =>
              file === `proofs/${proof.directory}/agreement.test.ts` &&
              title.startsWith("the shipped "),
          ),
        );
        if (agreement !== undefined) ran.agreement = agreement;
      }
      return {
        id,
        sentence: row.sentence,
        heldBy: row.claims,
        ran,
        problems: problemsOf(row, ran),
        mutantsKilled: mutants.filter(
          (mutant) => mutant.law === id && mutant.outcome === "killed",
        ).length,
      };
    }),
  );

const problems = laws.flatMap(({ problems }) => problems);
for (const problem of problems) console.log(`FAIL  ${problem}`);

const ok =
  gates.every(({ exitCode }) => exitCode === 0) && problems.length === 0;
const report = {
  ok,
  commit,
  dirty,
  startedAt,
  verdict,
  tools,
  gates,
  laws,
  mutants,
};
writeFileSync(join(evidence, "report.json"), JSON.stringify(report, null, 2));

const cell = (text: string) =>
  text.replaceAll("|", "\\|").replaceAll("\n", " ");
const fence = (text: string) =>
  `\`\`\`\n${text.replaceAll("```", "'''")}\n\`\`\``;
const killed = mutants.filter(({ outcome }) => outcome === "killed");

const markdown = [
  `# Verification evidence, ${startedAt}`,
  "",
  `**${ok ? "Every gate passed." : "Some gates failed."}** Commit \`${commit}\`${dirty ? ", with uncommitted changes" : ", clean tree"}. Proofs ${verdict ? "rechecked with the Lean-proven kernel (`--verdict`)" : "checked by Bend's own checker only"}.`,
  "",
  "## Tools",
  "",
  "| Tool | Version |",
  "| --- | --- |",
  ...Object.entries(tools).map(([tool, version]) => `| ${tool} | ${version} |`),
  "",
  "## Gates",
  "",
  "| Gate | Command | Exit | Seconds |",
  "| --- | --- | --- | --- |",
  ...gates.map(
    (gate) =>
      `| ${gate.name} | \`${gate.command}\` | ${gate.exitCode} | ${gate.seconds.toFixed(1)} |`,
  ),
  "",
  "## Laws",
  "",
  "| Law | Sentence | Held by | Types | Property | Replay | Contract | ClickHouse | Slow | Proof | Agreement | Mutants killed |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ...laws.map(
    (law) =>
      `| ${[
        law.id,
        cell(law.sentence),
        law.heldBy.join(", "),
        ...tiers.map((tier) => law.ran[tier] ?? "—"),
        law.mutantsKilled,
      ].join(" | ")} |`,
  ),
  ...(problems.length > 0
    ? ["", ...problems.map((problem) => `- ${problem}`)]
    : []),
  "",
  "## Mutants",
  "",
  `${killed.length} of ${mutants.length} killed. A mutant without a law breaks a rule of the spec that no law states; the test it names is the one expected to notice.`,
  "",
  "| Mutant | Law | Outcome | Named test |",
  "| --- | --- | --- | --- |",
  ...mutants.map(
    (mutant) =>
      `| ${cell(mutant.name)} | ${mutant.law} | ${mutant.outcome} | ${cell(mutant.killedBy)} |`,
  ),
  "",
  "### Counterexamples",
  "",
  ...mutants.flatMap((mutant) => [
    `**${mutant.name}** (${mutant.law}), in \`${mutant.file}\`:`,
    "",
    fence(mutant.counterexample),
    "",
  ]),
  "## Gate output",
  "",
  ...gates.flatMap((gate) => [
    `### ${gate.name}`,
    "",
    `\`${gate.command}\` exited ${gate.exitCode} after ${gate.seconds.toFixed(1)}s.`,
    "",
    fence(gate.output),
    "",
  ]),
].join("\n");
writeFileSync(join(evidence, "report.md"), markdown);

const seconds = gates.reduce((total, gate) => total + gate.seconds, 0);
console.log(
  `verify: ${ok ? "every gate passed" : "FAILED"} in ${seconds.toFixed(1)}s; evidence in ${relative(root, evidence)}/report.md`,
);
process.exitCode = ok ? 0 : 1;
