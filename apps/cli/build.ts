import { join } from "node:path";
import { parseArgs } from "node:util";

/** The systems `cota` is built for (ADR-0022), as Bun names its compile targets. */
const targets = [
  "bun-darwin-arm64",
  "bun-darwin-x64",
  "bun-linux-x64",
  "bun-linux-arm64",
  "bun-windows-x64",
] as const;
type Target = (typeof targets)[number];

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: { all: { type: "boolean", default: false } },
});

const entry = join(import.meta.dir, "src", "main.ts");
const dist = join(import.meta.dir, "dist");

const fileOf = (target: Target) =>
  target.startsWith("bun-windows-") ? "cota.exe" : "cota";

const thisSystem = targets.find(
  (target) =>
    target ===
    `bun-${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`,
);

const build = (target: Target, outfile: string) => {
  const run = Bun.spawnSync(
    [
      process.execPath,
      "build",
      "--compile",
      `--target=${target}`,
      entry,
      "--outfile",
      outfile,
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  if (run.exitCode !== 0) {
    console.error(`cli:build: ${target} did not build`);
    process.exit(1);
  }
  console.log(`cli:build: ${target} → ${outfile}`);
};

if (values.all) {
  for (const target of targets) {
    build(target, join(dist, target, fileOf(target)));
  }
} else if (thisSystem === undefined) {
  console.error(
    `cli:build: cota is not built for ${process.platform} on ${process.arch}; --all builds ${targets.join(", ")}`,
  );
  process.exit(1);
} else {
  build(thisSystem, join(dist, fileOf(thisSystem)));
}
