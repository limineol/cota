import { Option, Result, Schema } from "effect";
import type { RoutedClient } from "./client.ts";

const Pool = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["subscription", "keyed"]),
  protocol: Schema.String,
  provider: Schema.String,
});

/** The pool the hub answers a launch: its id, kind, protocol and provider. */
export type RoutedPool = typeof Pool.Type;

/** The hub's answer to `GET /api/route`, in the terms a launch needs. */
export interface RouteAnswer {
  readonly project: string;
  readonly pool: RoutedPool;
  readonly by:
    | {
        readonly _tag: "Route";
        readonly position: number;
        readonly pattern: string;
      }
    | { readonly _tag: "Default" }
    | { readonly _tag: "Override" };
  /** The client's default pool, which is its own pool where the configuration names none. */
  readonly defaultPool: Option.Option<string>;
}

/** The problems with which the hub answers a route it cannot give. */
export type Refusal =
  | "no-route"
  | "route-pool-gone"
  | "no-such-pool"
  | "pool-not-for-client";

/** What asking the hub for a launch's route came to, by the launch's deadline. */
export type Asked =
  | { readonly _tag: "Answered"; readonly answer: RouteAnswer }
  | {
      readonly _tag: "Refused";
      readonly refusal: Refusal;
      readonly detail: string;
    }
  /** The hub does not know the hub key the machine asked with. */
  | { readonly _tag: "KeyUnknown" }
  /** The machine keeps no hub key to ask with. */
  | { readonly _tag: "NoHubKey" }
  /** The hub answered, but could not say: its store failed, or any other 5xx. */
  | { readonly _tag: "Unsure" }
  /** No answer by the deadline. */
  | { readonly _tag: "Unreachable" };

const Kept = Schema.Struct({
  client: Schema.Literals(["claude-code", "codex"]),
  project: Schema.String,
  pool: Pool,
  defaultPool: Schema.NullOr(Schema.String),
});

/** An answer kept in `routes.json`, the last the hub gave for a client and project. */
export type KeptAnswer = typeof Kept.Type;

const KeptFile = Schema.Struct({ answers: Schema.Array(Kept) });

/** How many answers `routes.json` keeps: the latest, by client and project. */
export const mostKept = 1000;

export const keptFor = (
  kept: ReadonlyArray<KeptAnswer>,
  client: RoutedClient,
  project: string,
): Option.Option<KeptAnswer> =>
  Option.fromUndefinedOr(
    kept.findLast((each) => each.client === client && each.project === project),
  );

/** The kept answers with this one as the latest, replacing the one before it for its client and project, and at most `mostKept`. */
export const keeping = (
  kept: ReadonlyArray<KeptAnswer>,
  answer: KeptAnswer,
): ReadonlyArray<KeptAnswer> =>
  [
    ...kept.filter(
      (each) =>
        each.client !== answer.client || each.project !== answer.project,
    ),
    answer,
  ].slice(-mostKept);

export const keptOf = (
  client: RoutedClient,
  answer: RouteAnswer,
): KeptAnswer => ({
  client,
  project: answer.project,
  pool: answer.pool,
  defaultPool: Option.getOrNull(answer.defaultPool),
});

/** Reads `routes.json`, or says why it does not read. */
export const decodeKept = (
  text: string,
): Result.Result<ReadonlyArray<KeptAnswer>, string> => {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (cause) {
    return Result.fail(cause instanceof Error ? cause.message : String(cause));
  }
  const decoded = Schema.decodeUnknownResult(KeptFile)(json);
  return Result.isFailure(decoded)
    ? Result.fail(decoded.failure.message)
    : Result.succeed(decoded.success.answers);
};

export const keptText = (kept: ReadonlyArray<KeptAnswer>): string =>
  `${JSON.stringify({ answers: kept }, null, 2)}\n`;
