import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, layer } from "@effect/vitest";
import { Arbitrary, Effect, Layer, Schema } from "effect";
import * as Hub from "#hub.ts";
import * as HubStore from "#shared/04-infrastructure/hub-store/hub-store.ts";
import * as Harness from "#shared/05-tests/harness.ts";

const fleet = { "x-cota-key": Harness.secrets.fleetHubKey };
const clients = { "x-cota-key": Harness.secrets.clientsHubKey };
const reader = { authorization: `Bearer ${Harness.secrets.readerHubKey}` };

const json = { "content-type": "application/json" };

const put = (client: string, body: unknown) =>
  Effect.gen(function* () {
    const owner = yield* Harness.signIn();
    return yield* Harness.send(`/api/routes/${client}`, {
      method: "PUT",
      headers: { ...owner, ...json },
      body: JSON.stringify(body),
    });
  });

const bodyOf = (response: Response) =>
  Effect.gen(function* () {
    const body: unknown = JSON.parse(yield* Harness.textOf(response));
    return { status: response.status, body };
  });

const route = (query: string, headers: Record<string, string> = fleet) =>
  Harness.send(`/api/route?${query}`, { headers }).pipe(Effect.flatMap(bodyOf));

const never = (client: string) => ({
  client,
  routes: [],
  defaultPool: null,
  revision: 0,
  changedAt: null,
});

const stored = {
  client: "claude-code",
  routes: [
    { position: 1, pattern: "acme/api", pool: "console", fits: true },
    { position: 2, pattern: "acme/*", pool: "claude", fits: true },
  ],
  defaultPool: { pool: "personal", fits: true },
  revision: 1,
  changedAt: "2026-11-12T00:00:00.000Z",
};

