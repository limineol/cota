import { answer, type Fixture, never, problem, where } from "./fake-api.ts";
import { displayNames, displayNamesWithPools, owner } from "./fixtures.ts";

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

/** The fixtures' present: a whole minute, so that every answer agrees on it. */
export const now = Math.floor(Date.now() / minute) * minute;

const iso = (at: number) => new Date(at).toISOString();

const money = (dollars: number) => dollars.toFixed(12);

interface WindowShape {
  readonly length: number;
  readonly used: number;
  /** The share of the window gone, or null for a window that has not opened. */
  readonly elapsed: number | null;
  readonly scope?: string;
  readonly source?: "reading" | "headers";
}

/** A quota window as the hub answers it, its standing worked out at `now` by the quota windows spec's rules. */
const quotaWindow = ({
  length,
  used,
  elapsed,
  scope,
  source = "reading",
}: WindowShape) => {
  const observedAt = iso(now - 40_000);
  if (elapsed === null) {
    return {
      lengthMs: length,
      scope: scope ?? null,
      source,
      usedPercent: used,
      startsAt: null,
      resetsAt: null,
      observedAt,
      standing: null,
    };
  }
  const startsAt = now - Math.round(elapsed * length);
  const resetsAt = startsAt + length;
  const lead = used - elapsed * 100;
  const sinceStart = now - startsAt;
  const pace =
    used >= 100
      ? "full"
      : Math.abs(lead) < 2
        ? "on-pace"
        : lead < 0
          ? "in-reserve"
          : "ahead-of-pace";
  return {
    lengthMs: length,
    scope: scope ?? null,
    source,
    usedPercent: used,
    startsAt: iso(startsAt),
    resetsAt: iso(resetsAt),
    observedAt,
    standing: {
      elapsed,
      resetsInMs: resetsAt - now,
      pace,
      points:
        pace === "in-reserve" || pace === "ahead-of-pace"
          ? Math.abs(lead)
          : null,
      emptiesInMs:
        pace === "ahead-of-pace" && sinceStart > 0
          ? Math.floor(((100 - used) / used) * sinceStart)
          : null,
    },
  } as const;
};

const fiveHours = 5 * hour;
const week = 7 * day;
const month = 30 * day;

const readOk = {
  at: iso(now - 40_000),
  failure: null,
  nextAttemptAt: iso(now + 80_000),
};

const loginActive = (provider: "anthropic" | "chatgpt") =>
  ({
    provider,
    state: "active",
    givenAt: iso(now - 12 * day),
    refreshedAt: iso(now - 3 * hour),
    endsAt: iso(now + 5 * hour),
    expiredAt: null,
  }) as const;

const personal = {
  id: "personal",
  kind: "subscription",
  protocol: "anthropic-messages",
  provider: "anthropic",
  plan: "Max 20x",
  windows: [
    quotaWindow({ length: fiveHours, used: 41, elapsed: 0.42 }),
    quotaWindow({ length: week, used: 12, elapsed: 0.49 }),
    quotaWindow({ length: week, used: 3, elapsed: 0.49, scope: "opus" }),
  ],
  observedAt: iso(now - 40_000),
  reading: readOk,
  quotaLogin: loginActive("anthropic"),
} as const;

const work = {
  id: "work",
  kind: "subscription",
  protocol: "anthropic-messages",
  provider: "anthropic",
  plan: "Pro",
  windows: [
    quotaWindow({
      length: fiveHours,
      used: 86,
      elapsed: 0.7,
      source: "headers",
    }),
    quotaWindow({ length: week, used: 64, elapsed: 0.81 }),
  ],
  observedAt: iso(now - 40_000),
  reading: readOk,
  quotaLogin: loginActive("anthropic"),
} as const;

const codex = {
  id: "codex",
  kind: "subscription",
  protocol: "chatgpt-codex",
  provider: "openai",
  plan: "Plus",
  windows: [
    quotaWindow({ length: fiveHours, used: 100, elapsed: 0.82 }),
    quotaWindow({ length: week, used: 71, elapsed: 0.55 }),
  ],
  observedAt: iso(now - 40_000),
  reading: readOk,
  quotaLogin: loginActive("chatgpt"),
} as const;

