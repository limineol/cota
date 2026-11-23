import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Schema } from "effect";
import * as Client from "./client.ts";

const name = Arbitrary.schema(
  Schema.Literals([
    "",
    "antigravity",
    "Antigravity",
    "ANTIGRAVITY",
    "claude-code",
    "codex",
    "claude-cli",
    "opencode",
    "pi",
    "curl",
  ]),
);
const version = Arbitrary.schema(Schema.Literals(["", "/1.2.3", "/0.9"]));
const rest = Arbitrary.schema(Schema.Literals(["", " (darwin; arm64)"]));
const userAgent = Arbitrary.all({ name, version, rest }).pipe(
  Arbitrary.map(({ name, version, rest }) => `${name}${version}${rest}`),
);

describe("a forwarded request's client", () => {
  it.effect.prop(
    "R7: a forwarded request's client is never a reported client, whatever its tag and user agent",
    { tag: name, userAgent },
    ({ tag, userAgent }) =>
      Effect.sync(() =>
        expect(
          Schema.is(Client.ReportedClient)(
            Client.of(tag, userAgent).client.toLowerCase(),
          ),
        ).toBe(false),
      ),
    { arbitrary: { runs: 500 } },
  );

  it("passes over a tag naming a reported client for the user agent, and names no client for a user agent naming one", () => {
    expect([
      Client.of("antigravity", "claude-cli/2.1.0 (external, cli)"),
      Client.of("Antigravity", "antigravity/1.4.0"),
      Client.of("", "Antigravity/1.4.0 (darwin)"),
      Client.of("codex", "antigravity/1.4.0"),
    ]).toEqual([
      { client: "claude-code", version: "2.1.0" },
      { client: "unknown", version: "1.4.0" },
      { client: "unknown", version: "1.4.0" },
      { client: "codex", version: "1.4.0" },
    ]);
  });
});
