import { Option, Schema } from "effect";
import { cut, mcpServer, type Result, text } from "../install/tools.ts";
import type { Machine } from "./answerer.ts";

/** The MCP server's name, as the client prefixes it to its tool. */
export const serverName = "memory";

/** The only tool an agent answerer may have, by the name its client announces. */
export const allowedTools = [`mcp__${serverName}__cota`] as const;

/** The subcommands the tool runs: those that read the request log, never `cota memory key` or any other command. */
const reading = ["get", "sql", "transcript"];

/** Why the tool refuses to run `cota` with these arguments, or null when it runs them. */
export const refusalOf = (args: ReadonlyArray<string>): string | null =>
  args[0] === "memory" && reading.includes(args[1] ?? "")
    ? null
    : `It runs only cota memory get, cota memory sql and cota memory transcript, not cota ${args.join(" ")}.`;

const CotaArguments = Schema.Struct({
  args: Schema.Array(Schema.String),
  stdin: Schema.optionalKey(Schema.String),
});

const Call = Schema.Struct({
  name: Schema.String,
  arguments: Schema.optionalKey(Schema.Unknown),
});

const decodeCall = Schema.decodeUnknownOption(Call);
const decodeArguments = Schema.decodeUnknownOption(CotaArguments);

const tools = [
  {
    name: "cota",
    description:
      "Runs `cota` on the owner's machine with the arguments given, without a shell, reading stdin when it is given, and answers its exit status and what it printed. It runs only `cota memory get`, `cota memory sql` and `cota memory transcript`, and is stopped after 60 seconds.",
    inputSchema: {
      type: "object",
      properties: {
        args: {
          type: "array",
          items: { type: "string" },
          description:
            'The arguments after cota, each as a shell would give it after its quoting: ["memory", "get", "/api/search", "q=webhook retry"].',
        },
        stdin: {
          type: "string",
          description:
            "What it reads on standard input: the SQL of cota memory sql.",
        },
      },
      required: ["args"],
      additionalProperties: false,
    },
  },
];

/**
 * The agent answerer's one tool, as an MCP server over HTTP on the loopback
 * address: `cota`, the world's machine's `cota` run with the arguments given
 * (`Machine.cota`), and only for reading the request log. Calls are answered
 * only for a caller that gives the server's token, and only while `isOpen`
 * says the question is open.
 */
export const serveTool = (options: {
  readonly machine: Machine;
  readonly isOpen: () => boolean;
}) =>
  mcpServer({
    name: serverName,
    info: "cota-memory-world",
    tools: () => tools,
    call: async (params): Promise<Result> => {
      if (!options.isOpen()) return text("The question is closed.", true);
      const asked = Option.getOrUndefined(decodeCall(params));
      if (asked?.name !== "cota")
        return text(`There is no tool ${asked?.name ?? "of that name"}.`, true);
      const given = Option.getOrUndefined(
        decodeArguments(asked.arguments ?? {}),
      );
      if (given === undefined)
        return text("cota takes args, and optionally stdin.", true);
      const refusal = refusalOf(given.args);
      if (refusal !== null) return text(refusal, true);
      const ran = await options.machine.cota(given.args, given.stdin);
      return text(
        [
          ran.exitCode === null
            ? "It was stopped at its limit of 60 seconds."
            : `Exit status ${ran.exitCode}.`,
          ...(ran.stdout === "" ? [] : [`stdout:\n${cut(ran.stdout)}`]),
          ...(ran.stderr === "" ? [] : [`stderr:\n${cut(ran.stderr)}`]),
        ].join("\n"),
        ran.exitCode !== 0,
      );
    },
  });
