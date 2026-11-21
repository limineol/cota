import { describe, expect, it } from "vitest";
import { runGate } from "./fixture.ts";

const compilerOptions = {
  strict: true,
  noEmit: true,
  module: "ESNext",
  moduleResolution: "bundler",
  allowImportingTsExtensions: true,
  skipLibCheck: true,
  types: [],
};

const project = {
  "package.json": JSON.stringify({ type: "module" }),
  "tsconfig.json": JSON.stringify({ compilerOptions, include: ["src"] }),
  "vitest.config.ts":
    'export default { test: { include: ["src/**/*.test.ts"] } };\n',
  "src/pace.ts": "export const isFull = (used: number) => used === 100;\n",
  "src/pace.test.ts":
    'import { expect, it } from "vitest";\nimport { isFull } from "./pace.ts";\n\nit("is full at 100% used", () => {\n  expect(isFull(100)).toBe(true);\n});\n',
};

const tableOf = (mutant: Record<string, string>) =>
  `export const mutants = [${JSON.stringify({ file: "src/pace.ts", killedBy: "is full at 100% used", ...mutant })}];\n`;

describe("mutants", { timeout: 30_000 }, () => {
  it("fails on a mutant that the test it names does not notice", () => {
    const gate = runGate("mutants.ts", {
      ...project,
      "tooling/mutants.table.ts": tableOf({
        name: "99% used is full too",
        law: "Q2",
        find: "used === 100",
        replace: "used >= 99",
      }),
    });

    expect(gate.exitCode).toBe(1);
    expect(gate.stdout).toContain(
      'SURVIVED Q2  99% used is full too\n        "is full at 100% used" still passes\n',
    );
  });

  it("passes a mutant that any test of the name it gives notices", () => {
    const mutant = {
      file: "src/pace.ts",
      killedBy: "is full at 100% used",
      law: "Q2",
      find: "used === 100",
    };
    const gate = runGate("mutants.ts", {
      ...project,
      "src/under.test.ts":
        'import { expect, it } from "vitest";\nimport { isFull } from "./pace.ts";\n\nit("is full at 100% used", () => {\n  expect(isFull(99)).toBe(false);\n});\n',
      "tooling/mutants.table.ts": `export const mutants = ${JSON.stringify([
        { ...mutant, name: "99% used is full too", replace: "used >= 99" },
        { ...mutant, name: "only 101% used is full", replace: "used === 101" },
      ])};\n`,
    });

    expect(gate.stdout).toContain(
      'killed   Q2  99% used is full too\n        by "is full at 100% used"\n        counterexample: AssertionError: expected true to be false',
    );
    expect(gate.stdout).toContain(
      'killed   Q2  only 101% used is full\n        by "is full at 100% used"\n        counterexample: AssertionError: expected false to be true',
    );
    expect(gate.exitCode).toBe(0);
  });

  it("fails on a mutant that does not type-check, though the test it names fails", () => {
    const gate = runGate("mutants.ts", {
      ...project,
      "tooling/mutants.table.ts": tableOf({
        name: "full is compared with a limit nothing declares",
        find: "used === 100",
        replace: "used === limit",
      }),
    });

    expect(gate.exitCode).toBe(1);
    expect(gate.stdout).toContain(
      "BROKEN   —   full is compared with a limit nothing declares\n        the mutant does not type-check:\n",
    );
    expect(gate.stdout).toContain("Cannot find name 'limit'");
  });

  it("fails on a mutant that type-checks where it is, but not where the test it names uses it", () => {
    const gate = runGate("mutants.ts", {
      ...project,
      "vitest.config.ts":
        'export default { test: { include: ["checks/**/*.test.ts"] } };\n',
      "checks/tsconfig.json": JSON.stringify({
        compilerOptions,
        include: ["."],
      }),
      "src/pace.ts": "export const fullAt = () => 100;\n",
      "checks/pace.test.ts":
        'import { expect, it } from "vitest";\nimport { fullAt } from "../src/pace.ts";\n\nit("is full at 100% used", () => {\n  const percent: number = fullAt();\n  expect(percent).toBe(100);\n});\n',
      "tooling/mutants.table.ts": tableOf({
        name: "full is a string",
        find: "() => 100",
        replace: '() => "100"',
      }),
    });

    expect(gate.exitCode).toBe(1);
    expect(gate.stdout).toContain(
      "BROKEN   —   full is a string\n        the mutant does not type-check:\n",
    );
    expect(gate.stdout).toContain(
      "Type 'string' is not assignable to type 'number'",
    );
  });

  it("judges a mutant of a tooling script by the test that runs it", () => {
    const gate = runGate("mutants.ts", {
      ...project,
      "tsconfig.json": JSON.stringify({
        compilerOptions: { ...compilerOptions, types: ["bun"] },
        include: ["tooling"],
      }),
      "vitest.config.ts":
        'export default { test: { include: ["tooling/**/*.test.ts"] } };\n',
      "tooling/full.ts":
        'console.log(process.argv[2] === "100" ? "full" : "not full");\n',
      "tooling/full.test.ts":
        'import { expect, it } from "vitest";\n\nit("says 100% used is full", () => {\n  const run = Bun.spawnSync([process.execPath, new URL("full.ts", import.meta.url).pathname, "100"]);\n  expect(run.stdout.toString()).toBe("full\\n");\n});\n',
      "tooling/mutants.table.ts": tableOf({
        file: "tooling/full.ts",
        killedBy: "says 100% used is full",
        name: "only 99% used is full",
        find: '=== "100"',
        replace: '=== "99"',
      }),
    });

    expect(gate.exitCode).toBe(0);
    expect(gate.stdout).toContain(
      "killed   —   only 99% used is full\n        by \"says 100% used is full\"\n        counterexample: AssertionError: expected 'not full\\n' to be 'full\\n'",
    );
  });

  it("judges a mutant by a test of the clickhouse tier, under that tier's configuration", () => {
    const { "src/pace.test.ts": _, ...withoutTests } = project;
    const gate = runGate("mutants.ts", {
      ...withoutTests,
      "vitest.config.ts":
        'export default { test: { include: ["src/**/*.test.ts"], exclude: ["**/*.clickhouse.test.ts"] } };\n',
      "vitest.clickhouse.config.ts":
        'export default { test: { include: ["src/**/*.clickhouse.test.ts"] } };\n',
      "src/pace.clickhouse.test.ts":
        'import { expect, it } from "vitest";\nimport { isFull } from "./pace.ts";\n\nit("is full at 100% used, in ClickHouse", () => {\n  expect(isFull(100)).toBe(true);\n});\n',
      "tooling/mutants.table.ts": tableOf({
        name: "full means more than 100% used",
        find: "used === 100",
        replace: "used > 100",
        killedBy: "is full at 100% used, in ClickHouse",
      }),
    });

    expect(gate.stdout).toContain(
      'killed   —   full means more than 100% used\n        by "is full at 100% used, in ClickHouse"\n',
    );
    expect(gate.exitCode).toBe(0);
  });

  it("fails on a mutant whose text is not in its file exactly once", () => {
    const gate = runGate("mutants.ts", {
      ...project,
      "tooling/mutants.table.ts": tableOf({
        name: "full means more than 100% used",
        find: "used === 101",
        replace: "used > 100",
      }),
    });

    expect(gate.exitCode).toBe(1);
    expect(gate.stdout).toContain(
      "STALE    —   full means more than 100% used\n        its text is found 0 times in src/pace.ts, not once\n",
    );
  });
});
