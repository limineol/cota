import { DateTime, Duration, Effect } from "effect";

/** How far behind the hub's clock a reported through may be before it is late (`docs/specs/reported-requests/spec.md`, Late: decided by default). */
export const lateAfter = Duration.minutes(5);

/** Whether a reported through is more than `lateAfter` behind the hub's clock now. */
export const isLate = Effect.fn("ReportedThrough.isLate")(function* (
  through: DateTime.Utc,
): Effect.fn.Return<boolean> {
  const now = yield* DateTime.now;
  return Duration.isGreaterThan(DateTime.distance(through, now), lateAfter);
});
