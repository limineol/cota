import { answer, type Fixture, never, problem, where } from "./fake-api.ts";
import { eightPools, overviewOfPools } from "./overview.ts";
import { listed, sessionOf } from "./sessions.ts";

/** The display names of every story, and the owner's name for the spare pool. */
const names = answer("display-names", "list", {
  names: [
    {
      kind: "client",
      key: "claude-code",
      name: "Claude Code",
      source: "built-in",
    },
    { kind: "client", key: "codex", name: "Codex", source: "built-in" },
    { kind: "machine", key: "tower", name: "Desk", source: "owner" },
    {
      kind: "model",
      key: "claude-opus-4-5",
      name: "Claude Opus 4.5",
      source: "built-in",
    },
    { kind: "pool", key: "personal", name: "Personal plan", source: "owner" },
    { kind: "pool", key: "spare", name: "Spare quota", source: "owner" },
  ],
});

const facet = (values: ReadonlyArray<string>) =>
  values.map((value, index) => ({
    value,
    requests: Math.round(40_000 / (index + 1)),
  }));

/** Each dimension's values over the last 7 days, as the palette offers them to filter the sessions by. */
const facets = answer("traffic", "facets", {
  pool: facet(eightPools.map((pool) => pool.id)),
  project: facet([
    "acme/shop",
    "cota",
    "quota-readers",
    "notes",
    "infra",
    "blog",
    "api-client",
    "scratch",
    "dotfiles",
    "status-page",
    "sessions-export",
    "search-index",
    "acme/storefront",
  ]),
  machine: facet(["tower", "laptop", "studio"]),
  client: facet(["claude-code", "codex", "opencode", "pi"]),
  provider: facet(["anthropic", "openai", "zai"]),
  model: facet([
    "claude-opus-4-5",
    "claude-sonnet-4-5",
    "gpt-5-codex",
    "claude-haiku-4-5",
    "glm-4.6",
    "gpt-5-mini",
  ]),
  hub_key: facet(["tower"]),
  outcome: facet(["ok", "error"]),
});

const quotaSnippets = [
  "The quota reader for Z.ai times out after 10 seconds, and the quota window it last read is shown as if it were current.",
  "so the weekly quota resets on Monday, and the 5-hour window under it keeps its own reset",
  "Read the quota headers of every answer, refusals too, before asking the provider's usage endpoint.",
];

const quotaRows = quotaSnippets.map((text, index) =>
  sessionOf({ index: index * 3 + 3, snippet: { text, start: index * 90 } }),
);

const manyRows = Array.from({ length: 8 }, (_, index) =>
  sessionOf({
    index,
    snippet: {
      text: `s ${index}: the relay's reader and the stream's end, which is what this session was about`,
      start: 0,
    },
  }),
);

/** Every answer the overview behind the palette reads, the names with the spare pool's, and the values to filter by. */
const behind: ReadonlyArray<Fixture> = [
  names,
  ...overviewOfPools(eightPools),
  facets,
];

/** What the hub was asked to search for, in order, since `forgetTheSearches`. */
export const searchesAsked: Array<string> = [];

export const forgetTheSearches = () => {
  searchesAsked.length = 0;
};

const searchFor = (q: string) => (query: URLSearchParams) =>
  query.get("q") === q;

/** The overview behind a palette whose search finds three sessions for "quota", many for "s", and none for anything else. */
export const paletteAnswers: ReadonlyArray<Fixture> = [
  ...behind,
  where(listed(quotaRows, 3), (query) => {
    searchesAsked.push(query.get("q") ?? "");
    return query.get("q") === "quota";
  }),
  where(listed(manyRows, 412), searchFor("s")),
  where(listed([], 0), (query) => query.has("q")),
];

/** A hub that takes the palette's search and never answers. */
export const searchReading: ReadonlyArray<Fixture> = [
  ...behind,
  never("sessions", "sessions"),
];

/** A hub whose request log cannot be searched. */
export const searchFailed: ReadonlyArray<Fixture> = [
  ...behind,
  problem("sessions", "sessions", {
    type: "urn:cota:request-log-unavailable",
    status: 503,
    detail: "ClickHouse did not answer within 30 seconds.",
  }),
];

/** A hub that cannot read the pools nor the values to filter by. */
export const paletteFailed: ReadonlyArray<Fixture> = [
  names,
  problem("pools", "list", {
    type: "urn:cota:request-log-unavailable",
    status: 503,
    detail: "ClickHouse did not answer within 30 seconds.",
  }),
  problem("traffic", "facets", {
    type: "urn:cota:request-log-unavailable",
    status: 503,
    detail: "ClickHouse did not answer within 30 seconds.",
  }),
  ...overviewOfPools(eightPools),
  where(listed([], 0), (query) => query.has("q")),
];
