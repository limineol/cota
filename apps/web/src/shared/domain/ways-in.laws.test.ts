import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Schema } from "effect";
import { doorOf, type PasswordSource, removalsOf } from "./ways-in.ts";

const boolean = Arbitrary.schema(Schema.Boolean);

const sources: ReadonlyArray<PasswordSource> = [
  "configuration",
  "hub-store",
  "none",
];

const source = Arbitrary.schema(
  Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 2 })),
).pipe(Arbitrary.map((index) => sources[index] as PasswordSource));

const passkeys = Arbitrary.schema(
  Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4 })),
);

/** The hub's rule of the last way in (`docs/specs/sign-in/spec.md`): a removal is refused when no password and no passkey would be left. */
const hubAllows = (after: {
  readonly source: PasswordSource;
  readonly passkeys: number;
}) => after.source !== "none" || after.passkeys > 0;

describe("the ways in the dashboard offers", () => {
  it.prop(
    "V39: a hub that is not set up is led to setup; on one that is, the sign-in screen offers the password exactly when the hub takes one and a passkey exactly when the hub keeps one and this browser offers passkeys here, and says where a passkey works exactly when a passkey is the only way in and this browser cannot use one here",
    {
      ways: Arbitrary.all({
        setUp: boolean,
        password: boolean,
        passkey: boolean,
      }),
      here: boolean,
    },
    ({ ways, here }) => {
      const usable = ways.passkey && here;
      expect(doorOf(ways, here)).toEqual(
        ways.setUp
          ? {
              _tag: "Open",
              password: ways.password,
              passkey: usable,
              passkeyElsewhere: !ways.password && ways.passkey && !usable,
            }
          : { _tag: "SetUp" },
      );
    },
  );

  it.prop(
    "V40: Settings offers turning off the password this hub keeps, and removing a passkey, exactly when the hub would allow it, a password or a passkey being left after it; turning off is offered for no other password, and while the kept password is the last way in, it says a passkey is wanted first",
    { source, passkeys },
    ({ source, passkeys }) => {
      const turnOffAllowed = hubAllows({ source: "none", passkeys });
      expect(removalsOf(source, passkeys)).toEqual({
        turnOff:
          source !== "hub-store"
            ? "none"
            : turnOffAllowed
              ? "offered"
              : "wants-a-passkey",
        removePasskey:
          passkeys > 0 && hubAllows({ source, passkeys: passkeys - 1 }),
      });
    },
  );
});
