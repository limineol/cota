import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const runGate = (script: string, files: Record<string, string>) => {
  const root = mkdtempSync(join(tmpdir(), "cota-gate-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  const gate = Bun.spawnSync([
    process.execPath,
    fileURLToPath(new URL(script, import.meta.url)),
    root,
  ]);
  return {
    exitCode: gate.exitCode,
    stdout: gate.stdout.toString(),
    stderr: gate.stderr.toString(),
  };
};
