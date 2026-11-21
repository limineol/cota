import { Arbitrary, DateTime, Option, Schema } from "effect";
import type { PricedRequest } from "#modules/request-log/02-application/interfaces/requests.repository.ts";
import { LoginFingerprint, PoolId } from "#shared/03-domain/ids.ts";
import type * as Pool from "#shared/03-domain/pool.entity.ts";
import * as Request from "#shared/03-domain/request.entity.ts";
import * as Harness from "#shared/05-tests/harness.ts";

export const int = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

export const pick = <const A extends readonly [unknown, ...Array<unknown>]>(
  values: A,
): Arbitrary.Arbitrary<A[number]> =>
  int(0, values.length - 1).pipe(
    Arbitrary.map((index): A[number] => values[index] ?? values[0]),
  );

/** When generated quota logs end: no request starts after it. */
export const now = DateTime.makeUnsafe("2026-11-13T12:00:00Z");
const nowMs = DateTime.toEpochMillis(now);

/** The step of the grid generated times fall on, so that a reset, a window's end and a look-back often land exactly on the clock. */
export const step = 30 * 60_000;

/** A pool of every kind and protocol. */
export const pools: ReadonlyArray<Pool.Pool> = [
  ...(
    [
      ["claude", "anthropic-messages"],
      ["max", "anthropic-messages"],
      ["codex", "chatgpt-codex"],
    ] as const
  ).map(
    ([id, protocol]): Pool.Pool => ({
      kind: "subscription",
      id: PoolId.make(id),
      protocol,
      provider: protocol === "anthropic-messages" ? "anthropic" : "openai",
      baseUrl: "https://provider.example",
      keptLogin: Option.none(),
      fallback: Option.none(),
      prices: Option.none(),
      ownPrices: {},
    }),
  ),
  ...(
    [
      ["console", "anthropic-messages"],
      ["zai", "openai-chat"],
    ] as const
  ).map(
    ([id, protocol]): Pool.Pool => ({
      kind: "keyed",
      id: PoolId.make(id),
      protocol,
      provider: id,
      baseUrl: "https://provider.example",
      key: Option.none(),
      prices: Option.none(),
      ownPrices: {},
    }),
  ),
];

/** A number of grid steps: mostly a few, so that times meet the clock, sometimes up to `most`. */
const stepsUpTo = (least: number, few: number, most: number) =>
  Arbitrary.all({
    near: Arbitrary.schema(Schema.Boolean),
    few: int(least, few),
    any: int(least, most),
  }).pipe(Arbitrary.map(({ near, few, any }) => (near ? few : any)));

/** Unix seconds on the grid around `now`, a second either side at times, as a provider writes a reset. */
const resetSeconds = Arbitrary.all({
  steps: stepsUpTo(-4, 16, 8 * 48),
  second: pick([0, 0, 0, -1, 1]),
}).pipe(
  Arbitrary.map(({ steps, second }) =>
    String((nowMs + steps * step) / 1000 + second),
  ),
);

/** A header's value: mostly the given good ones, sometimes one a reader must not take for a number. */
const sometimesBad = (good: Arbitrary.Arbitrary<string>) =>
  Arbitrary.all({
    good,
    kind: pick(["good", "good", "good", "good", "bad"]),
    bad: pick(["", " ", "abc", "1e3", "0x10", "-", "1.", "NaN"]),
  }).pipe(
    Arbitrary.map(({ good, kind, bad }) => (kind === "good" ? good : bad)),
  );

const reset = sometimesBad(
  Arbitrary.all({
    at: resetSeconds,
    edge: pick(["at", "at", "at", "0", "-3", " at "]),
  }).pipe(
    Arbitrary.map(({ at, edge }) =>
      edge === "at" ? at : edge === " at " ? ` ${at} ` : edge,
    ),
  ),
);

const fraction = sometimesBad(
  pick(["0", "0.41", "0.5", "0.57", "0.86", "1", " 0.07 ", "1.25", "-0.1"]),
);

const percent = sometimesBad(
  pick(["0", "41", "100", "12.5", " 7 ", "250", "-3", "99.99"]),
);

const minutes = sometimesBad(
  pick(["300", "10080", "10080", "0", "-60", "0.5", "43200"]),
);

const planType = pick([
  "pro",
  "plus",
  "prolite",
  "pro_lite",
  "free_workspace",
  "",
  "team",
  " pro ",
]);

type Shape = "complete" | "recorded" | "partial" | "empty";

const shape = pick([
  "complete",
  "complete",
  "recorded",
  "recorded",
  "partial",
  "empty",
]);

/** Some of the headers given, as the answer's shape says: all, the recorded ones, any, or none. */
const shaped = (
  headers: Record<string, string>,
  shape: Shape,
  recorded: ReadonlyArray<string>,
  kept: ReadonlyArray<boolean>,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(headers).filter(([name], index) =>
      shape === "complete"
        ? true
        : shape === "recorded"
          ? recorded.includes(name)
          : shape === "partial" && (kept[index] ?? false),
    ),
  );

