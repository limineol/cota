import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Schema } from "effect";
import { newPasswordOf } from "./new-password.ts";

/** Characters of one, two and four bytes of UTF-16 alike: the hub counts each as one. */
const characters = ["a", "Z", " ", "é", "ß", "中", "😀", "𝄞", "👩‍", "́"];

const character = Arbitrary.schema(
  Schema.Int.check(
    Schema.isBetween({ minimum: 0, maximum: characters.length - 1 }),
  ),
).pipe(Arbitrary.map((index) => characters[index] as string));

const lengths = [0, 1, 11, 12, 13, 600, 1023, 1024, 1025, 1100];

const password = Arbitrary.all({
  length: Arbitrary.schema(
    Schema.Int.check(
      Schema.isBetween({ minimum: 0, maximum: lengths.length - 1 }),
    ),
  ).pipe(Arbitrary.map((index) => lengths[index] as number)),
  seed: Arbitrary.array(character, { minLength: 1, maxLength: 8 }),
}).pipe(
  Arbitrary.map(({ length, seed }) =>
    Array.from({ length }, (_, at) => seed[at % seed.length] as string),
  ),
);

describe("a new owner password", () => {
  it.prop(
    "V42: a new owner password is counted as the hub counts it, by code points, and fits exactly when it has 12 to 1,024 of them",
    { password },
    ({ password }) => {
      const codePoints = password.flatMap((each) => [...each]).length;
      expect(newPasswordOf(password.join(""))).toEqual({
        length: codePoints,
        fits: codePoints >= 12 && codePoints <= 1024,
      });
    },
  );
});