const acmeShop = {
  id: "acme/shop",
  kind: "subscription",
  protocol: "anthropic-messages",
  provider: "anthropic",
  plan: "Max 5x",
  windows: [
    quotaWindow({
      length: fiveHours,
      used: 22,
      elapsed: 0.6,
      source: "headers",
    }),
    quotaWindow({ length: week, used: 48, elapsed: 0.38, source: "headers" }),
  ],
  observedAt: iso(now - 6 * minute),
  reading: {
    at: iso(now - 2 * hour),
    failure: {
      at: iso(now - 3 * minute),
      kind: "unreachable",
      status: null,
      detail: "The provider's usage endpoint did not answer within 10 seconds.",
    },
    nextAttemptAt: iso(now + 2 * minute),
  },
  quotaLogin: loginActive("anthropic"),
} as const;

const zai = {
  id: "zai",
  kind: "keyed",
  protocol: "openai-chat",
  provider: "zai",
  plan: "Lite",
  windows: [
    quotaWindow({ length: fiveHours, used: 8, elapsed: 0.15 }),
    quotaWindow({ length: week, used: 15, elapsed: 0.3 }),
    quotaWindow({ length: month, used: 31, elapsed: 0.52 }),
    quotaWindow({ length: month, used: 2, elapsed: 0.52, scope: "web search" }),
  ],
  observedAt: iso(now - 40_000),
  reading: readOk,
  quotaLogin: null,
} as const;

const opencode = {
  id: "opencode",
  kind: "keyed",
  protocol: "openai-chat",
  provider: "opencode",
  plan: null,
  windows: [],
  observedAt: null,
  reading: readOk,
  quotaLogin: null,
} as const;

const local = {
  id: "local",
  kind: "keyed",
  protocol: "openai-chat",
  provider: "ollama",
  plan: null,
  windows: [],
  observedAt: null,
  reading: null,
  quotaLogin: null,
} as const;

const spare = {
  id: "spare",
  kind: "subscription",
  protocol: "anthropic-messages",
  provider: "anthropic",
  plan: null,
  windows: [],
  observedAt: null,
  reading: null,
  quotaLogin: {
    provider: "anthropic",
    state: "expired",
    givenAt: iso(now - 40 * day),
    refreshedAt: iso(now - 9 * day),
    endsAt: iso(now - 9 * day + 8 * hour),
    expiredAt: iso(now - 9 * day + 8 * hour),
  },
} as const;

/** An observed pool: the hub forwards nothing for it, so it has no protocol, windows, reading or quota login. */
const gemini = {
  id: "gemini",
  kind: "observed",
  protocol: null,
  provider: "google",
  plan: null,
  windows: [],
  observedAt: null,
  reading: null,
  quotaLogin: null,
} as const;

type PoolShape =
  | typeof gemini
  | typeof personal
  | typeof work
  | typeof codex
  | typeof acmeShop
  | typeof zai
  | typeof opencode
  | typeof local
  | typeof spare;

export const eightPools: ReadonlyArray<PoolShape> = [
  acmeShop,
  codex,
  local,
  opencode,
  personal,
  spare,
  work,
  zai,
];

export const threePools: ReadonlyArray<PoolShape> = [personal, work, local];

export const atTheLimit: ReadonlyArray<PoolShape> = [work, codex];

export const withAnObservedPool: ReadonlyArray<PoolShape> = [
  gemini,
  personal,
  work,
];

export const poolsAnswer = (pools: ReadonlyArray<PoolShape>) =>
  answer("pools", "list", { pools: [...pools] });

/** Usage of `total` tokens, split as a coding client's traffic is: mostly cache reads. */
const usageOf = (total: number) => ({
  input: Math.round(total * 0.031),
  cacheRead: Math.round(total * 0.83),
  cacheWriteShort: Math.round(total * 0.052),
  cacheWriteLong: Math.round(total * 0.007),
  output: Math.round(total * 0.08),
  reasoning: Math.round(total * 0.019),
});

interface RowShape {
  readonly key: string;
  readonly requests: number;
  readonly sessions?: number;
  readonly errors?: number;
  readonly tokens: number;
  readonly dollars: number;
  readonly unpriced?: number;
  readonly lastAgo?: number;
}

