import { describe, expect, it } from "@effect/vitest";
import { Duration, Option } from "effect";
import * as QuotaLog from "#modules/quota/05-tests/quota-log.ts";
import * as UsageAnswers from "#modules/quota/05-tests/usage-answers.ts";
import type * as Pool from "#shared/03-domain/pool.entity.ts";
import * as Readers from "./readers.ts";

describe("which pool has which quota reader", () => {
  it("reads a keyed Z.ai or OpenCode Go pool that holds a key with that key every 60 seconds, and no other pool", () => {
    const zai = UsageAnswers.keyedPool(
      "zai",
      "https://api.z.ai/api/coding/paas/v4",
    );
    const go = UsageAnswers.keyedPool(
      "opencode-go",
      "https://opencode.ai/zen/go/v1",
    );
    const readerOf = (pool: Pool.Pool) =>
      Option.map(Readers.readerOf(pool, Option.none()), ({ name, period }) => ({
        name,
        periodMs: Duration.toMillis(period),
      }));
    expect([
      readerOf(zai),
      readerOf(go),
      readerOf({ ...zai, key: Option.none() }),
      readerOf({ ...zai, provider: "openrouter" }),
      ...QuotaLog.pools.map(readerOf),
    ]).toEqual([
      Option.some({ name: "zai", periodMs: 60_000 }),
      Option.some({ name: "opencode-go", periodMs: 60_000 }),
      ...Array.from({ length: 2 + QuotaLog.pools.length }, () => Option.none()),
    ]);
  });
});
