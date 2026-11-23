import { Arbitrary, HashMap, Option, Schema } from "effect";
import * as ProjectPattern from "#modules/routes/03-domain/project-pattern.ts";
import * as RouteList from "#modules/routes/03-domain/route-list.ts";
import { PoolId } from "#shared/03-domain/ids.ts";
import type * as Pool from "#shared/03-domain/pool.entity.ts";
import type { ProtocolName } from "#shared/03-domain/protocol-name.ts";

/** Patterns and projects are drawn from these, so that prefixes, equal patterns and near misses are common. */
export const alphabet = ["a", "b", "/", "-", "A"] as const;

const letter = Arbitrary.schema(Schema.Literals(alphabet));

const word = (minLength: number, maxLength: number) =>
  Arbitrary.array(letter, { minLength, maxLength }).pipe(
    Arbitrary.map((letters) => letters.join("")),
  );

export const project = word(1, 5);

/** A pattern as the owner writes one: 1 to 3 letters, a prefix pattern half the time. */
export const writtenPattern = Arbitrary.all({
  stem: word(1, 3),
  prefix: Arbitrary.schema(Schema.Boolean),
}).pipe(Arbitrary.map(({ stem, prefix }) => (prefix ? `${stem}*` : stem)));

/** Written patterns that are not patterns, beside ones that are. */
export const anyWrittenPattern = Arbitrary.all({
  pattern: writtenPattern,
  broken: Arbitrary.schema(
    Schema.Literals(["no", "no", "no", "no", "*", "a*b", "  ", "a\u0007"]),
  ),
}).pipe(
  Arbitrary.map(({ pattern, broken }) => (broken === "no" ? pattern : broken)),
);

export const pattern = writtenPattern.pipe(
  Arbitrary.map((written) => Option.getOrThrow(ProjectPattern.parse(written))),
);

/** The pools the configurations generated may have; `p5` none has. */
export const poolIds = ["p1", "p2", "p3", "p4", "p5"].map((id) =>
  PoolId.make(id),
);

export const poolId = Arbitrary.schema(
  Schema.Literals(["p1", "p2", "p3", "p4", "p5"]),
).pipe(Arbitrary.map((id) => PoolId.make(id)));

export const client = Arbitrary.schema(RouteList.RoutedClient);

export const poolOf = (
  id: PoolId,
  protocol: ProtocolName,
  keyed: boolean,
): Pool.Pool =>
  protocol === "openai-chat" || (protocol === "anthropic-messages" && keyed)
    ? {
        kind: "keyed",
        id,
        protocol,
        provider: "provider",
        baseUrl: "http://127.0.0.1:9/v1",
        key: Option.none(),
        prices: Option.none(),
        ownPrices: {},
      }
    : {
        kind: "subscription",
        id,
        protocol,
        provider: "provider",
        baseUrl: "http://127.0.0.1:9/v1",
        keptLogin: Option.none(),
        fallback: Option.none(),
        prices: Option.none(),
        ownPrices: {},
      };

const observedOf = (id: PoolId): Pool.Pool => ({
  kind: "observed",
  id,
  provider: "provider",
  prices: Option.none(),
  ownPrices: {},
});

/** A configuration that has some of `p1` to `p4`, each of any protocol or observed, so that some pools are gone and some of another protocol or none. */
export const pools = Arbitrary.array(
  Arbitrary.all({
    present: Arbitrary.schema(Schema.Boolean),
    protocol: Arbitrary.schema(
      Schema.Literals([
        "anthropic-messages",
        "chatgpt-codex",
        "openai-chat",
        "observed",
      ]),
    ),
    keyed: Arbitrary.schema(Schema.Boolean),
  }),
  { minLength: 4, maxLength: 4 },
).pipe(
  Arbitrary.map((choices) =>
    HashMap.fromIterable(
      choices.flatMap(({ present, protocol, keyed }, index) => {
        const id = poolIds[index];
        return present && id !== undefined
          ? [
              [
                id,
                protocol === "observed"
                  ? observedOf(id)
                  : poolOf(id, protocol, keyed),
              ] as const,
            ]
          : [];
      }),
    ),
  ),
);

/** A stored list of up to 12 routes, unchecked: shadowed and equal patterns among them. */
export const list = Arbitrary.all({
  client,
  routes: Arbitrary.array(Arbitrary.all({ pattern, pool: poolId }), {
    maxLength: 12,
  }),
  defaultPool: Arbitrary.schema(Schema.Boolean),
  defaultId: poolId,
}).pipe(
  Arbitrary.map(
    ({ client, routes, defaultPool, defaultId }): RouteList.RouteList => ({
      client,
      routes: routes.map((route, index) => ({ ...route, position: index + 1 })),
      defaultPool: defaultPool ? Option.some(defaultId) : Option.none(),
      revision: 1,
      changedAt: Option.none(),
    }),
  ),
);

/** Whether a pattern, as stored, matches a project, by this spec's matching rule alone. */
export const matchesBySpec = (stored: string, project: string): boolean => {
  const lowercased = project.toLowerCase();
  return stored.endsWith("*")
    ? lowercased.startsWith(stored.slice(0, -1))
    : lowercased === stored;
};

/**
 * Every project of the alphabet, lowercased, and of `z`, a character no
 * pattern holds, up to `longest` characters.
 */
export const everyProject = (longest: number): ReadonlyArray<string> => {
  const letters = ["a", "b", "/", "-", "z"];
  const all: Array<string> = [];
  let previous = [""];
  for (let length = 1; length <= longest; length++) {
    previous = previous.flatMap((start) =>
      letters.map((letter) => start + letter),
    );
    all.push(...previous);
  }
  return all;
};
