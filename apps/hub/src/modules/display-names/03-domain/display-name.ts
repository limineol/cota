import { Schema } from "effect";
import { compareText, isCharactersBetween } from "#shared/03-domain/text.ts";

/** A display name's limits, in characters (code points). */
export const limits = { longestKey: 255, longestName: 80 } as const;

export const Kind = Schema.Literals([
  "pool",
  "model",
  "client",
  "machine",
  "project",
]);
export type Kind = typeof Kind.Type;

/** The id as the request log has it. */
export const Key = Schema.String.check(
  isCharactersBetween(1, limits.longestKey),
);

/** A name as the owner gives it: trimmed, then 1 to 80 characters. */
export const Name = Schema.Trim.check(
  isCharactersBetween(1, limits.longestName),
);

export const Source = Schema.Literals(["owner", "built-in"]);
export type Source = typeof Source.Type;

/** The owner's name for one kind and key. */
export interface OwnerName {
  readonly kind: Kind;
  readonly key: string;
  readonly name: string;
}

export interface DisplayName extends OwnerName {
  readonly source: Source;
}

/** The owner has no name for this kind and key. */
export class NoSuchDisplayName extends Schema.TaggedError<
  NoSuchDisplayName,
  { readonly brand: unique symbol }
>()("NoSuchDisplayName", { kind: Kind, key: Schema.String }) {}

/** Whether a name, trimmed, is its key: setting it removes the owner's name instead. */
export const isItsKey = (name: OwnerName): boolean => name.name === name.key;

const sameKey = (one: OwnerName, other: OwnerName): boolean =>
  one.kind === other.kind && one.key === other.key;

const byKindThenKey = (one: DisplayName, other: DisplayName): number =>
  compareText(one.kind, other.kind) || compareText(one.key, other.key);

/**
 * Every owner name, and every built-in name the owner has not replaced, by
 * kind, then key: one name per kind and key (D4).
 */
export const listed = (
  owner: ReadonlyArray<OwnerName>,
  builtIn: ReadonlyArray<DisplayName>,
): ReadonlyArray<DisplayName> =>
  [
    ...owner.map((name): DisplayName => ({ ...name, source: "owner" })),
    ...builtIn.filter((name) => !owner.some((each) => sameKey(each, name))),
  ].sort(byKindThenKey);
