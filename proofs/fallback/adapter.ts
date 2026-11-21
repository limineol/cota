import type { Decision, Policy, Refusal, Request } from "@cota/hub/fallback";
import type { LoginFingerprint, ModelId, PoolId } from "@cota/hub/ids";
import { DateTime, Option } from "effect";
import type * as Model from "./model.mjs";
import compiled from "./model.mjs";

const largestNat = 2 ** 48 - 1;

const natOf = (time: DateTime.Utc): Model.Nat => {
  const millis = DateTime.toEpochMillis(time);
  if (millis < 0 || millis > largestNat) {
    throw new RangeError(`the model holds no time at ${millis} ms`);
  }
  return millis;
};

const maybe = <A, B>(
  value: A | undefined,
  f: (value: A) => B,
): Model.Maybe<B> =>
  value === undefined ? { $: "None" } : { $: "Some", value: f(value) };

const listOf = <A>(items: ReadonlyArray<A>): Model.List<A> =>
  items.reduceRight<Model.List<A>>((tail, head) => ({ $: "Con", head, tail }), {
    $: "Nil",
  });

const interner = <Id extends string>() => {
  const ids: Array<Id> = [];
  return {
    nat: (id: Id): Model.Nat => {
      const known = ids.indexOf(id);
      return known === -1 ? ids.push(id) - 1 : known;
    },
    id: (nat: Model.Nat): Id => {
      const id = ids[nat];
      if (id === undefined) {
        throw new RangeError(
          `the model answered ${nat}, which it was not given`,
        );
      }
      return id;
    },
  };
};

export interface Recorded {
  readonly refusal: Refusal;
  readonly recordedAt: DateTime.Utc;
}

export const afterHistory = (
  policy: Policy,
  history: ReadonlyArray<Recorded>,
) => {
  const pools = interner<PoolId>();
  const logins = interner<LoginFingerprint>();
  const models = interner<ModelId>();
  const fallbacks = listOf(
    [...policy].map(
      ([pool, fallback]): Model.Fallback => ({
        $: "Fallback",
        pool: pools.nat(pool),
        fallback: pools.nat(fallback),
      }),
    ),
  );
  const parked = history.reduce(
    (parked, { refusal, recordedAt }) =>
      compiled.record(parked, {
        $: "Refusal",
        login: logins.nat(refusal.login),
        model: models.nat(refusal.model),
        refused_at: natOf(recordedAt),
        reset: maybe(refusal.reset, natOf),
      }),
    compiled.empty(),
  );

  return {
    decide: (request: Request, now: DateTime.Utc): Decision => {
      const decision = compiled.decide(
        fallbacks,
        parked,
        {
          $: "Request",
          pool: pools.nat(request.pool),
          login: maybe(request.login, logins.nat),
          model: models.nat(request.model),
        },
        natOf(now),
      );
      if (decision.$ === "Keep") return { _tag: "Keep" };
      return {
        _tag: "Divert",
        fallbackPool: pools.id(decision.pool),
        reset: DateTime.makeUnsafe(decision.reset),
      };
    },
    parkedUntil: (
      login: LoginFingerprint,
      model: ModelId,
      now: DateTime.Utc,
    ): Option.Option<DateTime.Utc> => {
      const reset = compiled.parkedUntil(
        parked,
        logins.nat(login),
        models.nat(model),
        natOf(now),
      );
      return reset.$ === "None"
        ? Option.none()
        : Option.some(DateTime.makeUnsafe(reset.value));
    },
  };
};
