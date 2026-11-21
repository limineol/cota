---
status: accepted
scope: apps/hub
owner: limineol
last_verified: 2026-11-13
review_by: 2027-02-13
supersedes: []
code:
  - apps/hub/src/api.ts
  - apps/hub/src/hub.ts
  - apps/hub/package.json
  - tooling/boundaries.ts
---

# ADR-0011: The hub's API is a typed contract under `/api`

## Context

Milestone 2 gives the request log readers: the dashboard (Milestone 3), and the owner's agents, which read sessions and run SQL. The prototype's dashboard API was a hand-written Bun server whose types lived in a shared `types.ts` that nothing checked against the answers, and whose errors were whatever each handler threw: a 401 with `{error}`, a 400 with ClickHouse's message, a 404 with `No such <what>`. Its client cast responses to those types.

The hub already answers HTTP: the relay's routes (`modules/relay/01-presentation/relay.routes.ts`) are hand-written on Effect's `HttpRouter`, because they forward bytes and must not decode anything (ADR-0006). The API is the opposite: every request and every answer is a value the hub decodes or encodes.

Effect 4.1.4, which the hub pins, ships `effect/http-api` (read from its type definitions under `node_modules/.bun/effect@4.1.4/node_modules/effect/dist/http-api`):

- `HttpApi.make(id).add(group…).prefix(path)`, `HttpApiGroup.make(id).add(endpoint…).prefix(path)`, and `HttpApiEndpoint.get|post|put|patch|delete(name, path, { params, query, headers, payload, success, error })`, whose options are Schemas.
- `HttpApiBuilder.layer(api, { openapiPath })` and `HttpApiBuilder.group(api, name, handlers)`, which serve the definition on the same `HttpRouter` the relay uses.
- `HttpApiSecurity.bearer`, `HttpApiSecurity.apiKey({ key, in: "header" | "query" | "cookie" })` and `HttpApiMiddleware.Service` with a `security` record: the builder decodes each scheme in turn and the first whose handler succeeds wins (`HttpApiBuilder.js`, `makeSecurityMiddleware`).
- `HttpApiError.Problem` (since 4.0.6): a typed RFC 9457 problem declared as a `Schema` error class with a fixed `type`, `status` and `title`, rendered as `application/problem+json`, documented in OpenAPI and decoded by clients. `HttpApiMiddleware.ProblemDetails` renders request-decoding failures as a 400 problem.
- `OpenApi.fromApi(api)`, `HttpApiClient` (a typed client derived from the definition), and `HttpApiTest.groups(api, groups)`, an in-memory typed client over the real handlers.

All of it is marked unstable, as is `effect/http`, which the relay already uses.

## Decision

