import { Option, Schema } from "effect";
import { type Change, type Copy, type Ran, run } from "./copy.ts";
import type { GateFailure } from "./runs.ts";

export interface Mechanical {
  readonly check: boolean;
  readonly checkFailure: GateFailure | null;
  readonly lintFindings: number | null;
  readonly story: "passed" | "failed" | "none";
  readonly storyFailure: GateFailure | null;
  readonly storyFiles: ReadonlyArray<string>;
}

const keptLines = 60;
const failing = /\berror\b|\bFAIL\b|\bfailed\b|×|✗/i;

/** What a failed gate printed, as much as the report needs to say why: the first line that names a failure, and the last lines. */
export const failureOf = (ran: Ran): GateFailure | null => {
  if (ran.exitCode === 0) return null;
  const lines = ran.output.trimEnd().split("\n");
  return {
    firstLine:
      lines.map((line) => line.trim()).find((line) => failing.test(line)) ??
      `exited ${ran.exitCode}`,
    tail: lines.slice(-keptLines).join("\n"),
  };
};

const linted =
  /^(apps\/web\/src|apps\/web\/\.storybook|packages\/ui\/src)\/.*\.tsx?$/;

const Lint = Schema.Struct({
  diagnostics: Schema.Array(Schema.Struct({ code: Schema.String })),
});
const decodeLint = Schema.decodeUnknownOption(Schema.fromJsonString(Lint));

const kept = (change: Change) =>
  change.files.filter(({ status }) => status !== "D").map(({ path }) => path);

/** How many findings the design lint has in the files the run added or changed, or undefined when it printed nothing it could read. */
export const lintFindingsOf = async (copy: Copy, change: Change) => {
  const files = kept(change).filter((path) => linted.test(path));
  if (files.length === 0) return 0;
  const lint = await run(
    ["node_modules/.bin/oxlint", "--format", "json", ...files],
    copy.dir,
  );
  return Option.getOrUndefined(decodeLint(lint.stdout))?.diagnostics.length;
};

/** The stories the run added to the dashboard, as paths under `apps/web`. */
export const storyFilesOf = (change: Change) =>
  change.files
    .filter(
      ({ status, path }) =>
        status === "A" &&
        path.startsWith("apps/web/src/") &&
        path.endsWith(".stories.tsx"),
    )
    .map(({ path }) => path.slice("apps/web/".length));

/** The arm's own check, the design lint over what the run touched, and its stories through the stories gate. */
export const mechanicalOf = async (
  copy: Copy,
  change: Change,
): Promise<Mechanical> => {
  const check = await run(["bun", "run", "check"], copy.dir);
  const lintFindings = await lintFindingsOf(copy, change);
  const storyFiles = storyFilesOf(change);
  const stories =
    storyFiles.length === 0
      ? undefined
      : await run(
          ["bun", "run", "stories", ...storyFiles],
          `${copy.dir}/apps/web`,
          {
            timeoutMs: 15 * 60_000,
          },
        );
  return {
    check: check.exitCode === 0,
    checkFailure: failureOf(check),
    lintFindings: lintFindings ?? null,
    story:
      stories === undefined
        ? "none"
        : stories.exitCode === 0
          ? "passed"
          : "failed",
    storyFailure: stories === undefined ? null : failureOf(stories),
    storyFiles,
  };
};
