import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Schema } from "effect";
import type { Machine, Ran } from "./answerer.ts";
import { refusalOf, serveTool } from "./tools.ts";

const Argument = Schema.Union([
  Schema.Literals([
    "memory",
    "get",
    "sql",
    "transcript",
    "key",
    "join",
    "leave",
    "doctor",
    "hub-key",
    "keyed",
    "claude",
    "--help",
    "/api/search",
    "q=retry",
    "$(cat ~/.config/cota/hub-keys/reader)",
    "; rm -rf ~",
    "|",
    "",
  ]),
  Schema.String,
]);

const recordingMachine = () => {
  const ran: Array<{ args: ReadonlyArray<string>; stdin: string | null }> = [];
  const shells: Array<string> = [];
  const answered = (command: string): Ran => ({
    command,
    stdin: null,
    exitCode: 0,
    stdout: "{}",
    stderr: "",
  });
  const machine: Machine = {
    run: async (command) => {
      shells.push(command);
      return answered(command);
    },
    cota: async (args, stdin) => {
      ran.push({ args, stdin: stdin ?? null });
      return answered(args.join(" "));
    },
  };
  return { ran, shells, machine };
};

const called = async (
  server: ReturnType<typeof serveTool>,
  args: unknown,
  token: string = server.token,
) => {
  const response = await fetch(server.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "cota", arguments: args },
    }),
  });
  return response.status === 200 ? await response.json() : response.status;
};

describe("the agent answerer's tool", () => {
  it.prop(
    "O8: The agent answerer's tool runs the world's `cota` only for `memory get`, `memory sql` and `memory transcript`, without a shell, in the world's machine; any other arguments are refused and nothing runs.",
    { args: Arbitrary.schema(Schema.Array(Argument)) },
    ({ args }) => {
      const reads =
        args[0] === "memory" &&
        ["get", "sql", "transcript"].includes(args[1] ?? "");
      expect(refusalOf(args) === null).toBe(reads);
    },
  );

  it("O8: runs the machine's cota with the arguments and input given, without a shell, and refuses any other command with nothing run", async () => {
    const { ran, shells, machine } = recordingMachine();
    const server = serveTool({ machine, isOpen: () => true });
    try {
      await called(server, {
        args: ["memory", "sql"],
        stdin: "SELECT 1",
      });
      await called(server, {
        args: [
          "memory",
          "get",
          "/api/search",
          "q=$(cat ~/.config/cota/hub-keys/reader)",
        ],
      });
      const refused = await called(server, {
        args: ["memory", "key"],
        stdin: "a key",
      });
      await called(server, { args: ["hub-key", "keyed"] });
      await called(server, { command: "cat ~/.config/cota/hub-keys/reader" });
      expect(
        await called(server, { args: ["memory", "sql"] }, "another-token"),
      ).toBe(401);
      expect(ran).toEqual([
        { args: ["memory", "sql"], stdin: "SELECT 1" },
        {
          args: [
            "memory",
            "get",
            "/api/search",
            "q=$(cat ~/.config/cota/hub-keys/reader)",
          ],
          stdin: null,
        },
      ]);
      expect(shells).toEqual([]);
      expect(refused).toMatchObject({
        result: {
          isError: true,
          content: [
            {
              text: "It runs only cota memory get, cota memory sql and cota memory transcript, not cota memory key.",
            },
          ],
        },
      });
    } finally {
      server.stop();
    }
  });

  it("answers nothing once the question is closed", async () => {
    const { ran, machine } = recordingMachine();
    const server = serveTool({ machine, isOpen: () => false });
    try {
      expect(await called(server, { args: ["memory", "sql"] })).toMatchObject({
        result: {
          isError: true,
          content: [{ text: "The question is closed." }],
        },
      });
      expect(ran).toEqual([]);
    } finally {
      server.stop();
    }
  });
});
