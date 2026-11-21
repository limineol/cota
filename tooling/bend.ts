import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createZstdDecompress } from "node:zlib";

const platforms = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
] as const;

type Platform = (typeof platforms)[number];

type Env = Record<string, string | undefined>;

interface Pinned {
  readonly name: string;
  readonly sha256: string;
}

interface Bend {
  readonly bin: string;
  readonly home: string;
}

interface Run {
  readonly ok: boolean;
  readonly output: string;
}

class ToolError extends Error {}

export const bendVersion = "2.0.40";
export const leanVersion = "4.34.0";

const bendArchives: Record<Platform, Pinned> = {
  "darwin-arm64": {
    name: "bend-2.0.40-darwin-arm64.tar.gz",
    sha256: "b2be003b041eb6cfc65326be18f79eb2e0bae2189be79a18c507e661b4b6900b",
  },
  "darwin-x64": {
    name: "bend-2.0.40-darwin-x64.tar.gz",
    sha256: "9229c8bdd0a93f63fa45cc5af5e9e56389ebb620d655920915daf966c6ca561c",
  },
  "linux-arm64": {
    name: "bend-2.0.40-linux-arm64.tar.gz",
    sha256: "2f42a6fa34ecdaa71ae105e5fa734f9a07e129d333e45448ab6d2ff03a837570",
  },
  "linux-x64": {
    name: "bend-2.0.40-linux-x64.tar.gz",
    sha256: "c9ff8d67bd903fb6ad9a26b43d8a62c01021de82a44d55ce4a3dcd4732113d6b",
  },
};

const leanArchives: Record<Platform, Pinned> = {
  "darwin-arm64": {
    name: "lean-4.34.0-darwin_aarch64.tar.zst",
    sha256: "69f263fa6e21bbc2466bbfb1affcd92479ee2714c883a07de548e099a5922932",
  },
  "darwin-x64": {
    name: "lean-4.34.0-darwin.tar.zst",
    sha256: "e90afe84c0a2aa3583f3ecd08e51fb7eeebb84d36f99b7cac5d3c067fa8640b0",
  },
  "linux-arm64": {
    name: "lean-4.34.0-linux_aarch64.tar.zst",
    sha256: "40b04fdb7fb849d3c80e10c3bbeebc7b7354b6d3f07450b9168c2149b40d2a82",
  },
  "linux-x64": {
    name: "lean-4.34.0-linux.tar.zst",
    sha256: "caaa98356098c85dc0fcbbd28e1ec66f39eb6551829972b752ff20e1286b646b",
  },
};

const root = path.resolve(import.meta.dir, "..");
const proofs = path.join(root, "proofs");
const tools = path.join(root, ".tools");
const bendDir = path.join(tools, `bend-${bendVersion}`);
const leanDir = path.join(tools, `lean-${leanVersion}`);
const kernelsDir = path.join(tools, "bendtt");
const homeDir = path.join(tools, "home");
const tmpDir = path.join(tools, "tmp");

const relative = (file: string): string => path.relative(root, file);

const say = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

const currentPlatform = (): Platform => {
  const key = `${process.platform}-${process.arch}`;
  const platform = platforms.find((pinned) => pinned === key);
  if (platform === undefined) {
    throw new ToolError(
      `no pinned Bend or Lean for ${key}; pinned: ${platforms.join(", ")}`,
    );
  }
  return platform;
};

// Bend and Lean write under $HOME and $TMPDIR; pointing both into .tools keeps every write inside the repository.
const toolEnv = (extra: Env = {}): Env => {
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(tmpDir, { recursive: true });
  return {
    ...process.env,
    HOME: homeDir,
    TMPDIR: tmpDir,
    BEND_NO_TELEMETRY: "1",
    ...extra,
  };
};

