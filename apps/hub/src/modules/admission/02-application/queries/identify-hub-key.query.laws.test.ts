import { describe, it } from "@effect/vitest";
import {
  Arbitrary,
  Effect,
  Equal,
  HashMap,
  Layer,
  Option,
  Schema,
} from "effect";
import * as Admission from "#modules/admission/03-domain/admission.ts";
import * as Sha256HubKeyHasher from "#modules/admission/04-infrastructure/sha256-hub-key-hasher.ts";
import { HubKeyName } from "#shared/03-domain/ids.ts";
import * as IdentifyHubKey from "./identify-hub-key.query.ts";

const known = Arbitrary.schema(Schema.Literals(["key-a", "key-b", "key-c"]));
const any = Arbitrary.schema(
  Schema.Literals(["key-a", "key-b", "key-c", "key-d"]),
);
const name = Arbitrary.schema(
  HubKeyName.check(Schema.isPattern(/^(laptop|desk|agent)$/)),
);
const policy = Arbitrary.array(
  Arbitrary.all([
    known,
    Arbitrary.all({ name, scope: Arbitrary.schema(Admission.Scope) }),
  ]),
  { minLength: 1, maxLength: 3 },
).pipe(
  Arbitrary.map(
    (hubKeys): Admission.Policy => ({
      hubKeys: HashMap.fromIterable(
        hubKeys.map(([secret, hubKey]) => [
          Sha256HubKeyHasher.digestOf(secret),
          hubKey,
        ]),
      ),
      pools: HashMap.empty(),
    }),
  ),
);
const presented = Arbitrary.all({
  cotaKey: Arbitrary.schema(
    Schema.Literals(["absent", "blank", "plain", "padded"]),
  ),
  cotaSecret: any,
  bearer: Arbitrary.schema(Schema.Boolean),
  bearerSecret: any,
}).pipe(
  Arbitrary.map(
    ({
      cotaKey,
      cotaSecret,
      bearer,
      bearerSecret,
    }): IdentifyHubKey.Presented => ({
      cotaKey: {
        absent: undefined,
        blank: "  ",
        plain: cotaSecret,
        padded: ` ${cotaSecret} `,
      }[cotaKey],
      bearer: bearer ? Option.some(bearerSecret) : Option.none(),
    }),
  ),
);

const identifyUnder = (
  policy: Admission.Policy,
  presented: IdentifyHubKey.Presented,
) =>
  Effect.gen(function* () {
    const identify = yield* IdentifyHubKey.IdentifyHubKey;
    return yield* identify.execute(presented);
  }).pipe(
    Effect.provide(
      IdentifyHubKey.layer(policy).pipe(
        Layer.provide(Sha256HubKeyHasher.layer),
      ),
    ),
  );

describe("IdentifyHubKey laws", () => {
  it.effect.prop(
    "A6: IdentifyHubKey gives the name and scope the policy gives the presented key's digest, and nothing for a key the policy does not know or a request that presents none",
    { policy, presented },
    ({ policy, presented }) =>
      Effect.gen(function* () {
        const cotaKey = presented.cotaKey?.trim() ?? "";
        const key = cotaKey === "" ? presented.bearer : Option.some(cotaKey);
        const expected = Option.flatMap(key, (each) =>
          HashMap.get(policy.hubKeys, Sha256HubKeyHasher.digestOf(each)),
        );
        return Equal.equals(yield* identifyUnder(policy, presented), expected);
      }),
    { arbitrary: { runs: 1000 } },
  );
});