layer(Harness.layer())("the routes group", (it) => {
  it.effect(
    "answers both routed clients' lists, never stored, to a reader key and the owner",
    () =>
      Effect.gen(function* () {
        const answers = [
          yield* bodyOf(
            yield* Harness.send("/api/routes", { headers: reader }),
          ),
          yield* bodyOf(
            yield* Harness.send("/api/routes", {
              headers: yield* Harness.signIn(),
            }),
          ),
        ];
        const empty = {
          status: 200,
          body: { clients: [never("claude-code"), never("codex")] },
        };
        expect(answers).toEqual([empty, empty]);
      }),
  );

  it.effect(
    "refuses a list, naming every route and the default pool that is refused and why, a route to an observed pool among them, and stores nothing",
    () =>
      Effect.gen(function* () {
        const refused = yield* Harness.problemOf(
          yield* put("claude-code", {
            revision: 0,
            routes: [
              { pattern: "acme*", pool: "claude" },
              { pattern: "acme/*", pool: "claude" },
              { pattern: "a*b", pool: "nowhere" },
              { pattern: "ACME*", pool: "codex" },
              { pattern: " beta ", pool: "work" },
              { pattern: "*", pool: "solo" },
              { pattern: "gem", pool: "gemini" },
            ],
            defaultPool: "codex",
          }),
        );
        expect(refused).toEqual({
          status: 400,
          contentType: "application/problem+json",
          body: {
            type: "urn:cota:routes-refused",
            status: 400,
            title: "The routes were not stored.",
            detail:
              "The routes of claude-code were not stored: route 2: shadowed by route 1; route 3: not a project pattern; route 3: no such pool; route 4: the pool does not speak the client's protocol; route 4: the same pattern as an earlier route; route 5: the pool does not speak the client's protocol; route 6: not a project pattern; route 7: the pool does not speak the client's protocol; the default pool: the pool does not speak the client's protocol.",
            refusals: [
              { position: 2, reason: "shadowed", shadowedBy: 1 },
              { position: 3, reason: "not-a-pattern", shadowedBy: null },
              { position: 3, reason: "no-such-pool", shadowedBy: null },
              { position: 4, reason: "pool-not-for-client", shadowedBy: null },
              { position: 4, reason: "same-pattern", shadowedBy: null },
              { position: 5, reason: "pool-not-for-client", shadowedBy: null },
              { position: 6, reason: "not-a-pattern", shadowedBy: null },
              { position: 7, reason: "pool-not-for-client", shadowedBy: null },
              {
                position: null,
                reason: "pool-not-for-client",
                shadowedBy: null,
              },
            ],
          },
        });
        const lists = yield* bodyOf(
          yield* Harness.send("/api/routes", { headers: reader }),
        );
        expect(lists.body).toEqual({
          clients: [never("claude-code"), never("codex")],
        });
      }),
  );

  it.effect(
    "stores a list, its patterns trimmed and lowercased, and answers it as stored; a change from the same revision is refused",
    () =>
      Effect.gen(function* () {
        const change = {
          revision: 0,
          routes: [
            { pattern: " Acme/API ", pool: "console" },
            { pattern: "acme/*", pool: "claude" },
          ],
          defaultPool: "personal",
        };
        expect(yield* bodyOf(yield* put("claude-code", change))).toEqual({
          status: 200,
          body: stored,
        });
        expect(
          yield* Harness.problemOf(yield* put("claude-code", change)),
        ).toEqual({
          status: 409,
          contentType: "application/problem+json",
          body: {
            type: "urn:cota:routes-changed",
            status: 409,
            title: "The routes changed since they were read.",
            detail:
              "The routes of claude-code changed since revision 0; read them again.",
          },
        });
        expect(
          yield* bodyOf(
            yield* Harness.send("/api/routes", { headers: reader }),
          ),
        ).toEqual({
          status: 200,
          body: { clients: [stored, never("codex")] },
        });
      }),
  );

  it.effect(
    "answers a launch the route that matches its project, else the default pool, with the default pool whatever answered, to any hub key alike",
    () =>
      Effect.gen(function* () {
        const pool = (id: string, kind: string) => ({
          id,
          kind,
          protocol: "anthropic-messages",
          provider: "anthropic",
        });
        const answers = [];
        for (const headers of [fleet, clients, reader]) {
          answers.push(
            yield* route("client=claude-code&project=ACME/api", headers),
          );
        }
        expect(answers).toEqual(
          [fleet, clients, reader].map(() => ({
            status: 200,
            body: {
              client: "claude-code",
              project: "ACME/api",
              pool: pool("console", "keyed"),
              by: "route",
              route: { position: 1, pattern: "acme/api" },
              defaultPool: "personal",
            },
          })),
        );
        expect([
          yield* route("client=claude-code&project=%20acme%2Fweb%20"),
          yield* route("client=claude-code&project=acme"),
          yield* route("client=claude-code&project=acme&pool=solo"),
        ]).toEqual([
          {
            status: 200,
            body: {
              client: "claude-code",
              project: "acme/web",
              pool: pool("claude", "subscription"),
              by: "route",
              route: { position: 2, pattern: "acme/*" },
              defaultPool: "personal",
            },
          },
          {
            status: 200,
            body: {
              client: "claude-code",
              project: "acme",
              pool: pool("personal", "subscription"),
              by: "default",
              route: null,
              defaultPool: "personal",
            },
          },
          {
            status: 200,
            body: {
              client: "claude-code",
              project: "acme",
              pool: pool("solo", "subscription"),
              by: "override",
              route: null,
              defaultPool: "personal",
            },
          },
        ]);
      }),
  );

  it.effect(
    "answers no-route, no-such-pool and pool-not-for-client as problems, the last for an override naming an observed pool too",
    () =>
      Effect.gen(function* () {
        const problem = (query: string) =>
          Harness.send(`/api/route?${query}`, { headers: clients }).pipe(
            Effect.flatMap(Harness.problemOf),
          );
        expect([
          yield* problem("client=codex&project=acme/api"),
          yield* problem("client=codex&project=acme/api&pool=nowhere"),
          yield* problem("client=codex&project=acme/api&pool=claude"),
          yield* problem("client=codex&project=acme/api&pool=gemini"),
        ]).toEqual([
          {
            status: 404,
            contentType: "application/problem+json",
            body: {
              type: "urn:cota:no-route",
              status: 404,
              title: "No route matches, and the client has no default pool.",
              detail:
                'No route of codex matches the project "acme/api", and codex has no default pool.',
            },
          },
          {
            status: 404,
            contentType: "application/problem+json",
            body: {
              type: "urn:cota:no-such-pool",
              status: 404,
              title: "The hub has no such pool.",
              detail: 'The hub has no pool "nowhere".',
            },
          },
          {
            status: 400,
            contentType: "application/problem+json",
            body: {
              type: "urn:cota:pool-not-for-client",
              status: 400,
              title: "That pool does not speak this client's protocol.",
              detail:
                "The pool claude speaks anthropic-messages, and codex speaks chatgpt-codex.",
            },
          },
          {
            status: 400,
            contentType: "application/problem+json",
            body: {
              type: "urn:cota:pool-not-for-client",
              status: 400,
              title: "That pool does not speak this client's protocol.",
              detail:
                "The pool gemini is an observed pool, which speaks no protocol, and codex speaks chatgpt-codex.",
            },
          },
        ]);
      }),
  );

  it.effect(
    "does not decode a client it does not route, a project out of bounds, or a list of more than 200 routes",
    () =>
      Effect.gen(function* () {
        const statuses = [
          (yield* route("client=opencode&project=acme")).status,
          (yield* route("client=codex&project=%20%20")).status,
          (yield* route(`client=codex&project=${"a".repeat(201)}`)).status,
          (yield* route("client=codex")).status,
          (yield* put("pi", { revision: 0, routes: [], defaultPool: null }))
            .status,
          (yield* put("codex", {
            revision: 0,
            routes: Array.from({ length: 201 }, (_, index) => ({
              pattern: `p${index}`,
              pool: "codex",
            })),
            defaultPool: null,
          })).status,
          (yield* put("codex", {
            revision: 0,
            routes: [{ pattern: "a".repeat(201), pool: "codex" }],
            defaultPool: null,
          })).status,
        ];
        expect(statuses).toEqual([400, 400, 400, 400, 400, 400, 400]);
      }),
  );
});

