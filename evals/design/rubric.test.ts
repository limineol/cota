import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { root } from "./evaluation.ts";
import { rulesOf } from "./rubric.ts";

const design = readFileSync(join(root, "DESIGN.md"), "utf8");

describe("the rubric", () => {
  it("holds every rule of DESIGN.md, once, with its scope, its text and its Bad and Good pair", () => {
    const rules = rulesOf(design);
    const headings = design
      .slice(design.indexOf("## Do's and Don'ts"))
      .match(/^### `[a-z0-9-]+`$/gm);
    expect(rules.map(({ id }) => `### \`${id}\``)).toEqual(headings);
    for (const rule of rules) {
      expect(rule.scope).not.toBe("");
      expect(rule.text).not.toBe("");
      expect(rule.text).not.toContain("**Scope:**");
      expect(rule.bad).not.toBe("");
      expect(rule.bad).not.toContain("**Good:**");
      expect(rule.good).not.toBe("");
      expect(rule.good).not.toContain("### ");
    }
  });

  it("reads each rule's scope, holder, text and pair as the document writes them, knows the ones the design lint holds, and stops at the next section", () => {
    const document = [
      "# Design",
      "",
      "## Do's and Don'ts",
      "",
      "Each rule has an id.",
      "",
      "### `names-not-ids`",
      "",
      "**Scope:** pools and models. **Held by:** review.",
      "",
      "People see display names.",
      "",
      "**Bad:** `<strong>{pool.id}</strong>`",
      "",
      "**Good:**",
      "",
      "```tsx",
      '<Name kind="pool" value={pool.id} />',
      "```",
      "",
      "### `screens-compose`",
      "",
      "**Scope:** `apps/web`. **Held by:** `bun run lint:design` (`shadcn/no-restyle`).",
      "",
      "A screen composes.",
      "",
      "**Bad:** a card restyled.",
      "",
      "**Good:** the variant.",
      "",
      "## After",
      "",
      "### `not-a-rule`",
    ].join("\n");
    expect(rulesOf(document)).toEqual([
      {
        id: "names-not-ids",
        scope: "pools and models.",
        heldBy: "review.",
        text: "People see display names.",
        bad: "`<strong>{pool.id}</strong>`",
        good: '```tsx\n<Name kind="pool" value={pool.id} />\n```',
        heldByLint: false,
      },
      {
        id: "screens-compose",
        scope: "`apps/web`.",
        heldBy: "`bun run lint:design` (`shadcn/no-restyle`).",
        text: "A screen composes.",
        bad: "a card restyled.",
        good: "the variant.",
        heldByLint: true,
      },
    ]);
  });
});
