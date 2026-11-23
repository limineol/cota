import { Api } from "@cota/hub/api";
import { DateTime, Effect, Layer, Option, Redacted, Schema } from "effect";
import {
  Cookies,
  FetchHttpClient,
  HttpClient,
  type HttpClientError,
  HttpClientRequest,
} from "effect/http";
import { HttpApiClient } from "effect/http-api";
import {
  Hub,
  type RouteQuestion,
  type TranscriptOf,
} from "#02-application/interfaces/hub.ts";
import type { RoutedClient } from "#03-domain/client.ts";
import type { HubAddress } from "#03-domain/hub-address.ts";
import {
  HubFailed,
  HubKeyUnknown,
  HubUnreachable,
  RouteRefused,
} from "#03-domain/machine.ts";
import {
  type Ask,
  HubAnswered,
  type Transcript,
  urlOf,
} from "#03-domain/memory.ts";
import {
  type GivenList,
  type RouteList,
  RoutesChanged,
  RoutesRefused,
  SignInRefused,
} from "#03-domain/route-list.ts";

const signInCookie = "cota_sign_in";

const clientWith = (hub: HubAddress, name: string, value: string) =>
  HttpApiClient.make(Api, {
    baseUrl: hub,
    transformClient: HttpClient.mapRequest(
      HttpClientRequest.setHeader(name, value),
    ),
  });

const clientOf = (hub: HubAddress, key: Redacted.Redacted<string>) =>
  clientWith(hub, "x-cota-key", Redacted.value(key));

const ownersClientOf = (hub: HubAddress, signIn: Redacted.Redacted<string>) =>
  clientWith(hub, "cookie", `${signInCookie}=${Redacted.value(signIn)}`);

const transportOrFailed = (error: HttpClientError.HttpClientError) =>
  error.reason._tag === "TransportError"
    ? new HubUnreachable()
    : new HubFailed({});

const Listing = Schema.Struct({
  data: Schema.Array(Schema.Struct({ id: Schema.String })),
});

const Problem = Schema.Struct({ type: Schema.String });

const routeListOf = (list: {
  readonly client: RoutedClient;
  readonly routes: ReadonlyArray<{
    readonly position: number;
    readonly pattern: string;
    readonly pool: string;
  }>;
  readonly defaultPool: { readonly pool: string } | null;
  readonly revision: number;
}): RouteList => ({
  client: list.client,
  routes: list.routes.map(({ position, pattern, pool }) => ({
    position,
    pattern,
    pool,
  })),
  defaultPool: Option.map(
    Option.fromNullOr(list.defaultPool),
    ({ pool }) => pool,
  ),
  revision: list.revision,
});

const problemOf = (problem: {
  readonly status: number;
  readonly title: string;
  readonly detail?: string;
}) =>
  new HubAnswered({
    status: problem.status,
    text: problem.detail ?? problem.title,
  });

const transcriptOf = (transcript: Transcript): Transcript => ({
  request: transcript.request,
  protocol: transcript.protocol,
  entries: transcript.entries,
});

