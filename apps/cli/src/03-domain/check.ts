import { Schema } from "effect";

/** Doctor's checks that exist, in the order doctor runs them (`docs/specs/cli/spec.md`, Doctor). */
export const CheckId = Schema.Literals([
  "config",
  "hub",
  "hub-keys",
  "files",
  "shims",
  "path",
  "clients",
  "own-pools",
  "logins",
  "kept-routes",
  "configured",
  "titles",
]);
export type CheckId = typeof CheckId.Type;

/**
 * A check's outcome. One that failed, or works worse than it should, cannot
 * be made without what is wrong and the command that fixes it (J14).
 */
export type Outcome =
  | { readonly outcome: "passed"; readonly found?: string }
  | { readonly outcome: "skipped" }
  | {
      readonly outcome: "failed" | "warned";
      readonly problem: string;
      readonly fix: string;
    };

export type Check = { readonly id: CheckId } & Outcome;

export const passed: Outcome = { outcome: "passed" };

/** A check that passed, and what it found that the owner may want to read. */
export const passedFinding = (found: string): Outcome => ({
  outcome: "passed",
  found,
});

/** A check that a check it needs failed, or that does not apply to the system. */
export const skipped: Outcome = { outcome: "skipped" };

export const failed = (problem: string, fix: string): Outcome => ({
  outcome: "failed",
  problem,
  fix,
});

export const warned = (problem: string, fix: string): Outcome => ({
  outcome: "warned",
  problem,
  fix,
});

/** Whether no check failed: a warning is not a failure. */
export const isOk = (checks: ReadonlyArray<Check>): boolean =>
  checks.every(({ outcome }) => outcome !== "failed");
