import { Api } from "@cota/hub/api";
import { Effect, Layer, type Schema } from "effect";
import {
  HttpClient,
  HttpClientError,
  type HttpClientRequest,
  HttpClientResponse,
} from "effect/http";
import type { HttpApiEndpoint } from "effect/http-api";
import { type Caller, callerOver } from "#shared/api.ts";

type Groups = typeof Api.groups;
type Group = keyof Groups;
type Endpoints<G extends Group> = Groups[G]["endpoints"];

type Encoded<S> =
  S extends Schema.toCodecJson<infer Inner> ? Inner["Encoded"] : never;

type Wire<Problem> = Problem extends {
  readonly type: infer Type;
  readonly status: infer Status;
}
  ? { readonly type: Type; readonly status: Status; readonly detail?: string }
  : never;

type Reply =
  | {
      readonly _tag: "Answer";
      readonly status: number;
      readonly headers: Readonly<Record<string, string>>;
      readonly body: unknown;
    }
  | { readonly _tag: "Never" }
  | { readonly _tag: "Unreachable" };

/** What the fake answers to one endpoint, as the hub would put it on the wire, or that it never answers. */
export interface Fixture {
  readonly method: string;
  readonly path: string;
  readonly reply: Reply;
  readonly once: boolean;
  readonly matches: (query: URLSearchParams, body: unknown) => boolean;
}

interface Route {
  readonly method: string;
  readonly path: string;
}

const routeOf = (group: Group, name: string): Route => {
  const endpoints: Record<string, Route> = Api.groups[group].endpoints;
  const endpoint = endpoints[name];
  if (endpoint === undefined) throw new Error(`${group} has no ${name}`);
  return endpoint;
};

const fixture = (group: Group, name: string, reply: Reply): Fixture => {
  const { method, path } = routeOf(group, name);
  return { method, path, reply, once: false, matches: () => true };
};

/** The endpoint's success, encoded as its success Schema writes it. */
export const answer = <G extends Group, N extends keyof Endpoints<G> & string>(
  group: G,
  name: N,
  body: Encoded<HttpApiEndpoint.Success<Endpoints<G>[N]>>,
): Fixture =>
  fixture(group, name, {
    _tag: "Answer",
    status: 200,
    headers: { "content-type": "application/json" },
    body,
  });

/** The 204 of an endpoint whose success has no content. */
export const noContent = <
  G extends Group,
  N extends keyof Endpoints<G> & string,
>(
  group: G,
  name: N,
): Fixture =>
  fixture(group, name, {
    _tag: "Answer",
    status: 204,
    headers: {},
    body: undefined,
  });

/**
 * One of the problems the endpoint or its middleware declares, with any
 * headers the hub sends beside it, and the fields of its own a problem
 * carries beside its detail, such as `routes-refused`'s refusals, which the
 * client decodes as the hub's Schema has them.
 */
export const problem = <G extends Group, N extends keyof Endpoints<G> & string>(
  group: G,
  name: N,
  body: Wire<HttpApiEndpoint.Errors<Endpoints<G>[N]>> & {
    readonly status: number;
  },
  headers: Readonly<Record<string, string>> = {},
  fields: Readonly<Record<string, unknown>> = {},
): Fixture =>
  fixture(group, name, {
    _tag: "Answer",
    status: body.status,
    headers: { ...headers, "content-type": "application/problem+json" },
    body: { ...fields, ...body },
  });

/** A request the hub takes and never answers, as one still on its way. */
export const never = <G extends Group, N extends keyof Endpoints<G> & string>(
  group: G,
  name: N,
): Fixture => fixture(group, name, { _tag: "Never" });

/** A request that reaches no hub, as when it is down or the network is. */
export const unreachable = <
  G extends Group,
  N extends keyof Endpoints<G> & string,
>(
  group: G,
  name: N,
): Fixture => fixture(group, name, { _tag: "Unreachable" });

/** A fixture that answers the first request only; a later one is answered by the next fixture that matches. */
export const once = (answered: Fixture): Fixture => ({
  ...answered,
  once: true,
});

/** A fixture that answers only a request whose query parameters pass `test`; others go on to the next fixture. */
export const where = (
  answered: Fixture,
  test: (query: URLSearchParams) => boolean,
): Fixture => ({ ...answered, matches: test });

/** A fixture that answers only a request whose JSON body passes `test`; others go on to the next fixture. */
export const asked = (
  answered: Fixture,
  test: (body: unknown) => boolean,
): Fixture => ({ ...answered, matches: (_, body) => test(body) });

/** A fixture that answers only at one path, its parameters filled in: `/api/sessions/abc` of `/api/sessions/:session`. */
export const at = (answered: Fixture, path: string): Fixture => ({
  ...answered,
  path,
});

const segmentsOf = (path: string) => path.split("/").map(decodeURIComponent);

/** Whether a path is the fixture's, a `:parameter` of the fixture's taking any one segment. */
const pathMatches = (template: string, path: string) => {
  const wanted = segmentsOf(template);
  const given = segmentsOf(path);
  return (
    wanted.length === given.length &&
    wanted.every(
      (segment, index) => segment.startsWith(":") || segment === given[index],
    )
  );
};

const bodyOf = (request: HttpClientRequest.HttpClientRequest): unknown =>
  request.body._tag === "Uint8Array"
    ? JSON.parse(new TextDecoder().decode(request.body.body))
    : undefined;

/** A caller whose `HttpClient` answers from fixtures, and dies on a request none of them answers. */
export const fakeCaller = (fixtures: ReadonlyArray<Fixture>): Caller => {
  const used = new Set<Fixture>();
  return callerOver(
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request, url) => {
        const found = fixtures.find(
          (each) =>
            each.method === request.method &&
            pathMatches(each.path, url.pathname) &&
            each.matches(url.searchParams, bodyOf(request)) &&
            !used.has(each),
        );
        if (found === undefined) {
          return Effect.die(
            new Error(`No fixture answers ${request.method} ${url.pathname}`),
          );
        }
        if (found.once) used.add(found);
        const { reply } = found;
        switch (reply._tag) {
          case "Never":
            return Effect.never;
          case "Unreachable":
            return Effect.fail(
              new HttpClientError.HttpClientError({
                reason: new HttpClientError.TransportError({
                  request,
                  description: "The fixture reaches no hub.",
                }),
              }),
            );
          case "Answer":
            return Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                new Response(
                  reply.body === undefined ? null : JSON.stringify(reply.body),
                  { status: reply.status, headers: reply.headers },
                ),
              ),
            );
        }
      }),
    ),
  );
};
