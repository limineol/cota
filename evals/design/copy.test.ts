import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { freshen } from "./copy.ts";

it("gives installed files the present as their times, so the nightly cleaning of the temporary directory leaves them", () => {
  const folder = mkdtempSync(join(tmpdir(), "cota-design-freshen-"));
  try {
    const file = join(folder, ".bun/vitest/dist/cli.js");
    mkdirSync(join(folder, ".bun/vitest/dist"), { recursive: true });
    writeFileSync(file, "");
    const old = new Date(Date.now() - 10 * 24 * 3_600_000);
    utimesSync(file, old, old);
    const before = Date.now() - 1000;
    freshen(folder);
    const { atimeMs, mtimeMs } = statSync(file);
    expect(atimeMs).toBeGreaterThan(before);
    expect(mtimeMs).toBeGreaterThan(before);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
