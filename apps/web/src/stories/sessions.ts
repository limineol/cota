import { answer, type Fixture, never, problem, where } from "./fake-api.ts";
import { displayNames, owner } from "./fixtures.ts";
import {
  eightPools,
  lastFifteenMinutes,
  now,
  poolsAnswer,
} from "./overview.ts";

const minute = 60_000;

const iso = (at: number) => new Date(at).toISOString();

const money = (dollars: number) => dollars.toFixed(12);

const usageOf = (total: number) => ({
  input: Math.round(total * 0.031),
  cacheRead: Math.round(total * 0.83),
  cacheWriteShort: Math.round(total * 0.052),
  cacheWriteLong: Math.round(total * 0.007),
  output: Math.round(total * 0.08),
  reasoning: Math.round(total * 0.019),
});

const titles: ReadonlyArray<string> = [
  "Fix the relay hang when a stream ends early",
  "Archive each day of the request log once it is over",
  "Add the sessions list to the dashboard",
  "Why does the quota reader time out on Z.ai?",
  "Rename the overview's totals",
  "Price the new Opus model from the curated list",
  "Move the scrubber's vocabulary into one file and give every word a reason the protocol states, with the tests that hold each one",
  "Check out the flaky contract test",
  "Write the restore command's day-by-day check",
  "Make the block meter amber from 80%",
];

const prompts: ReadonlyArray<string> = [
  "The relay hangs when the provider closes the stream before the last event. Find out why and fix it.",
  "write a migration that adds the archive's manifest table and backfills it from the days already archived",
  "Can you look at why the facets endpoint counts a pool's own filter? It should count under every filter but its own.",
  "Read docs/specs/search/spec.md and tell me whether a tolerant search can miss a word the exact one finds. I think the bound on completions means a short prefix can lose words that are long, and I want to know whether that is a bug or what the spec intends, with an example from the log's words that shows it either way, and then propose a change to the spec if it is a bug.",
  "bump effect to 4.1.4 everywhere and run the gates",
  "the overview chart's ticks say 00:00 for every day over a week, date them",
];

const pools = ["personal", "work", "codex", "acme/shop", "zai", "local"];
const projects = ["acme/shop", "cota", "notes", "infra", "blog", "api-client"];
const clients = ["claude-code", "codex", "opencode", "pi"];
const models = [
  "claude-opus-4-5",
  "claude-sonnet-4-5",
  "gpt-5-codex",
  "claude-haiku-4-5",
  "glm-4.6",
];
const machines = ["tower", "laptop"];

const at = <A>(values: ReadonlyArray<A>, index: number): A =>
  values[index % values.length] as A;

interface Shape {
  readonly index: number;
  readonly endedAgo?: number;
  readonly snippet?: { readonly text: string; readonly start: number } | null;
}

