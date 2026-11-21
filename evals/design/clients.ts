import { spawn } from "node:child_process";
import { createWriteStream, readFileSync, writeFileSync } from "node:fs";
import { Option, Schema } from "effect";
import type { Runner, Status } from "./runs.ts";

export type Client = Exclude<Runner, "replay">;

export const minutes = 20;

export const defaultModels: Readonly<Record<Client, string | null>> = {
  claude: "claude-sonnet-5-5",
  codex: null,
};

/**
 * The repository's scripts a run may use, as a colleague building a screen
 * would: `bun run` with one of these and its arguments, and the formatter's
 * fixes through `bun run biome`. Nothing that installs, adds, removes or
 * fetches a package.
 */
const scripts = [
  "check",
  "typecheck",
  "test",
  "stories",
  "lint:design",
  "boundaries",
  "docs:check",
  "web:build",
  "biome check",
  "biome format",
];

export const allowedBash = scripts.flatMap((script) => [
  `Bash(bun run ${script})`,
  `Bash(bun run ${script} *)`,
]);

/** Denied even where an allowed pattern would match, since a denial wins. */
export const deniedBash = [
  "bunx",
  "bun x",
  "bun add",
  "bun install",
  "bun i",
  "bun pm",
  "bun remove",
  "bun rm",
  "bun update",
  "bun upgrade",
  "bun link",
  "bun create",
  "bun init",
  "bun patch",
].flatMap((command) => [`Bash(${command})`, `Bash(${command} *)`]);

/**
 * What keeps the user's own Claude Code out of a run and the judge: only the
 * project's settings, no MCP servers, no skills or slash commands (the
 * built-in ones included), no auto memory, nothing kept of the session.
 */
export const claudeIsolation = [
  "--setting-sources",
  "project",
  "--settings",
  JSON.stringify({ autoMemoryEnabled: false }),
  "--disable-slash-commands",
  "--strict-mcp-config",
  "--no-session-persistence",
];

/** The runner of the runs and the client of the judge: claude unless it is missing, codex otherwise, and replay only to judge kept patches again. */
export const chooseRunner = (options: {
  readonly asked: Runner | undefined;
  readonly judgeOnly: boolean;
  readonly onPath: (client: Client) => boolean;
}): { readonly runner: Runner; readonly judge: Client } => {
  const present: Client | undefined = options.onPath("claude")
    ? "claude"
    : options.onPath("codex")
      ? "codex"
      : undefined;
  const runner = options.asked ?? (options.judgeOnly ? "replay" : present);
  if (runner === undefined || present === undefined) {
    throw new Error("Neither claude nor codex is on the path.");
  }
  if (runner === "replay" && !options.judgeOnly) {
    throw new Error("The replay runner takes its patches from --judge-only.");
  }
  if (runner !== "replay" && options.judgeOnly) {
    throw new Error(
      "--judge-only replays the kept patches: its runner is replay.",
    );
  }
  if (runner !== "replay" && !options.onPath(runner)) {
    throw new Error(`${runner} is not on the path.`);
  }
  return { runner, judge: runner === "replay" ? present : runner };
};

/**
 * The variables that make a process part of the session that started it
 * (Claude Code's own, and T3 Code's thread). A run is a session of its own,
 * so they are left out; nothing that says where a client connects is.
 */
const sessionVariables = [
  "CLAUDECODE",
  "CLAUDE_AGENT_SDK_VERSION",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_EFFORT",
  "CLAUDE_PID",
  "T3CODE_CLI_PATH",
  "T3CODE_THREAD_ID",
];

export const clientEnvironment = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !sessionVariables.includes(name),
    ),
  );

