import {
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mentionsIn, prepareArm, tracesOf } from "./arms.ts";
import { rulesOf } from "./rubric.ts";
import type { Arm } from "./runs.ts";

export interface Ran {
  readonly exitCode: number;
  readonly stdout: string;
  readonly output: string;
}

/** Runs a command to its end; `output` is its output and its errors together. */
export const run = async (
  command: ReadonlyArray<string>,
  cwd: string,
  options: { readonly stdin?: string; readonly timeoutMs?: number } = {},
): Promise<Ran> => {
  const child = Bun.spawn([...command], {
    cwd,
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    stdin: options.stdin === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
    ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
  });
  if (options.stdin !== undefined && child.stdin !== undefined) {
    child.stdin.write(options.stdin);
    await child.stdin.end();
  }
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stdout, output: `${stdout}${stderr}` };
};

const ok = async (command: ReadonlyArray<string>, cwd: string) => {
  const ran = await run(command, cwd);
  if (ran.exitCode !== 0) {
    throw new Error(
      `${command.join(" ")} exited ${ran.exitCode} in ${cwd}:\n${ran.output}`,
    );
  }
  return ran.output;
};

export const git = (dir: string, ...args: ReadonlyArray<string>) =>
  ok(
    [
      "git",
      "-c",
      "user.name=Cota evals",
      "-c",
      "user.email=evals@cota.invalid",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "maintenance.auto=false",
      "-c",
      "gc.auto=0",
      ...args,
    ],
    dir,
  );

export interface Copy {
  readonly dir: string;
  readonly base: string;
  readonly ruleIds: ReadonlyArray<string>;
  readonly remove: () => void;
}

const textFilesOf = async (dir: string) =>
  (await git(dir, "ls-files", "-z"))
    .split("\0")
    .filter(
      (path) =>
        path !== "" &&
        path !== "bun.lock" &&
        lstatSync(join(dir, path)).isFile(),
    )
    .map((path) => ({ path, text: readFileSync(join(dir, path), "utf8") }))
    .filter(({ text }) => !text.includes("\0"));

/** The traces of the document or of the eval left in a copy, which must be none. */
export const tracesLeft = async (copy: Copy, arm: Arm) =>
  mentionsIn(await textFilesOf(copy.dir), tracesOf(arm, copy.ruleIds));

/**
 * Gives every installed file the present as its times. Bun clones its cache
 * into `node_modules` with the cache's old times, and macOS removes the files
 * of the temporary directory older than three days every night at 03:35
 * (`dirhelper`), which emptied a copy's dependencies in the middle of a run.
 */
export const freshen = (folder: string) => {
  const now = new Date();
  for (const entry of readdirSync(folder, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (entry.isFile() || entry.isDirectory()) {
      utimesSync(join(entry.parentPath, entry.name), now, now);
    }
  }
};

/**
 * A scratch copy of the repository at a commit, as the arm: cloned, prepared,
 * then committed alone in a new repository, so neither the history nor a
 * remote holds what the arm left out; its dependencies installed, and its
 * check passing before anything else runs in it.
 */
export const copyOf = async (
  source: string,
  commit: string,
  arm: Arm,
): Promise<Copy> => {
  const parent = mkdtempSync(join(tmpdir(), "cota-design-eval-"));
  const dir = join(parent, "cota");
  const remove = () => rmSync(parent, { recursive: true, force: true });
  try {
    await git(
      parent,
      "clone",
      "--quiet",
      "--local",
      "--no-checkout",
      source,
      dir,
    );
    await git(dir, "checkout", "--quiet", "--detach", commit);
    const ruleIds = rulesOf(readFileSync(join(dir, "DESIGN.md"), "utf8")).map(
      ({ id }) => id,
    );
    rmSync(join(dir, ".git"), { recursive: true });
    prepareArm(dir, arm);
    await git(dir, "init", "--quiet", "--initial-branch=main");
    await git(dir, "add", "--all");
    await git(dir, "commit", "--quiet", "--message", "The repository");
    const base = (await git(dir, "rev-parse", "HEAD")).trim();
    const copy = { dir, base, ruleIds, remove };
    const left = await tracesLeft(copy, arm);
    if (left.length > 0) {
      throw new Error(
        `The ${arm} arm still holds traces it must not:\n${left.join("\n")}`,
      );
    }
    await ok(["bun", "install", "--frozen-lockfile"], dir);
    freshen(join(dir, "node_modules"));
    const check = await run(["bun", "run", "check"], dir);
    if (check.exitCode !== 0) {
      throw new Error(
        `The ${arm} arm's check fails before any run:\n${check.output}`,
      );
    }
    return copy;
  } catch (error) {
    remove();
    throw error;
  }
};

export interface Change {
  readonly patch: string;
  readonly files: ReadonlyArray<{
    readonly status: string;
    readonly path: string;
  }>;
}

/** What was done in the copy since it was made, new files included. */
export const changeIn = async (copy: Copy): Promise<Change> => {
  await git(copy.dir, "add", "--all");
  const patch = await git(copy.dir, "diff", "--cached", "--binary", copy.base);
  const files = (
    await git(
      copy.dir,
      "diff",
      "--cached",
      "--name-status",
      "--no-renames",
      copy.base,
    )
  )
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const [status = "", path = ""] = line.split("\t");
      return { status, path };
    });
  return { patch, files };
};

/** Applies a kept patch to a copy, as the replay runner does. */
export const applyPatch = (dir: string, patchFile: string) =>
  git(dir, "apply", "--binary", "--whitespace=nowarn", patchFile);
