import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Schema } from "effect";
import { announcedOfContext, lineOf, refusalOf } from "./client.ts";
import { allowedTools } from "./tools.ts";

const someTool = Schema.Union([
  Schema.Literals(allowedTools),
  Schema.Literals(["Bash", "Read", "WebFetch", "Agent", "mcp__world__other"]),
  Schema.String,
]);

describe("the tools a client announces", () => {
  it.prop(
    "E3: A run whose client announces any tool but the eval's two, or lacks one of them, does not start.",
    { announced: Arbitrary.schema(Schema.Array(someTool)) },
    ({ announced }) => {
      const allowed: ReadonlyArray<string> = allowedTools;
      const exactly =
        announced.every((tool) => allowed.includes(tool)) &&
        allowed.every((tool) => announced.includes(tool));
      expect(refusalOf(announced) === null).toBe(exactly);
    },
  );

  it("names what was announced beyond the two and what was missing", () => {
    expect(refusalOf(["mcp__world__run", "Bash", "Bash"])).toBe(
      "it announced Bash, and it lacked mcp__world__tell_owner",
    );
  });

  it("reads a context's built-in tools, other servers' tools and subagents as announced, and an unknown part of it too", () => {
    expect(
      announcedOfContext({
        categories: [
          { name: "System prompt", tokens: 1471 },
          { name: "System tools", tokens: 1008 },
          { name: "MCP tools", tokens: 249 },
          { name: "Messages", tokens: 10 },
          { name: "Skills", tokens: 30 },
        ],
        mcpTools: [
          { name: "mcp__world__run" },
          { name: "mcp__world__tell_owner" },
        ],
        agents: [{ agentType: "general-purpose" }],
      }),
    ).toEqual([
      "mcp__world__run",
      "mcp__world__tell_owner",
      'the part "System tools" of its context',
      'the part "Skills" of its context',
      "subagent 1",
    ]);
    expect(announcedOfContext({ categories: [] })).toBeNull();
  });

  it("reads only what the harness needs of a client's line, and nothing of a line it does not know", () => {
    expect(
      lineOf(
        JSON.stringify({
          type: "system",
          subtype: "init",
          tools: ["mcp__world__run"],
          model: "claude-sonnet-5-5",
          cwd: "/somewhere",
        }),
      ),
    ).toEqual({
      kind: "init",
      tools: ["mcp__world__run"],
      model: "claude-sonnet-5-5",
    });
    expect(lineOf('{"type":"system","subtype":"init"}')).toEqual({
      kind: "other",
    });
    expect(lineOf("not json")).toEqual({ kind: "other" });
  });
});