const anthropic = Arbitrary.all({
  shape,
  kept: Arbitrary.array(Arbitrary.schema(Schema.Boolean), {
    minLength: 8,
    maxLength: 8,
  }),
  fiveHour: fraction,
  fiveHourReset: reset,
  sevenDay: fraction,
  sevenDayReset: reset,
  status: pick(["allowed", "allowed_warning", "rejected"]),
}).pipe(
  Arbitrary.map((generated) =>
    shaped(
      {
        "anthropic-ratelimit-unified-5h-utilization": generated.fiveHour,
        "anthropic-ratelimit-unified-5h-reset": generated.fiveHourReset,
        "anthropic-ratelimit-unified-7d-utilization": generated.sevenDay,
        "anthropic-ratelimit-unified-7d-reset": generated.sevenDayReset,
        "anthropic-ratelimit-unified-7d-status": generated.status,
        "anthropic-ratelimit-unified-status": generated.status,
        "anthropic-ratelimit-unified-reset": generated.sevenDayReset,
        "anthropic-ratelimit-unified-representative-claim": "seven_day",
      },
      generated.shape,
      [
        "anthropic-ratelimit-unified-7d-utilization",
        "anthropic-ratelimit-unified-7d-reset",
        "anthropic-ratelimit-unified-7d-status",
        "anthropic-ratelimit-unified-status",
        "anthropic-ratelimit-unified-reset",
        "anthropic-ratelimit-unified-representative-claim",
      ],
      generated.kept,
    ),
  ),
);

const codex = Arbitrary.all({
  shape,
  kept: Arbitrary.array(Arbitrary.schema(Schema.Boolean), {
    minLength: 9,
    maxLength: 9,
  }),
  primary: percent,
  primaryMinutes: minutes,
  primaryReset: reset,
  secondary: percent,
  secondaryMinutes: minutes,
  secondaryReset: reset,
  plan: planType,
}).pipe(
  Arbitrary.map((generated) => {
    const headers = {
      "x-codex-primary-used-percent": generated.primary,
      "x-codex-primary-window-minutes": generated.primaryMinutes,
      "x-codex-primary-reset-at": generated.primaryReset,
      "x-codex-secondary-used-percent": generated.secondary,
      "x-codex-secondary-window-minutes": generated.secondaryMinutes,
      "x-codex-secondary-reset-at": generated.secondaryReset,
      "x-codex-plan-type": generated.plan,
      "x-codex-active-limit": "premium",
      "x-codex-primary-reset-after-seconds": "0",
    };
    return generated.shape === "recorded"
      ? {
          ...headers,
          "x-codex-secondary-used-percent": "0",
          "x-codex-secondary-window-minutes": "0",
          "x-codex-secondary-reset-at": "",
        }
      : shaped(headers, generated.shape, [], generated.kept);
  }),
);

const openAiChat = pick([{}, {}, { "retry-after": "30" }]);

/** A time on the grid from eight days before `now` to `now`, a millisecond off at times, never after `now`. */
export const startedAt = Arbitrary.all({
  steps: stepsUpTo(0, 14, 8 * 48 + 2),
  nudge: pick([0, 0, 0, -1, 1]),
}).pipe(
  Arbitrary.map(({ steps, nudge }) =>
    DateTime.makeUnsafe(Math.min(nowMs, nowMs - steps * step + nudge)),
  ),
);

const seed = Arbitrary.all({
  pool: int(0, pools.length - 1),
  at: startedAt,
  anthropic,
  codex,
  openAiChat,
  login: pick([true, true, false]),
  operation: pick([
    "messages",
    "messages",
    "messages",
    "count_tokens",
    "models",
  ]),
  outcome: pick(["ok", "ok", "ok", "error", "refused", "cancelled"]),
});

const hex = (value: number, digits: number) =>
  value.toString(16).padStart(digits, "0");

/**
 * A generated request log of the pools above whose answers carry quota
 * headers in their protocol's names: complete, as recorded (Anthropic's
 * without the 5-hour window, Codex's with no secondary), partial, malformed
 * and empty, on refusals and failures too, with and without a login.
 */
export const quotaLog = (maxLength: number) =>
  Arbitrary.array(seed, {
    minLength: Math.floor(maxLength / 2),
    maxLength,
  }).pipe(
    Arbitrary.map((seeds) =>
      seeds.map((generated, index): PricedRequest => {
        const pool = pools[generated.pool] ?? pools[0];
        const protocol = pool?.protocol ?? "anthropic-messages";
        const at = hex(DateTime.toEpochMillis(generated.at), 12);
        return {
          request: Harness.requestOf({
            id: Request.RequestId.make(
              `${at.slice(0, 8)}-${at.slice(8)}-7${hex(index, 3)}-8${hex(index, 3)}-${hex(index, 12)}`,
            ),
            startedAt: generated.at,
            pool: pool?.id ?? PoolId.make("claude"),
            protocol,
            provider: pool?.provider ?? "anthropic",
            operation: generated.operation,
            outcome: generated.outcome,
            loginFingerprint: generated.login
              ? Option.some(
                  LoginFingerprint.make(`fingerprint-${generated.pool}`),
                )
              : Option.none(),
            rateLimits:
              protocol === "anthropic-messages"
                ? generated.anthropic
                : protocol === "chatgpt-codex"
                  ? generated.codex
                  : generated.openAiChat,
          }),
          cost: Option.none(),
        };
      }),
    ),
  );
