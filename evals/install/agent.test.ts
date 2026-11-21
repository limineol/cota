import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { agentInstaller } from "./agent.ts";
import { type Machine, type Owner, Stopped, Unfinished } from "./installer.ts";
import { tasks } from "./tasks.ts";
import { serveTools } from "./tools.ts";

const [task] = tasks;
if (task === undefined) throw new Error("no task");

const scratch = mkdtempSync(join(tmpdir(), "cota-install-agent-test-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const standIn = fileURLToPath(new URL("fixtures/claude.ts", import.meta.url));

const machinesRecording = () => {
  const ran: Array<{
    machine: string;
    command: string;
    cwd?: string;
    stdin?: string;
  }> = [];
  const machines: ReadonlyArray<Machine> = ["studio", "laptop"].map((name) => ({
    name,
    home: "/home/owner",
    run: async (command, options = {}) => {
      ran.push({ machine: name, command, ...options });
      return {
        exitCode: command === "false" ? 1 : 0,
        stdout: `ran on ${name}`,
        stderr: "",
      };
    },
  }));
  return { ran, machines };
};

const ownerRecording = (
  answer: (message: string) => Promise<string> = async () => "Yes.",
) => {
  const told: Array<string> = [];
  const owner: Owner = {
    tell: (message) => {
      told.push(message);
      return answer(message);
    },
  };
  return { told, owner };
};

const allowed = ["mcp__world__run", "mcp__world__tell_owner"];
const context = (
  extra: {
    categories?: ReadonlyArray<string>;
    mcpTools?: ReadonlyArray<string>;
  } = {},
) => ({
  categories: [
    "System prompt",
    "MCP tools",
    "Messages",
    "Free space",
    ...(extra.categories ?? []),
  ].map((name) => ({ name, tokens: 10 })),
  mcpTools: (extra.mcpTools ?? allowed).map((name) => ({
    name,
    serverName: "world",
  })),
  agents: [],
});

let scripts = 0;
const installWith = async (options: {
  readonly context?: unknown;
  readonly tools?: ReadonlyArray<string>;
  readonly calls?: ReadonlyArray<{ name: string; arguments: unknown }>;
  readonly hang?: boolean;
  readonly said?: string;
  readonly result?: {
    subtype: string;
    is_error: boolean;
    total_cost_usd: number;
    num_turns: number;
  };
  readonly turns?: number;
  readonly budgetUsd?: number;
  readonly owner?: Owner;
  readonly stopAfterMs?: number;
}) => {
  scripts += 1;
  const record = join(scratch, `record-${scripts}.jsonl`);
  const script = join(scratch, `script-${scripts}.json`);
  writeFileSync(
    script,
    JSON.stringify({
      record,
      context: options.context ?? context(),
      tools: options.tools ?? allowed,
      calls: options.calls ?? [],
      hang: options.hang ?? false,
      said: options.said ?? "INSTALLED\nBoth machines are set up.",
      result: options.result ?? {
        subtype: "success",
        is_error: false,
        total_cost_usd: 0.42,
        num_turns: 3,
      },
    }),
  );
  const { ran, machines } = machinesRecording();
  const { told, owner } = ownerRecording();
  const installer = agentInstaller({
    task,
    model: "claude-sonnet-5-5",
    turns: options.turns ?? 50,
    budgetUsd: options.budgetUsd ?? 1,
    client: ["bun", standIn, script],
  });
  const stop = new AbortController();
  if (options.stopAfterMs !== undefined)
    setTimeout(() => stop.abort(), options.stopAfterMs);
  const outcome = await installer
    .install({
      prompt: "THE INSTALL PROMPT",
      machines,
      owner: options.owner ?? owner,
      stop: stop.signal,
    })
    .then(
      () => null,
      (error: unknown) => error,
    );
  const recorded = existsSync(record)
    ? readFileSync(record, "utf8")
        .trim()
        .split("\n")
        .map((line): { kind: string; [key: string]: unknown } =>
          JSON.parse(line),
        )
    : [];
  return { outcome, ran, told, recorded, installer };
};

interface Reply {
  readonly result: {
    readonly tools?: ReadonlyArray<{ readonly name: string }>;
    readonly content?: ReadonlyArray<{
      readonly type: string;
      readonly text: string;
    }>;
    readonly isError?: boolean;
  };
}
const replyOf = async (response: Response) => (await response.json()) as Reply;

describe("the agent installer's tools", () => {
  const post = (url: string, token: string, body: unknown) =>
    fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

  it("serves run and tell_owner, each backed by a machine of the world and the owner, and nothing else", async () => {
    const { ran, machines } = machinesRecording();
    const { told, owner } = ownerRecording(async () => "I am signed in.");
    const served = serveTools({ machines, owner, isOpen: () => true });
    try {
      const call = async (name: string, args: unknown) =>
        replyOf(
          await post(served.url, served.token, {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name, arguments: args },
          }),
        );
      const listed = await replyOf(
        await post(served.url, served.token, {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
        }),
      );
      expect(listed.result.tools?.map(({ name }) => name)).toEqual([
        "run",
        "tell_owner",
      ]);
      expect(
        await call("run", {
          machine: "laptop",
          command: "cat",
          stdin: "keys\n",
          cwd: "/home/owner/cota",
        }),
      ).toEqual({
        jsonrpc: "2.0",
        id: 1,
        result: {
          content: [
            { type: "text", text: "Exit status 0.\nstdout:\nran on laptop" },
          ],
        },
      });
      expect(ran).toEqual([
        {
          machine: "laptop",
          command: "cat",
          stdin: "keys\n",
          cwd: "/home/owner/cota",
        },
      ]);
      expect(
        (await call("run", { machine: "studio", command: "false" })).result
          .isError,
      ).toBe(true);
      expect(
        await call("tell_owner", {
          message: "Tell me when you are signed in.",
        }),
      ).toEqual({
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text: "I am signed in." }] },
      });
      expect(told).toEqual(["Tell me when you are signed in."]);
      expect(
        (await call("run", { machine: "desktop", command: "ls" })).result,
      ).toEqual({
        content: [
          {
            type: "text",
            text: "There is no machine desktop; the machines are studio, laptop.",
          },
        ],
        isError: true,
      });
      expect((await call("Bash", { command: "ls" })).result.isError).toBe(true);
      expect(ran).toHaveLength(2);
    } finally {
      served.stop();
    }
  });

  it("answers no caller without the server's token, and no call once the run is over", async () => {
    const { ran, machines } = machinesRecording();
    let open = true;
    const served = serveTools({
      machines,
      owner: ownerRecording().owner,
      isOpen: () => open,
    });
    try {
      const call = {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "run",
          arguments: { machine: "studio", command: "ls" },
        },
      };
      expect((await post(served.url, "another-token", call)).status).toBe(401);
      open = false;
      expect(
        (await replyOf(await post(served.url, served.token, call))).result,
      ).toEqual({
        content: [{ type: "text", text: "The run is over." }],
        isError: true,
      });
      expect(ran).toEqual([]);
    } finally {
      served.stop();
    }
  });
});