- **The API is one `HttpApi`, served under `/api`** on the hub's server beside the relay's `/pools/…` and `/health`. Its definition is `apps/hub/src/api.ts`, part of the composition root: it adds each group and is exported as `@cota/hub/api` for the dashboard's client in Milestone 3. Each group is defined in the `01-presentation` of the module that owns it (`<group>.api.ts`), with its handlers beside it (`<group>.handlers.ts`), which call that module's commands and queries and nothing else. A module may own several groups; a group belongs to one module.
- **Every value is a Schema.** Path parameters, query, payload and success are Schemas from the owning module's `03-domain` or its `01-presentation`, never `unknown`. What the endpoints are, field by field, is `docs/specs/api/spec.md`.
- **Paths are nouns, in kebab case**, under the group's prefix: `/api/sessions`, `/api/sessions/{session}`, `/api/requests/{id}`, `/api/display-names/{kind}/{key}`. Reading is `GET`; running a query whose text does not fit a URL is `POST` (`/api/sql`); changing one thing is `PUT` or `DELETE` on it.
- **One error shape: an RFC 9457 problem.** Every error the API answers itself is `application/problem+json`: `{ "type": "urn:cota:<name>", "status": <code>, "title": "<fixed sentence>", "detail": "<this case>" }`, declared per endpoint with `HttpApiError.Problem`, so the definition lists every error an endpoint can give. `type` is the stable part a client switches on; `title` belongs to the type; `detail` is for the owner and never carries a secret. A request that fails to decode is the `ProblemDetails` middleware's 400, with each issue's path. The relay's own errors keep their shape (ADR-0006), which clients' libraries need; the API's 401 is allowed, since no client reads `/api` as its provider.
- **No version in the path until there is a second.** Until the first release the API changes with the dashboard in the same pull request. After it, an endpoint only gains optional fields and new endpoints; removing a field or changing its meaning is a new path, and the old one is kept until the next release.
- **The OpenAPI document is committed.** `apps/hub/openapi.json` is `OpenApi.fromApi(api)`, written by a script and checked by a test that fails when it differs, so every change to the contract is a reviewed diff. The hub also serves it at `GET /api/openapi.json`, without sign-in: it describes the code, which is public, and holds no data.
- **Every group declares the same middleware**, in this order: `CallerMiddleware` (who is asking, and whether they may call the endpoint; `docs/specs/sign-in/spec.md`), then `JsonBody` (a body must be said to be JSON, else 415, and be at most 1 MiB, else 413) and `ProblemDetails` (a request that does not decode is a 400 problem). Each group carries its own `/api` prefix, so that its handlers' types are the same inside the API as in the group's file. An endpoint added to a group before the group declares `CallerMiddleware` needs no caller.
- **Contract tests are derived from the definition.** The contract tier (beside property, replay and clickhouse in ADR-0004), in `*.contract.test.ts`, runs a whole hub through the harness (`shared/05-tests/harness.ts`) with a scratch hub store and the module's fakes, and calls it over HTTP:
  - For every endpoint, a test calls it through the typed client (`HttpApiClient`, the dashboard's), which decodes every answer with the declared Schema, and asserts its literal answer, with plain requests where a header or a cookie is the point.
  - One test walks every endpoint of the definition and checks what holds for all of them: that it answers 401 with no credential, 403 for a subscription or keyed hub key, and only the problems it declares (the sign-in spec's laws I1 and I2, the api spec's H1). An endpoint added later is covered without writing a test for it.
  - The ClickHouse repository's reading queries are held against the in-memory fake by the clickhouse tier, so a contract test over the fake says what the real hub answers.

## Alternatives weighed

- **Hand-written routes on `HttpRouter`, as the relay's.** Nothing would tie an answer to a type a client can import, and every endpoint would need its own decoding, error mapping and OpenAPI text. The relay is hand-written because it must not decode; the API must.
- **`@effect/rpc`** gives a typed client and server too, but one POST endpoint with a procedure name in the body: agents could not use `curl` or read an OpenAPI document, and a browser could not cache a `GET`.
- **A version prefix now (`/api/v1`).** It costs a segment in every path and promises a second version nobody has planned; the rule above makes one when a breaking change needs it.
- **The relay's error body (`{type: "error", error: {type, message}}`) for the API too.** It exists for Anthropic's and OpenAI's client libraries. The API's clients are the dashboard and agents, and RFC 9457 is what `effect/http-api` declares, documents and decodes for free.
- **`HttpApiTest.groups` for contract tests**, as first planned. It calls the handlers in memory, without the server: the cookie's attributes, `retry-after`, the body limit and the pool routes beside the API would go untested, and every test would assemble the middleware itself. The harness already runs a whole hub in a test, with fakes for what leaves the process, so the contract tier uses it.
- **One group per module**, as first planned. The request log owns most of the API; one group for all of it would put sessions, search and SQL in one file and one OpenAPI tag. A group per concept, each owned by one module, keeps the files and the document readable without changing who owns what.

## Consequences

- `tooling/boundaries.ts` learns `api.ts` as part of the composition root, which tests and the package's `exports` may import. A module's `01-presentation` already may import `effect/http` and `effect/http-api`; `02-application` and `03-domain` still may not, so the Schemas a group uses live in `03-domain` or `01-presentation`.
- The security middleware every group declares (`docs/specs/sign-in/spec.md`) is defined once, in `shared/01-presentation`, and implemented by the sign-in module, which asks the admission module who a hub key is.
- `effect/http-api` is unstable. An Effect upgrade that changes it is caught by the type check and the contract tier, and costs the API's presentation layer, never a module's domain or use cases.
- The committed OpenAPI document is large and changes with every endpoint. That is the point: the owner reviews the contract as a diff.
