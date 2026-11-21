import { describe, expect, it } from "@effect/vitest";
import { Effect, HashMap, Layer, Option } from "effect";
import type * as Admission from "#modules/admission/03-domain/admission.ts";
import * as Sha256HubKeyHasher from "#modules/admission/04-infrastructure/sha256-hub-key-hasher.ts";
import { HubKeyName, PoolId } from "#shared/03-domain/ids.ts";
import * as IdentifyHubKey from "./identify-hub-key.query.ts";

const agentSecret = "agent-hub-key-41f7";
const laptopSecret = "laptop-hub-key-2b71";

const reader: Admission.Scope = "reader";
const subscription: Admission.Kind = "subscription";

const policy: Admission.Policy = {
  hubKeys: HashMap.make(
    [
      Sha256HubKeyHasher.digestOf(agentSecret),
      { name: HubKeyName.make("agent"), scope: reader },
    ],
    [
      Sha256HubKeyHasher.digestOf(laptopSecret),
      { name: HubKeyName.make("laptop"), scope: subscription },
    ],
  ),
  pools: HashMap.make([PoolId.make("work"), subscription]),
};

const identify = (cotaKey: string | undefined, bearer?: string) =>
  Effect.gen(function* () {
    const identifyHubKey = yield* IdentifyHubKey.IdentifyHubKey;
    return yield* identifyHubKey.execute({
      cotaKey,
      bearer: Option.fromUndefinedOr(bearer),
    });
  }).pipe(
    Effect.provide(
      IdentifyHubKey.layer(policy).pipe(
        Layer.provide(Sha256HubKeyHasher.layer),
      ),
    ),
  );

describe("IdentifyHubKey", () => {
  it.effect(
    "names a hub key of any scope from x-cota-key, trimmed, ahead of the bearer token, and nothing else",
    () =>
      Effect.gen(function* () {
        expect([
          yield* identify(` ${agentSecret} `, laptopSecret),
          yield* identify("", agentSecret),
          yield* identify(undefined, laptopSecret),
          yield* identify("not-a-hub-key", agentSecret),
          yield* identify(undefined),
        ]).toEqual([
          Option.some({ name: "agent", scope: "reader" }),
          Option.some({ name: "agent", scope: "reader" }),
          Option.some({ name: "laptop", scope: "subscription" }),
          Option.none(),
          Option.none(),
        ]);
      }),
  );
});
