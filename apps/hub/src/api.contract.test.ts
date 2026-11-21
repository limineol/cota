import { readFileSync } from "node:fs";
import { expect, layer } from "@effect/vitest";
import { Context, Effect, Exit, Schema } from "effect";
import { HttpApi, type HttpApiEndpoint } from "effect/http-api";
import { Api } from "#api.ts";
import {
  CallerMiddleware,
  MayCall,
} from "#shared/01-presentation/caller.middleware.ts";
import type { MayCall as Who } from "#shared/03-domain/caller.ts";
import * as Harness from "#shared/05-tests/harness.ts";
import * as OpenApiDocument from "#shared/05-tests/openapi.ts";

type Access = Who | "anyone";

/**
 * Who may call each endpoint: the sign-in spec's table, written out here so
 * that a change to an endpoint's declaration fails until both are changed.
 */
const access: Readonly<Record<string, Access>> = {
  "POST /api/sign-in": "anyone",
  "GET /api/sign-in": "anyone",
  "POST /api/setup": "anyone",
  "POST /api/sign-in/passkey/options": "anyone",
  "POST /api/sign-in/passkey": "anyone",
  "PUT /api/session-titles": "any-hub-key",
  "GET /api/machine": "any-hub-key",
  "GET /api/route": "any-hub-key",
  "GET /api/me": "reader",
  "GET /api/overview": "reader",
  "GET /api/series": "reader",
  "GET /api/breakdown": "reader",
  "GET /api/facets": "reader",
  "GET /api/errors": "reader",
  "GET /api/sessions": "reader",
  "GET /api/sessions/{session}": "reader",
  "GET /api/requests/{id}": "reader",
  "GET /api/requests/{id}/body": "reader",
  "GET /api/search": "reader",
  "POST /api/sql": "reader",
  "GET /api/schema": "reader",
  "GET /api/display-names": "reader",
  "GET /api/pools": "reader",
  "GET /api/routes": "reader",
  "POST /api/sign-out": "owner",
  "GET /api/sign-ins": "owner",
  "DELETE /api/sign-ins": "owner",
  "DELETE /api/sign-ins/{id}": "owner",
  "GET /api/owner-password": "owner",
  "PUT /api/owner-password": "owner",
  "DELETE /api/owner-password": "owner",
  "POST /api/passkeys/options": "owner",
  "POST /api/passkeys": "owner",
  "GET /api/passkeys": "owner",
  "DELETE /api/passkeys/{id}": "owner",
  "PUT /api/display-names/{kind}/{key}": "owner",
  "DELETE /api/display-names/{kind}/{key}": "owner",
  "PUT /api/pools/{pool}/quota-login": "owner",
  "DELETE /api/pools/{pool}/quota-login": "owner",
  "PUT /api/routes/{client}": "owner",
};

interface Endpoint {
  readonly name: string;
  readonly method: HttpApiEndpoint.Top["method"];
  readonly path: string;
  /** Who the table above says may call it. */
  readonly mayCall: Access;
  /** Who its declaration says may call it: `anyone` when it does not declare `CallerMiddleware`. */
  readonly declares: Access;
  readonly successes: ReadonlyMap<number, ReadonlyArray<Schema.Top>>;
  readonly errors: ReadonlyMap<number, ReadonlyArray<Schema.Top>>;
}

const endpoints: Array<Endpoint> = [];
HttpApi.reflect(Api, {
  onGroup: () => {},
  onEndpoint: ({ endpoint, middleware, successes, errors }) => {
    const name = `${endpoint.method} ${endpoint.path.replaceAll(/:(\w+)/g, "{$1}")}`;
    endpoints.push({
      name,
      method: endpoint.method,
      path: endpoint.path.replaceAll(
        /:\w+/g,
        "01a1cd0d-dc00-70df-a1a8-000000000000",
      ),
      mayCall: access[name] ?? "owner",
      declares: [...middleware].some(({ key }) => key === CallerMiddleware.key)
        ? Context.get(endpoint.annotations, MayCall)
        : "anyone",
      successes,
      errors,
    });
  },
});

const known = endpoints.filter(({ mayCall }) => mayCall !== "anyone");

const call = (endpoint: Endpoint, headers: Record<string, string>) =>
  Harness.send(endpoint.path, { method: endpoint.method, headers });

