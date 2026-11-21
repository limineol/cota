import { describe, expect, it } from "@effect/vitest";
import { DateTime, Option, Redacted } from "effect";
import { jwt } from "#modules/quota/05-tests/quota-logins.ts";
import * as QuotaLogin from "./quota-login.ts";

const now = DateTime.makeUnsafe("2026-11-13T12:00:00.000Z");

const endOf = (accessToken: string) =>
  DateTime.formatIso(QuotaLogin.chatGptEndsAt(Redacted.make(accessToken), now));

describe("when a ChatGPT access token ends", () => {
  it("ends at the exp of a JWT, and 8 days after now when the token is not a JWT or its payload has no numeric exp", () => {
    expect([
      endOf(jwt(Option.some(1_794_583_200))),
      endOf("not-a-jwt"),
      endOf(jwt(Option.none())),
      endOf(
        `${Buffer.from("{}").toString("base64url")}.${Buffer.from('{"exp":"soon"}').toString("base64url")}.c2ln`,
      ),
    ]).toEqual([
      "2026-11-13T15:20:00.000Z",
      "2026-11-21T12:00:00.000Z",
      "2026-11-21T12:00:00.000Z",
      "2026-11-21T12:00:00.000Z",
    ]);
  });
});
