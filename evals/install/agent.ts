import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeIsolation, clientEnvironment } from "../design/clients.ts";
import {
  announcedOfContext,
  type Line,
  lineOf,
  refusalOf,
  textOfBlock,
  toolResultOf,
  toolUseOf,
} from "./client.ts";
import {
  type Given,
  type Installer,
  type Owner,
  type Spend,
  Stopped,
  type Turn,
  Unfinished,
} from "./installer.ts";
import type { Task } from "./tasks.ts";
import { allowedTools, serveTools } from "./tools.ts";

/** The model of the agent installer, unless `--model` names another. */
export const defaultInstallerModel = "claude-sonnet-5-5";

/** The headless Claude Code of the agent installer: no built-in tool, the eval's two through its MCP server and nothing else, nobody to ask, nothing of the user's. */
export const installerArgs = (options: {
  readonly model: string;
  readonly mcpConfig: string;
  readonly budgetUsd: number;
}): ReadonlyArray<string> => [
  "--print",
  "--input-format",
  "stream-json",
  "--output-format",
  "stream-json",
  "--verbose",
  "--model",
  options.model,
  "--tools",
  "",
  "--mcp-config",
  options.mcpConfig,
  "--strict-mcp-config",
  "--allowedTools",
  allowedTools.join(","),
  "--permission-mode",
  "dontAsk",
  "--permission-prompts",
  "none",
  "--restricted",
  ...claudeIsolation,
  "--max-budget-usd",
  options.budgetUsd.toFixed(2),
];

/** The first line of an agent's last message that says it is done. */
export const doneWord = "INSTALLED";

/** What an agent's last message says, as the harness reads it: null when its first line is the word that says it is done, else that first line (cut short), empty when it said nothing. */
export const unfinishedLineOf = (last: string): string | null => {
  const first = (last.trim().split("\n")[0] ?? "").trim();
  if (first === doneWord) return null;
  return first.length > 300 ? `${first.slice(0, 300)}…` : first;
};

/** The first message: the task's first words, how the agent reaches the machines and the owner, how it ends, and the install prompt. */
export const firstMessage = (task: Task, prompt: string) =>
  `${task.ask}

You reach my machines (${task.machines.map(({ name }) => name).join(", ")}) only through the tool run, which runs one command in the machine you name, as my user, and you reach me only through the tool tell_owner: I read your message and answer it. Nothing you run happens anywhere else, and you have no other tool.

When you end, the first line of your last message is the word ${doneWord} alone if everything the document's "Done" asks holds; otherwise it says what is left.

The install document, Cota's docs/install.md:

${prompt}`;

const cut = (text: string, most = 2000) =>
  text.length > most
    ? `${text.slice(0, most)}… [${text.length - most} more characters]`
    : text;

const contextRequest = "cota-install-tools";

/**
 * A coding agent as the installer: a headless Claude Code on the host, in an
 * empty temporary directory, whose only tools are the eval's two. It is
 * started with no built-in tool and the eval's MCP server alone, asked what
 * it has before it is given anything to do, and stopped before its first turn
 * when it has any other tool. It is done only when its last message begins
 * with the word that says so. It is stopped at its turn and spend limits and
 * when the eval stops it; what it reported spending and its transcript are
 * kept.
 */
