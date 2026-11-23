import { Effect, Layer, Redacted } from "effect";
import { Hub, type RouteQuestion } from "#02-application/interfaces/hub.ts";
import {
  HubFailed,
  HubKeyUnknown,
  HubUnreachable,
  type OpenedPool,
  type RouteRefused,
  type Scope,
} from "#03-domain/machine.ts";
import type { RouteAnswer } from "#03-domain/route.ts";

/** What the stand-in hub answers about a key it is shown. */
export type Answer = Scope | "unknown" | "failed" | "unreachable";

export interface Script {
  /** The answer for each key; a key not named is one the hub does not know. */
  readonly keys: ReadonlyMap<string, Answer>;
  readonly health?: "up" | "down" | "failing";
  /** The pools each scope of hub key opens. */
  readonly pools?: Partial<Record<Scope, ReadonlyArray<OpenedPool>>>;
  /** The observed pools the hub lists. */
  readonly observedPools?: ReadonlyArray<string>;
  /** What the hub answers `GET /api/route`; by default it cannot be reached. */
  readonly route?: (
    question: RouteQuestion,
  ) => Effect.Effect<
    RouteAnswer,
    HubUnreachable | HubKeyUnknown | RouteRefused | HubFailed
  >;
  /** The ids each keyed pool's provider lists; a pool not named cannot be listed. */
  readonly models?: ReadonlyMap<string, ReadonlyArray<string>>;
}

/** A hub that answers as it is scripted, and remembers each key it was shown. */
export const make = (
  script: Script,
): { readonly shown: Array<string>; readonly layer: Layer.Layer<Hub> } => {
  const shown: Array<string> = [];
  const layer = Layer.succeed(
    Hub,
    Hub.of({
      health: () => {
        switch (script.health ?? "up") {
          case "up":
            return Effect.void;
          case "down":
            return Effect.fail(new HubUnreachable());
          case "failing":
            return Effect.fail(new HubFailed({ status: 503 }));
        }
      },
      machine: (_hub, key) => {
        const value = Redacted.value(key);
        shown.push(value);
        const answer = script.keys.get(value) ?? "unknown";
        switch (answer) {
          case "unknown":
            return Effect.fail(new HubKeyUnknown());
          case "failed":
            return Effect.fail(new HubFailed({}));
          case "unreachable":
            return Effect.fail(new HubUnreachable());
          default:
            return Effect.succeed({
              hubKey: { name: "a key", scope: answer },
              pools: script.pools?.[answer] ?? [],
              observedPools: script.observedPools ?? [],
            });
        }
      },
      route: (_hub, key, question) => {
        shown.push(Redacted.value(key));
        return script.route === undefined
          ? Effect.fail(new HubUnreachable())
          : script.route(question);
      },
      models: (_hub, key, pool) => {
        shown.push(Redacted.value(key));
        const listed = script.models?.get(pool);
        return listed === undefined
          ? Effect.fail(new HubFailed({ status: 502 }))
          : Effect.succeed(listed);
      },
      ask: () => Effect.fail(new HubUnreachable()),
      transcript: () => Effect.fail(new HubUnreachable()),
      signIn: () => Effect.fail(new HubUnreachable()),
      signOut: () => Effect.fail(new HubUnreachable()),
      routes: () => Effect.fail(new HubUnreachable()),
      changeRoutes: () => Effect.fail(new HubUnreachable()),
    }),
  );
  return { shown, layer };
};
