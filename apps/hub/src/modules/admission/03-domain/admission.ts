import { Context, Effect, HashMap, Layer, Option, Schema } from "effect";
import { HubKey, type Scope } from "#shared/03-domain/hub-key.ts";
import { HubKeyDigest, HubKeyName, PoolId } from "#shared/03-domain/ids.ts";

export { HubKey, Scope } from "#shared/03-domain/hub-key.ts";

export const Kind = Schema.Literals(["subscription", "keyed"]);
export type Kind = typeof Kind.Type;

/** Whether a hub key of a scope opens a pool of a kind: exactly when they are the same word, so a reader key opens none. */
export const opens = (scope: Scope, kind: Kind): boolean => scope === kind;

export const Policy = Schema.Struct({
  hubKeys: Schema.HashMap(HubKeyDigest, HubKey),
  pools: Schema.HashMap(PoolId, Kind),
});
export type Policy = typeof Policy.Type;

export const Request = Schema.Struct({
  hubKey: Schema.optionalKey(HubKeyDigest),
  pool: PoolId,
});
export type Request = typeof Request.Type;

export const Rejection = Schema.Literals([
  "NoHubKey",
  "UnknownHubKey",
  "UnknownPool",
  "WrongScope",
]);
export type Rejection = typeof Rejection.Type;

export const Decision = Schema.TaggedUnion({
  Admitted: { hubKey: HubKeyName, kind: Kind },
  Rejected: { reason: Rejection },
});
export type Decision = typeof Decision.Type;

export class Admission extends Context.Service<
  Admission,
  {
    /**
     * Admits a request only with a hub key the policy knows, to a pool the
     * policy knows whose kind is that key's scope, and rejects any other
     * without looking at its pool until its hub key is known (A1 to A5).
     */
    readonly decide: (request: Request) => Effect.Effect<Decision>;
  }
>()("@cota/hub/admission/Admission") {}

const rejected = (reason: Rejection): Decision => ({
  _tag: "Rejected",
  reason,
});

export const layer = (policy: Policy): Layer.Layer<Admission> =>
  Layer.succeed(
    Admission,
    Admission.of({
      // biome-ignore lint/correctness/useYield: Effect.fn takes a generator, and deciding needs nothing to yield.
      decide: Effect.fn("Admission.decide")(function* (
        request: Request,
      ): Effect.fn.Return<Decision> {
        if (request.hubKey === undefined) return rejected("NoHubKey");
        const hubKey = HashMap.get(policy.hubKeys, request.hubKey);
        if (Option.isNone(hubKey)) return rejected("UnknownHubKey");
        const kind = HashMap.get(policy.pools, request.pool);
        if (Option.isNone(kind)) return rejected("UnknownPool");
        if (!opens(hubKey.value.scope, kind.value)) {
          return rejected("WrongScope");
        }
        return {
          _tag: "Admitted",
          hubKey: hubKey.value.name,
          kind: kind.value,
        };
      }),
    }),
  );
