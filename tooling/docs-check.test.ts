import { describe, expect, it } from "vitest";
import { runGate } from "./fixture.ts";

const frontMatter = (fields: Record<string, string>) =>
  `---\n${Object.entries({
    status: "accepted",
    scope: "repository",
    owner: "limineol",
    last_verified: "2026-11-11",
    review_by: "2999-01-01",
    supersedes: "[]",
    code: "[CONTEXT.md]",
    ...fields,
  })
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n")}\n---\n\n# Title\n`;

describe("docs:check", () => {
  it("passes documents whose front matter is complete and current", () => {
    const gate = runGate("docs-check.ts", {
      "CONTEXT.md": frontMatter({ status: "active" }),
      "docs/adr/ADR-0001-hub.md": frontMatter({}),
    });

    expect(gate).toMatchObject({
      exitCode: 0,
      stdout: "docs:check: 2 documents are current\n",
    });
  });

  it("reports missing front matter, a passed review, a missing code path and a target not marked superseded", () => {
    const gate = runGate("docs-check.ts", {
      "CONTEXT.md": frontMatter({ status: "active" }),
      "docs/adr/ADR-0001-hub.md": frontMatter({}),
      "docs/adr/ADR-0002-stale.md": frontMatter({ review_by: "2020-01-01" }),
      "docs/adr/ADR-0003-relay.md": frontMatter({
        supersedes: "[ADR-0001]",
        code: "[apps/hub]",
      }),
      "docs/specs/fallback/spec.md": "# Fallback\n",
    });

    expect(gate.exitCode).toBe(1);
    expect(gate.stderr.split("\n")).toEqual([
      "docs/adr/ADR-0002-stale.md: review_by 2020-01-01 has passed: read it against the code, then move last_verified and review_by (ADR-0005)",
      "docs/adr/ADR-0003-relay.md: supersedes ADR-0001, whose status is not superseded (ADR-0005)",
      "docs/adr/ADR-0003-relay.md: code names apps/hub, which does not exist (ADR-0005)",
      "docs/specs/fallback/spec.md: has no front matter (ADR-0005)",
      "",
    ]);
  });
});
