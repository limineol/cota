import { Result } from "effect";
import type { KeptScope, Scope } from "./machine.ts";

/** What the hub answered about one hub key a join was given. */
export type KeyAnswer =
  | { readonly _tag: "Known"; readonly scope: Scope }
  | { readonly _tag: "Unknown" }
  | { readonly _tag: "Failed" };

/** A key a join keeps: its place in the order given, from 0, and the scope it is kept under. */
export interface KeptKey {
  readonly place: number;
  readonly scope: KeptScope;
}

/**
 * The keys a join keeps, or every problem that stops it: a key the hub does
 * not know or could not say anything about, a reader key, or two keys of one
 * scope. A problem names a key by its place, from 1, never by its value.
 */
export const keysToKeep = (
  answers: ReadonlyArray<KeyAnswer>,
): Result.Result<ReadonlyArray<KeptKey>, ReadonlyArray<string>> => {
  const problems: Array<string> = [];
  const kept: Array<KeptKey> = [];
  answers.forEach((answer, place) => {
    const key = `key ${place + 1}`;
    if (answer._tag === "Unknown") {
      problems.push(`the hub does not know ${key}`);
      return;
    }
    if (answer._tag === "Failed") {
      problems.push(`the hub could not say what ${key} is`);
      return;
    }
    if (answer.scope === "reader") {
      problems.push(`${key} is a reader key, which opens no pool`);
      return;
    }
    const scope = answer.scope;
    const first = kept.find((each) => each.scope === scope);
    if (first !== undefined) {
      problems.push(
        `keys ${first.place + 1} and ${place + 1} are both ${scope} keys, and a machine keeps one of each`,
      );
      return;
    }
    kept.push({ place, scope });
  });
  return problems.length === 0 ? Result.succeed(kept) : Result.fail(problems);
};
