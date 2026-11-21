import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Schema } from "effect";
import * as UserPath from "./user-path.ts";

const shims = "C:\\Users\\me\\AppData\\Local\\cota\\bin";

/** An entry of the user's `Path`: the owner's, empty, or the shims' directory as written in another case or with a trailing separator. */
const Entry = Schema.Literals([
  "C:\\Program Files\\nodejs",
  "%USERPROFILE%\\.local\\bin",
  "",
  "C:\\Users\\me\\AppData\\Local\\cota\\binaries",
  "the shims",
  "the shims in capitals",
  "the shims with a separator",
]);

const entryOf = (drawn: typeof Entry.Type) => {
  switch (drawn) {
    case "the shims":
      return shims;
    case "the shims in capitals":
      return shims.toUpperCase();
    case "the shims with a separator":
      return `${shims}\\`;
    default:
      return drawn;
  }
};

const isShims = (drawn: typeof Entry.Type) => drawn.startsWith("the shims");

describe("user Path laws", () => {
  it.effect.prop(
    "J18: After `cota shims` on Windows, the user's `Path` holds the shims' directory exactly once, as its first entry, and every other entry as it was, in order.",
    { entries: Arbitrary.schema(Schema.Array(Entry)) },
    ({ entries }) =>
      Effect.sync(() => {
        const path = entries.map(entryOf).join(";");
        const after = UserPath.withShimsFirst(path, shims);
        const others = entries.filter((entry) => !isShims(entry)).map(entryOf);
        expect(after.split(";")).toEqual(
          path === "" ? [shims] : [shims, ...others],
        );
        expect(UserPath.startsWithShims(after, shims)).toBe(true);
        expect(UserPath.withShimsFirst(after, shims)).toBe(after);
        expect(UserPath.withoutShims(after, shims)).toBe(others.join(";"));
      }),
    { arbitrary: { runs: 1000 } },
  );
});
