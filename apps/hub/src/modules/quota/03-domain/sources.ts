import { DateTime, Duration, Effect, Option } from "effect";
import { compareText } from "#shared/03-domain/text.ts";
import type * as Quota from "./quota.ts";

/** How far back the quota headers of a pool's answers are read. */
export const headersFor = Duration.days(7);

/** A pool's last good quota reading, as the rules take it: the windows and the plan a quota reader got. */
export interface QuotaReading {
  readonly windows: ReadonlyArray<Quota.Window>;
  readonly plan: Option.Option<string>;
}

/** What a pool's windows and plan are worked out from. */
export interface Sources {
  /** Its last good quota reading; none for a pool the hub does not read, or has not read. */
  readonly reading: Option.Option<QuotaReading>;
  /** What its quota headers give (`QuotaHeaders.observe`). */
  readonly headers: {
    readonly windows: ReadonlyArray<Quota.Window>;
    readonly plan: Option.Option<string>;
  };
  /** The plan its Claude quota login's plan facts name, kept or expired. */
  readonly loginPlan: Option.Option<string>;
}

/** A pool's quota as the quota API answers it. */
export interface PoolQuota {
  readonly windows: ReadonlyArray<Quota.Window>;
  readonly plan: Option.Option<string>;
  /** When its latest window was observed. */
  readonly observedAt: Option.Option<DateTime.Utc>;
}

const keyOf = (window: Quota.Window): string =>
  `${Option.getOrElse(window.scope, () => "")}\u0000${Duration.toMillis(window.length)}`;

/** A window resets after now, or, without a reset, was observed less than its length before now. */
const isCurrentAt =
  (now: DateTime.Utc) =>
  (window: Quota.Window): boolean =>
    window.span !== undefined
      ? DateTime.isGreaterThan(window.span.reset, now)
      : DateTime.toEpochMillis(now) -
          DateTime.toEpochMillis(window.observedAt) <
        Duration.toMillis(window.length);

const byScopeThenLength = (one: Quota.Window, other: Quota.Window): number =>
  Number(Option.isSome(one.scope)) - Number(Option.isSome(other.scope)) ||
  compareText(
    Option.getOrElse(one.scope, () => ""),
    Option.getOrElse(other.scope, () => ""),
  ) ||
  Duration.toMillis(one.length) - Duration.toMillis(other.length);

/**
 * A pool's windows at now: of the current windows its quota reading and
 * quota headers give, the one observed last for each scope and length, the
 * reading's on a tie (W1); the plan's first, then by scope, and within a
 * scope shortest first. Its plan is its quota login's, else its reading's,
 * else its headers'.
 *
 * ChatGPT's and Claude's $100 and $200 plans may no longer have a 5-hour
 * window, so a window is never estimated: a pool shows only the windows its
 * provider reports.
 */
export const quotaOf = Effect.fn("Sources.quotaOf")(function* (
  sources: Sources,
): Effect.fn.Return<PoolQuota> {
  const now = yield* DateTime.now;
  const kept = new Map<string, Quota.Window>();
  const observed = [
    ...Option.match(sources.reading, {
      onNone: () => [],
      onSome: ({ windows }) => windows,
    }),
    ...sources.headers.windows,
  ].filter(isCurrentAt(now));
  for (const window of observed) {
    const held = kept.get(keyOf(window));
    if (
      held === undefined ||
      DateTime.isGreaterThan(window.observedAt, held.observedAt)
    ) {
      kept.set(keyOf(window), window);
    }
  }
  const windows = [...kept.values()];
  const latest = windows
    .map(({ observedAt }) => observedAt)
    .reduce<Option.Option<DateTime.Utc>>(
      (best, at) =>
        Option.isSome(best) && DateTime.isGreaterThanOrEqualTo(best.value, at)
          ? best
          : Option.some(at),
      Option.none(),
    );
  return {
    windows: windows.sort(byScopeThenLength),
    plan: sources.loginPlan.pipe(
      Option.orElse(() => Option.flatMap(sources.reading, ({ plan }) => plan)),
      Option.orElse(() => sources.headers.plan),
    ),
    observedAt: latest,
  };
});
