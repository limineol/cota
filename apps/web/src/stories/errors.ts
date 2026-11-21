import { answer, type Fixture, never, problem, where } from "./fake-api.ts";
import { displayNames, owner } from "./fixtures.ts";
import {
  eightPools,
  lastFifteenMinutes,
  now,
  poolsAnswer,
} from "./overview.ts";

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

const iso = (moment: number) => new Date(moment).toISOString();

const id = (n: number) =>
  `0193a4c2-000e-7000-8000-${n.toString(16).padStart(12, "0")}`;

type Answered = Parameters<typeof answer<"traffic", "errors">>[2];
type Group = Answered["groups"][number];

const groupOf = (
  n: number,
  shape: Omit<Group, "firstAt" | "lastAt" | "latestRequest"> & {
    readonly first: number;
    readonly last: number;
  },
): Group => {
  const { first, last, ...rest } = shape;
  return {
    ...rest,
    firstAt: iso(now - first),
    lastAt: iso(now - last),
    latestRequest: id(n),
  };
};

/** The hub keeps the first 500 characters of a message, in code points. */
const kept = (message: string) => [...message].slice(0, 500).join("");

const toolResultMismatch = kept(
  JSON.stringify({
    type: "error",
    error: {
      type: "invalid_request_error",
      message: `messages.41.content.0: unexpected \`tool_use_id\` found in \`tool_result\` blocks: toolu_01QmA7xK3c9VbZ2pL8sR4tWy. Each \`tool_result\` block must have a corresponding \`tool_use\` block in the previous message.\n\nThe previous message held ${"a tool_use block whose id did not match, ".repeat(8)}`,
    },
    request_id: "req_011CV4p9Lm2Qa7Xn3Rt8Yw5Z",
  }),
);

/** Nine causes of failure, of the kinds a hub meets, latest first. */
export const nineCauses: ReadonlyArray<Group> = [
  groupOf(1, {
    provider: "anthropic",
    model: "claude-opus-4-5",
    outcome: "error",
    upstreamStatus: 529,
    errorType: "overloaded_error",
    message: "Overloaded",
    requests: 212,
    first: 6 * day,
    last: 4 * minute,
    pools: ["personal", "work"],
    clients: ["claude-code"],
  }),
  groupOf(2, {
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    outcome: "error",
    upstreamStatus: 400,
    errorType: "invalid_request_error",
    message: toolResultMismatch,
    requests: 3,
    first: 2 * day,
    last: 52 * minute,
    pools: ["work"],
    clients: ["claude-code", "opencode"],
  }),
  groupOf(3, {
    provider: "openai",
    model: "gpt-5-codex",
    outcome: "error",
    upstreamStatus: 0,
    errorType: "cota_provider_timeout",
    message:
      'The provider of pool "codex" sent no answer within 5m. Raise relay.first_byte_timeout in the hub\'s configuration if it needs longer.',
    requests: 7,
    first: 3 * day,
    last: 2 * hour,
    pools: ["codex"],
    clients: ["codex"],
  }),
  groupOf(4, {
    provider: "anthropic",
    model: "claude-opus-4-5",
    outcome: "error",
    upstreamStatus: 429,
    errorType: "rate_limit_error",
    message:
      "This request would exceed the rate limit for your organization of 4,000,000 input tokens per minute. Please reduce the prompt length or the maximum tokens requested, or try again later.",
    requests: 41,
    first: 5 * day,
    last: 5 * hour,
    pools: ["acme/shop"],
    clients: ["claude-code"],
  }),
  groupOf(5, {
    provider: "zai",
    model: "glm-4.6",
    outcome: "error",
    upstreamStatus: 503,
    errorType: "",
    message:
      "Service Unavailable\nupstream connect error or disconnect/reset before headers. reset reason: connection termination",
    requests: 18,
    first: 30 * hour,
    last: 9 * hour,
    pools: ["zai"],
    clients: ["opencode"],
  }),
  groupOf(6, {
    provider: "anthropic",
    model: "claude-haiku-4-5",
    outcome: "error",
    upstreamStatus: 500,
    errorType: "api_error",
    message: "Internal server error",
    requests: 2,
    first: 26 * hour,
    last: 25 * hour,
    pools: ["personal"],
    clients: ["claude-code"],
  }),
  groupOf(7, {
    provider: "openai",
    model: "gpt-5-mini",
    outcome: "error",
    upstreamStatus: 400,
    errorType: "invalid_request_error",
    message:
      "Unsupported parameter: 'temperature' is not supported with this model.",
    requests: 25,
    first: 4 * day,
    last: 2 * day,
    pools: ["codex"],
    clients: ["pi"],
  }),
  groupOf(8, {
    provider: "anthropic",
    model: "claude-opus-4-5",
    outcome: "error",
    upstreamStatus: 200,
    errorType: "cota_stream_broken",
    message: "The provider broke the stream before its answer finished.",
    requests: 1,
    first: 3 * day,
    last: 3 * day,
    pools: ["work"],
    clients: ["claude-code"],
  }),
  groupOf(9, {
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    outcome: "error",
    upstreamStatus: 413,
    errorType: "request_too_large",
    message: "",
    requests: 3,
    first: 6 * day,
    last: 6 * day,
    pools: ["personal"],
    clients: ["claude-code"],
  }),
];

