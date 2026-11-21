import { Option, Schema } from "effect";
import type { Machine, Owner } from "./installer.ts";

/** The MCP server's name, as the client prefixes it to each of its tools. */
export const serverName = "world";

/** The only tools an agent installer may have, by the names its client announces. */
export const allowedTools = [
  `mcp__${serverName}__run`,
  `mcp__${serverName}__tell_owner`,
] as const;

/** How much of what a command printed goes back to the agent, from the end. */
const kept = 12_000;

/** What a command printed, cut to its last characters as an agent is given them. */
export const cut = (text: string) =>
  text.length > kept
    ? `[the first ${text.length - kept} characters are cut]\n${text.slice(-kept)}`
    : text;

const RunArguments = Schema.Struct({
  machine: Schema.String,
  command: Schema.String,
  stdin: Schema.optionalKey(Schema.String),
  cwd: Schema.optionalKey(Schema.String),
});

const TellArguments = Schema.Struct({ message: Schema.String });

const Request = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.optionalKey(Schema.Union([Schema.String, Schema.Finite])),
  method: Schema.String,
  params: Schema.optionalKey(Schema.Unknown),
});
type Request = typeof Request.Type;

const Call = Schema.Struct({
  name: Schema.String,
  arguments: Schema.optionalKey(Schema.Unknown),
});

const Initialize = Schema.Struct({
  protocolVersion: Schema.optionalKey(Schema.String),
});

const decodeRequests = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Union([Request, Schema.Array(Request)])),
);
const decodeCall = Schema.decodeUnknownOption(Call);
const decodeRun = Schema.decodeUnknownOption(RunArguments);
const decodeTell = Schema.decodeUnknownOption(TellArguments);
const decodeInitialize = Schema.decodeUnknownOption(Initialize);

const tools = (machines: ReadonlyArray<Machine>) => [
  {
    name: "run",
    description: `Runs a command with \`bash -c\` as the owner's user in one of the owner's machines (${machines.map(({ name }) => name).join(", ")}), each Ubuntu 24.04, and answers its exit status and what it printed. It starts in the owner's home unless cwd names a directory, reads stdin when given, and is stopped after 10 minutes. Each call is a new shell: nothing set in one call is kept for the next. Nothing runs anywhere else.`,
    inputSchema: {
      type: "object",
      properties: {
        machine: {
          type: "string",
          enum: machines.map(({ name }) => name),
          description: "The machine to run it in.",
        },
        command: { type: "string", description: "The command, for bash -c." },
        stdin: {
          type: "string",
          description: "What the command reads on standard input.",
        },
        cwd: {
          type: "string",
          description: "An absolute directory to run it in.",
        },
      },
      required: ["machine", "command"],
      additionalProperties: false,
    },
  },
  {
    name: "tell_owner",
    description:
      "Sends the owner a message and answers with what they say back. The owner reads it in their own terminal and does what is theirs to do there before answering.",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "The message to the owner." },
      },
      required: ["message"],
      additionalProperties: false,
    },
  },
];

export interface Result {
  readonly content: ReadonlyArray<{
    readonly type: "text";
    readonly text: string;
  }>;
  readonly isError?: boolean;
}

export const text = (said: string, isError = false): Result => ({
  content: [{ type: "text", text: said }],
  ...(isError ? { isError } : {}),
});

/**
 * An MCP server over HTTP on the loopback address, answering only a caller
 * that gives its token: `tools/list` with the tools given, and `tools/call`
 * with what `call` answers.
 */
