import { describe, expect, it } from "vitest";
import { evaluate } from "./evaluation.ts";
import { rehearsal } from "./rehearsal.ts";
import { tasks } from "./tasks.ts";

const docker = (...args: ReadonlyArray<string>) =>
  Bun.spawnSync(["docker", ...args], { stdout: "pipe", stderr: "pipe" })
    .stdout.toString()
    .trim();

describe("the install eval", () => {
  it("the rehearsal follows the install prompt in a clean world to an install that passes every criterion, and leaves nothing of the world behind", async () => {
    const [task] = tasks;
    if (task === undefined) throw new Error("no task");
    const lines: Array<string> = [];
    const run = await evaluate({
      task,
      installer: rehearsal(task),
      say: (line) => lines.push(line),
    });
    const project = `cota-install-${run.id}`;
    expect({
      error: run.error,
      failed: run.verdicts.filter(({ passed }) => !passed),
    }).toEqual({ error: null, failed: [] });
    expect(run.passed).toBe(true);
    expect(
      docker(
        "ps",
        "--all",
        "--quiet",
        "--filter",
        `label=com.docker.compose.project=${project}`,
      ),
    ).toBe("");
    expect(
      docker("network", "ls", "--quiet", "--filter", `name=${project}`),
    ).toBe("");
    expect(
      docker("volume", "ls", "--quiet", "--filter", `name=${project}`),
    ).toBe("");
  }, 900_000);
});