/** The hub over HTTP: its API through the typed client of `@cota/hub/api`, as the dashboard calls it. */
export const layer: Layer.Layer<Hub> = Layer.effect(
  Hub,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    return Hub.of({
      health: Effect.fn("Hub.health")(function* (hub: HubAddress) {
        const response = yield* http
          .get(`${hub}/health`)
          .pipe(Effect.mapError(() => new HubUnreachable()));
        if (response.status !== 200) {
          return yield* new HubFailed({ status: response.status });
        }
      }),
      machine: Effect.fn("Hub.machine")(function* (
        hub: HubAddress,
        key: Redacted.Redacted<string>,
      ) {
        const client = yield* clientOf(hub, key).pipe(
          Effect.provideService(HttpClient.HttpClient, http),
        );
        const machine = yield* client.machine.read().pipe(
          Effect.mapError((error) => {
            if (error._tag === "SignInRequired") return new HubKeyUnknown();
            return error._tag === "HttpClientError" &&
              error.reason._tag === "TransportError"
              ? new HubUnreachable()
              : new HubFailed({});
          }),
        );
        if (machine.hubKey === null) return yield* new HubFailed({});
        return {
          hubKey: machine.hubKey,
          // Only the owner is answered an observed pool, so a hub key never is.
          pools: machine.pools.flatMap(
            ({ id, kind, protocol, displayName, models }) =>
              kind === "observed" || protocol === null
                ? []
                : [{ id, kind, protocol, displayName, models }],
          ),
        };
      }),
      route: Effect.fn("Hub.route")(function* (
        hub: HubAddress,
        key: Redacted.Redacted<string>,
        question: RouteQuestion,
      ) {
        const client = yield* clientOf(hub, key).pipe(
          Effect.provideService(HttpClient.HttpClient, http),
        );
        const answer = yield* client.routes
          .answer({
            query: {
              client: question.client,
              project: question.project,
              ...Option.match(question.pool, {
                onNone: () => ({}),
                onSome: (pool) => ({ pool }),
              }),
            },
          })
          .pipe(
            Effect.mapError((error) => {
              const refused = (
                refusal: RouteRefused["refusal"],
                problem: { readonly title: string; readonly detail?: string },
              ) =>
                new RouteRefused({
                  refusal,
                  detail: problem.detail ?? problem.title,
                });
              switch (error._tag) {
                case "NoRouteProblem":
                  return refused("no-route", error);
                case "RoutePoolGoneProblem":
                  return refused("route-pool-gone", error);
                case "NoSuchPoolProblem":
                  return refused("no-such-pool", error);
                case "PoolNotForClientProblem":
                  return refused("pool-not-for-client", error);
                case "SignInRequired":
                  return new HubKeyUnknown();
                case "HttpClientError":
                  return error.reason._tag === "TransportError"
                    ? new HubUnreachable()
                    : new HubFailed({});
                default:
                  return new HubFailed({});
              }
            }),
          );
        return {
          project: answer.project,
          pool: answer.pool,
          by:
            answer.route !== null
              ? {
                  _tag: "Route" as const,
                  position: answer.route.position,
                  pattern: answer.route.pattern,
                }
              : answer.by === "override"
                ? { _tag: "Override" as const }
                : { _tag: "Default" as const },
          defaultPool: Option.fromNullOr(answer.defaultPool),
        };
      }),
      models: Effect.fn("Hub.models")(function* (
        hub: HubAddress,
        key: Redacted.Redacted<string>,
        pool: string,
      ) {
        const response = yield* http
          .execute(
            HttpClientRequest.get(
              `${hub}/pools/${encodeURIComponent(pool)}/models`,
            ).pipe(
              HttpClientRequest.setHeaders({
                "x-cota-key": Redacted.value(key),
                "x-cota-client": "cota",
              }),
            ),
          )
          .pipe(Effect.mapError(transportOrFailed));
        if (response.status === 401) return yield* new HubKeyUnknown();
        if (response.status !== 200) {
          return yield* new HubFailed({ status: response.status });
        }
        const listing = yield* response.json.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Listing)),
          Effect.mapError(() => new HubFailed({})),
        );
        return listing.data.map(({ id }) => id);
      }),
      ask: Effect.fn("Hub.ask")(
        function* (hub: HubAddress, key: Redacted.Redacted<string>, ask: Ask) {
          const request =
            ask._tag === "Get"
              ? HttpClientRequest.get(urlOf(hub, ask))
              : HttpClientRequest.post(urlOf(hub, ask)).pipe(
                  HttpClientRequest.bodyJsonUnsafe({ sql: ask.sql }),
                );
          const response = yield* http.execute(
            request.pipe(
              HttpClientRequest.setHeader("x-cota-key", Redacted.value(key)),
            ),
          );
          return { status: response.status, body: yield* response.text };
        },
        Effect.mapError(() => new HubUnreachable()),
      ),
      transcript: Effect.fn("Hub.transcript")(function* (
        hub: HubAddress,
        key: Redacted.Redacted<string>,
        of: TranscriptOf,
      ) {
        const client = yield* clientOf(hub, key).pipe(
          Effect.provideService(HttpClient.HttpClient, http),
        );
        if (of._tag === "Session") {
          const detail = yield* client.sessions
            .session({ params: { session: of.session } })
            .pipe(
              Effect.mapError((error) => {
                switch (error._tag) {
                  case "NoSuchSessionProblem":
                  case "RequestLogProblem":
                    return problemOf(error);
                  case "SignInRequired":
                    return new HubKeyUnknown();
                  case "HttpClientError":
                    return transportOrFailed(error);
                  default:
                    return new HubFailed({});
                }
              }),
            );
          return {
            _tag: "Session" as const,
            session: of.session,
            segments: detail.segments.map(({ tip, startedAt, requests }) => ({
              tip,
              startedAt: DateTime.formatIso(startedAt),
              requests,
            })),
            transcript: Option.map(
              Option.fromNullOr(detail.transcript),
              transcriptOf,
            ),
          };
        }
        const inspected = yield* client.requests
          .request({ params: { id: of.request } })
          .pipe(
            Effect.mapError((error) => {
              switch (error._tag) {
                case "NoSuchRequestProblem":
                case "RequestLogProblem":
                  return problemOf(error);
                case "SignInRequired":
                  return new HubKeyUnknown();
                case "HttpClientError":
                  return transportOrFailed(error);
                default:
                  return new HubFailed({});
              }
            }),
          );
        const parts = [inspected.system, inspected.input, inspected.output];
        return {
          _tag: "Request" as const,
          request: of.request,
          transcript: parts.every((entries) => entries === null)
            ? Option.none()
            : Option.some({
                request: inspected.request.id,
                protocol: inspected.request.protocol,
                entries: parts.flatMap((entries) => entries ?? []),
              }),
        };
      }),
      signIn: Effect.fn("Hub.signIn")(function* (
        hub: HubAddress,
        password: Redacted.Redacted<string>,
      ) {
        const response = yield* http
          .execute(
            HttpClientRequest.post(`${hub}/api/sign-in`).pipe(
              HttpClientRequest.setHeader("user-agent", "cota routes"),
              HttpClientRequest.bodyJsonUnsafe({
                password: Redacted.value(password),
              }),
            ),
          )
          .pipe(Effect.mapError(transportOrFailed));
        if (response.status === 204) {
          const cookie = Cookies.getValue(response.cookies, signInCookie);
          if (Option.isNone(cookie)) return yield* new HubFailed({});
          return Redacted.make(cookie.value);
        }
        const problem = yield* response.json.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Problem)),
          Effect.orElseSucceed(() => ({ type: "" })),
        );
        switch (problem.type) {
          case "urn:cota:wrong-password":
            return yield* new SignInRefused({ refusal: "wrong-password" });
          case "urn:cota:password-off":
            return yield* new SignInRefused({ refusal: "password-off" });
          case "urn:cota:not-set-up":
            return yield* new SignInRefused({ refusal: "not-set-up" });
          case "urn:cota:too-many-attempts": {
            const retryAfter = response.headers["retry-after"];
            return yield* new SignInRefused({
              refusal: "too-many-attempts",
              ...(retryAfter === undefined ? {} : { retryAfter }),
            });
          }
          default:
            return yield* new HubFailed({ status: response.status });
        }
      }),
      signOut: Effect.fn("Hub.signOut")(function* (
        hub: HubAddress,
        signIn: Redacted.Redacted<string>,
      ) {
        const client = yield* ownersClientOf(hub, signIn).pipe(
          Effect.provideService(HttpClient.HttpClient, http),
        );
        yield* client["sign-in"]
          .signOut()
          .pipe(
            Effect.mapError((error) =>
              error._tag === "HttpClientError"
                ? transportOrFailed(error)
                : new HubFailed({}),
            ),
          );
      }),
      routes: Effect.fn("Hub.routes")(function* (
        hub: HubAddress,
        signIn: Redacted.Redacted<string>,
        client: RoutedClient,
      ) {
        const api = yield* ownersClientOf(hub, signIn).pipe(
          Effect.provideService(HttpClient.HttpClient, http),
        );
        const { clients } = yield* api.routes
          .list()
          .pipe(
            Effect.mapError((error) =>
              error._tag === "HttpClientError"
                ? transportOrFailed(error)
                : new HubFailed({}),
            ),
          );
        const list = clients.find((each) => each.client === client);
        if (list === undefined) return yield* new HubFailed({});
        return routeListOf(list);
      }),
      changeRoutes: Effect.fn("Hub.changeRoutes")(function* (
        hub: HubAddress,
        signIn: Redacted.Redacted<string>,
        client: RoutedClient,
        revision: number,
        list: GivenList,
      ) {
        const api = yield* ownersClientOf(hub, signIn).pipe(
          Effect.provideService(HttpClient.HttpClient, http),
        );
        const stored = yield* api.routes
          .change({
            params: { client },
            payload: {
              revision,
              routes: list.routes,
              defaultPool: Option.getOrNull(list.defaultPool),
            },
          })
          .pipe(
            Effect.mapError((error) => {
              switch (error._tag) {
                case "RoutesRefusedProblem":
                  return new RoutesRefused({
                    refusals: error.refusals.map(
                      ({ position, reason, shadowedBy }) => ({
                        position: Option.fromNullOr(position),
                        reason,
                        shadowedBy: Option.fromNullOr(shadowedBy),
                      }),
                    ),
                  });
                case "RoutesChangedProblem":
                  return new RoutesChanged();
                case "HttpClientError":
                  return transportOrFailed(error);
                default:
                  return new HubFailed({});
              }
            }),
          );
        return routeListOf(stored);
      }),
    });
  }),
).pipe(Layer.provide(FetchHttpClient.layer));