const row = ({
  key,
  requests,
  sessions = Math.max(1, Math.round(requests / 70)),
  errors = 0,
  tokens,
  dollars,
  unpriced = 0,
  lastAgo = 4 * minute,
}: RowShape) => ({
  key,
  requests,
  sessions,
  errors,
  usage: usageOf(tokens),
  costUsd: money(dollars),
  unpricedRequests: unpriced,
  lastAt: iso(now - lastAgo),
});

const lengthOf = (query: URLSearchParams) =>
  Date.parse(query.get("to") ?? "") - Date.parse(query.get("from") ?? "");

const byPool = (query: URLSearchParams) => query.get("by") === "pool";

const breakdown = (rows: ReadonlyArray<RowShape>, distinct = rows.length) =>
  answer("traffic", "breakdown", {
    rows: rows.map(row),
    distinctKeys: distinct,
  });

const todayRows: ReadonlyArray<RowShape> = [
  { key: "personal", requests: 1204, tokens: 38_200_000, dollars: 84.1 },
  { key: "work", requests: 412, tokens: 9_400_000, dollars: 21.6, errors: 3 },
  { key: "codex", requests: 388, tokens: 12_900_000, dollars: 28.4 },
  { key: "acme/shop", requests: 156, tokens: 3_100_000, dollars: 7.8 },
  { key: "zai", requests: 92, tokens: 1_700_000, dollars: 0.9, unpriced: 92 },
];

const monthRows: ReadonlyArray<RowShape> = [
  {
    key: "personal",
    requests: 31_880,
    tokens: 1_104_000_000,
    dollars: 2410,
    lastAgo: minute,
  },
  {
    key: "work",
    requests: 9870,
    tokens: 310_000_000,
    dollars: 690,
    lastAgo: 3 * minute,
  },
  {
    key: "codex",
    requests: 7120,
    tokens: 288_000_000,
    dollars: 512.4,
    lastAgo: 14 * minute,
  },
  {
    key: "acme/shop",
    requests: 2210,
    tokens: 71_000_000,
    dollars: 160.2,
    lastAgo: 52 * minute,
  },
  {
    key: "zai",
    requests: 1408,
    tokens: 30_100_000,
    dollars: 14.2,
    unpriced: 1408,
    lastAgo: 2 * hour,
  },
  {
    key: "local",
    requests: 41,
    tokens: 820_000,
    dollars: 0,
    unpriced: 41,
    lastAgo: 6 * day,
  },
];

const activeRows: ReadonlyArray<RowShape> = [
  {
    key: "personal",
    requests: 48,
    sessions: 2,
    tokens: 1_900_000,
    dollars: 3.9,
  },
  { key: "codex", requests: 11, sessions: 1, tokens: 420_000, dollars: 0.8 },
];

/** Each pool's traffic today, over 30 days and in the last 15 minutes, told apart by the window asked for. */
export const poolFigures = (
  today: ReadonlyArray<RowShape> = todayRows,
  thirty: ReadonlyArray<RowShape> = monthRows,
  active: ReadonlyArray<RowShape> = activeRows,
): ReadonlyArray<Fixture> => [
  where(breakdown(active), (q) => byPool(q) && lengthOf(q) === 15 * minute),
  where(breakdown(thirty), (q) => byPool(q) && lengthOf(q) === month),
  where(breakdown(today), byPool),
];

const zeroUsage = usageOf(0);

const totalsOf = ({
  requests,
  sessions,
  errors,
  tokens,
  dollars,
}: {
  readonly requests: number;
  readonly sessions: number;
  readonly errors: number;
  readonly tokens: number;
  readonly dollars: number;
}) => ({
  requests,
  sessions,
  outcomes: {
    ok: requests - errors - Math.round(requests * 0.006),
    error: errors,
    refused: Math.round(requests * 0.004),
    cancelled: Math.round(requests * 0.002),
  },
  usage: tokens === 0 ? zeroUsage : usageOf(tokens),
  usageUnreported: 0,
  costUsd: money(dollars),
  unpricedRequests: 0,
  durationMs: requests === 0 ? null : { p50: 8200, p95: 41_000 },
  firstByteMs: requests === 0 ? null : { p50: 1400, p95: 5200 },
});

