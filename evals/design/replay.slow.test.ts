import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { judgeRuns, type Made, makeRun, replay } from "./evaluation.ts";
import type { Judged } from "./judge.ts";
import { reportOf } from "./report.ts";
import type { Rule } from "./rubric.ts";
import type { Evaluation, Judgement } from "./runs.ts";
import { workingTree } from "./working-tree.ts";

const slow = 600_000;
const fixtures = fileURLToPath(new URL("fixtures", import.meta.url));

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
  rule("screens-compose", true),
  rule("a-list-is-a-table", false),
  rule("roles-are-words", false),
];

/** A judge that reads the patch as a person would at a glance: a restyled card breaks two rules, a table follows them. */
const scriptedJudge = async (judged: Judged): Promise<Judgement> => {
  const restyled = judged.patch.includes('className="rounded-xl');
  return {
    status: "judged",
    error: null,
    onDiffAlone: judged.shots.length === 0,
    verdicts: [
      {
        rule: "screens-compose",
        verdict: restyled ? "broken" : "followed",
        evidence: "keys.tsx",
      },
      {
        rule: "a-list-is-a-table",
        verdict: restyled ? "broken" : "followed",
        evidence: "keys.tsx",
      },
      { rule: "roles-are-words", verdict: "not-applicable", evidence: "" },
    ],
    seconds: 30,
    costUsd: 0.25,
  };
};

let tree: Awaited<ReturnType<typeof workingTree>>;
let folder: string;

beforeAll(async () => {
  tree = await workingTree();
  folder = mkdtempSync(join(tmpdir(), "cota-design-replay-"));
}, slow);

afterAll(() => {
  tree.remove();
  rmSync(folder, { recursive: true, force: true });
});

describe("the replay runner", () => {
  it(
    "runs the whole path over two kept patches: copies, scores, screenshots, a blind judge and the report",
    async () => {
      const said: Array<string> = [];
      const runOf = (
        arm: "with" | "without",
        patch: string,
        scoreInAFreshCopy: boolean,
      ) =>
        makeRun({
          source: tree.source,
          commit: tree.commit,
          task: "keys",
          arm,
          repetition: 1,
          folder,
          scratch: folder,
          work: replay(join(fixtures, patch), undefined),
          scoreInAFreshCopy,
          say: (line) => said.push(line),
        });
      const made: ReadonlyArray<Made> = [
        await runOf("with", "follows.patch", false),
        await runOf("without", "breaks.patch", true),
      ];
      const [follows, breaks] = made;
      expect(follows?.run.storyFailure).toBeNull();
      expect(follows?.run).toMatchObject({
        id: "keys-with-1",
        status: "done",
        patch: "keys-with-1.patch",
        changedFiles: 2,
        check: true,
        lintFindings: 0,
        story: "passed",
        rendered: true,
        leaks: [],
      });
      expect(follows?.run.checkFailure).toBeNull();
      expect(
        breaks?.run.checkFailure?.tail.split("\n").length,
      ).toBeLessThanOrEqual(60);
      expect(breaks?.run.checkFailure?.firstLine).not.toBe("");
      expect(
        follows?.shots.map(({ width, theme }) => `${width} ${theme}`),
      ).toEqual([
        "1440 light",
        "414 light",
        "1440 dark",
        "414 dark",
        "1440 light",
        "414 light",
        "1440 dark",
        "414 dark",
      ]);
      expect(breaks?.run).toMatchObject({
        id: "keys-without-1",
        status: "done",
        check: false,
        lintFindings: 8,
        story: "passed",
        storyFailure: null,
        rendered: true,
      });
      expect(readFileSync(join(folder, "keys-without-1.patch"), "utf8")).toBe(
        readFileSync(join(fixtures, "breaks.patch"), "utf8"),
      );
      expect(said).toContain(
        "keys-without-1: applying the patch to a fresh copy to score it",
      );
      for (const { shots } of made) {
        for (const shot of shots) expect(existsSync(shot.path)).toBe(true);
      }

      const evaluation: Evaluation = {
        commit: tree.commit,
        date: "2026-11-17",
        runner: "replay",
        client: { name: "replay", version: "—", model: "the kept patches" },
        judge: { name: "scripted", version: "—", model: "—" },
        tasks: ["keys"],
        arms: ["with", "without"],
        repetitions: 1,
        seed: 1,
        minutes: 20,
        runs: made.map(({ run }) => run),
      };
      const judged = await judgeRuns({
        evaluation,
        made,
        judge: scriptedJudge,
        recorded: async () => undefined,
        say: (line) => said.push(line),
      });
      const report = reportOf(judged, rules);
      expect(report).toContain(
        "| with | 1 | done | 0.0 | — | passes | 0 | passed | 0 |",
      );
      expect(report).toContain(
        "| without | 1 | done | 0.0 | — | fails | 8 | passed | 2: screens-compose, a-list-is-a-table |",
      );
      expect(report).toContain(
        "| `a-list-is-a-table` | no | 0 of 1 | 1 of 1 |",
      );
    },
    slow,
  );

  it(
    "records a patch that does not apply as a failed run, kept and never judged",
    async () => {
      const failed = await makeRun({
        source: tree.source,
        commit: tree.commit,
        task: "keys",
        arm: "with",
        repetition: 2,
        folder,
        scratch: folder,
        work: replay(join(fixtures, "missing.patch"), undefined),
        scoreInAFreshCopy: true,
        say: () => undefined,
      });
      expect(failed.run).toMatchObject({
        status: "failed",
        patch: null,
        check: null,
        judgement: null,
      });
      expect(failed.run.error).toContain("The patch did not apply");
    },
    slow,
  );
});