/** The command that builds a task in the copy: reading, editing and running bun there, and nothing else, with no one to ask. */
export const buildCommand = (
  client: Client,
  model: string | null,
  dir: string,
  lastMessage: string,
): ReadonlyArray<string> =>
  client === "claude"
    ? [
        "claude",
        "--print",
        "--output-format",
        "stream-json",
        "--verbose",
        ...(model === null ? [] : ["--model", model]),
        "--tools",
        "Read,Edit,Write,Glob,Grep,Bash",
        "--allowedTools",
        ...allowedBash,
        "--disallowedTools",
        ...deniedBash,
        "--permission-mode",
        "acceptEdits",
        "--permission-prompts",
        "none",
        ...claudeIsolation,
      ]
    : [
        "codex",
        "exec",
        "--sandbox",
        "workspace-write",
        "--config",
        "sandbox_workspace_write.network_access=false",
        "--ignore-user-config",
        "--ephemeral",
        "--json",
        "--cd",
        dir,
        "--output-last-message",
        lastMessage,
        ...(model === null ? [] : ["--model", model]),
      ];

/** The command that judges a run: no tools, no project, the answer held to a JSON Schema. */
export const judgeCommand = (
  client: Client,
  model: string | null,
  dir: string,
  schemaFile: string,
  lastMessage: string,
  images: ReadonlyArray<string>,
): ReadonlyArray<string> =>
  client === "claude"
    ? [
        "claude",
        "--print",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        ...(model === null ? [] : ["--model", model]),
        "--tools",
        "",
        ...claudeIsolation,
        "--json-schema",
        readFileSync(schemaFile, "utf8"),
      ]
    : [
        "codex",
        "exec",
        "--sandbox",
        "read-only",
        "--ignore-user-config",
        "--ephemeral",
        "--skip-git-repo-check",
        "--json",
        "--cd",
        dir,
        "--output-schema",
        schemaFile,
        "--output-last-message",
        lastMessage,
        ...(model === null ? [] : ["--model", model]),
        ...images.flatMap((image) => ["--image", image]),
      ];

export interface Outcome {
  readonly status: Status;
  readonly seconds: number;
  readonly error: string | null;
  readonly costUsd: number | null;
  readonly turns: number | null;
  readonly model: string | null;
  readonly answer: unknown;
}

const ClaudeInit = Schema.Struct({
  type: Schema.Literal("system"),
  subtype: Schema.Literal("init"),
  model: Schema.String,
});

const ClaudeResult = Schema.Struct({
  type: Schema.Literal("result"),
  subtype: Schema.String,
  is_error: Schema.Boolean,
  num_turns: Schema.optionalKey(Schema.Int),
  total_cost_usd: Schema.optionalKey(Schema.Finite),
  result: Schema.optionalKey(Schema.String),
  structured_output: Schema.optionalKey(Schema.Unknown),
});

const CodexEvent = Schema.Struct({
  type: Schema.String,
  message: Schema.optionalKey(Schema.String),
  error: Schema.optionalKey(Schema.Struct({ message: Schema.String })),
});

const decodeInit = Schema.decodeUnknownOption(
  Schema.fromJsonString(ClaudeInit),
);
const decodeResult = Schema.decodeUnknownOption(
  Schema.fromJsonString(ClaudeResult),
);
const decodeCodex = Schema.decodeUnknownOption(
  Schema.fromJsonString(CodexEvent),
);
const decodeJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Unknown),
);

const lastOf = <A>(
  lines: ReadonlyArray<string>,
  decode: (line: string) => Option.Option<A>,
): A | undefined =>
  lines.flatMap((line) => Option.toArray(decode(line))).at(-1);

