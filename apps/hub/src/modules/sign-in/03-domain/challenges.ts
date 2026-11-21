import {
  Context,
  DateTime,
  Duration,
  Effect,
  Layer,
  Option,
  Ref,
  Schema,
} from "effect";
import type { RelyingParty } from "./relying-party.ts";

/** A WebAuthn challenge as the browser gets it and signs it back: random bytes, written as base64url. */
export const Challenge = Schema.NonEmptyString.pipe(Schema.brand("Challenge"));
export type Challenge = typeof Challenge.Type;

/** What a challenge was issued for: making a passkey, or signing in with one. */
export type Purpose = "make-passkey" | "sign-in";

export interface Issued {
  readonly purpose: Purpose;
  readonly relyingParty: RelyingParty;
  readonly at: DateTime.Utc;
}

/** How long a challenge lasts after it is issued. */
export const lifetime = Duration.minutes(5);

/** How many challenges may be outstanding at once; issuing one more drops the oldest. */
export const mostOutstanding = 64;

interface Outstanding {
  readonly challenge: Challenge;
  readonly issued: Issued;
}

/** The challenges the hub issued and that are not yet used, in memory, for as long as it runs. */
export class Challenges extends Context.Service<
  Challenges,
  {
    /**
     * Keeps a challenge issued now for the purpose and relying party given.
     * Of more than `mostOutstanding` challenges, the oldest are dropped (I15).
     */
    readonly issue: (
      challenge: Challenge,
      purpose: Purpose,
      relyingParty: RelyingParty,
    ) => Effect.Effect<void>;
    /**
     * Uses a challenge: what it was issued for, while it lasts; none for one
     * not issued, used, expired or dropped (I15).
     */
    readonly take: (
      challenge: Challenge,
    ) => Effect.Effect<Option.Option<Issued>>;
  }
>()("@cota/hub/sign-in/Challenges") {}

/** Whether a challenge issued at `at` still lasts at `now`. */
const lasts = (at: DateTime.Utc, now: DateTime.Utc): boolean =>
  DateTime.isGreaterThan(DateTime.addDuration(at, lifetime), now);

export const layer: Layer.Layer<Challenges> = Layer.effect(
  Challenges,
  Effect.gen(function* () {
    const outstanding = yield* Ref.make<ReadonlyArray<Outstanding>>([]);
    return Challenges.of({
      issue: Effect.fn("Challenges.issue")(function* (
        challenge: Challenge,
        purpose: Purpose,
        relyingParty: RelyingParty,
      ) {
        const now = yield* DateTime.now;
        yield* Ref.update(outstanding, (all) =>
          [
            ...all.filter(({ issued }) => lasts(issued.at, now)),
            { challenge, issued: { purpose, relyingParty, at: now } },
          ].slice(-mostOutstanding),
        );
      }),
      take: Effect.fn("Challenges.take")(function* (challenge: Challenge) {
        const now = yield* DateTime.now;
        return yield* Ref.modify(
          outstanding,
          (
            all,
          ): readonly [Option.Option<Issued>, ReadonlyArray<Outstanding>] => {
            const found = all.find((each) => each.challenge === challenge);
            if (found === undefined) return [Option.none(), all];
            return [
              lasts(found.issued.at, now)
                ? Option.some(found.issued)
                : Option.none(),
              all.filter((each) => each !== found),
            ];
          },
        );
      }),
    });
  }),
);
