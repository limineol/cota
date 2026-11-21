import { describe, expect, it } from "vitest";
import { problemsOf, rowsOf, testsOf } from "./laws.ts";

const spec = [
  "| Id | Law | Held by |",
  "| --- | --- | --- |",
  "| L1 | **Splitting.** Joining gives the same value. | property, replay |",
  "| R4 | **Pools.** A pool has one provider. | types |",
  "Not a law.",
].join("\n");

const outcomes = [
  {
    file: "apps/hub/src/modules/request-log/02-application/request-log.laws.test.ts",
    title: "L1: Joining gives the same value.",
    status: "passed",
  },
  {
    file: "apps/hub/src/shared/05-tests/replay/replay.test.ts",
    title: "L1: Joining gives the same value. Replayed.",
    status: "passed",
  },
  {
    file: "apps/hub/src/shared/05-tests/replay/replay.test.ts",
    title: "replays every exchange",
    status: "passed",
  },
  {
    file: "apps/hub/src/modules/request-log/04-infrastructure/persistence/clickhouse/tables.clickhouse.test.ts",
    title: "L1: Joining gives the same value. Against ClickHouse.",
    status: "passed",
  },
  {
    file: "apps/hub/src/api.contract.test.ts",
    title: "L1: Joining gives the same value. Over the API.",
    status: "passed",
  },
  {
    file: "deploy/deployment.slow.test.ts",
    title: "L1: Joining gives the same value. Deployed.",
    status: "passed",
  },
  {
    file: "apps/hub/src/modules/relay/01-presentation/relay.test.ts",
    title: "L12: another law",
    status: "passed",
  },
];

describe("laws", () => {
  it("reads each law's row and the tiers it claims", () => {
    expect(rowsOf(spec)).toEqual([
      {
        id: "L1",
        sentence: "Joining gives the same value.",
        claims: ["property", "replay"],
      },
      { id: "R4", sentence: "A pool has one provider.", claims: ["types"] },
    ]);
  });

  it("counts a test in a replay file only for the replay tier, one in a contract file only for the contract tier, one in a ClickHouse file only for the clickhouse tier, one in a slow file only for the slow tier, and any other only for the property tier", () => {
    expect(
      (["property", "replay", "contract", "clickhouse", "slow"] as const).map(
        (tier) => testsOf("L1", tier, outcomes).map(({ file }) => file),
      ),
    ).toEqual([
      [
        "apps/hub/src/modules/request-log/02-application/request-log.laws.test.ts",
      ],
      ["apps/hub/src/shared/05-tests/replay/replay.test.ts"],
      ["apps/hub/src/api.contract.test.ts"],
      [
        "apps/hub/src/modules/request-log/04-infrastructure/persistence/clickhouse/tables.clickhouse.test.ts",
      ],
      ["deploy/deployment.slow.test.ts"],
    ]);
  });

  it("finds nothing wrong with a law whose every claimed tier passed", () => {
    expect(
      problemsOf(
        { id: "L1", sentence: "", claims: ["property", "replay"] },
        { property: "passed, 1 test", replay: "passed, 1 test" },
      ),
    ).toEqual([]);
  });

  it("fails a law held by a tier verify does not know", () => {
    expect(
      problemsOf(
        { id: "L1", sentence: "", claims: ["property", "replays"] },
        { property: "passed, 1 test" },
      ),
    ).toEqual([
      'L1 is held by "replays", which is not a tier (types, property, replay, contract, clickhouse, slow, proof, agreement)',
    ]);
  });

  it("fails a law whose replay tier has only property tests, and the reverse", () => {
    const onlyProperty = { property: "passed, 1 test" };
    const onlyReplay = { replay: "passed, 1 test" };
    expect(
      problemsOf({ id: "L1", sentence: "", claims: ["replay"] }, onlyProperty),
    ).toEqual(["L1 has no replay tier, though its spec says so"]);
    expect(
      problemsOf({ id: "L1", sentence: "", claims: ["property"] }, onlyReplay),
    ).toEqual(["L1 has no property tier, though its spec says so"]);
  });

  it("fails a law whose claimed tier ran and failed", () => {
    expect(
      problemsOf(
        { id: "L1", sentence: "", claims: ["replay"] },
        { replay: "failed, 2 tests" },
      ),
    ).toEqual(["L1's replay tier failed: failed, 2 tests"]);
  });
});