/** A session as the hub lists it, varied by its index: titles reported and generated, prompts, none, several pools, errors. */
export const sessionOf = ({ index, endedAgo, snippet = null }: Shape) => {
  const kind = index % 9;
  const withoutSession = kind === 4;
  const ended = now - (endedAgo ?? index * 37 * minute + 3 * minute);
  const lasted = withoutSession ? 0 : ((index * 7) % 30) * 9 * minute + 40_000;
  const requests = withoutSession ? 1 : 3 + ((index * 53) % 400);
  const tokens = requests * (24_000 + ((index * 977) % 30_000));
  const pool = at(pools, index);
  const secondPool = kind === 2 ? [at(pools, index + 2)] : [];
  const title =
    kind === 0 || kind === 3 || kind === 6 || kind === 8
      ? {
          text: at(titles, index),
          source: kind === 3 ? ("reported" as const) : ("generated" as const),
          at: iso(ended - 2 * minute),
          machine: kind === 3 ? at(machines, index) : null,
        }
      : null;
  const firstPrompt =
    withoutSession || kind === 7 ? null : at(prompts, index * 5 + 1);
  return {
    id: withoutSession
      ? `request:0193a4c2-7d1e-7b3a-9c4e-${String(index).padStart(12, "0")}`
      : `0193a4c2-${String(index).padStart(4, "0")}-7000-8000-5e5510000000`,
    startedAt: iso(ended - lasted),
    endedAt: iso(ended),
    requests,
    errors: kind === 5 ? 3 : index % 13 === 0 ? 1 : 0,
    pools: [pool, ...secondPool].sort(),
    projects:
      kind === 1
        ? [at(projects, index), at(projects, index + 1)].sort()
        : [at(projects, index)],
    machines: [at(machines, index)],
    clients: [at(clients, index)],
    providers: [
      pool === "codex" ? "openai" : pool === "zai" ? "zai" : "anthropic",
    ] as ReadonlyArray<string>,
    models:
      kind === 6
        ? [at(models, index), at(models, index + 1), at(models, index + 3)]
        : [at(models, index)],
    origins: ["forwarded"] as ReadonlyArray<"forwarded" | "reported">,
    usage: usageOf(tokens),
    usageUnreported: 0,
    costUsd: money(pool === "zai" ? 0 : tokens * 0.0000021),
    unpricedRequests: pool === "zai" ? requests : 0,
    title,
    firstPrompt,
    snippet,
  } as const;
};

type Row = ReturnType<typeof sessionOf>;

export const listed = (
  sessions: ReadonlyArray<Row>,
  total: number,
  offset = 0,
): Fixture =>
  answer("sessions", "sessions", {
    sessions: [...sessions],
    total,
    limit: 50,
    offset,
  });

const range = (from: number, count: number) =>
  Array.from({ length: count }, (_, step) => sessionOf({ index: from + step }));

/** A session an Antigravity record reported, on an observed pool. */
const reportedOf = (row: Row): Row => ({
  ...row,
  pools: ["gemini"],
  clients: ["antigravity"],
  providers: ["google"],
  models: ["gemini-3-flash-preview"],
  origins: ["reported"],
});

/** The first page of the last 7 days: fifty sessions of every kind, the second reported. */
export const firstPage = range(0, 50).map((row, at) =>
  at === 1 ? reportedOf(row) : row,
);

const secondPage = range(50, 50);

const searchSnippets = [
  "when the provider closes the stream early the relay waits for an event that never comes, so the request hangs until the client gives up. A relay hang like this one ends only when the client hangs up.",
  "The relay hang came back after the upgrade: the reader still waits on the stream's last event.",
  '{"command":"bun test apps/hub/src/modules/relay","description":"Run the relay tests, which hang on the closed stream"}',
  "I think the hang is in the relay's reader, not in the provider: the stream ends and nothing reads that end.",
];

const searchRows = searchSnippets.map((text, index) =>
  sessionOf({
    index: index * 3,
    snippet: { text, start: index === 0 ? 412 : 0 },
  }),
);

const workRows = firstPage.filter((row) => row.pools.includes("work"));

const isPlain = (query: URLSearchParams) =>
  !query.has("q") &&
  !query.has("outcome") &&
  ["pool", "project", "machine", "client", "provider", "model"].every(
    (dimension) => !query.has(dimension),
  );

const offsetOf = (query: URLSearchParams) => Number(query.get("offset") ?? 0);

const facet = (values: ReadonlyArray<readonly [string, number]>) =>
  values.map(([value, requests]) => ({ value, requests }));

