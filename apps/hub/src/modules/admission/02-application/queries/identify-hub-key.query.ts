import { Context, Effect, HashMap, Layer, Option } from "effect";
import { HubKeyHasher } from "#modules/admission/02-application/interfaces/hub-key-hasher.ts";
import type * as Admission from "#modules/admission/03-domain/admission.ts";
import * as HubKey from "#modules/admission/03-domain/hub-key.ts";

/** What a request to the hub's API presents that can be its hub key. */
export type Presented = Pick<HubKey.Candidates, "cotaKey" | "bearer">;

export class IdentifyHubKey extends Context.Service<
  IdentifyHubKey,
  {
    /**
     * Gives the name and scope the policy gives the hub key a request
     * presents, and nothing for a key it does not know or a request that
     * presents none (A6).
     */
    readonly execute: (
      presented: Presented,
    ) => Effect.Effect<Option.Option<Admission.HubKey>>;
  }
>()("@cota/hub/admission/IdentifyHubKey") {}

export const layer = (
  policy: Admission.Policy,
): Layer.Layer<IdentifyHubKey, never, HubKeyHasher> =>
  Layer.effect(
    IdentifyHubKey,
    Effect.gen(function* () {
      const hasher = yield* HubKeyHasher;
      const known = [...HashMap.keys(policy.hubKeys)];
      return IdentifyHubKey.of({
        // biome-ignore lint/correctness/useYield: Effect.fn takes a generator, and identifying needs nothing to yield.
        execute: Effect.fn("IdentifyHubKey.execute")(function* (
          presented: Presented,
        ) {
          const key = HubKey.presentedToApi(presented);
          if (Option.isNone(key)) return Option.none();
          const digest = hasher.match(known, key.value);
          if (Option.isNone(digest)) return Option.none();
          return HashMap.get(policy.hubKeys, digest.value);
        }),
      });
    }),
  );