export const mcpServer = (options: {
  readonly name: string;
  readonly info: string;
  readonly tools: () => ReadonlyArray<unknown>;
  readonly call: (params: unknown) => Promise<Result>;
}) => {
  const token = crypto.randomUUID();
  const answer = async (request: Request) => {
    if (request.id === undefined) return undefined;
    const reply = (result: unknown) => ({
      jsonrpc: "2.0",
      id: request.id,
      result,
    });
    switch (request.method) {
      case "initialize":
        return reply({
          protocolVersion:
            Option.getOrUndefined(decodeInitialize(request.params))
              ?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: options.info, version: "1" },
        });
      case "ping":
        return reply({});
      case "tools/list":
        return reply({ tools: options.tools() });
      case "tools/call":
        return reply(
          await options
            .call(request.params)
            .catch((error: unknown) =>
              text(
                `The call failed: ${error instanceof Error ? error.message : String(error)}`,
                true,
              ),
            ),
        );
      default:
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32601, message: `No method ${request.method}` },
        };
    }
  };

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    fetch: async (request) => {
      if (request.headers.get("authorization") !== `Bearer ${token}`)
        return new Response(null, { status: 401 });
      if (request.method === "DELETE")
        return new Response(null, { status: 200 });
      if (request.method !== "POST") return new Response(null, { status: 405 });
      const decoded = Option.getOrUndefined(
        decodeRequests(await request.text()),
      );
      if (decoded === undefined)
        return Response.json(
          {
            jsonrpc: "2.0",
            id: null,
            error: { code: -32700, message: "Parse error" },
          },
          { status: 400 },
        );
      const requests = Array.isArray(decoded) ? decoded : [decoded];
      const answers = (await Promise.all(requests.map(answer))).filter(
        (each) => each !== undefined,
      );
      if (answers.length === 0) return new Response(null, { status: 202 });
      return Response.json(Array.isArray(decoded) ? answers : answers[0]);
    },
  });

  return {
    /** The client's `--mcp-config`: this server, and nothing else. */
    config: JSON.stringify({
      mcpServers: {
        [options.name]: {
          type: "http",
          url: `http://127.0.0.1:${server.port}/mcp`,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    }),
    url: `http://127.0.0.1:${server.port}/mcp`,
    token,
    stop: () => server.stop(true),
  };
};

/**
 * The agent installer's two tools, as an MCP server over HTTP on the loopback
 * address: `run`, a command in a named machine (`Machine.run`), and
 * `tell_owner`, a message to the owner (`Owner.tell`). Calls are answered one
 * at a time, in the order they came, only for a caller that gives the
 * server's token, and only while `isOpen` says the run is on.
 */
export const serveTools = (options: {
  readonly machines: ReadonlyArray<Machine>;
  readonly owner: Owner;
  readonly isOpen: () => boolean;
}) => {
  let queue: Promise<unknown> = Promise.resolve();
  const inTurn = <A>(work: () => Promise<A>): Promise<A> => {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  };

  const call = async (params: unknown): Promise<Result> => {
    if (!options.isOpen()) return text("The run is over.", true);
    const asked = Option.getOrUndefined(decodeCall(params));
    if (asked?.name === "run") {
      const run = Option.getOrUndefined(decodeRun(asked.arguments ?? {}));
      if (run === undefined)
        return text(
          "run takes machine, command, and optionally stdin and cwd.",
          true,
        );
      const machine = options.machines.find(({ name }) => name === run.machine);
      if (machine === undefined)
        return text(
          `There is no machine ${run.machine}; the machines are ${options.machines.map(({ name }) => name).join(", ")}.`,
          true,
        );
      const ran = await inTurn(() =>
        machine.run(run.command, {
          ...(run.cwd === undefined ? {} : { cwd: run.cwd }),
          ...(run.stdin === undefined ? {} : { stdin: run.stdin }),
        }),
      );
      return text(
        [
          ran.exitCode === null
            ? "It was stopped at its limit of 10 minutes."
            : `Exit status ${ran.exitCode}.`,
          ...(ran.stdout === "" ? [] : [`stdout:\n${cut(ran.stdout)}`]),
          ...(ran.stderr === "" ? [] : [`stderr:\n${cut(ran.stderr)}`]),
        ].join("\n"),
        ran.exitCode !== 0,
      );
    }
    if (asked?.name === "tell_owner") {
      const tell = Option.getOrUndefined(decodeTell(asked.arguments ?? {}));
      if (tell === undefined) return text("tell_owner takes a message.", true);
      return inTurn(() => options.owner.tell(tell.message)).then(
        (answer) => text(answer),
        (error: unknown) =>
          text(
            `The owner could not answer: ${error instanceof Error ? error.message : String(error)}`,
            true,
          ),
      );
    }
    return text(`There is no tool ${asked?.name ?? "of that name"}.`, true);
  };

  return mcpServer({
    name: serverName,
    info: "cota-install-world",
    tools: () => tools(options.machines),
    call,
  });
};
