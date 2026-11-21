import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { releaseOf, releasePageOf } from "./release.ts";

const repository = join(import.meta.dirname, "..");

const rootOf = (files: Record<string, string>) => {
  const root = mkdtempSync(join(tmpdir(), "cota-release-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
};

describe("a release", () => {
  it("can be made of the repository as it stands: one version, and its release notes", () => {
    expect(releaseOf(repository).problems).toEqual([]);
  });

  it("is refused a tag of another version, a version stated differently, and a version without notes", () => {
    const root = rootOf({
      "apps/hub/package.json": '{ "version": "0.2.0" }',
      "apps/cli/package.json": '{ "version": "0.1.0" }',
      Dockerfile: "FROM scratch\nARG COTA_VERSION=0.2.0\n",
      "docs/releases/0.1.0.md": "# Cota 0.1.0\n",
    });

    expect(releaseOf(root, "v0.1.0")).toEqual({
      version: "0.2.0",
      problems: [
        "apps/cli/package.json states the version 0.1.0, not 0.2.0 as apps/hub/package.json does",
        "docs/releases/0.2.0.md, the release notes of 0.2.0, does not exist",
        "the tag v0.1.0 is not v0.2.0, the version the repository states",
      ],
    });
  });

  it("has a page of its notes without their front matter and title, then its hub image", () => {
    expect(
      releasePageOf(
        "---\nstatus: active\n---\n\n# Cota 0.1.0\n\nThe first release.\n",
        "ghcr.io/limineol/cota-hub:0.1.0@sha256:0f",
      ),
    ).toBe(
      "The first release.\n\n## The hub image\n\n```text\nghcr.io/limineol/cota-hub:0.1.0@sha256:0f\n```\n",
    );
  });
});
