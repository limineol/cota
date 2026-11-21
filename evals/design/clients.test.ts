import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  buildCommand,
  type Client,
  chooseRunner,
  judgeCommand,
  outcomeOf,
} from "./clients.ts";

const scratch = mkdtempSync(join(tmpdir(), "cota-design-clients-"));
const schemaFile = join(scratch, "schema.json");
writeFileSync(schemaFile, "{}");
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const present =
  (...clients: ReadonlyArray<Client>) =>
  (client: Client) =>
    clients.includes(client);

describe("the runner", () => {
  it("is claude when it is on the path, codex when only codex is, and the one asked for", () => {
    expect(
      chooseRunner({
        asked: undefined,
        judgeOnly: false,
        onPath: present("claude", "codex"),
      }),
    ).toEqual({ runner: "claude", judge: "claude" });
    expect(
      chooseRunner({
        asked: undefined,
        judgeOnly: false,
        onPath: present("codex"),
      }),
    ).toEqual({ runner: "codex", judge: "codex" });
    expect(
      chooseRunner({
        asked: "codex",
        judgeOnly: false,
        onPath: present("claude", "codex"),
      }),
    ).toEqual({ runner: "codex", judge: "codex" });
  });

  it("replays the kept patches to judge them again, with the client on the path as the judge", () => {
    expect(
      chooseRunner({
        asked: undefined,
        judgeOnly: true,
        onPath: present("codex"),
      }),
    ).toEqual({ runner: "replay", judge: "codex" });
    expect(
      chooseRunner({
        asked: "replay",
        judgeOnly: true,
        onPath: present("claude", "codex"),
      }),
    ).toEqual({ runner: "replay", judge: "claude" });
  });

  it("refuses what it cannot do", () => {
    expect(() =>
      chooseRunner({ asked: undefined, judgeOnly: false, onPath: present() }),
    ).toThrow("Neither claude nor codex is on the path.");
    expect(() =>
      chooseRunner({
        asked: "claude",
        judgeOnly: false,
        onPath: present("codex"),
      }),
    ).toThrow("claude is not on the path.");
    expect(() =>
      chooseRunner({
        asked: "replay",
        judgeOnly: false,
        onPath: present("claude"),
      }),
    ).toThrow("The replay runner takes its patches from --judge-only.");
  });

  it("never lets a client past its permissions or its sandbox", () => {
    for (const client of ["claude", "codex"] as const) {
      const command = buildCommand(client, null, "/tmp/copy", "/tmp/last");
      expect(command).not.toContain("--dangerously-skip-permissions");
      expect(command).not.toContain(
        "--dangerously-bypass-approvals-and-sandbox",
      );
      expect(command).not.toContain("bypassPermissions");
      expect(command).not.toContain("danger-full-access");
    }
  });

  it("lets Claude Code run only the repository's scripts, never a command that installs or fetches a package", () => {
    const command = buildCommand("claude", null, "/tmp/copy", "/tmp/last");
    const listAfter = (flag: string) => {
      const from = command.indexOf(flag) + 1;
      const end = command.findIndex(
        (word, index) => index >= from && word.startsWith("--"),
      );
      return command.slice(from, end);
    };
    const allowed = listAfter("--allowedTools");
    expect(allowed).toContain("Bash(bun run check)");
    expect(allowed).toContain("Bash(bun run stories *)");
    expect(allowed).toContain("Bash(bun run biome check *)");
    for (const pattern of allowed) {
      expect(pattern).toMatch(/^Bash\(bun run [a-z:]+( [a-z]+)?( \*)?\)$/);
    }
    const denied = listAfter("--disallowedTools");
    for (const command of [
      "bunx",
      "bun x",
      "bun add",
      "bun install",
      "bun pm",
      "bun remove",
      "bun update",
    ]) {
      expect(denied).toContain(`Bash(${command})`);
      expect(denied).toContain(`Bash(${command} *)`);
    }
  });

  it("keeps the user's own Claude Code, its skills and its memory out of a run and of the judge", () => {
    for (const command of [
      buildCommand("claude", null, "/tmp/copy", "/tmp/last"),
      judgeCommand("claude", null, "/tmp/empty", schemaFile, "/tmp/last", []),
    ]) {
      expect(command.join(" ")).toContain(
        '--setting-sources project --settings {"autoMemoryEnabled":false} --disable-slash-commands --strict-mcp-config --no-session-persistence',
      );
    }
  });

  it("keeps Codex off the network, writing only in its copy", () => {
    expect(
      buildCommand("codex", null, "/tmp/copy", "/tmp/last").join(" "),
    ).toContain(
      "--sandbox workspace-write --config sandbox_workspace_write.network_access=false --ignore-user-config",
    );
  });
});

describe("a client's output", () => {
  const claude = (...lines: ReadonlyArray<unknown>) =>
    lines.map((line) => JSON.stringify(line)).join("\n");

  it("is done with its cost, turns and model when Claude Code's result says so", () => {
    expect(
      outcomeOf(
        "claude",
        claude(
          { type: "system", subtype: "init", model: "claude-sonnet-5-5" },
          { type: "assistant", message: { content: [] } },
          {
            type: "result",
            subtype: "success",
            is_error: false,
            num_turns: 41,
            total_cost_usd: 1.25,
            result: "Done.",
          },
        ),
        null,
      ),
    ).toEqual({
      status: "done",
      error: null,
      costUsd: 1.25,
      turns: 41,
      model: "claude-sonnet-5-5",
      answer: undefined,
    });
  });

  it("failed, with the client's words, when its result is an error or it printed none", () => {
    const limited = outcomeOf(
      "claude",
      claude({
        type: "result",
        subtype: "success",
        is_error: true,
        result: "Claude usage limit reached.",
      }),
      null,
    );
    expect(limited.status).toBe("failed");
    expect(limited.error).toBe("success: Claude usage limit reached.");
    const silent = outcomeOf("claude", "Error: not signed in\n", null);
    expect(silent.status).toBe("failed");
    expect(silent.error).toContain("Error: not signed in");
  });

  it("gives the judge's answer from Claude Code's structured output or its text, and from Codex's last message", () => {
    const answer = { verdicts: [] };
    expect(
      outcomeOf(
        "claude",
        claude({
          type: "result",
          subtype: "success",
          is_error: false,
          structured_output: answer,
        }),
        null,
      ).answer,
    ).toEqual(answer);
    expect(
      outcomeOf(
        "claude",
        claude({
          type: "result",
          subtype: "success",
          is_error: false,
          result: `Here it is:\n\`\`\`json\n${JSON.stringify(answer)}\n\`\`\``,
        }),
        null,
      ).answer,
    ).toEqual(answer);
    const codex = outcomeOf(
      "codex",
      `${JSON.stringify({ type: "turn.completed" })}\n`,
      JSON.stringify(answer),
    );
    expect(codex.status).toBe("done");
    expect(codex.answer).toEqual(answer);
    expect(
      outcomeOf(
        "codex",
        `${JSON.stringify({ type: "turn.failed", error: { message: "usage limit" } })}\n`,
        null,
      ),
    ).toMatchObject({ status: "failed", error: "usage limit" });
  });
});