/** What a client's printed lines say: the client's output is untrusted text, read only through these Schemas. */
export const outcomeOf = (
  client: Client,
  printed: string,
  lastMessage: string | null,
): Omit<Outcome, "seconds"> => {
  const lines = printed.split("\n").filter((line) => line.startsWith("{"));
  if (client === "claude") {
    const result = lastOf(lines, decodeResult);
    const model = lastOf(lines, decodeInit)?.model ?? null;
    if (result === undefined) {
      return {
        status: "failed",
        error: `claude printed no result: ${printed.slice(-600)}`,
        costUsd: null,
        turns: null,
        model,
        answer: undefined,
      };
    }
    return {
      status: result.is_error ? "failed" : "done",
      error: result.is_error
        ? `${result.subtype}: ${(result.result ?? "").slice(0, 600)}`
        : null,
      costUsd: result.total_cost_usd ?? null,
      turns: result.num_turns ?? null,
      model,
      answer:
        result.structured_output ??
        Option.getOrUndefined(decodeJson(fenced(result.result ?? ""))),
    };
  }
  const failure = lines
    .flatMap((line) => Option.toArray(decodeCodex(line)))
    .filter(({ type }) => type === "error" || type === "turn.failed")
    .map((event) => event.error?.message ?? event.message ?? event.type)
    .at(-1);
  return {
    status: failure === undefined ? "done" : "failed",
    error: failure ?? null,
    costUsd: null,
    turns: null,
    model: null,
    answer:
      lastMessage === null
        ? undefined
        : Option.getOrUndefined(decodeJson(fenced(lastMessage))),
  };
};

const fenced = (text: string) =>
  text.match(/```(?:json)?\n([\s\S]*?)\n```/)?.[1] ?? text.trim();

/**
 * Runs a client to its end or its time limit, its stdout kept in the
 * transcript. It runs in a process group of its own, so what it started is
 * stopped with it.
 */
export const runClient = async (options: {
  readonly client: Client;
  readonly command: ReadonlyArray<string>;
  readonly cwd: string;
  readonly stdin: string;
  readonly transcript: string;
  readonly lastMessage: string;
  readonly limitMs: number;
}): Promise<Outcome> => {
  const started = performance.now();
  writeFileSync(options.lastMessage, "");
  const [program = "", ...args] = options.command;
  const child = spawn(program, args, {
    cwd: options.cwd,
    env: clientEnvironment(),
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const transcript = createWriteStream(options.transcript);
  const chunks: Array<Buffer> = [];
  child.stdout.on("data", (chunk: Buffer) => {
    chunks.push(chunk);
    transcript.write(chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => transcript.write(chunk));
  child.stdin.end(options.stdin);
  const stop = (signal: NodeJS.Signals) => {
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, signal);
    } catch {}
  };
  let timedOut = false;
  const limit = setTimeout(() => {
    timedOut = true;
    stop("SIGTERM");
    setTimeout(() => stop("SIGKILL"), 10_000).unref();
  }, options.limitMs);
  const exit = await new Promise<{ code: number | null; error?: string }>(
    (resolve) => {
      child.on("error", (error) =>
        resolve({ code: null, error: error.message }),
      );
      child.on("close", (code) => resolve({ code }));
    },
  );
  clearTimeout(limit);
  stop("SIGTERM");
  // Callers read the transcript once this returns, so it is flushed first.
  await new Promise<void>((resolve) => transcript.end(resolve));
  const seconds = Math.round((performance.now() - started) / 1000);
  const printed = Buffer.concat(chunks).toString("utf8");
  const read = outcomeOf(
    options.client,
    printed,
    readFileSync(options.lastMessage, "utf8") || null,
  );
  if (timedOut) {
    return {
      ...read,
      status: "timed-out",
      error: `stopped after ${Math.round(options.limitMs / 60_000)} minutes`,
      seconds,
    };
  }
  if (exit.code !== 0 && read.status === "done") {
    return {
      ...read,
      status: "failed",
      error: exit.error ?? `${options.client} exited ${exit.code}`,
      seconds,
    };
  }
  return { ...read, seconds };
};

export const versionOf = async (client: Client) => {
  const child = Bun.spawn([client, "--version"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  return (await new Response(child.stdout).text()).trim().split("\n")[0] ?? "";
};

export const onPath = (client: Client) => Bun.which(client) !== null;
