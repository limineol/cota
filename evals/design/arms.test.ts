import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { prepareArm } from "./arms.ts";

describe("the arms", () => {
  it("stops when the repository no longer holds what an arm takes out", () => {
    const dir = mkdtempSync(join(tmpdir(), "cota-design-arm-"));
    try {
      mkdirSync(join(dir, "evals"));
      mkdirSync(join(dir, "docs/specs/design-evals"), { recursive: true });
      mkdirSync(join(dir, "docs/specs/install-evals"), { recursive: true });
      mkdirSync(join(dir, "docs/specs/memory-evals"), { recursive: true });
      writeFileSync(join(dir, "vitest.evals.config.ts"), "");
      writeFileSync(join(dir, "package.json"), "{}\n");
      expect(() => prepareArm(dir, "with")).toThrow(
        'The arm no longer applies: package.json does not hold ",\\n    \\"evals:design\\"',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
