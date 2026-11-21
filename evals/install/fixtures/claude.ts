import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { Option, Schema } from "effect";

/**
 * A stand-in for the headless Claude Code, for the tests: it speaks as much
 * of its stream as the harness reads, announces what its script says, makes
 * its script's tool calls through the MCP server of `--mcp-config`, and
 * records what it was given in the script's `record` file, one JSON line each.
 */
const Script = Schema.Struct({
  record: Schema.String,
  context: Schema.optionalKey(Schema.Unknown),
  tools: Schema.Array(Schema.String),
  calls: Schema.Array(
    Schema.Struct({ name: Schema.String, arguments: Schema.Unknown }),
  ),
  hang: Schema.optionalKey(Schema.Boolean),
  /** false: the owner's client prints no init line. */
  init: Schema.optionalKey(Schema.Boolean),
  said: Schema.optionalKey(Schema.String),
  result: Schema.Struct({
    subtype: Schema.String,
    is_error: Schema.Boolean,
    total_cost_usd: Schema.Finite,
    num_turns: Schema.Int,
    structured_output: Schema.optionalKey(Schema.Unknown),
  }),
});

const McpConfig = Schema.Struct({
  mcpServers: Schema.Record(
    Schema.String,
    Schema.Struct({
      url: Schema.String,
      headers: Schema.Record(Schema.String, Schema.String),
    }),
  ),
});

const Input = Schema.Struct({
  type: Schema.String,
  request_id: Schema.optionalKey(Schema.String),
  request: Schema.optionalKey(Schema.Struct({ subtype: Schema.String })),
  message: Schema.optionalKey(Schema.Struct({ content: Schema.String })),
});

const ToolsCalled = Schema.Struct({
  result: Schema.Unknown,
});

const [scriptFile = "", ...args] = process.argv.slice(2);
const script = Schema.decodeSync(Schema.fromJsonString(Script))(
  readFileSync(scriptFile, "utf8"),
);
const record = (entry: unknown) =>
  appendFileSync(script.record, `${JSON.stringify(entry)}\n`);
const print = (line: unknown) =>
  process.stdout.write(`${JSON.stringify(line)}\n`);

record({
  kind: "started",
  args,
  cwd: process.cwd(),
  entries: readdirSync("."),
});

const mcpAt = args.indexOf("--mcp-config");
const server =
  mcpAt === -1
    ? undefined
    : Object.values(
        Schema.decodeSync(Schema.fromJsonString(McpConfig))(
          args[mcpAt + 1] ?? "",
        ).mcpServers,
      )[0];
let ids = 0;
const mcp = async (method: string, params: unknown) => {
  if (server === undefined) throw new Error("no MCP server");
  ids += 1;
  const response = await fetch(server.url, {
    method: "POST",
    headers: { ...server.headers, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ids, method, params }),
  });
  return Schema.decodeUnknownSync(ToolsCalled)(await response.json()).result;
};

const result = () =>
  print({
    type: "result",
    ...script.result,
    result: script.said ?? "stand-in done",
  });

const work = async () => {
  print({
    type: "system",
    subtype: "init",
    tools: script.tools,
    model: "stand-in",
  });
  await mcp("initialize", { protocolVersion: "2025-06-18" });
  record({ kind: "listed", tools: await mcp("tools/list", {}) });
  let turn = 0;
  for (const call of script.calls) {
    turn += 1;
    print({
      type: "assistant",
      message: {
        id: `msg-${turn}`,
        content: [
          { type: "text", text: `Turn ${turn}.` },
          {
            type: "tool_use",
            id: `use-${turn}`,
            name: `mcp__world__${call.name}`,
            input: call.arguments,
          },
        ],
      },
    });
    const returned = await mcp("tools/call", call);
    record({ kind: "returned", returned });
    print({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: `use-${turn}`,
            content: JSON.stringify(returned),
          },
        ],
      },
    });
  }
  if (script.hang !== true) result();
};

if (!args.includes("--input-format")) {
  const conversation = await new Response(Bun.stdin.stream()).text();
  record({ kind: "asked", conversation });
  if (script.init !== false)
    print({
      type: "system",
      subtype: "init",
      tools: script.tools,
      model: "stand-in-owner",
    });
  result();
  process.exit(0);
}

const decoder = new TextDecoder();
let buffer = "";
for await (const chunk of Bun.stdin.stream()) {
  buffer += decoder.decode(chunk);
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    const input = Option.getOrUndefined(
      Schema.decodeOption(Schema.fromJsonString(Input))(line),
    );
    if (input === undefined) continue;
    record({
      kind: "input",
      type: input.type,
      subtype: input.request?.subtype ?? null,
    });
    if (
      input.type === "control_request" &&
      input.request?.subtype === "get_context_usage"
    )
      print({
        type: "control_response",
        response: {
          subtype: "success",
          request_id: input.request_id,
          response: script.context,
        },
      });
    if (
      input.type === "control_request" &&
      input.request?.subtype === "interrupt"
    ) {
      print({
        type: "result",
        ...script.result,
        subtype: "error_during_execution",
        is_error: true,
      });
      process.exit(0);
    }
    if (input.type === "user") {
      record({ kind: "message", content: input.message?.content ?? "" });
      void work();
    }
  }
}
await Bun.sleep(100);
process.exit(0);