const errorsOf = (
  groups: ReadonlyArray<Group>,
  distinctGroups = groups.length,
) =>
  answer("traffic", "errors", {
    groups: [...groups],
    requests: groups.reduce((sum, group) => sum + group.requests, 0),
    distinctGroups,
  });

const facet = (values: ReadonlyArray<readonly [string, number]>) =>
  values.map(([value, requests]) => ({ value, requests }));

/** The failed requests' values, as `GET /api/facets` counts them with `outcome=error`. */
const failedFacets = answer("traffic", "facets", {
  pool: facet([
    ["personal", 168],
    ["work", 104],
    ["acme/shop", 41],
    ["codex", 32],
    ["zai", 18],
  ]),
  model: facet([
    ["claude-opus-4-5", 254],
    ["gpt-5-mini", 25],
    ["glm-4.6", 18],
    ["gpt-5-codex", 7],
    ["claude-sonnet-4-5", 6],
    ["claude-haiku-4-5", 2],
  ]),
  client: facet([
    ["claude-code", 272],
    ["pi", 25],
    ["opencode", 21],
    ["codex", 7],
  ]),
  machine: facet([["tower", 312]]),
  project: facet([["acme/shop", 312]]),
  provider: facet([
    ["anthropic", 262],
    ["openai", 32],
    ["zai", 18],
  ]),
  hub_key: facet([["tower", 312]]),
  outcome: facet([["error", 312]]),
});

const emptyFacets = answer("traffic", "facets", {
  pool: [],
  model: [],
  client: [],
  machine: [],
  project: [],
  provider: [],
  hub_key: [],
  outcome: [],
});

const shared: ReadonlyArray<Fixture> = [
  owner,
  displayNames,
  poolsAnswer(eightPools),
  lastFifteenMinutes(),
];

const isAnthropic = (query: URLSearchParams) =>
  query.getAll("provider").includes("anthropic");

const isPersonal = (query: URLSearchParams) =>
  query.getAll("pool").includes("personal");

/** Every answer the errors screen reads: nine causes, fewer under a provider or a pool, and none refused or cancelled but one hang-up. */
export const errorsList: ReadonlyArray<Fixture> = [
  ...shared,
  where(emptyFacets, (query) => query.get("outcome") === "refused"),
  failedFacets,
  where(errorsOf([]), (query) => query.get("outcome") === "refused"),
  where(
    errorsOf([
      groupOf(10, {
        provider: "anthropic",
        model: "claude-opus-4-5",
        outcome: "cancelled",
        upstreamStatus: 200,
        errorType: "",
        message: "",
        requests: 64,
        first: 6 * day,
        last: 11 * minute,
        pools: ["personal", "work"],
        clients: ["claude-code"],
      }),
    ]),
    (query) => query.get("outcome") === "cancelled",
  ),
  where(
    errorsOf(
      nineCauses.filter(
        (group) =>
          group.provider === "anthropic" && group.pools.includes("personal"),
      ),
    ),
    (query) => isAnthropic(query) && isPersonal(query),
  ),
  where(
    errorsOf(nineCauses.filter((group) => group.provider === "anthropic")),
    isAnthropic,
  ),
  where(
    errorsOf(nineCauses.filter((group) => group.pools.includes("personal"))),
    isPersonal,
  ),
  errorsOf(nineCauses),
];

const manyCauses = Array.from({ length: 200 }, (_, index) =>
  groupOf(100 + index, {
    provider: index % 3 === 0 ? "openai" : "anthropic",
    model: index % 3 === 0 ? "gpt-5-codex" : "claude-opus-4-5",
    outcome: "error",
    upstreamStatus: 400,
    errorType: "invalid_request_error",
    message: `messages.${index + 2}.content.0: the image in this block is ${index + 6}.2 MB, and an image may be at most 5 MB.`,
    requests: 1 + (index % 4),
    first: (index + 2) * hour,
    last: (index + 1) * 20 * minute,
    pools: [index % 2 === 0 ? "personal" : "work"],
    clients: ["claude-code"],
  }),
);

/** More causes than the hub lists: the 200 latest of 1,408. */
export const manyCausesList: ReadonlyArray<Fixture> = [
  ...shared,
  failedFacets,
  errorsOf(manyCauses, 1408),
];

/** No request failed. */
export const noErrors: ReadonlyArray<Fixture> = [
  ...shared,
  emptyFacets,
  errorsOf([]),
];

/** A hub that takes the reads and never answers. */
export const loadingErrors: ReadonlyArray<Fixture> = [
  ...shared,
  never("traffic", "errors"),
  never("traffic", "facets"),
];

const unavailable = {
  type: "urn:cota:request-log-unavailable",
  status: 503,
  detail: "ClickHouse did not answer within 30 seconds.",
} as const;

/** A hub whose request log cannot be read. */
export const failedErrors: ReadonlyArray<Fixture> = [
  ...shared,
  problem("traffic", "facets", unavailable),
  problem("traffic", "errors", unavailable),
];