const noTraffic = totalsOf({
  requests: 0,
  sessions: 0,
  errors: 0,
  tokens: 0,
  dollars: 0,
});

const overviewOf = (
  length: number,
  totals: ReturnType<typeof totalsOf>,
  previous: ReturnType<typeof totalsOf>,
  firstRequestAt: number | null = logBegins,
) =>
  answer("traffic", "overview", {
    window: { from: iso(now - length), to: iso(now) },
    previous: { from: iso(now - 2 * length), to: iso(now - length) },
    totals,
    previousTotals: previous,
    firstRequestAt: firstRequestAt === null ? null : iso(firstRequestAt),
  });

const lasting = (length: number) => (q: URLSearchParams) =>
  lengthOf(q) === length;

/** When the fixtures' request log begins: 13 days ago. */
const logBegins = now - 13 * day;

const fromLogBeginning = (q: URLSearchParams) =>
  q.get("from") === iso(logBegins);

/** The last 15 minutes of every pool, which the overview reads for active sessions and when the log began. */
export const lastFifteenMinutes = (firstRequestAt: number | null = logBegins) =>
  where(
    overviewOf(
      15 * minute,
      totalsOf({
        requests: 59,
        sessions: 3,
        errors: 0,
        tokens: 2_320_000,
        dollars: 4.7,
      }),
      totalsOf({
        requests: 72,
        sessions: 3,
        errors: 1,
        tokens: 2_900_000,
        dollars: 5.9,
      }),
      firstRequestAt,
    ),
    lasting(15 * minute),
  );

export const lastDay = where(
  overviewOf(
    day,
    totalsOf({
      requests: 4812,
      sessions: 64,
      errors: 37,
      tokens: 182_400_000,
      dollars: 412.37,
    }),
    totalsOf({
      requests: 4296,
      sessions: 64,
      errors: 11,
      tokens: 198_100_000,
      dollars: 455.02,
    }),
  ),
  lasting(day),
);

/** The last day of one pool, whichever is chosen. */
const onePoolDay = where(
  overviewOf(
    day,
    totalsOf({
      requests: 1010,
      sessions: 14,
      errors: 6,
      tokens: 36_100_000,
      dollars: 61.3,
    }),
    totalsOf({
      requests: 1188,
      sessions: 15,
      errors: 2,
      tokens: 41_700_000,
      dollars: 70.4,
    }),
  ),
  (q) => q.has("pool") && lengthOf(q) === day,
);

export const lastWeek = where(
  overviewOf(
    week,
    totalsOf({
      requests: 30_118,
      sessions: 402,
      errors: 160,
      tokens: 1_210_000_000,
      dollars: 2740,
    }),
    totalsOf({
      requests: 12_904,
      sessions: 171,
      errors: 160,
      tokens: 512_000_000,
      dollars: 1120,
    }),
  ),
  lasting(week),
);

/** Every pool together over the last 30 days, which reach back before the log began, so the 30 days before hold nothing. */
export const lastMonth = where(
  overviewOf(
    month,
    totalsOf({
      requests: 52_480,
      sessions: 711,
      errors: 214,
      tokens: 1_804_000_000,
      dollars: 3787,
    }),
    noTraffic,
  ),
  lasting(month),
);

/** Every pool together since the request log began. */
export const allTime = where(
  overviewOf(
    now - logBegins,
    totalsOf({
      requests: 52_480,
      sessions: 711,
      errors: 214,
      tokens: 1_804_000_000,
      dollars: 3787,
    }),
    noTraffic,
  ),
  fromLogBeginning,
);

const seriesKeys = ["personal", "codex", "work", "acme/shop", "zai"];

const bucketLength = {
  "15m": 15 * minute,
  "3h": 3 * hour,
  "6h": 6 * hour,
} as const;

type BucketName = keyof typeof bucketLength;