const statusOf = (endpoint: Endpoint, headers: Record<string, string>) =>
  Effect.gen(function* () {
    const answer = yield* call(endpoint, headers);
    const body: unknown = JSON.parse((yield* Harness.textOf(answer)) || "null");
    const type =
      typeof body === "object" && body !== null && "type" in body
        ? body.type
        : undefined;
    return `${endpoint.name}: ${answer.status} ${String(type)}`;
  });

/** The API's Schemas need no service to decode, which `Schema.Top` cannot say. */
const decodes = (
  schemas: ReadonlyArray<Schema.Top> | undefined,
  body: unknown,
) =>
  (schemas ?? []).some((schema) =>
    Exit.isSuccess(
      Schema.decodeUnknownExit(
        Schema.toCodecJson(schema as Schema.Codec<unknown, unknown>),
      )(body),
    ),
  );

/**
 * Whether an answer is the endpoint's success or a problem it declares (H1),
 * its success decoding with its Schema (H2). Every endpoint declares the 500
 * of an answer the hub fails to encode, which is never a correct answer.
 */
const declared = (endpoint: Endpoint, answer: Response) =>
  Effect.gen(function* () {
    const text = yield* Harness.textOf(answer);
    if (answer.status === 500) return false;
    if (answer.status === 204) return endpoint.successes.has(204);
    const body: unknown = JSON.parse(text);
    if (endpoint.successes.has(answer.status)) {
      return decodes(endpoint.successes.get(answer.status), body);
    }
    return (
      answer.headers.get("content-type") === "application/problem+json" &&
      decodes(endpoint.errors.get(answer.status), body)
    );
  });

const fleet = { "x-cota-key": Harness.secrets.fleetHubKey };
const clients = { "x-cota-key": Harness.secrets.clientsHubKey };
const reader = { "x-cota-key": Harness.secrets.readerHubKey };

