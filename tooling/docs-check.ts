import { existsSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";

const statuses = ["draft", "active", "accepted", "superseded", "archived"];
const retired = ["superseded", "archived"];

const root = process.argv[2] ?? join(import.meta.dir, "..");
const today = new Date().toISOString().slice(0, 10);

const documents = [
  ...new Glob("docs/**/*.md").scanSync(root),
  "CONTEXT.md",
].sort();
const adrs = [...new Glob("docs/adr/ADR-*.md").scanSync(root)];

const frontMatterOf = async (path: string) => {
  const file = Bun.file(join(root, path));
  if (!(await file.exists())) return undefined;
  const yaml = (await file.text()).match(/^---\n([\s\S]*?)\n---\n/)?.[1];
  const meta: unknown = yaml === undefined ? undefined : Bun.YAML.parse(yaml);
  return typeof meta === "object" && meta !== null
    ? new Map<string, unknown>(Object.entries(meta))
    : undefined;
};

const isDate = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value)) &&
  new Date(value).toISOString().startsWith(value);

const isList = (value: unknown): value is ReadonlyArray<string> =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const problemsOf = async (document: string): Promise<ReadonlyArray<string>> => {
  const meta = await frontMatterOf(document);
  if (meta === undefined) return ["has no front matter"];

  const problems: Array<string> = [];
  const status = meta.get("status");
  if (typeof status !== "string" || !statuses.includes(status)) {
    problems.push(`status must be one of ${statuses.join(", ")}`);
  }
  for (const key of ["scope", "owner"]) {
    const value = meta.get(key);
    if (typeof value !== "string" || value === "")
      problems.push(`${key} is missing`);
  }
  if (!isDate(meta.get("last_verified"))) {
    problems.push("last_verified is not a YYYY-MM-DD date");
  }

  const reviewBy = meta.get("review_by");
  if (!isDate(reviewBy)) {
    problems.push("review_by is not a YYYY-MM-DD date");
  } else if (reviewBy < today && !retired.includes(String(status))) {
    problems.push(
      `review_by ${reviewBy} has passed: read it against the code, then move last_verified and review_by`,
    );
  }

  const supersedes = meta.get("supersedes");
  if (!isList(supersedes)) {
    problems.push("supersedes must be a list of ADR ids");
  } else {
    for (const id of supersedes) {
      const target = adrs.find((path) => path.startsWith(`docs/adr/${id}-`));
      if (target === undefined) {
        problems.push(`supersedes ${id}, which does not exist`);
      } else if (
        (await frontMatterOf(target))?.get("status") !== "superseded"
      ) {
        problems.push(`supersedes ${id}, whose status is not superseded`);
      }
    }
  }

  const code = meta.get("code");
  if (!isList(code)) {
    problems.push("code must be a list of paths");
  } else {
    for (const path of code) {
      if (!existsSync(join(root, path)))
        problems.push(`code names ${path}, which does not exist`);
    }
  }
  return problems;
};

const problems: Array<string> = [];
for (const document of documents) {
  for (const problem of await problemsOf(document)) {
    problems.push(`${document}: ${problem} (ADR-0005)`);
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`docs:check: ${documents.length} documents are current`);
