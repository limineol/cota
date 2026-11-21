import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Result, Schema } from "effect";
import * as HubAddress from "./hub-address.ts";

const oneOf = <const Choices extends ReadonlyArray<string>>(choices: Choices) =>
  Arbitrary.schema(Schema.Literals(choices));

const loopbackHosts = ["localhost", "127.0.0.1", "127.8.9.10", "[::1]"];

const written = Arbitrary.all({
  scheme: oneOf(["http", "https", "ftp", "ws"]),
  userInformation: oneOf(["", "", "me@", "me:token@", ":token@"]),
  host: oneOf([
    ...loopbackHosts,
    "cota.internal",
    "10.0.0.2",
    "[fd00::1]",
    "localhost.example",
    "128.0.0.1",
  ]),
  port: oneOf(["", "", ":8080", ":18080", ":80", ":443"]),
  path: oneOf(["", "", "/", "/api", "/pools/x/"]),
  query: oneOf(["", "", "?a=1"]),
  fragment: oneOf(["", "", "#top"]),
  allowPlainHttp: Arbitrary.schema(Schema.Boolean),
});

const defaultPorts: Readonly<Record<string, string>> = {
  http: ":80",
  https: ":443",
};

describe("hub address laws", () => {
  it.effect.prop(
    "J16: An address is kept only when it is `http` or `https` with no user information, path, query or fragment, and an `http` one only when its host is loopback or plain http was allowed; what is kept is its scheme, host and port, and a refusal repeats no user information.",
    { written },
    ({ written: parts }) =>
      Effect.sync(() => {
        const text = `${parts.scheme}://${parts.userInformation}${parts.host}${parts.port}${parts.path}${parts.query}${parts.fragment}`;
        const read = HubAddress.read(text, parts.allowPlainHttp);
        const kept =
          (parts.scheme === "http" || parts.scheme === "https") &&
          parts.userInformation === "" &&
          (parts.path === "" || parts.path === "/") &&
          parts.query === "" &&
          parts.fragment === "" &&
          (parts.scheme === "https" ||
            parts.allowPlainHttp ||
            loopbackHosts.includes(parts.host));
        if (!kept) {
          expect(Result.isFailure(read)).toBe(true);
          if (Result.isFailure(read)) {
            expect(read.failure).not.toContain("token");
            expect(read.failure).not.toContain("me@");
          }
          return;
        }
        const port =
          parts.port === defaultPorts[parts.scheme] ? "" : parts.port;
        expect(read).toEqual(
          Result.succeed(`${parts.scheme}://${parts.host}${port}`),
        );
      }),
    { arbitrary: { runs: 1000 } },
  );

  it("refuses an address written without its scheme", () => {
    expect(Result.isFailure(HubAddress.read("cota.internal:8080", true))).toBe(
      true,
    );
  });

  it("keeps an address's host lowercased and without its default port", () => {
    expect(HubAddress.read("HTTP://Cota.Internal:80/", true)).toEqual(
      Result.succeed("http://cota.internal"),
    );
  });
});
