import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Arm } from "./runs.ts";

type Change =
  | {
      readonly file: string;
      readonly replace: string;
      readonly with: string;
    }
  | { readonly file: string; readonly dropLine: string }
  | { readonly file: string; readonly dropSection: string }
  | { readonly remove: string };

/** What both arms lose: the eval itself, its tasks and its kept patches, which a run must not read, and the install and memory evals beside it. */
const theEval: ReadonlyArray<Change> = [
  { remove: "evals" },
  { remove: "docs/specs/design-evals" },
  { remove: "docs/specs/install-evals" },
  { remove: "docs/specs/memory-evals" },
  { remove: "vitest.evals.config.ts" },
  {
    file: "package.json",
    replace: ',\n    "evals:design": "bun evals/design/harness.ts"',
    with: "",
  },
  {
    file: "package.json",
    replace:
      ',\n    "test:evals": "bun --bun vitest run --config vitest.evals.config.ts"',
    with: "",
  },
  {
    file: "package.json",
    replace: ',\n    "evals:install": "bun evals/install/harness.ts"',
    with: "",
  },
  {
    file: "package.json",
    replace: ',\n    "evals:memory": "bun evals/memory/harness.ts"',
    with: "",
  },
  {
    file: "package.json",
    replace: " && effect-tsgo tsc -p evals",
    with: "",
  },
  {
    file: "tooling/verify.ts",
    replace: `  [\n    "evals",\n    \`bun run test:evals --reporter=default --reporter=json --outputFile.json=\${slowJson}\`,\n  ],\n`,
    with: "",
  },
  {
    file: "docs/verification.md",
    dropSection: "## The slow tier and the evals",
  },
  { file: "AGENTS.md", dropLine: "| `bun run evals:design`" },
  { file: "AGENTS.md", dropLine: "| `bun run evals:install`" },
  { file: "AGENTS.md", dropLine: "| `bun run evals:memory`" },
  { file: "AGENTS.md", dropLine: "| `bun run test:evals`" },
  { file: "AGENTS.md", dropLine: "| `evals`" },
  {
    file: "AGENTS.md",
    dropLine: "| `Dockerfile`, `.dockerignore` or `deploy/`",
  },
  { file: "docs/roadmap.md", dropLine: "**The design evals" },
];

/** What the without arm loses besides: the document, every sentence that points at it, and the checks that read it. */
const theDocument: ReadonlyArray<Change> = [
  { remove: "DESIGN.md" },
  {
    file: "AGENTS.md",
    replace: "| ADR-0020 and `DESIGN.md`. Add a component",
    with: "| ADR-0020. Add a component",
  },
  {
    file: "AGENTS.md",
    replace: "| `apps/web`, `packages/ui`, `DESIGN.md`, or an API definition",
    with: "| `apps/web`, `packages/ui`, or an API definition",
  },
  {
    file: "AGENTS.md",
    replace:
      "(`lint:design`: Oxlint with shadcn's rules, and `designmd lint DESIGN.md`)",
    with: "(`lint:design`: Oxlint with shadcn's rules)",
  },
  {
    file: "package.json",
    replace: " && designmd lint DESIGN.md",
    with: "",
  },
  {
    file: ".oxlintrc.json",
    replace: ',\n      "note": "See DESIGN.md for the design rules."',
    with: "",
  },
  {
    file: "tooling/design.test.ts",
    replace: 'const design = readFileSync(join(root, "DESIGN.md"), "utf8");\n',
    with: "",
  },
  {
    file: "tooling/design.test.ts",
    replace: String.raw`const colorsOfDesign = () => {
  const front = design.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "";
  const colors: unknown = Bun.YAML.parse(front);
  return typeof colors === "object" && colors !== null && "colors" in colors
    ? colors.colors
    : undefined;
};

`,
    with: "",
  },
  {
    file: "tooling/design.test.ts",
    replace: `describe("DESIGN.md", () => {
  it("names exactly the colours of tokens.css, the light theme as they are and the dark one with -dark", () => {
    expect(colorsOfDesign()).toEqual({
      ...colorsOfBlock(":root", ""),
      ...colorsOfBlock(":root\\\\.dark", "-dark"),
    });
  });

  it("pairs no text with a background below WCAG AA contrast", () => {
    const lint = Bun.spawnSync(
      [
        join(root, "node_modules/.bin/designmd"),
        "lint",
        "--format",
        "json",
        "DESIGN.md",
      ],
      { cwd: root },
    );
    const { findings }: { findings: ReadonlyArray<{ message: string }> } =
      JSON.parse(lint.stdout.toString());
    expect(
      findings
        .map(({ message }) => message)
        .filter((message) => message.includes("below WCAG")),
    ).toEqual([]);
  });

`,
    with: `describe("the theme's colours", () => {
`,
  },
  {
    file: "docs/adr/ADR-0020-design-system.md",
    replace: "  - DESIGN.md\n",
    with: "",
  },
  {
    file: "docs/adr/ADR-0020-design-system.md",
    dropLine: "- **`DESIGN.md` is the rules, in two parts.**",
  },
  {
    file: "docs/adr/ADR-0020-design-system.md",
    replace:
      "The test over `DESIGN.md` (`tooling/design.test.ts`) fails a colour the theme does not have, or has differently, and a pair below its contrast.",
    with: "The test over the theme's colours (`tooling/design.test.ts`) fails a pool hue below its contrast or too near its neighbour.",
  },
  {
    file: "docs/adr/ADR-0020-design-system.md",
    dropLine: "- Design evals (whether an agent given `DESIGN.md`",
  },
  {
    file: "docs/roadmap.md",
    replace: "`DESIGN.md` with bad and good pairs; ",
    with: "",
  },
  {
    file: "docs/roadmap.md",
    replace: "each with stories; `DESIGN.md`; `apps/web`",
    with: "each with stories; `apps/web`",
  },
  {
    file: "docs/specs/dashboard/spec.md",
    replace: "(`packages/ui/src/styles/tokens.css`, listed in `DESIGN.md`)",
    with: "(`packages/ui/src/styles/tokens.css`)",
  },
  {
    file: "docs/specs/dashboard/spec.md",
    replace: " (DESIGN.md, `a-list-is-a-table`)",
    with: "",
  },
  {
    file: "docs/specs/dashboard/spec.md",
    replace: " (`a-list-is-a-table`)",
    with: "",
  },
];