/** A hub store written by an earlier hub, whose routes name pools this configuration lacks or gives another protocol. */
const earlierStore = await Effect.runPromise(
  Effect.gen(function* () {
    const path = join(
      mkdtempSync(join(tmpdir(), "cota-routes-")),
      "cota.sqlite",
    );
    yield* Effect.scoped(
      Layer.build(HubStore.layer({ path, steps: Hub.storeSteps })),
    );
    const database = new Database(path);
    database.run(
      "INSERT INTO route_lists VALUES ('claude-code', 'retired', 3, '2026-11-11T09:00:00.000Z')",
    );
    database.run(
      "INSERT INTO routes VALUES ('claude-code', 1, 'acme/*', 'retired'), ('claude-code', 2, 'beta/*', 'work'), ('claude-code', 3, 'solo/*', 'solo')",
    );
    database.close();
    return path;
  }).pipe(Effect.orDie),
);

layer(Harness.layer({ store: earlierStore }))(
  "the routes group, with routes whose pools are gone",
  (it) => {
    it.effect(
      "warns at start of each route and default pool whose pool no longer fits its client",
      () =>
        Effect.gen(function* () {
          const logs = yield* Harness.Logs;
          const warnings = logs
            .lines()
            .map((line): { message: unknown; level: string } =>
              JSON.parse(line),
            )
            .filter(({ level }) => level === "WARN");
          expect(
            warnings.map(({ message, level }) => [level, message]),
          ).toEqual([
            [
              "WARN",
              "Route 1 of claude-code (acme/*) names the pool retired, which is not in the configuration; its projects' launches stop until the route is changed.",
            ],
            [
              "WARN",
              "Route 2 of claude-code (beta/*) names the pool work, which does not speak anthropic-messages; its projects' launches stop until the route is changed.",
            ],
            [
              "WARN",
              "The default pool of claude-code is retired, which is not in the configuration; launches no route matches stop until it is changed.",
            ],
          ]);
        }),
    );

    it.effect(
      "lists a route whose pool no longer fits as not fitting, and answers route-pool-gone for it, never a later route or the default",
      () =>
        Effect.gen(function* () {
          const lists = yield* bodyOf(
            yield* Harness.send("/api/routes", { headers: reader }),
          );
          expect(lists.body).toEqual({
            clients: [
              {
                client: "claude-code",
                routes: [
                  {
                    position: 1,
                    pattern: "acme/*",
                    pool: "retired",
                    fits: false,
                  },
                  { position: 2, pattern: "beta/*", pool: "work", fits: false },
                  { position: 3, pattern: "solo/*", pool: "solo", fits: true },
                ],
                defaultPool: { pool: "retired", fits: false },
                revision: 3,
                changedAt: "2026-11-11T09:00:00.000Z",
              },
              never("codex"),
            ],
          });
          const gone = (detail: string) => ({
            status: 409,
            contentType: "application/problem+json",
            body: {
              type: "urn:cota:route-pool-gone",
              status: 409,
              title: "The route names a pool this client cannot bill.",
              detail,
            },
          });
          const problem = (project: string) =>
            Harness.send(`/api/route?client=claude-code&project=${project}`, {
              headers: fleet,
            }).pipe(Effect.flatMap(Harness.problemOf));
          expect([
            yield* problem("acme/api"),
            yield* problem("beta/api"),
            yield* problem("gamma"),
          ]).toEqual([
            gone(
              "Route 1 of claude-code (acme/*) names the pool retired, which is not in the configuration.",
            ),
            gone(
              "Route 2 of claude-code (beta/*) names the pool work, which does not speak anthropic-messages.",
            ),
            gone(
              "The default pool of claude-code names the pool retired, which is not in the configuration.",
            ),
          ]);
          expect(
            (yield* route("client=claude-code&project=solo/x")).body,
          ).toEqual({
            client: "claude-code",
            project: "solo/x",
            pool: {
              id: "solo",
              kind: "subscription",
              protocol: "anthropic-messages",
              provider: "anthropic",
            },
            by: "route",
            route: { position: 3, pattern: "solo/*" },
            defaultPool: "retired",
          });
        }),
    );
  },
);

