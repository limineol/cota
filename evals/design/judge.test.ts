import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Schema } from "effect";
import {
  judgedOf,
  judgePrompt,
  leaksOf,
  shuffled,
  verdictsOf,
} from "./judge.ts";
import type { Rule } from "./rubric.ts";
import { arms, runIdOf } from "./runs.ts";

const rule = (id: string): Rule => ({
  id,
  scope: "screens.",
  heldBy: "review.",
  text: `The rule ${id}.`,
  bad: "`bad`",
  good: "`good`",
  heldByLint: false,
});
const rules = [rule("colour-is-data"), rule("names-not-ids")];

const text = Arbitrary.schema(Schema.String);
const Shot = Schema.Struct({
  story: Schema.String,
  width: Schema.Literals([1440, 414]),
  theme: Schema.Literals(["light", "dark"]),
  path: Schema.String,
});

const made = Arbitrary.all({
  task: Arbitrary.schema(Schema.Literals(["keys", "pool", "price", "machine"])),
  arm: Arbitrary.schema(Schema.Literals(arms)),
  repetition: Arbitrary.schema(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 9 })),
  ),
  taskText: text,
  patch: text,
  shots: Arbitrary.schema(Schema.Array(Shot)),
});

describe("the judge", () => {
  it.prop(
    "is given the same input for two runs that differ only in arm, and never a run's id",
    { made },
    ({ made }) => {
      const other = made.arm === "with" ? "without" : "with";
      const run = {
        ...made,
        id: runIdOf(made.task, made.arm, made.repetition),
        task: made.taskText,
      };
      const twin = {
        ...run,
        arm: other,
        id: runIdOf(made.task, other, made.repetition),
      };
      const input = judgedOf(run);
      expect(Object.keys(input).sort()).toEqual(["patch", "shots", "task"]);
      expect(judgePrompt(rules, input)).toBe(
        judgePrompt(rules, judgedOf(twin)),
      );
      if (!made.taskText.includes(run.id) && !made.patch.includes(run.id)) {
        expect(JSON.stringify(input)).not.toContain(run.id);
      }
    },
  );

  it.prop(
    "judges every run exactly once, whatever the seed",
    {
      ids: Arbitrary.schema(Schema.Array(Schema.String)),
      seed: Arbitrary.schema(Schema.Int),
    },
    ({ ids, seed }) => {
      const order = shuffled(ids, seed);
      expect([...order].sort()).toEqual([...ids].sort());
    },
  );

  it("draws the same order from the same seed, and another from another", () => {
    const runs = Array.from({ length: 16 }, (_, index) => `run-${index}`);
    expect(shuffled(runs, 7)).toEqual(shuffled(runs, 7));
    expect(shuffled(runs, 7)).not.toEqual(shuffled(runs, 8));
    expect(shuffled(runs, 7)).not.toEqual(runs);
  });

  it("reports as leaks the lines a run added that name the document or a rule, and no other", () => {
    const patch = [
      "diff --git a/apps/web/src/screens/keys/keys.tsx b/apps/web/src/screens/keys/keys.tsx",
      "--- /dev/null",
      "+++ b/apps/web/src/screens/keys/keys.tsx",
      "@@ -0,0 +1,4 @@",
      "+// Per DESIGN.md, a list is a table.",
      "+export const keys = 1;",
      "+// names-not-ids: the note, not the id.",
      " unchanged line naming colour-is-data",
      "-// removed line naming DESIGN.md",
    ].join("\n");
    expect(leaksOf(patch, ["colour-is-data", "names-not-ids"])).toEqual([
      "apps/web/src/screens/keys/keys.tsx: // Per DESIGN.md, a list is a table.",
      "apps/web/src/screens/keys/keys.tsx: // names-not-ids: the note, not the id.",
    ]);
  });

  it("gives each rule its verdict in the rubric's order, marks a rule left unanswered, and takes no answer that is not the Schema's", () => {
    expect(
      verdictsOf(rules, {
        verdicts: [
          {
            rule: "names-not-ids",
            verdict: "broken",
            evidence: "keys.tsx:12 shows key.id",
          },
          { rule: "made-up", verdict: "followed", evidence: "" },
        ],
      }),
    ).toEqual([
      {
        rule: "colour-is-data",
        verdict: "unjudged",
        evidence: "The judge did not answer this rule.",
      },
      {
        rule: "names-not-ids",
        verdict: "broken",
        evidence: "keys.tsx:12 shows key.id",
      },
    ]);
    expect(
      verdictsOf(rules, {
        verdicts: [{ rule: "names-not-ids", verdict: "mostly" }],
      }),
    ).toBeUndefined();
    expect(verdictsOf(rules, "followed")).toBeUndefined();
  });
});
