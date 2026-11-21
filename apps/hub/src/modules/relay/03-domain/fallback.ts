import {
  Context,
  DateTime,
  Duration,
  Effect,
  HashMap,
  Layer,
  Option,
  Ref,
  Schema,
} from "effect";
import { LoginFingerprint, ModelId, PoolId } from "#shared/03-domain/ids.ts";

export const Policy = Schema.HashMap(PoolId, PoolId);
export type Policy = typeof Policy.Type;

export const Request = Schema.Struct({
  pool: PoolId,
  login: Schema.optionalKey(LoginFingerprint),
  model: ModelId,
});
export type Request = typeof Request.Type;

export const Refusal = Schema.Struct({
  login: LoginFingerprint,
  model: ModelId,
  reset: Schema.optionalKey(Schema.DateTimeUtc),
});
export type Refusal = typeof Refusal.Type;

export const Decision = Schema.TaggedUnion({
  Keep: {},
  Divert: { fallbackPool: PoolId, reset: Schema.DateTimeUtc },
});
export type Decision = typeof Decision.Type;

export class Fallback extends Context.Service<
  Fallback,
  {
    /**
     * Keeps a request on the pool it bills, or diverts it to that pool's
     * fallback pool while its login and model are parked (F1, F2, F4, F5).
     */
    readonly decide: (request: Request) => Effect.Effect<Decision>;
    /**
     * Parks the refusal's login and model until its reset, or for 15 minutes
     * from now when it gives none. A later reset already recorded stands, and
     * nothing else changes (F3, F6).
     */
    readonly record: (refusal: Refusal) => Effect.Effect<void>;
    /**
     * Gives the reset of a login and model parked now, and nothing once now
     * reaches it.
     */
    readonly parkedUntil: (
      login: LoginFingerprint,
      model: ModelId,
    ) => Effect.Effect<Option.Option<DateTime.Utc>>;
    /**
     * Drops every login and model whose reset is at or before now, which
     * changes no decision made at or after now (F7).
     */
    readonly forget: Effect.Effect<void>;
  }
>()("@cota/hub/relay/Fallback") {}

interface Parking {
  readonly login: LoginFingerprint;
  readonly model: ModelId;
}

const parkingWithoutReset = Duration.minutes(15);

const keep: Decision = { _tag: "Keep" };

export const layer = (policy: Policy): Layer.Layer<Fallback> =>
  Layer.effect(
    Fallback,
    Effect.gen(function* () {
      const parked = yield* Ref.make(HashMap.empty<Parking, DateTime.Utc>());

      const parkedUntil = Effect.fn("Fallback.parkedUntil")(function* (
        login: LoginFingerprint,
        model: ModelId,
      ): Effect.fn.Return<Option.Option<DateTime.Utc>> {
        const now = yield* DateTime.now;
        const reset = HashMap.get(yield* Ref.get(parked), { login, model });
        if (Option.isSome(reset) && DateTime.isGreaterThan(reset.value, now)) {
          return reset;
        }
        return Option.none();
      });

      const decide = Effect.fn("Fallback.decide")(function* (
        request: Request,
      ): Effect.fn.Return<Decision> {
        if (request.login === undefined) return keep;
        const fallbackPool = HashMap.get(policy, request.pool);
        if (Option.isNone(fallbackPool)) return keep;
        const reset = yield* parkedUntil(request.login, request.model);
        if (Option.isSome(reset)) {
          return {
            _tag: "Divert",
            fallbackPool: fallbackPool.value,
            reset: reset.value,
          };
        }
        return keep;
      });

      const record = Effect.fn("Fallback.record")(function* (refusal: Refusal) {
        const now = yield* DateTime.now;
        const parking = { login: refusal.login, model: refusal.model };
        const reset =
          refusal.reset ?? DateTime.addDuration(now, parkingWithoutReset);
        yield* Ref.update(parked, (parkings) => {
          const recorded = HashMap.get(parkings, parking);
          const until = Option.isSome(recorded)
            ? DateTime.max(recorded.value, reset)
            : reset;
          return HashMap.set(parkings, parking, until);
        });
      });

      const forget = Effect.gen(function* () {
        const now = yield* DateTime.now;
        yield* Ref.update(
          parked,
          HashMap.filter((reset) => DateTime.isGreaterThan(reset, now)),
        );
      }).pipe(Effect.withSpan("Fallback.forget"));

      return Fallback.of({ decide, record, parkedUntil, forget });
    }),
  );
