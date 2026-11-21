import { describe, expect, it } from "vitest";
import { evaluate } from "./evaluation.ts";
import { blocksRun, knownBlocks, scripted } from "./scripted.ts";
import { leftInClickHouse, makeWorld } from "./world.ts";

describe("the memory eval", () => {
  it("O9: The scripted answerer, taking each command from the skill's blocks, gives every question of the world its right verdict.", async () => {
    const world = await makeWorld();
    try {
      const evaluation = await evaluate({
        answerer: scripted,
        world,
        stop: new AbortController().signal,
        say: () => undefined,
      });
      expect(
        evaluation.asked
          .filter(({ verdict }) => verdict.kind !== "right")
          .map(({ question, verdict }) => ({ id: question.id, verdict })),
      ).toEqual([]);
      expect([...blocksRun].sort()).toEqual([...knownBlocks].sort());
    } finally {
      await world.remove();
    }
    expect(await leftInClickHouse()).toEqual([]);
    expect(
      Bun.spawnSync(["pgrep", "-f", world.directory]).stdout.toString(),
    ).toBe("");
  }, 600_000);
});
