import { type Option, type Redacted, Schema } from "effect";

/** What a hub key opens, as the hub answers it. */
export const Scope = Schema.Literals(["subscription", "keyed", "reader"]);
export type Scope = typeof Scope.Type;

/** The scopes a machine keeps a hub key of, one key each: a reader key opens no pool. */
export const keptScopes = ["subscription", "keyed"] as const;
export type KeptScope = (typeof keptScopes)[number];

/** The machine's hub keys, by the scope each is kept under. */
export type HubKeys = Readonly<
  Record<KeptScope, Option.Option<Redacted.Redacted<string>>>
>;

/** Each price class's rate per million tokens, in picodollars, as the API's money decodes. */
export interface Rates {
  readonly input: bigint;
  readonly cacheRead: bigint;
  readonly cacheWriteShort: bigint;
  readonly cacheWriteLong: bigint;
  readonly output: bigint;
}

/** What the hub knows of a keyed pool's model (`GET /api/machine`). */
export interface ModelFacts {
  readonly id: string;
  readonly name: string;
  readonly contextTokens: number | null;
  readonly outputTokens: number | null;
  readonly imageInput: boolean | null;
  readonly price: {
    readonly base: Rates;
    readonly tiers: ReadonlyArray<{
      readonly threshold: number;
      readonly rates: Rates;
    }>;
  };
}

/** A pool a hub key opens, as `GET /api/machine` answers it. */
export interface OpenedPool {
  readonly id: string;
  readonly kind: "subscription" | "keyed";
  readonly protocol: string;
  readonly displayName: string | null;
  /** A keyed pool's models; none for a subscription pool. */
  readonly models: ReadonlyArray<ModelFacts>;
}

/** What the hub answers a hub key about itself (`GET /api/machine`). */
export interface Machine {
  readonly hubKey: { readonly name: string; readonly scope: Scope };
  readonly pools: ReadonlyArray<OpenedPool>;
}

export class HubUnreachable extends Schema.TaggedError<
  HubUnreachable,
  { readonly brand: unique symbol }
>()("HubUnreachable", {}) {}

/** The hub answered, but not with what was asked: a problem of its own, or an answer that does not decode. */
export class HubFailed extends Schema.TaggedError<
  HubFailed,
  { readonly brand: unique symbol }
>()("HubFailed", { status: Schema.optionalKey(Schema.Int) }) {}

export class HubKeyUnknown extends Schema.TaggedError<
  HubKeyUnknown,
  { readonly brand: unique symbol }
>()("HubKeyUnknown", {}) {}

/** How long doctor and a join wait for each answer of the hub. */
export const hubDeadline = "5 seconds";

/** The hub refused the route it was asked for, with the problem's type and detail. */
export class RouteRefused extends Schema.TaggedError<
  RouteRefused,
  { readonly brand: unique symbol }
>()("RouteRefused", {
  refusal: Schema.Literals([
    "no-route",
    "route-pool-gone",
    "no-such-pool",
    "pool-not-for-client",
  ]),
  detail: Schema.String,
}) {}

/** Whether a name is a pool's id as the hub's configuration allows one: one path segment, so also a file's name. */
export const isPoolId = (name: string): boolean =>
  /^[A-Za-z0-9][A-Za-z0-9._~-]*$/.test(name);
