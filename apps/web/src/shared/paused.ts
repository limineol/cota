import { Clock, Effect, Schema } from "effect";
import type { HttpClientResponse } from "effect/http";
import { useLayoutEffect, useState } from "react";

const RetryAfter = Schema.NumberFromString.check(
  Schema.isInt(),
  Schema.isGreaterThan(0),
);

/** When a 429's pause ends: now, and the `retry-after` it carries in whole seconds. */
export const pausedUntil = (response: HttpClientResponse.HttpClientResponse) =>
  Effect.gen(function* () {
    const seconds = yield* Schema.decodeUnknownEffect(RetryAfter)(
      response.headers["retry-after"],
    );
    const now = yield* Clock.currentTimeMillis;
    return now + seconds * 1000;
  });

const timeOfDay = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

/** The time of day a pause ends, as the sign-in screen writes it. */
export const untilText = (until: number) => timeOfDay.format(until);

/** The time now, read each second while `ticking`, as while a pause runs out. */
export const useNowWhile = (ticking: boolean) => {
  const [now, setNow] = useState(Date.now);
  useLayoutEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  return now;
};
