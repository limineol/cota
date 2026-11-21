import { DateTime, Duration, Effect, Option, Schema } from "effect";

export const Length = Schema.Duration.check(
  Schema.makeFilter(
    (length) =>
      (Duration.isFinite(length) && Duration.isPositive(length)) ||
      "a length is finite and longer than zero",
  ),
).pipe(Schema.brand("Length"));
export type Length = typeof Length.Type;

/** The length of a window of `ms` milliseconds, when that is a whole number above zero the hub holds exactly; none for any other number. */
export const lengthOf = (ms: number): Option.Option<Length> =>
  Number.isSafeInteger(ms) && ms > 0
    ? Option.some(Length.make(Duration.millis(ms)))
    : Option.none();

export const Percentage = Schema.Finite.check(
  Schema.isBetween({ minimum: 0, maximum: 100 }),
);
export type Percentage = typeof Percentage.Type;

export const Span = Schema.Struct({
  start: Schema.DateTimeUtc,
  reset: Schema.DateTimeUtc,
}).check(
  Schema.makeFilter(
    (span) =>
      DateTime.isLessThan(span.start, span.reset) ||
      "a span starts before it resets",
  ),
);
export type Span = typeof Span.Type;

/** What a window's allowance covers: none for the whole plan, else the provider's name for a model or a feature. */
const WindowScope = Schema.Option(Schema.NonEmptyString);

export const WindowSource = Schema.Literals(["reading", "headers"]);
export type WindowSource = typeof WindowSource.Type;

export const Window = Schema.Struct({
  length: Length,
  scope: WindowScope,
  source: WindowSource,
  used: Percentage,
  span: Schema.optionalKey(Span),
  observedAt: Schema.DateTimeUtc,
});
export type Window = typeof Window.Type;

export const Pace = Schema.TaggedUnion({
  Full: {},
  OnPace: {},
  InReserve: { points: Schema.Finite },
  AheadOfPace: {
    points: Schema.Finite,
    emptiesIn: Schema.optionalKey(Schema.Duration),
  },
});
export type Pace = typeof Pace.Type;

export const Standing = Schema.TaggedUnion({
  Unplaced: {},
  Placed: { elapsed: Schema.Finite, resetsIn: Schema.Duration, pace: Pace },
});
export type Standing = typeof Standing.Type;

const onPaceBand = 2;

/**
 * Says where a window stands now: the share of its span elapsed, the time
 * until it resets, and its pace (Q1, Q3 and Q4).
 */
export const standing = Effect.fn("Quota.standing")(function* (
  window: Window,
): Effect.fn.Return<Standing> {
  if (window.span === undefined) return { _tag: "Unplaced" };
  const now = yield* DateTime.now;
  const { start, reset } = window.span;
  const sinceStart = nonNegative(DateTime.distance(start, now));
  const resetsIn = nonNegative(DateTime.distance(now, reset));
  const elapsed = Math.min(
    Duration.toMillis(sinceStart) /
      Duration.toMillis(DateTime.distance(start, reset)),
    1,
  );
  return {
    _tag: "Placed",
    elapsed,
    resetsIn,
    pace: pace(window.used, elapsed, sinceStart),
  };
});

const pace = (
  used: Percentage,
  elapsed: number,
  sinceStart: Duration.Duration,
): Pace => {
  if (used === 100) return { _tag: "Full" };
  const lead = used - elapsed * 100;
  if (Math.abs(lead) < onPaceBand) return { _tag: "OnPace" };
  if (lead < 0) return { _tag: "InReserve", points: -lead };
  if (Duration.isZero(sinceStart)) return { _tag: "AheadOfPace", points: lead };
  return {
    _tag: "AheadOfPace",
    points: lead,
    emptiesIn: Duration.times(sinceStart, (100 - used) / used),
  };
};

const nonNegative = (duration: Duration.Duration): Duration.Duration =>
  Duration.max(duration, Duration.zero);
