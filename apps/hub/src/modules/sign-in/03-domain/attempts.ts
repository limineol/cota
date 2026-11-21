import {
  Context,
  DateTime,
  Duration,
  Effect,
  Layer,
  Ref,
  Schema,
} from "effect";

/** How many wrong passwords, setup codes and current passwords within `window` reach the attempt limit. */
export const limit = 10;

export const window = Duration.minutes(10);

/** How long after its request arrived a wrong password or setup code is answered, at the least (I8). */
export const wrongGuessDelay = Duration.seconds(1);

export class TooManyAttempts extends Schema.TaggedError<
  TooManyAttempts,
  { readonly brand: unique symbol }
>()("TooManyAttempts", {
  retryAfterSeconds: Schema.Int.check(Schema.isGreaterThan(0)),
}) {}

export class WrongPassword extends Schema.TaggedError<
  WrongPassword,
  { readonly brand: unique symbol }
>()("WrongPassword", {}) {}

interface Place {
  readonly at: DateTime.Utc;
}

type Outcome =
  | { readonly _tag: "Taken" }
  | { readonly _tag: "Limited"; readonly until: DateTime.Utc };

/** The attempts of the whole hub to give a secret it compares, counted in memory since it started. */
export class Attempts extends Context.Service<
  Attempts,
  {
    /**
     * Compares what an attempt gives with `matches`, and counts it when it is
     * wrong: it takes a place in the count before the comparison starts, and
     * gives it back when it was right, so attempts compared at once cannot
     * pass the limit. Once `limit` places fall within the last `window`, it
     * fails with `TooManyAttempts` without comparing, until the oldest of
     * them is `window` old (I7).
     */
    readonly compare: <E, R>(
      matches: Effect.Effect<boolean, E, R>,
    ) => Effect.Effect<boolean, TooManyAttempts | E, R>;
  }
>()("@cota/hub/sign-in/Attempts") {}

const oldestOf = (places: ReadonlyArray<Place>): DateTime.Utc =>
  places.map(({ at }) => at).reduce((oldest, at) => DateTime.min(oldest, at));

/** Fails with `wrong` no sooner than `wrongGuessDelay` after `began`, when its request arrived (I8). */
export const failAfterTheDelay = Effect.fn("Attempts.failAfterTheDelay")(
  function* <E>(began: DateTime.Utc, wrong: E) {
    const answerAt = DateTime.addDuration(began, wrongGuessDelay);
    const now = yield* DateTime.now;
    const wait = DateTime.toEpochMillis(answerAt) - DateTime.toEpochMillis(now);
    if (wait > 0) yield* Effect.sleep(Duration.millis(wait));
    return yield* Effect.fail(wrong);
  },
);

export const layer: Layer.Layer<Attempts> = Layer.effect(
  Attempts,
  Effect.gen(function* () {
    const places = yield* Ref.make<ReadonlyArray<Place>>([]);
    return Attempts.of({
      compare: Effect.fn("Attempts.compare")(function* <E, R>(
        matches: Effect.Effect<boolean, E, R>,
      ) {
        const now = yield* DateTime.now;
        const since = DateTime.subtractDuration(now, window);
        const place: Place = { at: now };
        const outcome = yield* Ref.modify(
          places,
          (all): readonly [Outcome, ReadonlyArray<Place>] => {
            const recent = all.filter(({ at }) =>
              DateTime.isGreaterThan(at, since),
            );
            if (recent.length >= limit) {
              return [
                {
                  _tag: "Limited",
                  until: DateTime.addDuration(oldestOf(recent), window),
                },
                recent,
              ];
            }
            return [{ _tag: "Taken" }, [...recent, place]];
          },
        );
        if (outcome._tag === "Limited") {
          const remaining =
            DateTime.toEpochMillis(outcome.until) - DateTime.toEpochMillis(now);
          return yield* new TooManyAttempts({
            retryAfterSeconds: Math.ceil(remaining / 1000),
          });
        }
        const right = yield* matches;
        if (right) {
          yield* Ref.update(places, (all) =>
            all.filter((each) => each !== place),
          );
        }
        return right;
      }),
    });
  }),
);