export const changesOf = (arm: Arm): ReadonlyArray<Change> =>
  arm === "with" ? theEval : [...theEval, ...theDocument];

const noLonger = (file: string, what: string) =>
  new Error(
    `The arm no longer applies: ${file} does not hold ${JSON.stringify(what.slice(0, 80))} exactly once. Update evals/design/arms.ts.`,
  );

const onlyIndex = (
  file: string,
  what: string,
  indices: ReadonlyArray<number>,
): number => {
  const [index] = indices;
  if (index === undefined || indices.length > 1) throw noLonger(file, what);
  return index;
};

const levelOf = (line: string) => line.match(/^(#+) /)?.[1]?.length;

const changed = (file: string, text: string, change: Change): string => {
  if ("replace" in change) {
    const at = text.indexOf(change.replace);
    if (at === -1 || text.indexOf(change.replace, at + 1) !== -1) {
      throw noLonger(file, change.replace);
    }
    return (
      text.slice(0, at) + change.with + text.slice(at + change.replace.length)
    );
  }
  const lines = text.split("\n");
  const indicesOf = (matches: (line: string) => boolean) =>
    lines.flatMap((line, index) => (matches(line) ? [index] : []));
  if ("dropLine" in change) {
    const at = onlyIndex(
      file,
      change.dropLine,
      indicesOf((line) => line.startsWith(change.dropLine)),
    );
    const blankAround = lines[at - 1] === "" && lines[at + 1] === "";
    return [
      ...lines.slice(0, at),
      ...lines.slice(at + (blankAround ? 2 : 1)),
    ].join("\n");
  }
  if (!("dropSection" in change)) return text;
  const start = onlyIndex(
    file,
    change.dropSection,
    indicesOf((line) => line === change.dropSection),
  );
  const level = levelOf(change.dropSection) ?? 1;
  const after = lines
    .slice(start + 1)
    .findIndex((line) => (levelOf(line) ?? Number.POSITIVE_INFINITY) <= level);
  return [
    ...lines.slice(0, start),
    ...(after === -1 ? [] : lines.slice(start + 1 + after)),
  ].join("\n");
};

/** Turns a checkout of the repository into the arm, in place: the with arm is the repository without the eval, the without arm also without the document. */
export const prepareArm = (dir: string, arm: Arm) => {
  for (const change of changesOf(arm)) {
    if ("remove" in change) {
      const path = join(dir, change.remove);
      if (!existsSync(path)) {
        throw new Error(
          `The arm no longer applies: ${change.remove} is not there. Update evals/design/arms.ts.`,
        );
      }
      rmSync(path, { recursive: true });
      continue;
    }
    const path = join(dir, change.file);
    writeFileSync(
      path,
      changed(change.file, readFileSync(path, "utf8"), change),
    );
  }
};

/** What in a tree would tell a run about the document (in the without arm) or about the eval (in both). */
export const tracesOf = (arm: Arm, ruleIds: ReadonlyArray<string>) => [
  "evals/design",
  "evals:design",
  "test:evals",
  ...(arm === "with"
    ? []
    : ["DESIGN.md", "designmd lint", "Do's and Don'ts", ...ruleIds]),
];

/** Each line of the given text files that holds a trace, as `file:line: trace`. */
export const mentionsIn = (
  files: ReadonlyArray<{ readonly path: string; readonly text: string }>,
  traces: ReadonlyArray<string>,
): ReadonlyArray<string> =>
  files.flatMap(({ path, text }) =>
    text
      .split("\n")
      .flatMap((line, index) =>
        traces
          .filter((trace) => line.includes(trace))
          .map((trace) => `${path}:${index + 1}: ${trace}`),
      ),
  );