const run = (
  command: string,
  args: readonly string[],
  cwd: string,
  env: Env,
): Run => {
  const result = Bun.spawnSync([command, ...args], {
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const output =
    `${result.stdout.toString()}${result.stderr.toString()}`.trim();
  return { ok: result.exitCode === 0, output };
};

const runOrThrow = (
  command: string,
  args: readonly string[],
  cwd: string,
  env: Env,
): string => {
  const result = run(command, args, cwd, env);
  if (!result.ok) {
    throw new ToolError(
      `${path.basename(command)} ${args.join(" ")} failed:\n${result.output}`,
    );
  }
  return result.output;
};

const download = async (
  url: string,
  pinned: Pinned,
  into: string,
): Promise<string> => {
  say(`downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok || response.body === null) {
    throw new ToolError(`download failed (${response.status}): ${url}`);
  }
  const file = path.join(into, pinned.name);
  const hash = createHash("sha256");
  const writer = Bun.file(file).writer();
  for await (const chunk of response.body) {
    hash.update(chunk);
    writer.write(chunk);
  }
  await writer.end();
  const actual = hash.digest("hex");
  if (actual !== pinned.sha256) {
    throw new ToolError(
      `${pinned.name} has sha256 ${actual}, not the pinned ${pinned.sha256}; nothing installed`,
    );
  }
  return file;
};

const installInto = async (
  target: string,
  fill: (staging: string) => Promise<void>,
): Promise<void> => {
  mkdirSync(path.dirname(target), { recursive: true });
  const staging = mkdtempSync(`${target}.staging-`);
  try {
    await fill(staging);
    renameSync(staging, target);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
};

const extractTarZst = async (archive: string, into: string): Promise<void> => {
  const tar = Bun.spawn(["tar", "-x", "-f", "-", "-C", into], {
    stdin: "pipe",
    stderr: "pipe",
  });
  const sink = new WritableStream<Uint8Array>({
    write: (chunk) => {
      tar.stdin.write(chunk);
    },
    close: async () => {
      await tar.stdin.end();
    },
  });
  await pipeline(createReadStream(archive), createZstdDecompress(), sink);
  if ((await tar.exited) !== 0) {
    throw new ToolError(
      `tar could not extract ${path.basename(archive)}: ${await new Response(tar.stderr).text()}`,
    );
  }
};

const installBend = async (): Promise<Bend> => {
  const bend = {
    bin: path.join(bendDir, "bend", "bin", "bend"),
    home: path.join(bendDir, "bend"),
  };
  if (existsSync(bend.bin)) {
    return bend;
  }
  const pinned = bendArchives[currentPlatform()];
  await installInto(bendDir, async (staging) => {
    const url = `https://github.com/bendlang/bend/releases/download/v${bendVersion}/${pinned.name}`;
    const archive = await download(url, pinned, staging);
    runOrThrow(
      "tar",
      ["-x", "-z", "-f", archive, "-C", staging],
      staging,
      toolEnv(),
    );
    rmSync(archive);
  });
  return bend;
};

const onlyDirectory = (parent: string): string => {
  const [only, ...others] = readdirSync(parent, { withFileTypes: true }).filter(
    (entry) => entry.isDirectory(),
  );
  if (only === undefined || others.length > 0) {
    throw new ToolError(
      `expected one toolchain directory in ${relative(parent)}`,
    );
  }
  return path.join(parent, only.name);
};

const installLean = async (): Promise<string> => {
  if (!existsSync(leanDir)) {
    const pinned = leanArchives[currentPlatform()];
    await installInto(leanDir, async (staging) => {
      const url = `https://github.com/leanprover/lean4/releases/download/v${leanVersion}/${pinned.name}`;
      const archive = await download(url, pinned, staging);
      await extractTarZst(archive, staging);
      rmSync(archive);
    });
  }
  return path.join(onlyDirectory(leanDir), "bin");
};

const kernelHash = (source: string): string => {
  const text = readFileSync(source, "utf8");
  return createHash("sha256")
    .update(leanVersion)
    .update("\0")
    .update(text)
    .digest("hex")
    .slice(0, 16);
};

// Bend builds its kernel under ~/.bend unless $BENDTT names one, so it is built here the way bend2/safe.ts builds it.
const installKernel = async (bend: Bend): Promise<string> => {
  const source = path.join(bend.home, "bend2", "bendtt.lean");
  const target = path.join(kernelsDir, kernelHash(source));
  const kernel = path.join(target, "bendtt");
  if (existsSync(kernel)) {
    return kernel;
  }
  const lean = await installLean();
  const env = toolEnv();
  const version = runOrThrow(
    path.join(lean, "lean"),
    ["--version"],
    tools,
    env,
  );
  if (!version.includes(`version ${leanVersion},`)) {
    throw new ToolError(`expected Lean ${leanVersion}, found: ${version}`);
  }
  say(`building the BendTT kernel with Lean ${leanVersion}`);
  await installInto(target, async (staging) => {
    await Bun.write(path.join(staging, "bendtt.lean"), Bun.file(source));
    runOrThrow(
      path.join(lean, "lean"),
      ["-c", "bendtt.c", "bendtt.lean"],
      staging,
      env,
    );
    runOrThrow(
      path.join(lean, "leanc"),
      ["-O3", "-DNDEBUG", "bendtt.c", "-o", "bendtt"],
      staging,
      env,
    );
  });
  rmSync(leanDir, { recursive: true, force: true });
  return kernel;
};

const proofDirectories = (file: string): string[] =>
  readdirSync(proofs, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && existsSync(path.join(proofs, entry.name, file)),
    )
    .map((entry) => path.join(proofs, entry.name))
    .sort();

type Outcome = "ok" | "FAIL" | "ERROR";

const outcomeOf = (result: Run): Outcome => {
  if (result.ok && result.output.startsWith("ALL PROOFS CHECK")) {
    return "ok";
  }
  return result.output.startsWith("SOME PROOFS FAIL") ? "FAIL" : "ERROR";
};

const report = (outcome: Outcome, file: string, why: string): void => {
  console.log(`${outcome.padEnd(6)}${relative(file)}`);
  if (outcome !== "ok") {
    console.log(why.replace(/^/gm, "      "));
  }
};

const exitCode = (outcomes: readonly Outcome[]): number => {
  if (outcomes.includes("ERROR")) {
    return 2;
  }
  return outcomes.includes("FAIL") ? 1 : 0;
};

const check = async (verdict: boolean): Promise<number> => {
  const bend = await installBend();
  const kernel = verdict ? { BENDTT: await installKernel(bend) } : {};
  const env = toolEnv({ BEND_HOME: bend.home, ...kernel });
  const mode = verdict ? "--verdict" : "--check-only";
  const outcomes = proofDirectories("PROOF.bend").map((directory) => {
    const result = run(bend.bin, ["PROOF.bend", mode], directory, env);
    const outcome = outcomeOf(result);
    report(outcome, path.join(directory, "PROOF.bend"), result.output);
    return outcome;
  });
  return exitCode(outcomes);
};

const sameBytes = (left: string, right: string): boolean =>
  existsSync(right) && readFileSync(left).equals(readFileSync(right));

const compileModel = (
  bend: Bend,
  directory: string,
  out: string,
  env: Env,
): Outcome => {
  const committed = path.join(directory, "model.mjs");
  const result = run(bend.bin, ["model.bend", "-o", out], directory, env);
  if (!result.ok) {
    const outcome = outcomeOf(result);
    report(outcome, committed, result.output);
    return outcome;
  }
  if (!sameBytes(out, committed)) {
    report(
      "FAIL",
      committed,
      `missing, or not what bend ${bendVersion} compiles from model.bend`,
    );
    return "FAIL";
  }
  report("ok", committed, "");
  return "ok";
};

const models = async (checkOnly: boolean): Promise<number> => {
  const bend = await installBend();
  const env = toolEnv({ BEND_HOME: bend.home });
  const scratch = mkdtempSync(path.join(tmpDir, "models-"));
  try {
    const outcomes = proofDirectories("model.bend").map((directory) => {
      const out = checkOnly
        ? path.join(scratch, `${path.basename(directory)}.mjs`)
        : path.join(directory, "model.mjs");
      return compileModel(bend, directory, out, env);
    });
    return exitCode(outcomes);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};

const usage = `usage:
  bun tooling/bend.ts check [--verdict]   check every proofs/*/PROOF.bend; --verdict rechecks with the Lean-proven kernel
  bun tooling/bend.ts models [--check]    compile every proofs/*/model.bend to model.mjs; --check writes nothing and fails on drift`;

const main = async (args: readonly string[]): Promise<number> => {
  const [command, ...flags] = args;
  if (command === "check" && flags.every((flag) => flag === "--verdict")) {
    return check(flags.includes("--verdict"));
  }
  if (command === "models" && flags.every((flag) => flag === "--check")) {
    return models(flags.includes("--check"));
  }
  say(usage);
  return 2;
};

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    say(
      error instanceof ToolError
        ? `bend.ts: ${error.message}`
        : String(error instanceof Error ? error.stack : error),
    );
    process.exitCode = 2;
  }
}