describe("the agent installer", () => {
  it("gives a client that has only the eval's two tools the task in an empty directory of its own, and keeps what it spent and did", async () => {
    const { outcome, ran, told, recorded, installer } = await installWith({
      calls: [
        {
          name: "run",
          arguments: {
            machine: "studio",
            command: "bun install",
            cwd: "/home/owner/cota",
          },
        },
        {
          name: "tell_owner",
          arguments: { message: "Where does the hub run?" },
        },
      ],
    });
    expect(outcome).toBeNull();
    const started = recorded.find(({ kind }) => kind === "started");
    expect(started?.entries).toEqual([]);
    expect(String(started?.cwd)).toContain("cota-install-agent-");
    expect(existsSync(String(started?.cwd))).toBe(false);
    const args = Array.isArray(started?.args) ? started.args.join(" ") : "";
    expect(args).toContain(
      '--tools  --mcp-config {"mcpServers":{"world":{"type":"http","url":"http://127.0.0.1:',
    );
    expect(args).toContain(
      "--strict-mcp-config --allowedTools mcp__world__run,mcp__world__tell_owner --permission-mode dontAsk --permission-prompts none --restricted --setting-sources project",
    );
    expect(
      recorded
        .filter(({ kind }) => kind === "input")
        .map(({ type, subtype }) => [type, subtype]),
    ).toEqual([
      ["control_request", "get_context_usage"],
      ["user", null],
    ]);
    const message = String(
      recorded.find(({ kind }) => kind === "message")?.content,
    );
    expect(message.startsWith(task.ask)).toBe(true);
    expect(message.endsWith("THE INSTALL PROMPT")).toBe(true);
    expect(ran).toEqual([
      { machine: "studio", command: "bun install", cwd: "/home/owner/cota" },
    ]);
    expect(told).toEqual(["Where does the hub run?"]);
    expect(installer.spent?.()).toEqual({
      who: "installer",
      model: "stand-in",
      costUsd: 0.42,
      turns: 3,
    });
    expect(installer.transcript?.()).toEqual([
      { kind: "text", text: "Turn 1." },
      {
        kind: "call",
        tool: "mcp__world__run",
        input:
          '{"machine":"studio","command":"bun install","cwd":"/home/owner/cota"}',
      },
      {
        kind: "returned",
        text: expect.stringContaining("ran on studio"),
        isError: false,
      },
      { kind: "text", text: "Turn 2." },
      {
        kind: "call",
        tool: "mcp__world__tell_owner",
        input: '{"message":"Where does the hub run?"}',
      },
      {
        kind: "returned",
        text: expect.stringContaining("Yes."),
        isError: false,
      },
      { kind: "end", text: "success: INSTALLED\nBoth machines are set up." },
    ]);
  }, 30_000);

  it("is done only when the client's last message begins with the word that says so, and otherwise quotes what it said", async () => {
    const messageOf = (recorded: ReadonlyArray<{ [key: string]: unknown }>) =>
      String(recorded.find(({ kind }) => kind === "message")?.content);
    const done = await installWith({ said: "\nINSTALLED\nAll set." });
    expect(done.outcome).toBeNull();
    expect(messageOf(done.recorded)).toContain(
      `the first line of your last message is the word INSTALLED alone if everything the document's "Done" asks holds`,
    );

    const left = await installWith({
      said: "Still to do: launch a client on laptop.\nINSTALLED otherwise.",
    });
    expect(left.outcome).toEqual(
      new Unfinished("Still to do: launch a client on laptop."),
    );
    expect(String(left.outcome)).toBe(
      'Error: it ended its turn without saying it was done: "Still to do: launch a client on laptop."',
    );

    const nothing = await installWith({ said: "" });
    expect(nothing.outcome).toEqual(new Unfinished(""));
  }, 60_000);

  it("does not start a client whose context holds any tool but the eval's two: it is never given the task, and nothing runs", async () => {
    for (const announced of [
      context({ categories: ["System tools"] }),
      context({ mcpTools: [...allowed, "mcp__other__read"] }),
      context({ mcpTools: ["mcp__world__run"] }),
      { ...context(), agents: [{ name: "general-purpose" }] },
      { categories: "none" },
    ]) {
      const { outcome, ran, told, recorded } = await installWith({
        context: announced,
        calls: [
          { name: "run", arguments: { machine: "studio", command: "ls" } },
        ],
      });
      expect(String(outcome)).toContain("the client was not started");
      expect(recorded.some(({ kind }) => kind === "message")).toBe(false);
      expect(ran).toEqual([]);
      expect(told).toEqual([]);
    }
  }, 60_000);

  it("stops a client whose start announces any other tool, and runs none of its calls", async () => {
    const { outcome, ran } = await installWith({
      tools: [...allowed, "Bash"],
      calls: [{ name: "run", arguments: { machine: "studio", command: "ls" } }],
    });
    expect(String(outcome)).toBe(
      "Error: the client was stopped at its start: it announced Bash",
    );
    expect(ran).toEqual([]);
  }, 30_000);

  it("stops a client at its turn limit, its spend limit, and when the eval stops it, keeping what it reported spending", async () => {
    const call = {
      name: "run",
      arguments: { machine: "studio", command: "ls" },
    };
    const turns = await installWith({
      calls: [call, call, call, call],
      hang: true,
      turns: 2,
    });
    expect(turns.outcome).toEqual(new Stopped("2 turns"));
    expect(turns.ran.length).toBeLessThanOrEqual(3);
    expect(
      turns.recorded.filter(({ kind }) => kind === "input").at(-1),
    ).toMatchObject({ subtype: "interrupt" });
    expect(turns.installer.spent?.().costUsd).toBe(0.42);

    const spend = await installWith({
      result: {
        subtype: "error_max_budget_usd",
        is_error: true,
        total_cost_usd: 1.03,
        num_turns: 9,
      },
    });
    expect(spend.outcome).toEqual(new Stopped("$1.00 of spend"));
    expect(spend.installer.spent?.().costUsd).toBe(1.03);

    const stopped = await installWith({ hang: true, stopAfterMs: 1_500 });
    expect(String(stopped.outcome)).toBe("Error: the eval stopped it");
  }, 60_000);

  it("stops the run when the owner is stopped at the owner's limit", async () => {
    const { outcome } = await installWith({
      calls: [
        {
          name: "tell_owner",
          arguments: { message: "Where does the hub run?" },
        },
      ],
      hang: true,
      owner: {
        tell: async () => {
          throw new Stopped("$0.50 of the owner's spend");
        },
      },
    });
    expect(outcome).toEqual(new Stopped("$0.50 of the owner's spend"));
  }, 30_000);
});
