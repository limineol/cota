import { DateTime, Option, Redacted } from "effect";
import { PoolId } from "#shared/03-domain/ids.ts";
import type * as Pool from "#shared/03-domain/pool.entity.ts";

/** The clock when a constructed usage answer is read. */
export const readAt = DateTime.makeUnsafe("2026-11-13T10:00:00Z");

export const heldKey = "held-key-for-the-usage-endpoint-41c9";

/** A keyed pool of the given provider, holding `heldKey`, at the given base URL. */
export const keyedPool = (
  provider: string,
  baseUrl: string,
): Pool.KeyedPool => ({
  kind: "keyed",
  id: PoolId.make(provider),
  protocol: "openai-chat",
  provider,
  baseUrl,
  key: Option.some(Redacted.make(heldKey)),
  prices: Option.none(),
  ownPrices: {},
});

/**
 * Constructed, not recorded: no usage answer has been recorded. Follows the
 * prototype's reading of Z.ai's answer,
 * `dashboard/server/limits.ts` lines 46 to 66: `data.level` and the entries
 * of `data.limits`. Its windows are a 5-hour one whose exact counts disagree
 * with its rounded percentage, a week, Z.ai's `TIME_LIMIT` not yet started,
 * and an entry of a unit the reader does not know.
 */
export const zaiConstructed = {
  data: {
    level: "pro",
    limits: [
      {
        type: "TOKENS_LIMIT",
        unit: 3,
        number: 5,
        usage: 1000,
        currentValue: 333,
        percentage: 33,
        nextResetTime: 1794574800000,
      },
      {
        type: "TOKENS_LIMIT",
        unit: 6,
        number: 1,
        percentage: 12,
        nextResetTime: 1794873600000,
      },
      {
        type: "TIME_LIMIT",
        unit: 1,
        number: 30,
        usage: 4000,
        currentValue: 0,
        percentage: 0,
        nextResetTime: null,
      },
      { type: "TOKENS_LIMIT", unit: 2, number: 1, percentage: 50 },
    ],
  },
};

/**
 * Constructed, not recorded: no usage answer has been recorded. Follows the
 * prototype's reading of OpenCode Go's answer,
 * `dashboard/server/limits.ts` lines 68 to 84: `usage.rolling`, `.weekly`
 * and `.monthly`, the last not yet started.
 */
export const openCodeGoConstructed = {
  usage: {
    rolling: { percent: 41.5, resetsAt: "2026-11-13T12:30:00Z" },
    weekly: { percent: 18, resetsAt: "2026-11-16T00:00:00.000Z" },
    monthly: { percent: 7, resetsAt: null },
  },
};

/**
 * Constructed, not recorded: no usage answer has been recorded. Follows the
 * prototype's reading of Anthropic's undocumented answer,
 * `dashboard/server/limits.ts` lines 86 to 114 and `claude.ts` lines 92 to
 * 125: `five_hour`, `seven_day` (utilization a percentage) and the
 * `weekly_scoped` entries of `limits` with a model's display name; a field
 * the reader does not read, an entry without a name and one of another kind
 * beside them.
 */
export const anthropicConstructed = {
  five_hour: { utilization: 41, resets_at: "2026-11-13T13:00:00.000Z" },
  seven_day: { utilization: 12.5, resets_at: "2026-11-17T00:00:00Z" },
  seven_day_oauth_apps: null,
  limits: [
    {
      kind: "weekly_scoped",
      scope: { model: { display_name: "Claude Opus" } },
      percent: 30,
      resets_at: "2026-11-17T00:00:00Z",
    },
    {
      kind: "weekly_scoped",
      scope: { model: { display_name: "" } },
      percent: 99,
    },
    { kind: "daily", percent: 5 },
  ],
};

/**
 * Constructed, not recorded: no usage answer has been recorded. Follows the
 * prototype's reading of ChatGPT's undocumented answer,
 * `dashboard/server/limits.ts` lines 116 to 148 and `chatgpt.ts` lines 106
 * to 132: `plan_type`, the primary and secondary windows of `rate_limit`
 * (resets in Unix seconds), and an additional limit of one model, not yet
 * started, beside one with no name.
 */
export const chatGptConstructed = {
  plan_type: "pro",
  rate_limit: {
    primary_window: {
      used_percent: 22,
      limit_window_seconds: 18_000,
      reset_at: 1794574800,
    },
    secondary_window: {
      used_percent: 9,
      limit_window_seconds: 604_800,
      reset_at: 1794873600,
    },
  },
  additional_rate_limits: [
    {
      limit_name: "GPT-5.3-Codex-Spark",
      metered_feature: "codex_bengalfox",
      rate_limit: {
        primary_window: {
          used_percent: 3,
          limit_window_seconds: 18_000,
          reset_at: 0,
        },
        secondary_window: null,
      },
    },
    {
      limit_name: null,
      metered_feature: "",
      rate_limit: {
        primary_window: {
          used_percent: 80,
          limit_window_seconds: 3_600,
          reset_at: 1794574800,
        },
      },
    },
  ],
};

/** A subscription pool of the given protocol at the given base URL. */
export const subscriptionPool = (
  id: string,
  protocol: Pool.SubscriptionPool["protocol"],
  baseUrl = "https://provider.example",
): Pool.SubscriptionPool => ({
  kind: "subscription",
  id: PoolId.make(id),
  protocol,
  provider: protocol === "anthropic-messages" ? "anthropic" : "openai",
  baseUrl,
  keptLogin: Option.none(),
  fallback: Option.none(),
  prices: Option.none(),
  ownPrices: {},
});
