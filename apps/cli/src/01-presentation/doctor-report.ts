import * as Check from "#03-domain/check.ts";

const column = 19;
const indent = " ".repeat(column);

/** Doctor's report as a person reads it: a check a line, with what a passed one found, and under one that failed or warned, what is wrong and its fix. */
export const textOf = (checks: ReadonlyArray<Check.Check>): string =>
  checks
    .map((check) => {
      const head = `${check.outcome.padEnd(8)} ${check.id}`;
      if (check.outcome === "passed" && check.found !== undefined) {
        return `${`${head} `.padEnd(column)}${check.found.replaceAll("\n", `\n${indent}`)}\n`;
      }
      if (check.outcome !== "failed" && check.outcome !== "warned") {
        return `${head}\n`;
      }
      const problem = check.problem.replaceAll("\n", `\n${indent}`);
      return `${`${head} `.padEnd(column)}${problem}\n${indent}fix: ${check.fix}\n`;
    })
    .join("");

/** Doctor's report as `--json` prints it: `{ ok, checks: [{ id, outcome, problem, fix }] }`, and `found` for a passed check that says what it found. */
export const jsonOf = (checks: ReadonlyArray<Check.Check>): string =>
  `${JSON.stringify(
    {
      ok: Check.isOk(checks),
      checks: checks.map((check) => ({
        id: check.id,
        outcome: check.outcome,
        problem:
          check.outcome === "failed" || check.outcome === "warned"
            ? check.problem
            : null,
        fix:
          check.outcome === "failed" || check.outcome === "warned"
            ? check.fix
            : null,
        ...(check.outcome === "passed" && check.found !== undefined
          ? { found: check.found }
          : {}),
      })),
    },
    null,
    2,
  )}\n`;
