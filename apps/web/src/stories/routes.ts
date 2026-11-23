import {
  answer,
  asked,
  at,
  type Fixture,
  never,
  once,
  problem,
  unreachable,
  where,
} from "./fake-api.ts";
import { now } from "./overview.ts";
import { settings } from "./settings.ts";

const day = 24 * 60 * 60_000;

type Lists = Parameters<typeof answer<"routes", "list">>[2]["clients"];
type List = Lists[number];

const route = (pattern: string, pool: string, fits = true) => ({
  pattern,
  pool,
  fits,
});

const listOf = (
  client: List["client"],
  routes: ReadonlyArray<ReturnType<typeof route>>,
  defaultPool: List["defaultPool"],
  revision: number,
): List => ({
  client,
  routes: routes.map((each, index) => ({ position: index + 1, ...each })),
  defaultPool,
  revision,
  changedAt:
    revision === 0 ? null : new Date(now - 2 * day + revision).toISOString(),
});

/** Claude Code's three routes and its default pool, as the hub keeps them at revision 3. */
export const claudeCodeRoutes = listOf(
  "claude-code",
  [route("acme/*", "studio"), route("notes", "solo"), route("blog", "spare")],
  { pool: "solo", fits: true },
  3,
);

/** Codex's one route, and no default pool. */
const codexRoutes = listOf("codex", [route("acme/*", "codex")], null, 1);

const neverStored = (client: List["client"]) => listOf(client, [], null, 0);

export const routesAnswer = (lists: Lists = [claudeCodeRoutes, codexRoutes]) =>
  answer("routes", "list", { clients: lists });

/** A hub whose routes and pools the screen reads, before the rest of `more`. */
export const routes = (
  more: ReadonlyArray<Fixture> = [],
  lists?: Lists,
): ReadonlyArray<Fixture> =>
  settings(undefined, [...more, routesAnswer(lists)]);

export const noRoutes: ReadonlyArray<Fixture> = routes(
  [],
  [neverStored("claude-code"), neverStored("codex")],
);

/** A route whose pool the configuration no longer has, one to an observed pool, and a default pool that speaks another protocol. */
export const unfitRoutes: ReadonlyArray<Fixture> = routes(
  [],
  [
    listOf(
      "claude-code",
      [
        route("acme/*", "studio"),
        route("legacy/*", "retired", false),
        route("gem/*", "gemini", false),
      ],
      { pool: "zai", fits: false },
      5,
    ),
    codexRoutes,
  ],
);

export const routesLoading: ReadonlyArray<Fixture> = settings(undefined, [
  never("routes", "list"),
]);

export const routesUnreachable: ReadonlyArray<Fixture> = settings(undefined, [
  unreachable("routes", "list"),
]);

const storeUnavailable = {
  type: "urn:cota:hub-store-unavailable",
  status: 503,
  detail: "The hub store could not be read.",
} as const;

export const routesStoreUnavailable: ReadonlyArray<Fixture> = settings(
  undefined,
  [problem("routes", "list", storeUnavailable)],
);

const claudeCodePath = "/api/routes/claude-code";

type Body = {
  readonly revision?: unknown;
  readonly routes?: ReadonlyArray<{ readonly pattern?: unknown }>;
  readonly defaultPool?: unknown;
};

const isBody = (body: unknown): body is Body =>
  typeof body === "object" && body !== null && "routes" in body;

/** Whether a sent list's patterns are these, in this order, sent from revision 3. */
const sends =
  (patterns: ReadonlyArray<string>) =>
  (body: unknown): boolean =>
    isBody(body) &&
    body.revision === 3 &&
    JSON.stringify(body.routes?.map((each) => each.pattern)) ===
      JSON.stringify(patterns);

/** After the edit the stories make: `notes` first, `acme/*` second, `blog` removed, and `cota` to studio added last. */
export const editedPatterns = ["notes", "acme/*", "cota"];

const afterTheEdit = listOf(
  "claude-code",
  [route("notes", "solo"), route("acme/*", "studio"), route("cota", "studio")],
  { pool: "solo", fits: true },
  4,
);

/** The edit is stored, and the list is read again as the hub answers it after. */
export const savingTheEdit: ReadonlyArray<Fixture> = settings(undefined, [
  at(
    asked(answer("routes", "change", afterTheEdit), sends(editedPatterns)),
    claudeCodePath,
  ),
  once(routesAnswer()),
  routesAnswer([afterTheEdit, codexRoutes]),
]);

/** The hub takes the edit and does not answer yet. */
export const savingForever: ReadonlyArray<Fixture> = routes([
  never("routes", "change"),
]);

/** Two routes added at the end, `acme/api` under `acme/*` and `a*b`, refused as shadowed and as not a pattern. */
export const refusedTwice: ReadonlyArray<Fixture> = routes([
  problem(
    "routes",
    "change",
    {
      type: "urn:cota:routes-refused",
      status: 400,
      detail:
        "The routes of claude-code were not stored: route 4: shadowed by route 1; route 5: not a project pattern.",
    },
    {},
    {
      refusals: [
        { position: 4, reason: "shadowed", shadowedBy: 1 },
        { position: 5, reason: "not-a-pattern", shadowedBy: null },
      ],
    },
  ),
]);

const changedElsewhere = listOf(
  "claude-code",
  [route("acme/*", "studio"), route("notes", "spare")],
  { pool: "solo", fits: true },
  4,
);

/** Another browser stored a change since revision 3; reading again finds it. */
export const changedFromElsewhere: ReadonlyArray<Fixture> = settings(
  undefined,
  [
    problem("routes", "change", {
      type: "urn:cota:routes-changed",
      status: 409,
      detail:
        "The routes of claude-code changed since revision 3; read them again.",
    }),
    once(routesAnswer()),
    routesAnswer([changedElsewhere, codexRoutes]),
  ],
);

export const savingWithoutAStore: ReadonlyArray<Fixture> = routes([
  problem("routes", "change", {
    type: "urn:cota:hub-store-unavailable",
    status: 503,
    detail: "The hub store could not be written: the disk is full.",
  }),
]);

const asking =
  (client: List["client"], project: string) => (query: URLSearchParams) =>
    query.get("client") === client && query.get("project") === project;

/** The hub's answers: by a route, by the default pool, with no route (Codex has no default pool), and a route whose pool is gone. */
export const answers: ReadonlyArray<Fixture> = routes([
  where(
    answer("routes", "answer", {
      client: "claude-code",
      project: "acme/api",
      pool: {
        id: "studio",
        kind: "subscription",
        protocol: "anthropic-messages",
        provider: "anthropic",
      },
      by: "route",
      route: { position: 1, pattern: "acme/*" },
      defaultPool: "solo",
    }),
    asking("claude-code", "acme/api"),
  ),
  where(
    answer("routes", "answer", {
      client: "claude-code",
      project: "scratch",
      pool: {
        id: "solo",
        kind: "subscription",
        protocol: "anthropic-messages",
        provider: "anthropic",
      },
      by: "default",
      route: null,
      defaultPool: "solo",
    }),
    asking("claude-code", "scratch"),
  ),
  where(
    problem("routes", "answer", {
      type: "urn:cota:no-route",
      status: 404,
      detail:
        'No route of codex matches the project "scratch", and codex has no default pool.',
    }),
    asking("codex", "scratch"),
  ),
  where(
    problem("routes", "answer", {
      type: "urn:cota:route-pool-gone",
      status: 409,
      detail:
        "Route 2 of claude-code (legacy/*) names the pool retired, which is not in the configuration.",
    }),
    asking("claude-code", "legacy/billing"),
  ),
]);
