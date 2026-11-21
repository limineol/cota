import { describe, expect, it } from "@effect/vitest";
import * as Conversation from "#shared/03-domain/conversation.ts";
import * as Columns from "./columns.ts";

describe("the columns", () => {
  it("writes a digest as the decimal of its 32 hex digits read big-endian, and reads it back", () => {
    const digests = [
      "c0971472ec3c4e4978e861fcac2fe310",
      "0000000000000000000000000000000f",
    ].map((hex) => Conversation.Digest.make(hex));
    expect(digests.map(Columns.uint128Of)).toEqual([
      "255996226769656573795906641528225784592",
      "15",
    ]);
    expect(digests.map(Columns.uint128Of).map(Columns.digestOf)).toEqual(
      digests,
    );
  });
});
