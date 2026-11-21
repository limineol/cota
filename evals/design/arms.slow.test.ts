import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyOf, git, run, tracesLeft } from "./copy.ts";
import { workingTree } from "./working-tree.ts";

const slow = 240_000;
let tree: Awaited<ReturnType<typeof workingTree>>;

beforeAll(async () => {
  tree = await workingTree();
}, slow);

afterAll(() => tree.remove());

const filesOf = async (dir: string) =>
  (await git(dir, "ls-files", "-z")).split("\0").filter((path) => path !== "");

describe("the arms", () => {
  it(
    "the without arm names neither the document nor a rule, and its check and the theme's colour tests pass before a run",
    async () => {
      const copy = await copyOf(tree.source, tree.commit, "without");
      try {
        expect(existsSync(join(copy.dir, "DESIGN.md"))).toBe(false);
        expect(await tracesLeft(copy, "without")).toEqual([]);
        expect(copy.ruleIds).toContain("colour-is-data");
        const lint = await run(
          ["node_modules/.bin/oxlint", "apps/web/src"],
          copy.dir,
        );
        expect(lint.output).not.toContain("DESIGN.md");
        const colours = await run(
          ["bun", "--bun", "vitest", "run", "tooling/design.test.ts"],
          copy.dir,
        );
        expect(colours.exitCode).toBe(0);
        expect(colours.output).toContain("4 passed");
      } finally {
        copy.remove();
      }
    },
    slow,
  );

  it(
    "the with arm is the repository with only the eval taken out",
    async () => {
      const copy = await copyOf(tree.source, tree.commit, "with");
      try {
        const source = await filesOf(tree.source);
        const kept = await filesOf(copy.dir);
        expect(kept).toEqual(
          source.filter(
            (path) =>
              !path.startsWith("evals/") &&
              !path.startsWith("docs/specs/design-evals/") &&
              !path.startsWith("docs/specs/install-evals/") &&
              !path.startsWith("docs/specs/memory-evals/") &&
              path !== "vitest.evals.config.ts",
          ),
        );
        const edited = kept.filter(
          (path) =>
            lstatSync(join(copy.dir, path)).isFile() &&
            readFileSync(join(copy.dir, path), "utf8") !==
              readFileSync(join(tree.source, path), "utf8"),
        );
        expect(edited).toEqual([
          "AGENTS.md",
          "docs/roadmap.md",
          "docs/verification.md",
          "package.json",
          "tooling/verify.ts",
        ]);
        expect(await tracesLeft(copy, "with")).toEqual([]);
      } finally {
        copy.remove();
      }
    },
    slow,
  );
});
