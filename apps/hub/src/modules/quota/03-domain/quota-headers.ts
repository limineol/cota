import { DateTime, Duration, Option } from "effect";
import type { ProtocolName } from "#shared/03-domain/protocol-name.ts";
import * as Plan from "./plan.ts";
import { lengthOf, type Span, type Window } from "./quota.ts";

/** A pool's latest answer whose quota headers hold a name: when its request started, and all its quota headers. */
export interface Answer {
  readonly startedAt: DateTime.Utc;
  readonly headers: Readonly<Record<string, string>>;
}

type Headers = Answer["headers"];

/** One window a protocol's quota headers give: the header of its percentage, of its reset, and its length. */
interface HeaderWindow {
  readonly percentage: string;
  /** Whether the percentage is sent as a fraction of 1. */
  readonly fraction: boolean;
  readonly reset: string;
  readonly lengthMs: (headers: Headers) => Option.Option<number>;
}

const fixed = (length: Duration.Duration) => () =>
  Option.some(Duration.toMillis(length));

const minutesIn = (name: string) => (headers: Headers) =>
  Option.map(numberIn(headers, name), (minutes) =>
    Math.floor(Number(minutes) * 60_000),
  );

const codexWindow = (which: "primary" | "secondary"): HeaderWindow => ({
  percentage: `x-codex-${which}-used-percent`,
  fraction: false,
  reset: `x-codex-${which}-reset-at`,
  lengthMs: minutesIn(`x-codex-${which}-window-minutes`),
});

/** The windows each protocol's quota headers give, in the order of the quota sources spec's table. */
const windows: Readonly<Record<ProtocolName, ReadonlyArray<HeaderWindow>>> = {
  "anthropic-messages": [
    {
      percentage: "anthropic-ratelimit-unified-5h-utilization",
      fraction: true,
      reset: "anthropic-ratelimit-unified-5h-reset",
      lengthMs: fixed(Duration.hours(5)),
    },
    {
      percentage: "anthropic-ratelimit-unified-7d-utilization",
      fraction: true,
      reset: "anthropic-ratelimit-unified-7d-reset",
      lengthMs: fixed(Duration.days(7)),
    },
  ],
  "chatgpt-codex": [codexWindow("primary"), codexWindow("secondary")],
  "openai-chat": [],
};

const planHeader = "x-codex-plan-type";

/** The quota headers a pool's latest answers are asked for: each window's percentage header, and the plan's. */
export const namesOf = (protocol: ProtocolName): ReadonlyArray<string> => [
  ...windows[protocol].map(({ percentage }) => percentage),
  ...(protocol === "chatgpt-codex" ? [planHeader] : []),
];

const decimal = /^-?[0-9]+(\.[0-9]+)?$/;

/** A header's value, trimmed, when it is a decimal number; none for any other value or none. */
const numberIn = (headers: Headers, name: string): Option.Option<string> => {
  const value = headers[name]?.trim();
  return value !== undefined && decimal.test(value)
    ? Option.some(value)
    : Option.none();
};

const finite = (value: number): Option.Option<number> =>
  Number.isFinite(value) ? Option.some(value) : Option.none();

const percentageOf = (
  rule: HeaderWindow,
  headers: Headers,
): Option.Option<number> =>
  Option.map(
    Option.flatMap(numberIn(headers, rule.percentage), (value) =>
      finite(Number(rule.fraction ? `${value}e2` : value)),
    ),
    (percentage) => Math.min(100, Math.max(0, percentage)),
  );

const spanOf = (
  rule: HeaderWindow,
  headers: Headers,
  lengthMs: number,
): Option.Option<Span> =>
  Option.flatMap(numberIn(headers, rule.reset), (value) => {
    const resetMs = Math.floor(Number(value) * 1000);
    if (!(resetMs > 0)) return Option.none();
    return Option.zipWith(
      DateTime.make(resetMs - lengthMs),
      DateTime.make(resetMs),
      (start, reset) => ({ start, reset }),
    );
  });

/** The window one answer's headers give under a rule: its percentage, reset and length all from that answer. */
const windowOf = (
  rule: HeaderWindow,
  answer: Answer,
): Option.Option<Window> => {
  const used = percentageOf(rule, answer.headers);
  const length = Option.flatMap(rule.lengthMs(answer.headers), lengthOf);
  if (Option.isNone(used) || Option.isNone(length)) return Option.none();
  const span = spanOf(rule, answer.headers, Duration.toMillis(length.value));
  return Option.some({
    length: length.value,
    scope: Option.none(),
    source: "headers",
    used: used.value,
    ...(Option.isSome(span) ? { span: span.value } : {}),
    observedAt: answer.startedAt,
  });
};

/**
 * The windows and the plan a pool's quota headers give, from the latest
 * answer that holds each name `namesOf` asks for: each window from the one
 * answer that holds its percentage header (W5), in the table's order.
 */
export const observe = (
  protocol: ProtocolName,
  latest: ReadonlyMap<string, Answer>,
): {
  readonly windows: ReadonlyArray<Window>;
  readonly plan: Option.Option<string>;
} => ({
  windows: windows[protocol].flatMap((rule) =>
    Option.toArray(
      Option.flatMap(
        Option.fromUndefinedOr(latest.get(rule.percentage)),
        (answer) => windowOf(rule, answer),
      ),
    ),
  ),
  plan:
    protocol === "chatgpt-codex"
      ? Option.flatMap(
          Option.fromUndefinedOr(latest.get(planHeader)),
          (answer) => Plan.chatGpt(answer.headers[planHeader]?.trim() ?? ""),
        )
      : Option.none(),
});
