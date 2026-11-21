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
} from "../install/client.ts";
import {
  type Answerer,
  found,
  type Given,
  notFound,
  type Spend,
  Stopped,
} from "./answerer.ts";
import { allowedTools, serveTool } from "./tools.ts";

/** The model of the agent answerer, unless `--model` names another. */
export const defaultAnswererModel = "claude-sonnet-5-5";

/** The headless Claude Code of the agent answerer: no built-in tool, the eval's one through its MCP server and nothing else, nobody to ask, nothing of the user's. */
export const answererArgs = (options: {
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

/** The one message an agent answerer is given: the skill, how its one tool stands in for the shell, and the question with how to answer it. */
export const questionMessage = (given: Pick<Given, "question" | "skill">) =>
  `You are on one of my machines, and you have the skill below, which reads my request log through \`cota memory\`. You have one tool, cota, which stands in for the shell the skill's commands are written for: give it the arguments after \`cota\`, each as the shell would give it after its quoting (\`q='webhook retry'\` is the one argument \`q=webhook retry\`), and a here-document's text as stdin. You have no other tool and no shell.

${given.skill}

My question: ${given.question}

Answer from the request log alone. The first line of your answer is ${found} alone if the log holds the answer, or ${notFound} alone if it does not; then what you found, and the session it came from.`;

const contextRequest = "cota-memory-tools";

/**
 * A coding agent as the answerer: a headless Claude Code on the host, a new
 * one for each question, in an empty temporary directory, whose only tool is
 * the eval's `cota`. It is started with no built-in tool and the eval's MCP
 * server alone, asked what it has before it is given the question, and
 * stopped before its first turn when it has any other tool. Its answer is
 * its last message. It is stopped at its turn and spend limits and when the
 * eval stops it.
 */
export const agentAnswerer = (options: {
  readonly model: string;
  readonly turns: number;
  readonly budgetUsd: number;
  /** The program and its first arguments; `claude` unless a test gives its stand-in. */
  readonly client?: ReadonlyArray<string>;
}): Answerer => {
  let spent: Spend = { model: null, costUsd: null, turns: null };

  const answer = async (given: Given): Promise<string> => {
    spent = { model: null, costUsd: null, turns: null };
    const dir = mkdtempSync(join(tmpdir(), "cota-memory-agent-"));
    let child: ChildProcess | undefined;
    let served: ReturnType<typeof serveTool> | undefined;
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
      let settle: (ended: Error | string) => void = () => undefined;
      const settled = new Promise<Error | string>((resolve) => {
        settle = resolve;
      });
      let ended = false;
      let started = false;
      let stopping: Error | undefined;
      const end = (outcome: Error | string) => {
        if (ended) return;
        ended = true;
        settle(outcome);
      };
      const send = (message: unknown) => {
        if (child?.stdin?.writable === true)
          child.stdin.write(`${JSON.stringify(message)}\n`);
      };
      const stop = (error: Error) => {
        if (stopping !== undefined || ended) return;
        stopping = error;
        send({
          type: "control_request",
          request_id: "cota-memory-stop",
          request: { subtype: "interrupt" },
        });
        setTimeout(() => {
          killGroup("SIGTERM");
          end(error);
        }, 15_000).unref();
      };

      served = serveTool({
        machine: given.machine,
        isOpen: () => started && stopping === undefined && !ended,
      });
      const [program = "claude", ...first] = options.client ?? ["claude"];
      child = spawn(
        program,
        [
          ...first,
          ...answererArgs({
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
      const onAbort = () => stop(new Stopped("the eval's limit"));
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
                : refusalOf(announced, allowedTools);
            if (refusal !== null) {
              killGroup("SIGTERM");
              end(
                new Error(`the client was not given the question: ${refusal}`),
              );
              return;
            }
            started = true;
            send({
              type: "user",
              message: { role: "user", content: questionMessage(given) },
              parent_tool_use_id: null,
              session_id: "",
            });
            return;
          }
          case "init": {
            spent = { ...spent, model: line.model };
            const refusal = refusalOf(line.tools, allowedTools);
            if (refusal !== null) {
              killGroup("SIGKILL");
              end(new Error(`the client was stopped at its start: ${refusal}`));
            }
            return;
          }
          case "assistant": {
            seen.add(line.id);
            if (seen.size > options.turns)
              stop(new Stopped(`${options.turns} turns`));
            return;
          }
          case "result": {
            spent = { ...spent, costUsd: line.costUsd, turns: line.turns };
            child?.stdin?.end();
            if (stopping !== undefined) return end(stopping);
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
                  `the client ended with ${line.subtype}: ${line.text.slice(0, 600)}`,
                ),
              );
            return end(line.text);
          }
          case "user":
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
          stopping ??
            new Error(
              `the client exited ${code ?? "on a signal"} before it answered${stderr.trim() === "" ? "" : `: ${stderr.trim().slice(0, 600)}`}`,
            ),
        ),
      );
      send({
        type: "control_request",
        request_id: contextRequest,
        request: { subtype: "get_context_usage" },
      });
      const outcome = await settled;
      given.stop.removeEventListener("abort", onAbort);
      if (outcome instanceof Error) throw outcome;
      return outcome;
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

  return { name: "claude", answer, spent: () => spent };
};
