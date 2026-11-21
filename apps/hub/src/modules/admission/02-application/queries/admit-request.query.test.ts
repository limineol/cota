import { describe, expect, it } from "@effect/vitest";
import { Effect, HashMap, Layer, Option } from "effect";
import * as Admission from "#modules/admission/03-domain/admission.ts";
import * as Sha256HubKeyHasher from "#modules/admission/04-infrastructure/sha256-hub-key-hasher.ts";
import { HubKeyName, PoolId } from "#shared/03-domain/ids.ts";
import * as AdmitRequest from "./admit-request.query.ts";

const laptopSecret = "laptop-hub-key-2b71";
const fleetSecret = "fleet-hub-key-9e04";
const strangerSecret = "stranger-hub-key-6d3a";
const work = PoolId.make("work");
const api = PoolId.make("api");
const nowhere = PoolId.make("nowhere");

const subscription: Admission.Kind = "subscription";
const keyed: Admission.Kind = "keyed";

const policy: Admission.Policy = {
  hubKeys: HashMap.make(
    [
      Sha256HubKeyHasher.digestOf(laptopSecret),
      { name: HubKeyName.make("laptop"), scope: subscription },
    ],
    [
      Sha256HubKeyHasher.digestOf(fleetSecret),
      { name: HubKeyName.make("fleet"), scope: keyed },
    ],
  ),
  pools: HashMap.make([work, subscription], [api, keyed]),
};

interface Headers {
  readonly cotaKey?: string;
  readonly bearer?: string;
  readonly apiKey?: string;
}

const admit = (pool: PoolId, headers: Headers) =>
  Effect.gen(function* () {
    const admitRequest = yield* AdmitRequest.AdmitRequest;
    return yield* admitRequest.execute({
      pool,
      cotaKey: headers.cotaKey,
      bearer: Option.fromUndefinedOr(headers.bearer),
      apiKey: headers.apiKey,
    });
  }).pipe(
    Effect.provide(
      AdmitRequest.layer(policy).pipe(
        Layer.provide(Admission.layer(policy)),
        Layer.provide(Sha256HubKeyHasher.layer),
      ),
    ),
  );

const admitted = (hubKey: string, kind: Admission.Kind) => ({
  _tag: "Admitted",
  hubKey,
  kind,
});
const rejected = (reason: Admission.Rejection) => ({
  _tag: "Rejected",
  reason,
});

describe("AdmitRequest", () => {
  it.effect(
    "takes the hub key from x-cota-key, trimmed, to a pool of either kind, ahead of a bearer token",
    () =>
      Effect.gen(function* () {
        expect([
          yield* admit(api, { cotaKey: ` ${fleetSecret} ` }),
          yield* admit(work, { cotaKey: laptopSecret, bearer: fleetSecret }),
          yield* admit(api, { cotaKey: laptopSecret, bearer: fleetSecret }),
        ]).toEqual([
          admitted("fleet", "keyed"),
          admitted("laptop", "subscription"),
          rejected("WrongScope"),
        ]);
      }),
  );

  it.effect(
    "takes a keyed pool's hub key from the bearer token, else from a non-empty x-api-key, when x-cota-key is missing or blank",
    () =>
      Effect.gen(function* () {
        expect([
          yield* admit(api, { bearer: fleetSecret }),
          yield* admit(api, { apiKey: fleetSecret }),
          yield* admit(api, { cotaKey: "  ", apiKey: ` ${fleetSecret}` }),
          yield* admit(api, { bearer: strangerSecret, apiKey: fleetSecret }),
          yield* admit(api, { apiKey: "  " }),
        ]).toEqual([
          admitted("fleet", "keyed"),
          admitted("fleet", "keyed"),
          admitted("fleet", "keyed"),
          rejected("UnknownHubKey"),
          rejected("NoHubKey"),
        ]);
      }),
  );

  it.effect(
    "takes a subscription pool's hub key only from x-cota-key, since its authorization carries the login",
    () =>
      Effect.gen(function* () {
        expect([
          yield* admit(work, { bearer: laptopSecret }),
          yield* admit(work, { apiKey: laptopSecret }),
        ]).toEqual([rejected("NoHubKey"), rejected("NoHubKey")]);
      }),
  );

  it.effect(
    "answers a request without a known hub key in x-cota-key to a pool the hub does not have as a subscription pool would (A3)",
    () =>
      Effect.gen(function* () {
        const presented: ReadonlyArray<Headers> = [
          {},
          { bearer: fleetSecret },
          { apiKey: fleetSecret },
          { bearer: strangerSecret },
          { cotaKey: strangerSecret, bearer: fleetSecret },
        ];
        const answers = [];
        for (const headers of presented) {
          answers.push([
            yield* admit(nowhere, headers),
            yield* admit(work, headers),
          ]);
        }
        expect(answers).toEqual([
          [rejected("NoHubKey"), rejected("NoHubKey")],
          [rejected("NoHubKey"), rejected("NoHubKey")],
          [rejected("NoHubKey"), rejected("NoHubKey")],
          [rejected("NoHubKey"), rejected("NoHubKey")],
          [rejected("UnknownHubKey"), rejected("UnknownHubKey")],
        ]);
      }),
  );
});
