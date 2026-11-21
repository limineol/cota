import { Context, Effect, HashMap, Layer, Option } from "effect";
import { HubKeyHasher } from "#modules/admission/02-application/interfaces/hub-key-hasher.ts";
import * as Admission from "#modules/admission/03-domain/admission.ts";
import * as HubKey from "#modules/admission/03-domain/hub-key.ts";
import type { PoolId } from "#shared/03-domain/ids.ts";

export type {
  Decision,
  Rejection,
} from "#modules/admission/03-domain/admission.ts";

/** What a request presents: the pool it names, and what can be its hub key. */
export interface Presented extends HubKey.Candidates {
  readonly pool: PoolId;
}

export class AdmitRequest extends Context.Service<
  AdmitRequest,
  {
    /**
     * Admits a request with a known hub key to a pool its scope opens, and
     * tells a request without a known hub key nothing about which pools exist
     * (A1 to A4).
     */
    readonly execute: (
      presented: Presented,
    ) => Effect.Effect<Admission.Decision>;
  }
>()("@cota/hub/admission/AdmitRequest") {}

export const layer = (
  policy: Admission.Policy,
): Layer.Layer<AdmitRequest, never, Admission.Admission | HubKeyHasher> =>
  Layer.effect(
    AdmitRequest,
    Effect.gen(function* () {
      const admission = yield* Admission.Admission;
      const hasher = yield* HubKeyHasher;
      const known = [...HashMap.keys(policy.hubKeys)];
      return AdmitRequest.of({
        execute: Effect.fn("AdmitRequest.execute")(function* (
          presented: Presented,
        ) {
          const key = HubKey.presented(
            presented,
            HashMap.get(policy.pools, presented.pool),
          );
          return yield* admission.decide(
            Option.match(key, {
              onNone: () => ({ pool: presented.pool }),
              onSome: (key) => ({
                pool: presented.pool,
                hubKey: Option.getOrElse(hasher.match(known, key), () =>
                  hasher.digest(key),
                ),
              }),
            }),
          );
        }),
      });
    }),
  );
