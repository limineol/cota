import { Context, type Effect, type Option, type Redacted } from "effect";
import type { RoutedClient } from "#03-domain/client.ts";
import type { HubAddress } from "#03-domain/hub-address.ts";
import type {
  HubFailed,
  HubKeyUnknown,
  HubUnreachable,
  Machine,
  RouteRefused,
} from "#03-domain/machine.ts";
import type {
  Answered,
  Ask,
  HubAnswered,
  TranscriptRead,
} from "#03-domain/memory.ts";
import type { RouteAnswer } from "#03-domain/route.ts";
import type {
  GivenList,
  RouteList,
  RoutesChanged,
  RoutesRefused,
  SignInRefused,
} from "#03-domain/route-list.ts";

/** What a launch asks the hub: which pool a client's launch in a project bills, with the override if one was named. */
export interface RouteQuestion {
  readonly client: RoutedClient;
  readonly project: string;
  readonly pool: Option.Option<string>;
}

/** Whose transcript `cota memory transcript` reads: a session's last segment, or one request. */
export type TranscriptOf =
  | { readonly _tag: "Session"; readonly session: string }
  | { readonly _tag: "Request"; readonly request: string };

/** The hub, at the address each call names. */
export class Hub extends Context.Service<
  Hub,
  {
    /** Succeeds when the hub answers `GET /health` with 200. */
    readonly health: (
      hub: HubAddress,
    ) => Effect.Effect<void, HubUnreachable | HubFailed>;
    /** What the hub answers a hub key about itself (`GET /api/machine`). */
    readonly machine: (
      hub: HubAddress,
      key: Redacted.Redacted<string>,
    ) => Effect.Effect<Machine, HubUnreachable | HubKeyUnknown | HubFailed>;
    /** The pool a launch bills (`GET /api/route`); `HubFailed` is any other answer: the hub's store failed, any 5xx, or one that does not decode. */
    readonly route: (
      hub: HubAddress,
      key: Redacted.Redacted<string>,
      question: RouteQuestion,
    ) => Effect.Effect<
      RouteAnswer,
      HubUnreachable | HubKeyUnknown | RouteRefused | HubFailed
    >;
    /** The ids a keyed pool's provider lists, asked through the relay as a client asks (`GET /pools/<pool>/models`, `x-cota-client: cota`). */
    readonly models: (
      hub: HubAddress,
      key: Redacted.Redacted<string>,
      pool: string,
    ) => Effect.Effect<
      ReadonlyArray<string>,
      HubUnreachable | HubKeyUnknown | HubFailed
    >;
    /** Sends an ask of `cota memory` with the reader key, and gives the answer's status and bytes whatever they are. */
    readonly ask: (
      hub: HubAddress,
      key: Redacted.Redacted<string>,
      ask: Ask,
    ) => Effect.Effect<Answered, HubUnreachable>;
    /** A session's segments and its last segment's transcript (`GET /api/sessions/{session}`), or one request's (`GET /api/requests/{id}`). */
    readonly transcript: (
      hub: HubAddress,
      key: Redacted.Redacted<string>,
      of: TranscriptOf,
    ) => Effect.Effect<
      TranscriptRead,
      HubUnreachable | HubKeyUnknown | HubAnswered | HubFailed
    >;
    /** Signs the owner in with the password (`POST /api/sign-in`, `User-Agent: cota routes`), and gives the sign-in's cookie. */
    readonly signIn: (
      hub: HubAddress,
      password: Redacted.Redacted<string>,
    ) => Effect.Effect<
      Redacted.Redacted<string>,
      SignInRefused | HubUnreachable | HubFailed
    >;
    /** Ends a sign-in (`POST /api/sign-out`). */
    readonly signOut: (
      hub: HubAddress,
      signIn: Redacted.Redacted<string>,
    ) => Effect.Effect<void, HubUnreachable | HubFailed>;
    /** A routed client's routes (`GET /api/routes`), signed in as the owner. */
    readonly routes: (
      hub: HubAddress,
      signIn: Redacted.Redacted<string>,
      client: RoutedClient,
    ) => Effect.Effect<RouteList, HubUnreachable | HubFailed>;
    /** Replaces a routed client's routes from a revision (`PUT /api/routes/{client}`), signed in as the owner. */
    readonly changeRoutes: (
      hub: HubAddress,
      signIn: Redacted.Redacted<string>,
      client: RoutedClient,
      revision: number,
      list: GivenList,
    ) => Effect.Effect<
      RouteList,
      RoutesRefused | RoutesChanged | HubUnreachable | HubFailed
    >;
  }
>()("@cota/cli/Hub") {}