/** Traffic over `length` up to now, from when the log began at the earliest: busy through the working day, quiet at night. */
const seriesPoints = (
  keys: ReadonlyArray<string>,
  bucket: BucketName,
  length: number,
  busiest = 40,
) => {
  const step = bucketLength[bucket];
  const first = Math.ceil(Math.max(now - length, logBegins) / step) * step;
  const points = [];
  for (let at = first; at < now; at += step) {
    const hourOfDay =
      new Date(at).getUTCHours() + new Date(at).getUTCMinutes() / 60;
    const busy = Math.max(0, Math.sin(((hourOfDay - 7) / 15) * Math.PI));
    for (const [index, key] of keys.entries()) {
      const wave = 0.6 + 0.4 * Math.sin(at / (37 * minute) + index * 1.7);
      const requests = Math.round(busy * wave * (busiest - index * 7));
      if (requests <= 0) continue;
      const tokens = requests * (38_000 - index * 4000);
      points.push({
        at: iso(at),
        key,
        requests,
        errors: (at / step + index) % 23 === 0 ? 1 : 0,
        usage: usageOf(tokens),
        costUsd: money(tokens * 0.0000022),
        unpricedRequests: key === "zai" ? requests : 0,
      });
    }
  }
  return points;
};

export const series = (
  keys: ReadonlyArray<string> = seriesKeys,
  bucket: BucketName = "15m",
  length = day,
  busiest = 40,
) =>
  answer("traffic", "series", {
    bucket,
    keys: [...keys],
    points: seriesPoints(keys, bucket, length, busiest),
  });

const projectRows: ReadonlyArray<RowShape> = [
  {
    key: "acme/shop",
    requests: 2140,
    tokens: 88_200_000,
    dollars: 192.4,
    errors: 21,
  },
  { key: "cota", requests: 1302, tokens: 41_900_000, dollars: 96.1, errors: 9 },
  { key: "notes", requests: 418, tokens: 16_100_000, dollars: 38.2 },
  { key: "infra", requests: 330, tokens: 12_800_000, dollars: 30.7, errors: 4 },
  { key: "blog", requests: 214, tokens: 9_900_000, dollars: 22.5 },
  { key: "", requests: 180, tokens: 6_200_000, dollars: 14.1, errors: 3 },
  { key: "api-client", requests: 141, tokens: 4_700_000, dollars: 11.2 },
  { key: "scratch", requests: 75, tokens: 2_300_000, dollars: 5.4 },
  { key: "dotfiles", requests: 12, tokens: 88_000, dollars: 0.21 },
];

const modelRows: ReadonlyArray<RowShape> = [
  {
    key: "claude-opus-4-5",
    requests: 2380,
    tokens: 120_400_000,
    dollars: 301.2,
    errors: 18,
  },
  {
    key: "gpt-5-codex",
    requests: 1010,
    tokens: 36_100_000,
    dollars: 61.3,
    errors: 6,
  },
  {
    key: "claude-sonnet-4-5",
    requests: 802,
    tokens: 18_800_000,
    dollars: 41.9,
    errors: 9,
  },
  { key: "claude-haiku-4-5", requests: 528, tokens: 4_900_000, dollars: 6.1 },
  {
    key: "glm-4.6",
    requests: 92,
    tokens: 2_200_000,
    dollars: 0,
    unpriced: 92,
    errors: 4,
  },
];

const byKind = (kind: string, limit: string) => (q: URLSearchParams) =>
  q.get("by") === kind && q.get("limit") === limit;

/** The range's projects and models, and one pool's over 30 days. */
export const breakdowns = (
  projects: ReadonlyArray<RowShape> = projectRows,
  models: ReadonlyArray<RowShape> = modelRows,
): ReadonlyArray<Fixture> => [
  where(breakdown(projects), byKind("project", "50")),
  where(breakdown(models), byKind("model", "50")),
  where(breakdown(projects.slice(0, 5)), byKind("project", "500")),
  where(breakdown(models.slice(0, 3)), byKind("model", "500")),
];

/** The observed pool's own traffic, every request of it reported: its last request is no later than the latest reported through. */
const observedBusiest = 5;

const observedDay = seriesPoints(["gemini"], "15m", day, observedBusiest);

const observedTokens = observedDay.reduce(
  (sum, point) => sum + point.requests * 38_000,
  0,
);

const observedTotals = totalsOf({
  requests: observedDay.reduce((sum, point) => sum + point.requests, 0),
  sessions: 7,
  errors: observedDay.reduce((sum, point) => sum + point.errors, 0),
  tokens: observedTokens,
  dollars: observedTokens * 0.0000022,
});

const ofTheObservedPool = (q: URLSearchParams) =>
  q.getAll("pool").includes("gemini");

