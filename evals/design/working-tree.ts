import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { git } from "./copy.ts";
import { root } from "./evaluation.ts";

/**
 * The working tree, uncommitted changes included, committed alone in a
 * repository of its own: what the tests make copies of, so that they hold
 * the arms to the tree being changed rather than to its last commit.
 */
export const workingTree = async () => {
  const parent = mkdtempSync(join(tmpdir(), "cota-design-tree-"));
  const source = join(parent, "cota");
  const listed = await git(
    root,
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
  );
  for (const path of listed.split("\0")) {
    if (path === "" || !existsSync(join(root, path))) continue;
    mkdirSync(dirname(join(source, path)), { recursive: true });
    cpSync(join(root, path), join(source, path));
  }
  await git(source, "init", "--quiet");
  await git(source, "add", "--all");
  await git(source, "commit", "--quiet", "--message", "The working tree");
  const commit = (await git(source, "rev-parse", "HEAD")).trim();
  return {
    source,
    commit,
    remove: () => rmSync(parent, { recursive: true, force: true }),
  };
};
