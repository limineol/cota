import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Schema } from "effect";
import { setupCodeOf } from "./setup-code.ts";

/** Crockford's base32, as the hub's setup codes are written. */
const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** What an owner may type for a character of a code: either case, and O for 0 and I or L for 1, as the hub reads them. */
const ways: Record<string, ReadonlyArray<string>> = {
  "0": ["0", "O", "o"],
  "1": ["1", "I", "i", "L", "l"],
};

const index = (maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum })));

const separators = ["", "", "", " ", "-", "  ", " - ", "\t"];

const typedCharacter = Arbitrary.all({
  character: index(alphabet.length - 1),
  way: index(4),
  lower: Arbitrary.schema(Schema.Boolean),
  separator: index(separators.length - 1),
}).pipe(
  Arbitrary.map(({ character, way, lower, separator }) => {
    const sent = alphabet[character] as string;
    const variants = ways[sent] ?? [lower ? sent.toLowerCase() : sent];
    return {
      sent,
      typed: `${variants[way % variants.length]}${separators[separator]}`,
    };
  }),
);

const typing = Arbitrary.all({
  characters: Arbitrary.array(typedCharacter, {
    minLength: 16,
    maxLength: 16,
  }),
  typed: index(16),
}).pipe(Arbitrary.map(({ characters, typed }) => characters.slice(0, typed)));

describe("a setup code as typed", () => {
  it.prop(
    "V41: a setup code typed in any case, with any spaces and hyphens, and O for 0 and I or L for 1, sends its first twelve characters as the hub reads them, is written as those in groups of four joined by hyphens, which reads back the same, and is complete only with twelve",
    { typing },
    ({ typing }) => {
      const code = typing
        .slice(0, 12)
        .map(({ sent }) => sent)
        .join("");
      const groups = [code.slice(0, 4), code.slice(4, 8), code.slice(8, 12)];
      const expected = {
        written: groups.filter((group) => group !== "").join("-"),
        code,
        complete: code.length === 12,
      };
      const read = setupCodeOf(typing.map(({ typed }) => typed).join(""));
      expect(read).toEqual(expected);
      expect(setupCodeOf(read.written)).toEqual(expected);
    },
  );
});
