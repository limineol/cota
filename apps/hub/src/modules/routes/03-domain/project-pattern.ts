import { Option } from "effect";
import { charactersOf } from "#shared/03-domain/text.ts";

/** The longest pattern, and the longest project, in characters (code points). */
export const longest = 200;

/**
 * A project pattern: a project exactly, or the start of one, its stem,
 * followed by `*`; lowercased, as it is stored.
 */
export type ProjectPattern =
  | { readonly _tag: "Exact"; readonly text: string }
  | { readonly _tag: "Prefix"; readonly stem: string };

const controlCharacter = /\p{Cc}/u;

/**
 * The pattern the owner wrote, trimmed and lowercased; none when it is not
 * 1 to 200 characters, holds a control character, or holds a `*` anywhere but
 * at its end or alone.
 */
export const parse = (written: string): Option.Option<ProjectPattern> => {
  const text = written.trim().toLowerCase();
  const length = charactersOf(text);
  if (length < 1 || length > longest || controlCharacter.test(text)) {
    return Option.none();
  }
  const star = text.indexOf("*");
  if (star === -1) return Option.some({ _tag: "Exact", text });
  if (star !== text.length - 1 || text === "*") return Option.none();
  return Option.some({ _tag: "Prefix", stem: text.slice(0, -1) });
};

/** The pattern as it is stored and answered. */
export const textOf = (pattern: ProjectPattern): string =>
  pattern._tag === "Exact" ? pattern.text : `${pattern.stem}*`;

/** Whether a pattern matches a project, which is compared lowercased. */
export const matches = (pattern: ProjectPattern, project: string): boolean => {
  const lowercased = project.toLowerCase();
  return pattern._tag === "Exact"
    ? lowercased === pattern.text
    : lowercased.startsWith(pattern.stem);
};

/**
 * Whether a pattern matches every project another matches, so that a route of
 * the second after one of the first can never be a first match: an exact
 * pattern only itself, a prefix pattern every pattern its stem starts.
 */
export const shadows = (
  earlier: ProjectPattern,
  later: ProjectPattern,
): boolean => {
  if (earlier._tag === "Exact") {
    return later._tag === "Exact" && later.text === earlier.text;
  }
  return (later._tag === "Exact" ? later.text : later.stem).startsWith(
    earlier.stem,
  );
};