const observedRows = {
  today: {
    key: "gemini",
    requests: 64,
    tokens: 2_430_000,
    dollars: 5.35,
    lastAgo: 2 * minute + 10_000,
  },
  month: {
    key: "gemini",
    requests: 2_960,
    tokens: 112_500_000,
    dollars: 247.5,
    lastAgo: 2 * minute + 10_000,
  },
  active: {
    key: "gemini",
    requests: 3,
    sessions: 1,
    tokens: 114_000,
    dollars: 0.25,
    lastAgo: 2 * minute + 10_000,
  },
} as const;

const observedProjects: ReadonlyArray<RowShape> = [
  { key: "notes", requests: 1_710, tokens: 66_200_000, dollars: 145.6 },
  { key: "cota", requests: 902, tokens: 33_900_000, dollars: 74.6 },
  { key: "blog", requests: 348, tokens: 12_400_000, dollars: 27.3 },
];

const observedModels: ReadonlyArray<RowShape> = [
  {
    key: "gemini-3-pro-preview",
    requests: 1_840,
    tokens: 78_100_000,
    dollars: 171.8,
    errors: 4,
  },
  {
    key: "gemini-3-flash-preview",
    requests: 1_120,
    tokens: 34_400_000,
    dollars: 75.7,
  },
];

/** Every pool's traffic over time with the observed pool's beside it. */
const seriesWithTheObserved = (
  keys: ReadonlyArray<string>,
  bucket: BucketName,
  length: number,
) =>
  answer("traffic", "series", {
    bucket,
    keys: [...keys, "gemini"],
    points: [
      ...seriesPoints(keys, bucket, length),
      ...seriesPoints(["gemini"], bucket, length, observedBusiest),
    ],
  });

/** What the overview reads of the observed pool alone, answered before the fixtures that answer for any pool. */
const observedPoolTraffic: ReadonlyArray<Fixture> = [
  where(
    overviewOf(
      day,
      observedTotals,
      totalsOf({
        requests: 141,
        sessions: 6,
        errors: 0,
        tokens: 5_300_000,
        dollars: 11.66,
      }),
    ),
    (q) => ofTheObservedPool(q) && lengthOf(q) === day,
  ),
  where(
    series(["gemini"], "15m", day, observedBusiest),
    (q) => ofTheObservedPool(q) && lengthOf(q) === day,
  ),
  ...(
    [
      ["project", "50", observedProjects],
      ["model", "50", observedModels],
      ["project", "500", observedProjects],
      ["model", "500", observedModels],
    ] as const
  ).map(([kind, limit, rows]) =>
    where(
      breakdown(rows),
      (q) => ofTheObservedPool(q) && byKind(kind, limit)(q),
    ),
  ),
];

interface ReporterShape {
  readonly machine: string;
  readonly throughAgo: number;
  readonly late: boolean;
}

const reporterOf = ({ machine, throughAgo, late }: ReporterShape) => ({
  machine,
  client: "antigravity" as const,
  pool: "gemini",
  through: iso(now - throughAgo),
  reportedAt: iso(late ? now - throughAgo : now - 20_000),
  reportedBy: machine,
  late,
});

const reportersAnswer = (reporters: ReadonlyArray<ReporterShape>) =>
  answer("reports", "reportedThrough", {
    reporters: reporters.map(reporterOf),
  });

/** How far each machine has reported to the observed pool, in each state the overview draws. */
export const reportedThrough = {
  current: reportersAnswer([
    { machine: "laptop", throughAgo: 50_000, late: false },
    { machine: "tower", throughAgo: 2 * minute, late: false },
  ]),
  late: reportersAnswer([
    { machine: "laptop", throughAgo: 3 * hour + 12 * minute, late: true },
    { machine: "tower", throughAgo: 2 * minute, late: false },
  ]),
  never: reportersAnswer([]),
  failed: problem("reports", "reportedThrough", {
    type: "urn:cota:hub-store-unavailable",
    status: 503,
    detail: "The hub store could not be read.",
  }),
  loading: never("reports", "reportedThrough"),
} as const;

