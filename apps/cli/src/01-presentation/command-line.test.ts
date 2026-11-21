import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Option, Result, Schema } from "effect";
import * as CommandLine from "./command-line.ts";

const parsed = (...argv: ReadonlyArray<string>) =>
  Result.getOrThrow(CommandLine.parse(argv));

const problemOf = (...argv: ReadonlyArray<string>) =>
  Result.isFailure(CommandLine.parse(argv))
    ? Result.merge(CommandLine.parse(argv))
    : "it parsed";

const anyArgument = Arbitrary.schema(
  Schema.Literals([
    "--",
    "-",
    "-abc",
    "--help",
    "--version",
    "--pool",
    "--pool=work",
    "--json",
    "-p",
    "resume",
    "--model=opus",
    "a b",
    "",
    "join",
    "claude",
  ]),
);

describe("the command line", () => {
  it.effect.prop(
    "passes every argument after a client's command to the client untouched, with or without --pool before it",
    {
      args: Arbitrary.array(anyArgument, { maxLength: 8 }),
      client: Arbitrary.schema(
        Schema.Literals(["claude", "codex", "opencode", "pi"]),
      ),
      pool: Arbitrary.schema(
        Schema.Literals(["", "--pool work", "--pool=work"]),
      ),
    },
    ({ args, client, pool }) =>
      Effect.sync(() => {
        const before = pool === "" ? [] : pool.split(" ");
        expect(parsed(...before, client, ...args)).toEqual({
          _tag: "Launch",
          client,
          pool: pool === "" ? Option.none() : Option.some("work"),
          args,
        });
      }),
  );

  it("reads every command of the spec's table", () => {
    expect(parsed("join", "http://127.0.0.1:18080")).toEqual({
      _tag: "Join",
      hub: "http://127.0.0.1:18080",
      machine: Option.none(),
      shims: true,
      allowPlainHttp: false,
    });
    expect(
      parsed(
        "join",
        "--no-shims",
        "http://cota.internal:8080",
        "--machine=studio",
        "--allow-plain-http",
      ),
    ).toEqual({
      _tag: "Join",
      hub: "http://cota.internal:8080",
      machine: Option.some("studio"),
      shims: false,
      allowPlainHttp: true,
    });
    expect(parsed("leave")).toEqual({ _tag: "Leave" });
    expect(parsed("route")).toEqual({
      _tag: "Route",
      client: "claude",
      pool: Option.none(),
    });
    expect(parsed("route", "codex", "--pool", "work")).toEqual({
      _tag: "Route",
      client: "codex",
      pool: Option.some("work"),
    });
    expect(parsed("routes", "show", "claude")).toEqual({
      _tag: "Routes",
      action: "show",
      client: "claude",
    });
    expect(parsed("routes", "set", "codex")).toEqual({
      _tag: "Routes",
      action: "set",
      client: "codex",
    });
    expect(parsed("login", "work")).toEqual({ _tag: "Login", pool: "work" });
    expect(parsed("logout", "work")).toEqual({ _tag: "Logout", pool: "work" });
    expect(parsed("configure")).toEqual({ _tag: "Configure" });
    expect(parsed("shims")).toEqual({ _tag: "Shims", remove: false });
    expect(parsed("shims", "--remove")).toEqual({
      _tag: "Shims",
      remove: true,
    });
    expect(parsed("titles", "report")).toEqual({ _tag: "TitlesReport" });
    expect(parsed("titles", "schedule", "--remove")).toEqual({
      _tag: "TitlesSchedule",
      remove: true,
    });
    expect(parsed("doctor")).toEqual({ _tag: "Doctor", json: false });
    expect(parsed("doctor", "--json")).toEqual({ _tag: "Doctor", json: true });
    expect(parsed("hub-key", "keyed")).toEqual({ _tag: "HubKey" });
    expect(parsed("--version")).toEqual({ _tag: "Version" });
  });

  it("says what is wrong with a command used wrongly", () => {
    expect(problemOf()).toBe("cota needs a command");
    expect(problemOf("jion", "http://hub")).toBe("cota has no command jion");
    expect(problemOf("join")).toBe("cota join needs the hub's address");
    expect(problemOf("join", "a", "b")).toBe(
      "cota join was given b, which it does not take",
    );
    expect(problemOf("join", "a", "--machine")).toBe("--machine needs a value");
    expect(problemOf("join", "a", "--machine", "x", "--machine=y")).toBe(
      "--machine is given twice",
    );
    expect(problemOf("join", "a", "--no-shims=yes")).toBe(
      "--no-shims takes no value",
    );
    expect(problemOf("doctor", "--jsn")).toBe(
      "cota doctor has no option --jsn",
    );
    expect(problemOf("doctor", "-j")).toBe("cota doctor has no option -j");
    expect(problemOf("leave", "--constructor")).toBe(
      "cota leave has no option --constructor",
    );
    expect(problemOf("hub-key")).toBe("cota hub-key takes keyed");
    expect(problemOf("hub-key", "subscription")).toBe(
      "cota hub-key takes keyed",
    );
    expect(problemOf("route", "pi")).toBe(
      "cota route takes claude or codex, not pi",
    );
    expect(problemOf("routes", "show")).toBe(
      "cota routes show needs a client: claude or codex",
    );
    expect(problemOf("titles")).toBe("cota titles needs report or schedule");
    expect(problemOf("--pool", "work")).toBe(
      "--pool is followed by a client: claude, codex, opencode or pi",
    );
    expect(problemOf("--pool")).toBe("--pool needs a value");
    expect(problemOf("--version", "now")).toBe(
      "cota --version takes nothing else",
    );
  });

  it("reads cota memory get's path and parameters, and keeps it under /api/", () => {
    expect(
      parsed(
        "memory",
        "get",
        "/api/search",
        "q=a = b",
        "project=x",
        "project=y",
      ),
    ).toEqual({
      _tag: "MemoryGet",
      path: "/api/search",
      query: [
        ["q", "a = b"],
        ["project", "x"],
        ["project", "y"],
      ],
    });
    expect(problemOf("memory", "get", "/pools/work/models")).toBe(
      "/pools/work/models is not a path of the hub's API: it starts /api/",
    );
    expect(problemOf("memory", "get", "/api/../pools/work/models")).toBe(
      "/api/../pools/work/models holds a . or .. segment",
    );
    expect(problemOf("memory", "get", "/api/%2E%2e/pools")).toBe(
      "/api/%2E%2e/pools holds a . or .. segment",
    );
    expect(problemOf("memory", "get", "/api/search?q=x")).toBe(
      "/api/search?q=x holds a query; give each parameter as <name>=<value>",
    );
    expect(problemOf("memory", "get", "/api/search", "=x")).toBe(
      "=x is not a parameter: write it <name>=<value>",
    );
  });

  it("reads cota memory transcript's target and page, within their limits", () => {
    expect(parsed("memory", "transcript", "s-1")).toEqual({
      _tag: "MemoryTranscript",
      of: { _tag: "Session", session: "s-1" },
      page: { from: 1, entries: 40, cut: 300 },
    });
    expect(
      parsed(
        "memory",
        "transcript",
        "--request",
        "r-1",
        "--from=41",
        "--entries",
        "200",
        "--cut",
        "100000",
      ),
    ).toEqual({
      _tag: "MemoryTranscript",
      of: { _tag: "Request", request: "r-1" },
      page: { from: 41, entries: 200, cut: 100_000 },
    });
    expect(problemOf("memory", "transcript", "s-1", "--entries", "201")).toBe(
      "--entries takes a whole number from 1 to 200",
    );
    expect(problemOf("memory", "transcript", "s-1", "--from", "0")).toBe(
      `--from takes a whole number from 1 to ${Number.MAX_SAFE_INTEGER}`,
    );
    expect(problemOf("memory", "transcript", "s-1", "--request", "r-1")).toBe(
      "cota memory transcript needs a session, or --request <id>, and not both",
    );
    expect(problemOf("memory")).toBe(
      "cota memory needs key, get, sql or transcript",
    );
  });
});
