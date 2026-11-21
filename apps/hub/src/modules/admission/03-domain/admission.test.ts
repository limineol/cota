import { describe, expect, it } from "@effect/vitest";
import { Effect, HashMap } from "effect";
import { HubKeyDigest, HubKeyName, PoolId } from "#shared/03-domain/ids.ts";
import * as Admission from "./admission.ts";

const laptopKey = HubKeyDigest.make("digest-laptop");
const ciKey = HubKeyDigest.make("digest-ci");
const agentKey = HubKeyDigest.make("digest-agent");
const strangerKey = HubKeyDigest.make("digest-stranger");
const work = PoolId.make("work");
const api = PoolId.make("api");
const nowhere = PoolId.make("nowhere");

const subscription: Admission.Kind = "subscription";
const keyed: Admission.Kind = "keyed";
const reader: Admission.Scope = "reader";

const policy: Admission.Policy = {
  hubKeys: HashMap.make(
    [laptopKey, { name: HubKeyName.make("laptop"), scope: subscription }],
    [ciKey, { name: HubKeyName.make("ci"), scope: keyed }],
    [agentKey, { name: HubKeyName.make("agent"), scope: reader }],
  ),
  pools: HashMap.make([work, subscription], [api, keyed]),
};

const decide = (request: Admission.Request) =>
  Effect.gen(function* () {
    const admission = yield* Admission.Admission;
    return yield* admission.decide(request);
  }).pipe(Effect.provide(Admission.layer(policy)));

describe("decide", () => {
  it.effect(
    "rejects a request without a hub key as NoHubKey, to a pool that exists or not",
    () =>
      Effect.gen(function* () {
        expect([
          yield* decide({ pool: work }),
          yield* decide({ pool: nowhere }),
        ]).toEqual([
          { _tag: "Rejected", reason: "NoHubKey" },
          { _tag: "Rejected", reason: "NoHubKey" },
        ]);
      }),
  );

  it.effect(
    "rejects a hub key the policy does not know as UnknownHubKey, to a pool that exists or not",
    () =>
      Effect.gen(function* () {
        expect([
          yield* decide({ hubKey: strangerKey, pool: work }),
          yield* decide({ hubKey: strangerKey, pool: nowhere }),
        ]).toEqual([
          { _tag: "Rejected", reason: "UnknownHubKey" },
          { _tag: "Rejected", reason: "UnknownHubKey" },
        ]);
      }),
  );

  it.effect(
    "rejects a known hub key naming a pool the policy does not know as UnknownPool",
    () =>
      Effect.gen(function* () {
        expect(yield* decide({ hubKey: laptopKey, pool: nowhere })).toEqual({
          _tag: "Rejected",
          reason: "UnknownPool",
        });
      }),
  );

  it.effect(
    "rejects a hub key whose scope is not the pool's kind as WrongScope, either way round",
    () =>
      Effect.gen(function* () {
        expect([
          yield* decide({ hubKey: laptopKey, pool: api }),
          yield* decide({ hubKey: ciKey, pool: work }),
        ]).toEqual([
          { _tag: "Rejected", reason: "WrongScope" },
          { _tag: "Rejected", reason: "WrongScope" },
        ]);
      }),
  );

  it.effect(
    "rejects a reader key as WrongScope at every pool the policy knows, and as UnknownPool at one it does not",
    () =>
      Effect.gen(function* () {
        expect([
          yield* decide({ hubKey: agentKey, pool: work }),
          yield* decide({ hubKey: agentKey, pool: api }),
          yield* decide({ hubKey: agentKey, pool: nowhere }),
        ]).toEqual([
          { _tag: "Rejected", reason: "WrongScope" },
          { _tag: "Rejected", reason: "WrongScope" },
          { _tag: "Rejected", reason: "UnknownPool" },
        ]);
      }),
  );

  it.effect(
    "admits a hub key to a pool of its scope, with the key's name and the pool's kind",
    () =>
      Effect.gen(function* () {
        expect([
          yield* decide({ hubKey: laptopKey, pool: work }),
          yield* decide({ hubKey: ciKey, pool: api }),
        ]).toEqual([
          { _tag: "Admitted", hubKey: "laptop", kind: "subscription" },
          { _tag: "Admitted", hubKey: "ci", kind: "keyed" },
        ]);
      }),
  );
});
