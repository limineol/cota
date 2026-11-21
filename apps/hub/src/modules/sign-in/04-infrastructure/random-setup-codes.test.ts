import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { SetupCodes } from "#modules/sign-in/02-application/interfaces/setup-codes.ts";
import * as SetupCode from "#modules/sign-in/03-domain/setup-code.ts";
import * as RandomSetupCodes from "./random-setup-codes.ts";

describe("random setup codes", () => {
  it.effect(
    "are 12 characters of Crockford's base32 in three groups, a new one each time",
    () =>
      Effect.gen(function* () {
        const codes = yield* SetupCodes;
        const made = [];
        for (let time = 0; time < 50; time++) made.push(yield* codes.make);
        expect([
          made.every(({ written }) =>
            /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/.test(
              written,
            ),
          ),
          new Set(made.map(({ written }) => written)).size,
        ]).toEqual([true, 50]);
      }).pipe(Effect.provide(RandomSetupCodes.layer)),
  );

  it.effect(
    "know a code again in any case, without its hyphens or with spaces, and no other code",
    () =>
      Effect.gen(function* () {
        const codes = yield* SetupCodes;
        const { written, digest } = yield* codes.make;
        const read = (given: string) =>
          codes.matches(digest, SetupCode.normalised(given));
        expect([
          read(written),
          read(written.toLowerCase()),
          read(written.replaceAll("-", "")),
          read(` ${written.replaceAll("-", " ")} `),
          read(written.replaceAll("0", "O").replaceAll("1", "l")),
          read(written.slice(0, -1)),
          read(`${written.slice(0, -1)}${written.endsWith("0") ? "1" : "0"}`),
        ]).toEqual([true, true, true, true, true, false, false]);
      }).pipe(Effect.provide(RandomSetupCodes.layer)),
  );

  it("read O as 0, and I and L as 1, as Crockford's base32 does", () => {
    expect(SetupCode.normalised(" k7qm-2fOx hdiL ")).toBe("K7QM2F0XHD11");
  });
});
