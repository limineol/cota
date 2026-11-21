import { describe, expect, it } from "@effect/vitest";
import { Option, Result } from "effect";
import * as RouteList from "./route-list.ts";

describe("a list of routes as text", () => {
  it("reads what show prints, a pattern with spaces among them, and prints it back", () => {
    const text = "acme/* work\nmy project personal\n* personal\n";
    const given = RouteList.read(`\n  ${text}\n`);
    expect(given).toEqual(
      Result.succeed({
        routes: [
          { pattern: "acme/*", pool: "work" },
          { pattern: "my project", pool: "personal" },
        ],
        defaultPool: Option.some("personal"),
      }),
    );
    expect(
      RouteList.textOf({
        client: "claude-code",
        routes: Result.getOrThrow(given).routes.map((route, index) => ({
          ...route,
          position: index + 1,
        })),
        defaultPool: Option.some("personal"),
        revision: 3,
      }),
    ).toBe(text);
  });

  it("reads nothing as an empty list with no default pool, and refuses a line without a pool or a second default", () => {
    expect(RouteList.read("")).toEqual(
      Result.succeed({ routes: [], defaultPool: Option.none() }),
    );
    expect(RouteList.read("acme/*\n")).toEqual(
      Result.fail('line 1 is not a pattern and a pool: "acme/*"'),
    );
    expect(RouteList.read("* a\n* b\n")).toEqual(
      Result.fail("line 2 names a second default pool"),
    );
  });
});