export const agentInstaller = (options: {
  readonly task: Task;
  readonly model: string;
  readonly turns: number;
  readonly budgetUsd: number;
  /** The program and its first arguments; `claude` unless a test gives its stand-in. */
  readonly client?: ReadonlyArray<string>;
}): Installer => {
  const turns: Array<Turn> = [];
  let model: string | null = null;
  let costUsd: number | null = null;
  let reportedTurns: number | null = null;

  const install = async (given: Given): Promise<void> => {
    const dir = mkdtempSync(join(tmpdir(), "cota-install-agent-"));
    let child: ChildProcess | undefined;
    let served: ReturnType<typeof serveTools> | undefined;
    const killGroup = (signal: NodeJS.Signals) => {
      if (child?.pid === undefined || child.exitCode !== null) return;
      try {
        process.kill(-child.pid, signal);
      } catch {}
    };
    const onExit = () => killGroup("SIGKILL");
    process.on("exit", onExit);
    try {
      if (readdirSync(dir).length !== 0)
        throw new Error(`the client's directory ${dir} is not empty`);
      let settle: (error: Error | null) => void = () => undefined;
      const settled = new Promise<Error | null>((resolve) => {
        settle = resolve;
      });
      let ending: Error | null | undefined;
      let stopping = false;
      let started = false;
      let stopped: Error | undefined;
      const end = (error: Error | null) => {
        if (ending !== undefined) return;
        ending = error;
        settle(error);
      };
      const send = (message: unknown) => {
        if (child?.stdin?.writable === true)
          child.stdin.write(`${JSON.stringify(message)}\n`);
      };
      const stop = (error: Error) => {
        if (stopping || ending !== undefined) return;
        stopping = true;
        send({
          type: "control_request",
          request_id: "cota-install-stop",
          request: { subtype: "interrupt" },
        });
        setTimeout(() => {
          killGroup("SIGTERM");
          end(error);
        }, 15_000).unref();
        stopped = error;
      };

      const owner: Owner = {
        tell: async (message) => {
          try {
            return await given.owner.tell(message);
          } catch (error) {
            stop(error instanceof Error ? error : new Error(String(error)));
            throw error;
          }
        },
      };
      served = serveTools({
        machines: given.machines,
        owner,
        isOpen: () => started && !stopping && ending === undefined,
      });
      const [program = "claude", ...first] = options.client ?? ["claude"];
      child = spawn(
        program,
        [
          ...first,
          ...installerArgs({
            model: options.model,
            mcpConfig: served.config,
            budgetUsd: options.budgetUsd,
          }),
        ],
        {
          cwd: dir,
          env: clientEnvironment(),
          detached: true,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      const onAbort = () => stop(new Error("the eval stopped it"));
      given.stop.addEventListener("abort", onAbort);

      const seen = new Set<string>();
      const read = (line: Line) => {
        switch (line.kind) {
          case "control": {
            if (line.id !== contextRequest || started) return;
            const announced = line.ok
              ? announcedOfContext(line.response)
              : null;
            const refusal =
              announced === null
                ? `it did not say what it has${line.error === null ? "" : `: ${line.error}`}`
                : refusalOf(announced);
            if (refusal !== null) {
              killGroup("SIGTERM");
              end(new Error(`the client was not started: ${refusal}`));
              return;
            }
            started = true;
            send({
              type: "user",
              message: {
                role: "user",
                content: firstMessage(options.task, given.prompt),
              },
              parent_tool_use_id: null,
              session_id: "",
            });
            return;
          }
          case "init": {
            model = line.model;
            const refusal = refusalOf(line.tools);
            if (refusal !== null) {
              killGroup("SIGKILL");
              end(new Error(`the client was stopped at its start: ${refusal}`));
            }
            return;
          }
          case "assistant": {
            for (const block of line.content) {
              const text = textOfBlock(block);
              if (text !== undefined && text.trim() !== "")
                turns.push({ kind: "text", text });
              const use = toolUseOf(block);
              if (use !== undefined)
                turns.push({
                  kind: "call",
                  tool: use.name,
                  input: JSON.stringify(use.input),
                });
            }
            seen.add(line.id);
            if (seen.size > options.turns)
              stop(new Stopped(`${options.turns} turns`));
            return;
          }
          case "user": {
            if (!Array.isArray(line.content)) return;
            for (const block of line.content) {
              const result = toolResultOf(block);
              if (result !== undefined)
                turns.push({
                  kind: "returned",
                  text: cut(result.text),
                  isError: result.isError,
                });
            }
            return;
          }
          case "result": {
            costUsd = line.costUsd;
            reportedTurns = line.turns;
            turns.push({
              kind: "end",
              text: `${line.subtype}${line.text === "" ? "" : `: ${line.text}`}`,
            });
            child?.stdin?.end();
            if (stopped !== undefined) return end(stopped);
            if (
              line.subtype === "error_max_budget_usd" ||
              (line.costUsd ?? 0) > options.budgetUsd
            )
              return end(
                new Stopped(`$${options.budgetUsd.toFixed(2)} of spend`),
              );
            if (line.subtype === "error_max_turns")
              return end(new Stopped(`${options.turns} turns`));
            if (line.isError)
              return end(
                new Error(
                  `the client ended with ${line.subtype}: ${cut(line.text, 600)}`,
                ),
              );
            const unfinished = unfinishedLineOf(line.text);
            return end(unfinished === null ? null : new Unfinished(unfinished));
          }
          case "other":
            return;
        }
      };

      let buffer = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const each of lines) read(lineOf(each));
      });
      let stderr = "";
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr = `${stderr}${chunk.toString("utf8")}`.slice(-2000);
      });
      child.on("error", (error) => end(error));
      child.on("close", (code) =>
        end(
          stopped ??
            new Error(
              `the client exited ${code ?? "on a signal"} before it was done${stderr.trim() === "" ? "" : `: ${cut(stderr.trim(), 600)}`}`,
            ),
        ),
      );
      send({
        type: "control_request",
        request_id: contextRequest,
        request: { subtype: "get_context_usage" },
      });
      const error = await settled;
      given.stop.removeEventListener("abort", onAbort);
      if (error !== null) throw error;
    } finally {
      killGroup("SIGTERM");
      const pid = child?.pid;
      if (pid !== undefined)
        setTimeout(() => {
          try {
            process.kill(-pid, "SIGKILL");
          } catch {}
        }, 5_000).unref();
      process.off("exit", onExit);
      served?.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  };

  return {
    name: "claude",
    install,
    spent: (): Spend => ({
      who: "installer",
      model,
      costUsd,
      turns: reportedTurns,
    }),
    transcript: () => turns,
  };
};
