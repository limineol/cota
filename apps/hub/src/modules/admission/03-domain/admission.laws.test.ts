import { describe, it } from "@effect/vitest";
import { Arbitrary, Effect, Equal, HashMap, Option, Schema } from "effect";
import { HubKeyDigest, HubKeyName, PoolId } from "#shared/03-domain/ids.ts";
import * as Admission from "./admission.ts";

const digest = Arbitrary.schema(
  HubKeyDigest.check(Schema.isPattern(/^digest-[ab]$/)),
);
const name = Arbitrary.schema(
  HubKeyName.check(Schema.isPattern(/^(laptop|desk|ci)$/)),
);
const pool = Arbitrary.schema(PoolId.check(Schema.isPattern(/^(work|api)$/)));
const kind = Arbitrary.schema(Admission.Kind);
const scope = Arbitrary.schema(Admission.Scope);
const hubKey = Arbitrary.all({ name, scope });
const policy = Arbitrary.all({
  hubKeys: Arbitrary.array(Arbitrary.all([digest, hubKey]), {
    minLength: 1,
    maxLength: 3,
  }),
  pools: Arbitrary.array(Arbitrary.all([pool, kind]), {
    minLength: 1,
    maxLength: 3,
  }),
}).pipe(
  Arbitrary.map(
    ({ hubKeys, pools }): Admission.Policy => ({
      hubKeys: HashMap.fromIterable(hubKeys),
      pools: HashMap.fromIterable(pools),
    }),
  ),
);
/**
 * A policy whose two hub keys share a scope: the name an admitted request
 * carries then depends on which of them it presents.
 */
const twoKeysOfOneScope = Arbitrary.all({
  names: Arbitrary.all([name, name]),
  scope,
  pools: Arbitrary.array(Arbitrary.all([pool, kind]), {
    minLength: 1,
    maxLength: 3,
  }),
}).pipe(
  Arbitrary.map(
    ({ names: [first, second], scope, pools }): Admission.Policy => ({
      hubKeys: HashMap.make(
        [HubKeyDigest.make("digest-a"), { name: first, scope }],
        [HubKeyDigest.make("digest-b"), { name: second, scope }],
      ),
      pools: HashMap.fromIterable(pools),
    }),
  ),
);
const anyPolicy = Arbitrary.schema(Schema.Boolean).pipe(
  Arbitrary.flatMap((shared) => (shared ? twoKeysOfOneScope : policy)),
);
const request = Arbitrary.all({
  hubKey: digest,
  pool,
  presentsKey: Arbitrary.schema(Schema.Boolean),
}).pipe(
  Arbitrary.map(
    ({ presentsKey, hubKey, pool }): Admission.Request =>
      presentsKey ? { hubKey, pool } : { pool },
  ),
);

const hubKeyOf = (policy: Admission.Policy, request: Admission.Request) =>
  request.hubKey === undefined
    ? Option.none()
    : HashMap.get(policy.hubKeys, request.hubKey);

const withoutKnownHubKey = Arbitrary.all({ policy, request }).pipe(
  Arbitrary.filter(({ policy, request }) =>
    Option.isNone(hubKeyOf(policy, request)),
  ),
);

const decideUnder = (policy: Admission.Policy, request: Admission.Request) =>
  Effect.gen(function* () {
    const admission = yield* Admission.Admission;
    return yield* admission.decide(request);
  }).pipe(Effect.provide(Admission.layer(policy)));

const runs = { arbitrary: { runs: 1000 } };

describe("admission laws", () => {
  it.effect.prop(
    "A1: a request that presents no hub key, or one the policy does not know, is rejected, whatever pool it names",
    { scene: withoutKnownHubKey },
    ({ scene: { policy, request } }) =>
      Effect.gen(function* () {
        const decision = yield* decideUnder(policy, request);
        return decision._tag === "Rejected";
      }),
    runs,
  );

  it.effect.prop(
    "L15: no request admitted by the relay names an observed pool, whatever hub key it presents",
    { policy, request },
    ({ policy, request }) =>
      Effect.gen(function* () {
        const decision = yield* decideUnder(policy, request);
        return !(
          decision._tag === "Admitted" &&
          Equal.equals(
            HashMap.get(policy.pools, request.pool),
            Option.some("observed"),
          )
        );
      }),
    runs,
  );

  it.effect.prop(
    "A2: a request is admitted only to a pool whose kind is its hub key's scope",
    { policy, request },
    ({ policy, request }) =>
      Effect.gen(function* () {
        const decision = yield* decideUnder(policy, request);
        if (decision._tag === "Rejected") return true;
        const scope = Option.map(
          hubKeyOf(policy, request),
          ({ scope }) => scope,
        );
        return (
          Option.isSome(scope) &&
          Equal.equals(HashMap.get(policy.pools, request.pool), scope)
        );
      }),
    runs,
  );

  it.effect.prop(
    "A3: a request without a known hub key gets the same answer whether or not the pool it names exists",
    { scene: withoutKnownHubKey, kind },
    ({ scene: { policy, request }, kind }) =>
      Effect.gen(function* () {
        const withPool = {
          ...policy,
          pools: HashMap.set(policy.pools, request.pool, kind),
        };
        const withoutPool = {
          ...policy,
          pools: HashMap.remove(policy.pools, request.pool),
        };
        return Equal.equals(
          yield* decideUnder(withPool, request),
          yield* decideUnder(withoutPool, request),
        );
      }),
    runs,
  );

  it.effect.prop(
    "A4: an admitted request's answer carries the kind the policy gives its pool and the name the policy gives its hub key",
    { policy: anyPolicy, request },
    ({ policy, request }) =>
      Effect.gen(function* () {
        const decision = yield* decideUnder(policy, request);
        if (decision._tag === "Rejected") return true;
        return (
          Equal.equals(
            HashMap.get(policy.pools, request.pool),
            Option.some(decision.kind),
          ) &&
          Equal.equals(
            Option.map(hubKeyOf(policy, request), ({ name }) => name),
            Option.some(decision.hubKey),
          )
        );
      }),
    runs,
  );

  it.effect.prop(
    "A5: a request that presents a reader key is rejected, whatever pool it names",
    { policy, readerKey: digest, name, pool },
    ({ policy, readerKey, name, pool }) =>
      Effect.gen(function* () {
        const withReader = {
          ...policy,
          hubKeys: HashMap.set(policy.hubKeys, readerKey, {
            name,
            scope: "reader" as const,
          }),
        };
        const decision = yield* decideUnder(withReader, {
          hubKey: readerKey,
          pool,
        });
        return decision._tag === "Rejected";
      }),
    runs,
  );
});
