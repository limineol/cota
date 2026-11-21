import { DateTime, Option } from "effect";
import * as Quota from "#modules/quota/03-domain/quota.ts";
import type { QuotaReading } from "#modules/quota/03-domain/sources.ts";

/** A window as a provider gave it, before it is a `Quota.Window`. */
export interface Given {
  readonly lengthMs: number;
  readonly scope: Option.Option<string>;
  readonly used: number;
  /** Its reset, in Unix milliseconds; none when the provider gave none. */
  readonly resetMs: Option.Option<number>;
}

const spanOf = (lengthMs: number, resetMs: number): Option.Option<Quota.Span> =>
  Option.zipWith(
    DateTime.make(resetMs - lengthMs),
    DateTime.make(resetMs),
    (start, reset) => ({ start, reset }),
  );

/**
 * The quota reading of the windows a provider gave, in its order, observed
 * at `at`: a window whose length is not a whole number of milliseconds
 * above zero that the hub holds exactly is skipped, a percentage
 * is clamped to 0 to 100, a reset of 0 or less, or one whose span the hub
 * cannot hold, gives no span, and of two windows with one scope and length
 * the first is kept.
 */
export const readingOf = (
  given: ReadonlyArray<Given>,
  plan: Option.Option<string>,
  at: DateTime.Utc,
): QuotaReading => {
  const windows = new Map<string, Quota.Window>();
  for (const window of given) {
    const length = Quota.lengthOf(window.lengthMs);
    if (Option.isNone(length)) continue;
    const key = `${Option.getOrElse(window.scope, () => "")}\u0000${window.lengthMs}`;
    if (windows.has(key)) continue;
    const span = Option.flatMap(
      Option.filter(window.resetMs, (resetMs) => resetMs > 0),
      (resetMs) => spanOf(window.lengthMs, resetMs),
    );
    windows.set(key, {
      length: length.value,
      scope: window.scope,
      source: "reading",
      used: Math.min(100, Math.max(0, window.used)),
      ...(Option.isSome(span) ? { span: span.value } : {}),
      observedAt: at,
    });
  }
  return { windows: [...windows.values()], plan };
};