/** Every pool of the harness's configuration, and one it does not have. */
const pools = [
  "work",
  "open",
  "gone",
  "claude",
  "personal",
  "solo",
  "codex",
  "console",
  "nowhere",
];

/** Every kind of caller a request to a pool may come from. */
const callers: ReadonlyArray<Record<string, string>> = [
  {},
  { "x-cota-key": "not-a-hub-key" },
  fleet,
  clients,
  { "x-cota-key": Harness.secrets.readerHubKey },
  { authorization: `Bearer ${Harness.secrets.fleetHubKey}` },
];

/** Each request to a pool, by caller, as the relay answers it: its status and the hub's error type, if any. */
const relayAnswers = Effect.gen(function* () {
  const answers: Array<string> = [];
  for (const pool of pools) {
    for (const caller of callers) {
      const answer = yield* Harness.send(`/pools/${pool}/v1/models`, {
        headers: caller,
      });
      const text = yield* Harness.textOf(answer);
      const type = /"type":"(cota_[a-z_]+)"/.exec(text)?.[1] ?? "";
      answers.push(
        `${pool} ${JSON.stringify(caller)}: ${answer.status} ${type}`,
      );
    }
  }
  yield* Harness.forgetEverything;
  return answers;
});

const SentLists = Schema.Struct({
  claudeCode: Schema.Array(
    Schema.Struct({
      pattern: Schema.Literals(["acme/*", "beta/api", "gamma*"]),
      pool: Schema.Literals(["claude", "personal", "solo", "console"]),
    }),
  ),
  claudeCodeDefault: Schema.NullOr(Schema.Literals(["personal", "console"])),
  codexDefault: Schema.NullOr(Schema.Literal("codex")),
});

let withNone: ReadonlyArray<string> | undefined;

describe("routes laws through the hub", () => {
  layer(Harness.layer())("a hub whose routes change", (it) => {
    it.effect.prop(
      "N11: for any lists stored, every request to a pool is admitted or rejected as it would be with none",
      { lists: Arbitrary.schema(SentLists) },
      ({ lists }) =>
        Effect.gen(function* () {
          withNone ??= yield* relayAnswers;
          const owner = yield* Harness.signIn();
          const read: {
            readonly clients: ReadonlyArray<{ readonly revision: number }>;
          } = JSON.parse(
            yield* Harness.textOf(
              yield* Harness.send("/api/routes", { headers: owner }),
            ),
          );
          const patterns = new Set<string>();
          const changes = [
            yield* put("claude-code", {
              revision: read.clients[0]?.revision ?? 0,
              routes: lists.claudeCode.filter(({ pattern }) => {
                if (patterns.has(pattern)) return false;
                patterns.add(pattern);
                return true;
              }),
              defaultPool: lists.claudeCodeDefault,
            }),
            yield* put("codex", {
              revision: read.clients[1]?.revision ?? 0,
              routes: [{ pattern: "acme/*", pool: "codex" }],
              defaultPool: lists.codexDefault,
            }),
          ];
          expect(changes.map(({ status }) => status)).toEqual([200, 200]);
          expect(yield* relayAnswers).toEqual(withNone);
        }),
      { timeout: 60_000, arbitrary: { runs: 10 } },
    );
  });
});