layer(Harness.layer())("the API", (it) => {
  it.effect(
    "every endpoint declares who may call it as the sign-in spec's table says, and the table names every endpoint",
    () =>
      Effect.sync(() => {
        expect(
          Object.fromEntries(
            endpoints.map(({ name, declares }) => [name, declares]),
          ),
        ).toEqual(access);
        expect(new Set(endpoints.map(({ mayCall }) => mayCall))).toEqual(
          new Set(["anyone", "any-hub-key", "reader", "owner"]),
        );
      }),
  );

  it.effect("serves every endpoint of the definition under /api/", () =>
    Effect.sync(() => {
      expect(endpoints.filter(({ path }) => !path.startsWith("/api/"))).toEqual(
        [],
      );
    }),
  );

  it.effect(
    "I1: every endpoint but those anyone may call and the definition answers 401 to a request with no caller, or one whose cookie and hub key the hub does not know",
    () =>
      Effect.gen(function* () {
        const strangers = [
          {},
          { cookie: "cota_sign_in=6f0b2c-not-a-sign-in" },
          { "x-cota-key": "not-a-hub-key" },
          { authorization: "Bearer not-a-hub-key" },
          {
            cookie: "cota_sign_in=6f0b2c-not-a-sign-in",
            "x-cota-key": "not-a-hub-key",
          },
        ];
        const answers: Array<string> = [];
        const expected: Array<string> = [];
        for (const endpoint of known) {
          for (const stranger of strangers) {
            answers.push(yield* statusOf(endpoint, stranger));
            expected.push(`${endpoint.name}: 401 urn:cota:sign-in-required`);
          }
        }
        expect(answers).toEqual(expected);
        expect(
          endpoints
            .filter(({ mayCall }) => mayCall === "anyone")
            .map(({ name }) => name),
        ).toEqual([
          "POST /api/sign-in",
          "GET /api/sign-in",
          "POST /api/setup",
          "POST /api/sign-in/passkey/options",
          "POST /api/sign-in/passkey",
        ]);
        expect((yield* Harness.send("/api/openapi.json")).status).toBe(200);
      }),
  );

  it.effect(
    "I2: every endpoint but those anyone may call and those any hub key may call answers 403 to a subscription or keyed hub key",
    () =>
      Effect.gen(function* () {
        const spending = known.filter(
          ({ mayCall }) => mayCall !== "any-hub-key",
        );
        const answers: Array<string> = [];
        for (const endpoint of spending) {
          answers.push(yield* statusOf(endpoint, fleet));
          answers.push(yield* statusOf(endpoint, clients));
        }
        expect(answers).toEqual(
          spending.flatMap(({ name }) => [
            `${name}: 403 urn:cota:not-allowed`,
            `${name}: 403 urn:cota:not-allowed`,
          ]),
        );
      }),
  );

  it.effect(
    "I3: a reader key gets 403 from every endpoint kept for the owner",
    () =>
      Effect.gen(function* () {
        const owners = known.filter(({ mayCall }) => mayCall === "owner");
        const answers: Array<string> = [];
        for (const endpoint of owners) {
          answers.push(yield* statusOf(endpoint, reader));
        }
        expect(answers).toEqual(
          owners.map(({ name }) => `${name}: 403 urn:cota:not-allowed`),
        );
      }),
  );

  it.effect(
    "I10: every endpoint answers 415 to a request whose body is not said to be JSON, before it decodes anything",
    () =>
      Effect.gen(function* () {
        const { cookie } = yield* Harness.signIn();
        const answers: Array<string> = [];
        const expected: Array<string> = [];
        for (const endpoint of endpoints) {
          for (const framing of [
            "content-length: 2",
            "content-type: text/plain;charset=UTF-8\r\ncontent-length: 2",
            "content-type: application/x-www-form-urlencoded\r\ncontent-length: 2",
            "content-type: multipart/form-data; boundary=x\r\ncontent-length: 2",
            "transfer-encoding: chunked",
          ]) {
            const body = framing.startsWith("transfer-encoding")
              ? "2\r\n{}\r\n0\r\n\r\n"
              : "{}";
            const answer = yield* Harness.sendRaw(
              `${endpoint.method} ${endpoint.path} HTTP/1.1\r\nhost: hub\r\nconnection: close\r\ncookie: ${cookie}\r\n${framing}\r\n\r\n${body}`,
            );
            const status = answer.split(" ")[1];
            const type = /"type":"([^"]+)"/.exec(answer)?.[1];
            answers.push(`${endpoint.name} (${framing}): ${status} ${type}`);
            expected.push(
              `${endpoint.name} (${framing}): 415 urn:cota:unsupported-media-type`,
            );
          }
        }
        expect(answers).toEqual(expected);
      }),
  );

  it.effect("admits to every endpoint the callers the table opens it to", () =>
    Effect.gen(function* () {
      const answers: Array<string> = [];
      const expected: Array<string> = [];
      for (const endpoint of known) {
        const owner = yield* Harness.signIn();
        const callers = {
          owner: [owner],
          reader: [owner, reader],
          "any-hub-key": [owner, reader, fleet, clients],
        }[endpoint.mayCall === "anyone" ? "owner" : endpoint.mayCall];
        for (const caller of callers) {
          const answer = yield* statusOf(endpoint, caller);
          answers.push(answer.replace(/: 40[13] .*/, ": refused"));
          expected.push(answer.replace(/: 40[13] .*/, ": admitted"));
        }
      }
      expect(answers).toEqual(expected);
    }),
  );

  it.effect(
    "H1: every answer of an endpoint is its declared success or a problem it declares, never a 500, whoever calls it with whatever body",
    () =>
      Effect.gen(function* () {
        const callers: Array<Record<string, string>> = [
          {},
          fleet,
          clients,
          reader,
          { authorization: `Bearer ${Harness.secrets.readerHubKey}` },
        ];
        const undeclared: Array<string> = [];
        for (const endpoint of endpoints) {
          for (const caller of [
            ...callers,
            yield* Harness.signIn(),
            {
              ...(yield* Harness.signIn()),
              "sec-fetch-site": "cross-site",
            },
          ]) {
            for (const [contentType, body] of [
              ["application/json", undefined],
              ["application/json", "{"],
              ["application/json", "{}"],
              ["text/plain", "{}"],
            ] as const) {
              const answer = yield* Harness.send(endpoint.path, {
                method: endpoint.method,
                headers: { "content-type": contentType, ...caller },
                ...(body === undefined || endpoint.method === "GET"
                  ? {}
                  : { body }),
              });
              const status = answer.status;
              if (!(yield* declared(endpoint, answer))) {
                undeclared.push(`${endpoint.name}: ${status}`);
              }
            }
          }
        }
        expect(undeclared).toEqual([]);
      }),
  );

  it.effect(
    "H3: the committed openapi.json is the definition's OpenAPI document, which the hub serves to anyone",
    () =>
      Effect.gen(function* () {
        const served = yield* Harness.send("/api/openapi.json");
        expect([
          JSON.parse(readFileSync(OpenApiDocument.committed, "utf8")),
          JSON.parse(yield* Harness.textOf(served)),
        ]).toEqual([OpenApiDocument.document(), OpenApiDocument.document()]);
      }),
  );
});