/** Each dimension's values over the last 7 days, the pools counted whatever pool is chosen. */
const facetsAnswer = (narrowed: boolean) => {
  const scale = narrowed ? 0.2 : 1;
  const counted = (values: ReadonlyArray<readonly [string, number]>) =>
    facet(
      values.map(
        ([value, requests]) =>
          [value, Math.max(1, Math.round(requests * scale))] as const,
      ),
    );
  return answer("traffic", "facets", {
    pool: facet([
      ["personal", 31_880],
      ["work", 9870],
      ["codex", 7120],
      ["acme/shop", 2210],
      ["zai", 1408],
      ["local", 41],
      ["opencode", 12],
    ]),
    project: counted([
      ["acme/shop", 21_400],
      ["cota", 13_020],
      ["notes", 4180],
      ["infra", 3300],
      ["blog", 2140],
      ["api-client", 1410],
      ["scratch", 750],
      ["dotfiles", 120],
      ["acme/a-repository-whose-name-runs-past-the-rail", 64],
    ]),
    machine: counted([
      ["tower", 38_200],
      ["laptop", 14_280],
    ]),
    client: counted([
      ["claude-code", 33_900],
      ["codex", 9100],
      ["opencode", 6600],
      ["pi", 2880],
    ]),
    provider: counted([
      ["anthropic", 41_800],
      ["openai", 7120],
      ["zai", 1408],
      ["lmstudio", 41],
    ]),
    model: counted([
      ["claude-opus-4-5", 23_800],
      ["claude-sonnet-4-5", 10_100],
      ["gpt-5-codex", 7120],
      ["claude-haiku-4-5", 5280],
      ["glm-4.6", 1408],
      ["gpt-5-mini", 210],
      ["claude-opus-4-1", 64],
    ]),
    hub_key: facet([["tower", 38_200]]),
    outcome: facet([
      ["ok", 51_900],
      ["error", 214],
      ["refused", 210],
      ["cancelled", 156],
    ]),
  });
};

const facets: ReadonlyArray<Fixture> = [
  where(facetsAnswer(true), (query) => query.has("pool")),
  facetsAnswer(false),
];

const shared: ReadonlyArray<Fixture> = [
  owner,
  displayNames,
  poolsAnswer(eightPools),
  lastFifteenMinutes(),
];

/** Every answer the sessions list reads: two pages of 1,284 sessions, a search, a pool, a project with one session, and nothing. */
export const sessionsList: ReadonlyArray<Fixture> = [
  ...shared,
  ...facets,
  where(
    listed(searchRows, searchRows.length),
    (q) => q.get("q") === "relay hang",
  ),
  where(listed([], 0), (q) => q.has("q")),
  where(listed([], 0), (q) => q.getAll("pool").includes("spare")),
  where(listed(workRows, workRows.length), (q) =>
    q.getAll("pool").includes("work"),
  ),
  where(listed([sessionOf({ index: 7 })], 1), (q) =>
    q.getAll("project").includes("notes"),
  ),
  where(listed(secondPage, 1284, 50), (q) => isPlain(q) && offsetOf(q) === 50),
  where(
    listed(range(10_000, 50), 18_342, 10_000),
    (q) => isPlain(q) && offsetOf(q) === 10_000,
  ),
  where(listed(firstPage, 1284), isPlain),
  where(
    listed(firstPage.slice(0, 20), 20),
    (q) =>
      q.has("outcome") ||
      q.has("machine") ||
      q.has("model") ||
      q.has("client") ||
      q.has("provider") ||
      q.has("project"),
  ),
];

/** A hub that takes every read of the list and never answers. */
export const loadingList: ReadonlyArray<Fixture> = [
  ...shared,
  never("sessions", "sessions"),
  never("traffic", "facets"),
];

const unavailable = {
  type: "urn:cota:request-log-unavailable",
  status: 503,
  detail: "ClickHouse did not answer within 30 seconds.",
} as const;

/** A hub whose request log cannot be read. */
export const failedList: ReadonlyArray<Fixture> = [
  ...shared,
  problem("traffic", "facets", unavailable),
  problem("sessions", "sessions", unavailable),
];

/** A hub that lists the sessions but fails to count the facets. */
export const failedFacets: ReadonlyArray<Fixture> = [
  ...shared,
  problem("traffic", "facets", unavailable),
  where(listed(firstPage, 1284), isPlain),
];