/** Every answer the overview reads, for these pools, with how far each machine has reported to an observed one; `reportedTo` false is an observed pool nothing has reported to, so it has no traffic. */
export const overviewOfPools = (
  pools: ReadonlyArray<PoolShape>,
  reported: Fixture = reportedThrough.current,
  reportedTo = true,
): ReadonlyArray<Fixture> => {
  const shown = seriesKeys.filter((key) =>
    pools.some((pool) => pool.id === key),
  );
  const observed = reportedTo && pools.some((pool) => pool.id === gemini.id);
  const byPools = observed ? seriesWithTheObserved : series;
  const withObserved = (
    rows: ReadonlyArray<RowShape>,
    row: RowShape,
  ): ReadonlyArray<RowShape> => [
    ...rows.filter((each) => pools.some((pool) => pool.id === each.key)),
    ...(observed ? [row] : []),
  ];
  return [
    owner,
    displayNames,
    poolsAnswer(pools),
    ...poolFigures(
      withObserved(todayRows, observedRows.today),
      withObserved(monthRows, observedRows.month),
      withObserved(activeRows, observedRows.active),
    ),
    ...(observed ? observedPoolTraffic : []),
    lastFifteenMinutes(),
    onePoolDay,
    lastDay,
    lastWeek,
    lastMonth,
    allTime,
    ...seriesKeys.map((key) =>
      where(series([key]), (q) => q.getAll("pool").includes(key)),
    ),
    where(series([]), (q) => q.has("pool")),
    where(byPools(shown, "3h", week), lasting(week)),
    where(byPools(shown, "6h", month), lasting(month)),
    where(byPools(shown, "3h", now - logBegins), fromLogBeginning),
    byPools(shown, "15m", day),
    ...breakdowns(),
    reported,
  ];
};

/**
 * Pools whose three orders differ: the configuration's (local, work, zai,
 * codex, personal, acme/shop), by usage over 30 days (Personal plan, then
 * work and zai, of equal usage, which their names put GLM plan first though
 * their ids put work first, then codex, acme/shop and local), and by name
 * (acme/shop, codex, GLM plan, local, Personal plan, work).
 */
export const poolsToOrder: ReadonlyArray<Fixture> = [
  displayNamesWithPools({ personal: "Personal plan", zai: "GLM plan" }),
  ...poolFigures(todayRows, [
    { key: "personal", requests: 31_880, tokens: 1_104_000_000, dollars: 2410 },
    { key: "work", requests: 9870, tokens: 288_000_000, dollars: 690 },
    {
      key: "zai",
      requests: 8120,
      tokens: 288_000_000,
      dollars: 136.5,
      unpriced: 8120,
    },
    { key: "codex", requests: 2210, tokens: 71_000_000, dollars: 160.2 },
    { key: "acme/shop", requests: 1408, tokens: 30_100_000, dollars: 66.8 },
    { key: "local", requests: 41, tokens: 820_000, dollars: 0, unpriced: 41 },
  ]),
  ...overviewOfPools([local, work, zai, codex, personal, acmeShop]),
];

/** A hub whose request log has nothing in it yet. */
export const emptyLog: ReadonlyArray<Fixture> = [
  owner,
  displayNames,
  poolsAnswer(threePools),
  ...poolFigures([], [], []),
  where(
    overviewOf(15 * minute, noTraffic, noTraffic, null),
    lasting(15 * minute),
  ),
  where(overviewOf(day, noTraffic, noTraffic, null), lasting(day)),
  answer("traffic", "series", { bucket: "15m", keys: [], points: [] }),
  ...breakdowns([], []),
];

/** A hub that takes every read of the overview and never answers. */
export const loading: ReadonlyArray<Fixture> = [
  owner,
  displayNames,
  never("pools", "list"),
  never("traffic", "breakdown"),
  never("traffic", "overview"),
  never("traffic", "series"),
];

const unavailable = {
  type: "urn:cota:request-log-unavailable",
  status: 503,
  detail: "ClickHouse did not answer within 30 seconds.",
} as const;

/** A hub whose request log cannot be read. */
export const failed: ReadonlyArray<Fixture> = [
  owner,
  displayNames,
  problem("pools", "list", unavailable),
  problem("traffic", "breakdown", unavailable),
  problem("traffic", "overview", unavailable),
  problem("traffic", "series", unavailable),
];
