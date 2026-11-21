import { Option, Result, Schema } from "effect";
import type { RoutedClient } from "./client.ts";

/** A routed client's routes as the hub keeps them (`docs/specs/routes/spec.md`, The endpoints). */
export interface RouteList {
  readonly client: RoutedClient;
  readonly routes: ReadonlyArray<{
    readonly position: number;
    readonly pattern: string;
    readonly pool: string;
  }>;
  readonly defaultPool: Option.Option<string>;
  readonly revision: number;
}

/** A list as the owner gives it: its routes in order, and its default pool. */
export interface GivenList {
  readonly routes: ReadonlyArray<{
    readonly pattern: string;
    readonly pool: string;
  }>;
  readonly defaultPool: Option.Option<string>;
}

export const Reason = Schema.Literals([
  "not-a-pattern",
  "no-such-pool",
  "pool-not-for-client",
  "same-pattern",
  "shadowed",
]);

/** Why the hub did not store a list: a route by its position, or the default pool with none. */
export interface RouteRefusal {
  readonly position: Option.Option<number>;
  readonly reason: typeof Reason.Type;
  readonly shadowedBy: Option.Option<number>;
}

/** The hub did not sign the owner in: its problem's type, and for `too-many-attempts` how long to wait. */
export class SignInRefused extends Schema.TaggedError<
  SignInRefused,
  { readonly brand: unique symbol }
>()("SignInRefused", {
  refusal: Schema.Literals([
    "wrong-password",
    "password-off",
    "not-set-up",
    "too-many-attempts",
  ]),
  retryAfter: Schema.optionalKey(Schema.String),
}) {}

export class RoutesRefused extends Schema.TaggedError<
  RoutesRefused,
  { readonly brand: unique symbol }
>()("RoutesRefused", {
  refusals: Schema.Array(
    Schema.Struct({
      position: Schema.Option(Schema.Int),
      reason: Reason,
      shadowedBy: Schema.Option(Schema.Int),
    }),
  ),
}) {}

export class RoutesChanged extends Schema.TaggedError<
  RoutesChanged,
  { readonly brand: unique symbol }
>()("RoutesChanged", {}) {}

/** A list as `cota routes show` prints it and `set` reads it: `<pattern> <pool>` a line, then `* <pool>` for the default pool. */
export const textOf = (list: RouteList): string =>
  [
    ...list.routes.map(({ pattern, pool }) => `${pattern} ${pool}`),
    ...Option.match(list.defaultPool, {
      onNone: () => [],
      onSome: (pool) => [`* ${pool}`],
    }),
  ]
    .map((line) => `${line}\n`)
    .join("");

/**
 * Reads a list in the form `show` prints: each line that is not empty
 * `<pattern> <pool>`, split at its last space since a pattern may hold
 * spaces and a pool's id cannot, and at most one `* <pool>`, the default
 * pool. Whether a pattern or a pool is one the hub takes is the hub's to say.
 */
export const read = (text: string): Result.Result<GivenList, string> => {
  const routes: Array<{ pattern: string; pool: string }> = [];
  let defaultPool = Option.none<string>();
  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const split = trimmed.match(/^(.*\S)\s+(\S+)$/);
    if (split === null) {
      return Result.fail(
        `line ${index + 1} is not a pattern and a pool: ${JSON.stringify(trimmed)}`,
      );
    }
    const [, pattern = "", pool = ""] = split;
    if (pattern === "*") {
      if (Option.isSome(defaultPool)) {
        return Result.fail(`line ${index + 1} names a second default pool`);
      }
      defaultPool = Option.some(pool);
      continue;
    }
    routes.push({ pattern, pool });
  }
  return Result.succeed({ routes, defaultPool });
};

const reasonWords = (refusal: RouteRefusal, protocol: string): string => {
  switch (refusal.reason) {
    case "not-a-pattern":
      return "it is not a project pattern: 1 to 200 characters, no control character, and at most one *, only at its end";
    case "no-such-pool":
      return "the hub has no such pool";
    case "pool-not-for-client":
      return `the pool does not speak ${protocol}`;
    case "same-pattern":
      return "an earlier route has the same pattern";
    case "shadowed":
      return Option.match(refusal.shadowedBy, {
        onNone: () => "an earlier route matches every project it matches",
        onSome: (position) =>
          `route ${position} matches every project it matches`,
      });
  }
};

/** Each refusal of a list in one line, naming the route as it was given. */
export const refusalLines = (
  refusals: ReadonlyArray<RouteRefusal>,
  given: GivenList,
  protocol: string,
): ReadonlyArray<string> =>
  refusals.map((refusal) =>
    Option.match(refusal.position, {
      onNone: () =>
        `the default pool, ${Option.getOrElse(given.defaultPool, () => "")}: ${reasonWords(refusal, protocol)}`,
      onSome: (position) => {
        const route = given.routes[position - 1];
        return `route ${position}${route === undefined ? "" : `, ${route.pattern} ${route.pool}`}: ${reasonWords(refusal, protocol)}`;
      },
    }),
  );
