import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Schema } from "effect";
import { afterAll } from "vitest";
import { refusalOf } from "../install/client.ts";
import { agentAnswerer, answererArgs, questionMessage } from "./agent.ts";
import { type Machine, type Ran, Stopped } from "./answerer.ts";
import { allowedTools } from "./tools.ts";

const scratch = mkdtempSync(join(tmpdir(), "cota-memory-agent-test-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const standIn = fileURLToPath(
  new URL("../install/fixtures/claude.ts", import.meta.url),
);

const machineRecording = () => {
  const ran: Array<ReadonlyArray<string>> = [];
  const answered = (command: string, stdin?: string): Ran => ({
    command,
    stdin: stdin ?? null,
    exitCode: 0,
    stdout: '{"hits":[]}',
    stderr: "",
  });
  const machine: Machine = {
    run: async (command, stdin) => {
      ran.push(["sh", "-c", command]);
      return answered(command, stdin);
    },
    cota: async (args, stdin) => {
      ran.push(args);
      return answered(["cota", ...args].join(" "), stdin);
    },
  };
  return { ran, machine };
};

const context = (mcpTools: ReadonlyArray<string> = allowedTools) => ({
  categories: ["System prompt", "MCP tools", "Messages", "Free space"].map(
    (name) => ({ name, tokens: 10 }),
  ),
  mcpTools: mcpTools.map((name) => ({ name, serverName: "memory" })),
  agents: [],
});

let scripts = 0;
const answerWith = async (options: {
  readonly context?: unknown;
  readonly tools?: ReadonlyArray<string>;
  readonly calls?: ReadonlyArray<{ name: string; arguments: unknown }>;
  readonly said?: string;
  readonly turns?: number;
}) => {
  scripts += 1;
  const record = join(scratch, `record-${scripts}.jsonl`);
  const script = join(scratch, `script-${scripts}.json`);
  writeFileSync(record, "");
  writeFileSync(
    script,
    JSON.stringify({
      record,
      context: options.context ?? context(),
      tools: options.tools ?? allowedTools,
      calls: options.calls ?? [],
      said: options.said ?? "FOUND\nmax_attempts = 6, in acme/billing.",
      result: {
        subtype: "success",
        is_error: false,
        total_cost_usd: 0.05,
        num_turns: 2,
      },
    }),
  );
  const { ran, machine } = machineRecording();
  const answerer = agentAnswerer({
    model: "claude-sonnet-5-5",
    turns: options.turns ?? 30,
    budgetUsd: 0.5,
    client: ["bun", standIn, script],
  });
  const outcome = await answerer
    .answer({
      question: "How many attempts?",
      skill: "THE SKILL",
      machine,
      stop: new AbortController().signal,
    })
    .then(
      (text) => text,
      (error: unknown) => error,
    );
  const recorded: ReadonlyArray<{
    readonly kind: string;
    readonly args?: ReadonlyArray<string>;
    readonly content?: string;
    readonly returned?: unknown;
  }> = readFileSync(record, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line));
  return { outcome, ran, recorded, spent: answerer.spent?.() };
};

const someTool = Schema.Union([
  Schema.Literals(allowedTools),
  Schema.Literals([
    "Bash",
    "Read",
    "WebFetch",
    "mcp__world__run",
    "mcp__memory__other",
  ]),
  Schema.String,
]);

describe("the agent answerer", () => {
  it.prop(
    "O7: A question whose client announces any other tool, or lacks the one, is never given to it, and none of its calls is answered.",
    { announced: Arbitrary.schema(Schema.Array(someTool)) },
    ({ announced }) => {
      const exactly =
        announced.length > 0 &&
        announced.every((tool) => tool === allowedTools[0]);
      expect(refusalOf(announced, allowedTools) === null).toBe(exactly);
    },
  );

  it("O7: a client whose context holds another tool is not given the question, and runs nothing", async () => {
    const { outcome, ran, recorded } = await answerWith({
      context: context([...allowedTools, "mcp__other__shell"]),
      calls: [{ name: "cota", arguments: { args: ["memory", "sql"] } }],
    });
    expect(String(outcome)).toContain(
      "the client was not given the question: it announced mcp__other__shell",
    );
    expect(recorded.filter(({ kind }) => kind === "message")).toEqual([]);
    expect(ran).toEqual([]);
  });

  it("O7: a client that announces a built-in tool at its start is stopped, and runs nothing", async () => {
    const { outcome, ran } = await answerWith({
      tools: [...allowedTools, "Bash"],
      calls: [{ name: "cota", arguments: { args: ["memory", "sql"] } }],
    });
    expect(String(outcome)).toContain(
      "the client was stopped at its start: it announced Bash",
    );
    expect(ran).toEqual([]);
  });

  it("is started with no built-in tool, the eval's server alone and nothing of the user's, is given the skill and the question, runs cota through its tool, and answers its last message", async () => {
    const { outcome, ran, recorded, spent } = await answerWith({
      calls: [
        {
          name: "cota",
          arguments: {
            args: ["memory", "get", "/api/search", "q=webhook retry"],
          },
        },
        {
          name: "cota",
          arguments: { args: ["memory", "sql"], stdin: "SELECT 1" },
        },
      ],
    });
    expect(outcome).toBe("FOUND\nmax_attempts = 6, in acme/billing.");
    expect(ran).toEqual([
      ["memory", "get", "/api/search", "q=webhook retry"],
      ["memory", "sql"],
    ]);
    const started = recorded.find(({ kind }) => kind === "started");
    const args = started?.args ?? [];
    expect(args).toEqual(
      expect.arrayContaining([
        "--tools",
        "",
        "--strict-mcp-config",
        "--allowedTools",
        "mcp__memory__cota",
        "--restricted",
      ]),
    );
    expect(args.join(" ")).toContain("--max-budget-usd 0.50");
    expect(recorded.find(({ kind }) => kind === "message")?.content).toBe(
      questionMessage({ question: "How many attempts?", skill: "THE SKILL" }),
    );
    expect(spent).toEqual({ model: "stand-in", costUsd: 0.05, turns: 2 });
  });

  it("is stopped at its turn limit, and the answer is missed for it", async () => {
    const { outcome } = await answerWith({
      turns: 1,
      calls: [
        {
          name: "cota",
          arguments: { args: ["memory", "get", "/api/machine"] },
        },
        {
          name: "cota",
          arguments: { args: ["memory", "get", "/api/machine"] },
        },
      ],
    });
    expect(outcome).toBeInstanceOf(Stopped);
    expect(outcome instanceof Stopped ? outcome.limit : "").toBe("1 turns");
  });

  it("passes the client the flags of the install evals' agent, with its own one tool", () => {
    expect(
      answererArgs({ model: "m", mcpConfig: "{}", budgetUsd: 0.5 }).slice(0, 8),
    ).toEqual([
      "--print",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--model",
      "m",
    ]);
  });
});
