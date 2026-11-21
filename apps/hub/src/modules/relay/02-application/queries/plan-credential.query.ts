import { Context, Effect, HashMap, Layer, Option } from "effect";
import type * as Protocol from "#modules/relay/02-application/interfaces/protocol.ts";
import type * as Credential from "#modules/relay/03-domain/credential.ts";
import * as Fallback from "#modules/relay/03-domain/fallback.ts";
import type {
  LoginFingerprint,
  ModelId,
  PoolId,
} from "#shared/03-domain/ids.ts";
import type * as Pool from "#shared/03-domain/pool.entity.ts";

export class PlanCredential extends Context.Service<
  PlanCredential,
  {
    /**
     * Chooses the pool and the credential a request goes out with: a keyed
     * pool's held key, else the client's own credential, or the fallback
     * pool's kept login while `Fallback` diverts the login.
     */
    readonly execute: (
      pool: Pool.Pool,
      protocol: Protocol.Protocol,
      login: Option.Option<LoginFingerprint>,
      model: Option.Option<ModelId>,
    ) => Effect.Effect<Credential.Plan>;
  }
>()("@cota/hub/relay/PlanCredential") {}

export const layer = (
  pools: HashMap.HashMap<PoolId, Pool.Pool>,
): Layer.Layer<PlanCredential, never, Fallback.Fallback> =>
  Layer.effect(
    PlanCredential,
    Effect.gen(function* () {
      const fallback = yield* Fallback.Fallback;

      const diverted = (
        from: Pool.SubscriptionPool,
        decision: Fallback.Decision,
      ): Option.Option<Credential.Plan> => {
        if (decision._tag === "Keep") return Option.none();
        return Option.flatMap(
          HashMap.get(pools, decision.fallbackPool),
          (pool) =>
            pool.kind === "subscription" && Option.isSome(pool.keptLogin)
              ? Option.some({
                  pool,
                  credential: { _tag: "Kept", login: pool.keptLogin.value },
                  divertedFrom: Option.some(from.id),
                  onRefusal: Option.none(),
                })
              : Option.none(),
        );
      };

      return PlanCredential.of({
        execute: Effect.fn("PlanCredential.execute")(function* (
          pool: Pool.Pool,
          protocol: Protocol.Protocol,
          login: Option.Option<LoginFingerprint>,
          model: Option.Option<ModelId>,
        ): Effect.fn.Return<Credential.Plan> {
          if (pool.kind === "keyed") {
            return {
              pool,
              credential: { _tag: "Held", key: pool.key },
              divertedFrom: Option.none(),
              onRefusal: Option.none(),
            };
          }
          const kept: Credential.Plan = {
            pool,
            credential: { _tag: "Client" },
            divertedFrom: Option.none(),
            onRefusal: Option.none(),
          };
          if (
            Option.isNone(login) ||
            Option.isNone(model) ||
            protocol.refusal._tag === "FromBody"
          ) {
            return kept;
          }
          const request = {
            pool: pool.id,
            login: login.value,
            model: model.value,
          };
          const now = diverted(pool, yield* fallback.decide(request));
          if (Option.isSome(now)) return now.value;
          return {
            ...kept,
            onRefusal: Option.some({
              record: (refusal) =>
                fallback.record({
                  login: login.value,
                  model: model.value,
                  ...Option.match(refusal.reset, {
                    onNone: () => ({}),
                    onSome: (reset) => ({ reset }),
                  }),
                }),
              divert: Effect.map(fallback.decide(request), (decision) =>
                diverted(pool, decision),
              ),
            }),
          };
        }),
      });
    }),
  );
