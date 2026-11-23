import { answer, at, type Fixture, never, problem } from "./fake-api.ts";
import { displayNames, owner } from "./fixtures.ts";
import { eightPools, now, poolsAnswer } from "./overview.ts";

const second = 1000;
const minute = 60 * second;

const iso = (moment: number) => new Date(moment).toISOString();

const money = (dollars: number) => dollars.toFixed(12);

const hex = (n: number, digits: number) => n.toString(16).padStart(digits, "0");

const requestId = (session: number, n: number) =>
  `0193a4c2-${hex(session, 4)}-7000-8000-${hex(n, 12)}`;

type Role = "main" | "subagent" | "title" | "utility";
type Origin = "forwarded" | "imported" | "reported";
type Outcome = "ok" | "error" | "refused" | "cancelled";

interface Planned {
  readonly role: Role;
  readonly segment: number | null;
  readonly promptSize: number | null;
  readonly outcome: Outcome;
  readonly divertedFrom?: string;
  readonly follows?: string;
}

const models: Record<Role, string> = {
  main: "claude-opus-4-5",
  subagent: "claude-sonnet-4-5",
  title: "claude-haiku-4-5",
  utility: "claude-haiku-4-5",
};

const statusOf: Record<Outcome, number> = {
  ok: 200,
  error: 529,
  refused: 429,
  cancelled: 0,
};

/** The requests of a session as the hub lists them, spread evenly from `start` to `end`. */
const summariesOf = (
  session: number,
  planned: ReadonlyArray<Planned>,
  start: number,
  end: number,
) =>
  planned.map((request, n) => {
    const started = Math.round(
      start + ((end - start) * n) / Math.max(1, planned.length - 1),
    );
    const answered = request.outcome === "ok";
    const output = answered
      ? 180 + ((n * 977) % (request.role === "main" ? 4800 : 900))
      : null;
    const prompt = answered ? request.promptSize : null;
    return {
      id: requestId(session, n + 1),
      startedAt: iso(started),
      origin: "forwarded" as Origin,
      requestRole: request.role,
      segment: request.role === "main" ? request.segment : null,
      operation: request.role === "utility" ? "count-tokens" : "messages",
      purpose: request.role === "main" ? "main" : "auxiliary",
      model: models[request.role],
      servedModel: answered ? models[request.role] : "",
      stopReason: answered ? (n % 4 === 0 ? "end_turn" : "tool_use") : "",
      outcome: request.outcome,
      upstreamStatus: statusOf[request.outcome],
      errorType: request.outcome === "error" ? "overloaded_error" : "",
      promptSize: prompt,
      outputTokens: output,
      costUsd:
        prompt === null || output === null
          ? null
          : money(prompt * 0.0000006 + output * 0.000025),
      durationMs:
        request.role === "main" ? 3200 + ((n * 4111) % 28_000) : 900 + n * 7,
      firstByteMs: answered ? 600 + ((n * 37) % 1400) : null,
      tools:
        request.role === "utility"
          ? null
          : request.role === "title"
            ? 0
            : request.role === "main"
              ? 18
              : 12,
      divertedFrom: request.divertedFrom ?? null,
      follows: request.follows ?? null,
    };
  });

type Summary = ReturnType<typeof summariesOf>[number];

const startedBy = ["start", "size", "compaction"] as const;

/** The segments of the main requests, by the segment each was planned in. */
const segmentsOf = (
  summaries: ReadonlyArray<Summary>,
  causes: ReadonlyArray<(typeof startedBy)[number]> = startedBy,
) => {
  const main = summaries.filter((each) => each.requestRole === "main");
  const indexes = [...new Set(main.map((each) => each.segment ?? 0))];
  return indexes.map((index) => {
    const own = main.filter((each) => each.segment === index);
    const first = own[0];
    const last = own.at(-1);
    const tip = own.findLast((each) => each.outcome === "ok") ?? last;
    if (first === undefined || last === undefined || tip === undefined) {
      throw new Error("A segment holds at least one main request.");
    }
    return {
      index,
      startedBy: causes[index] ?? "size",
      firstRequest: first.id,
      lastRequest: last.id,
      tip: tip.id,
      startedAt: first.startedAt,
      endedAt: last.startedAt,
      requests: own.length,
      promptSize: tip.promptSize,
    };
  });
};

const usageOf = (summaries: ReadonlyArray<Summary>) => {
  const prompt = summaries.reduce(
    (sum, each) => sum + (each.promptSize ?? 0),
    0,
  );
  const output = summaries.reduce(
    (sum, each) => sum + (each.outputTokens ?? 0),
    0,
  );
  const input = Math.round(prompt * 0.03);
  const cacheWriteShort = Math.round(prompt * 0.06);
  const cacheWriteLong = Math.round(prompt * 0.01);
  return {
    input,
    cacheRead: prompt - input - cacheWriteShort - cacheWriteLong,
    cacheWriteShort,
    cacheWriteLong,
    output,
    reasoning: Math.round(output * 0.22),
  };
};

interface RowShape {
  readonly id: string;
  readonly summaries: ReadonlyArray<Summary>;
  readonly pools: ReadonlyArray<string>;
  readonly title: string | null;
  readonly firstPrompt: string | null;
  readonly requests?: number;
}

/** A session's row, its figures summed over the requests it lists. */
const rowOf = ({
  id,
  summaries,
  pools,
  title,
  firstPrompt,
  requests,
}: RowShape) => {
  const first = summaries[0];
  const last = summaries.at(-1);
  return {
    id,
    startedAt: first?.startedAt ?? iso(now),
    endedAt: last?.startedAt ?? iso(now),
    requests: requests ?? summaries.length,
    errors: summaries.filter((each) => each.outcome === "error").length,
    pools: [...pools],
    projects: ["acme/shop"],
    machines: ["tower"],
    clients: ["claude-code"],
    providers: ["anthropic"],
    models: [...new Set(summaries.map((each) => each.model))].sort(),
    origins: [...new Set(summaries.map((each) => each.origin))].sort(),
    usage: usageOf(summaries),
    usageUnreported: summaries.filter((each) => each.promptSize === null)
      .length,
    costUsd: money(
      summaries.reduce((sum, each) => sum + Number(each.costUsd ?? 0), 0),
    ),
    unpricedRequests: 0,
    title:
      title === null
        ? null
        : {
            text: title,
            source: "generated" as const,
            at: first?.startedAt ?? iso(now),
            machine: null,
          },
    firstPrompt,
  };
};

const prompt =
  "The checkout page shows the old total after a coupon is removed. Find out why and fix it, with a test that would have caught it.";

/** A long session's plan: 212 main requests in three segments, 63 subagent, 35 utility and 2 title requests, with errors and diverted requests. */
const longPlan = (): ReadonlyArray<Planned> => {
  const lengths = [96, 76, 40];
  const peaks = [182_000, 160_000, 96_000];
  const bases = [18_000, 31_000, 28_000];
  const planned: Array<Planned> = [];
  let main = 0;
  lengths.forEach((length, segment) => {
    for (let at = 0; at < length; at += 1) {
      const climb = at / Math.max(1, length - 1);
      const size = Math.round(
        (bases[segment] ?? 0) +
          ((peaks[segment] ?? 0) - (bases[segment] ?? 0)) * climb +
          ((main * 733) % 3000),
      );
      const outcome: Outcome =
        main === 40 || main === 41 || main === 133
          ? "error"
          : main === 190
            ? "cancelled"
            : "ok";
      planned.push({
        role: "main",
        segment,
        promptSize: size,
        outcome,
        ...(main >= 60 && main <= 63 ? { divertedFrom: "personal" } : {}),
      });
      if (main === 0 || main === 150) {
        planned.push({
          role: "title",
          segment: null,
          promptSize: 3100,
          outcome: "ok",
        });
      }
      if ([2, 5, 8].includes(main % 10)) {
        planned.push({
          role: "subagent",
          segment: null,
          promptSize: 22_000 + ((main * 311) % 9000),
          outcome: main === 112 ? "error" : "ok",
        });
      }
      if (main % 6 === 3) {
        planned.push({
          role: "utility",
          segment: null,
          promptSize: 1200,
          outcome: main === 99 ? "refused" : "ok",
        });
      }
      main += 1;
    }
  });
  return planned;
};

const longStart = now - (3 * 60 + 13) * minute;
const longEnd = now - 4 * minute;
const long = summariesOf(1, longPlan(), longStart, longEnd);
const longSegments = segmentsOf(long);
const longTip = longSegments.at(-1)?.tip ?? requestId(1, 1);

/** The long session's id. */
export const longSession = "0193a4c2-0001-7000-8000-5e5510000000";

export const text = (value: string, cut = 0) => ({
  type: "text" as const,
  text: value,
  cut,
});

/** A transcript's entries, each from its own item unless told otherwise. */
export const entries = () => {
  let item = 0;
  const next = () => {
    item += 1;
    return `9f${hex(item, 14)}`;
  };
  return {
    system: (value: string) => ({
      kind: "message" as const,
      item: next(),
      part: "system" as const,
      role: "system",
      parts: [text(value)],
    }),
    user: (
      parts: ReadonlyArray<
        | ReturnType<typeof text>
        | {
            readonly type: "image";
            readonly mediaType: string | null;
            readonly bytes: number | null;
          }
      >,
    ) => ({
      kind: "message" as const,
      item: next(),
      part: "input" as const,
      role: "user",
      parts: [...parts],
    }),
    assistant: (
      value: string,
      cut = 0,
      part: "input" | "output" = "input",
    ) => ({
      kind: "message" as const,
      item: next(),
      part,
      role: "assistant",
      parts: [text(value, cut)],
    }),
    reasoning: (value: string | null) => ({
      kind: "reasoning" as const,
      item: next(),
      part: "input" as const,
      text: value,
      hidden: value === null,
      cut: 0,
    }),
    call: (callId: string, name: string, input: unknown) => ({
      kind: "tool-call" as const,
      item: next(),
      part: "input" as const,
      callId,
      name,
      input: JSON.stringify(input),
      cut: 0,
    }),
    result: (
      callId: string | null,
      name: string | null,
      output: string,
      error = false,
      cut = 0,
    ) => ({
      kind: "tool-result" as const,
      item: next(),
      part: "input" as const,
      callId,
      name,
      output,
      error,
      cut,
    }),
    other: (json: string) => ({
      kind: "other" as const,
      item: next(),
      part: "input" as const,
      json,
      cut: 0,
    }),
  };
};

const cartFile = Array.from(
  { length: 64 },
  (_, line) =>
    `${String(line + 1).padStart(4)}\t${
      [
        "import { totalOf } from './totals';",
        "",
        "export interface Cart { items: Item[]; coupon: Coupon | null; total: number }",
        "",
        "export const applyCoupon = (state: Cart, coupon: Coupon): Cart => {",
        "  const next = { ...state, coupon };",
        "  return { ...next, total: totalOf(next) };",
        "};",
        "",
        "export const removeCoupon = (state: Cart): Cart => ({ ...state, coupon: null });",
      ][line % 10]
    }`,
).join("\n");

const answerText = `I found it. \`removeCoupon\` clears the coupon but keeps the discounted total, because the total is kept in \`state.total\` and only worked out again in \`applyCoupon\`.

## The fix

- Work the total out again in \`removeCoupon\`, as \`applyCoupon\` does.
- Add a test that removes a coupon and checks the total.
- Leave \`totalOf\` as it is: it was right all along.

\`\`\`ts
export const removeCoupon = (state: Cart): Cart => {
  const next = { ...state, coupon: null };
  return { ...next, total: totalOf(next) };
};
\`\`\`

The tests pass: **42 passed**. The cart's docs, [how totals are worked out](https://example.com/docs/cart#totals), say the same.`;

/** The last segment's transcript: a system prompt, a prompt with a reminder and an image, reasoning shown and hidden, many tool calls (one failed, one result whose call is not in the transcript), an item the dashboard cannot read, and texts that were cut. */
const longTranscript = () => {
  const make = entries();
  const opening = [
    make.system(
      "You are an agent that helps with software engineering. You work in the repository at /home/dev/acme-shop, on the branch main. Read a file before you change it, run the tests after, and say what you changed and why.\n\nKeep answers short. Use the tools to look things up rather than guessing.",
    ),
    make.other(
      '{"type":"tool_addition","tools":[{"name":"Notebook","description":"Edit a cell of a notebook"}]}',
    ),
    make.user([
      text(
        `<system-reminder>\nThe date is 2026-11-15. The working directory is a git repository with 3 files changed.\n</system-reminder>\n${prompt}`,
      ),
      { type: "image", mediaType: "image/png", bytes: 245_120 },
    ]),
    make.reasoning(
      "The total is worked out in the cart's reducer. If removing a coupon does not work it out again, the page keeps the discounted total. I should read cart.ts and find every place the total is set.",
    ),
    make.call("call-1", "Bash", {
      command: 'rg -n "total" src/cart',
      description: "Find where the cart sets its total",
    }),
    make.result(
      "call-1",
      "Bash",
      "src/cart/cart.ts:3:export interface Cart { items: Item[]; coupon: Coupon | null; total: number }\nsrc/cart/cart.ts:7:  return { ...next, total: totalOf(next) };\nsrc/cart/totals.ts:12:export const totalOf = (cart: Cart) =>",
    ),
    make.call("call-2", "Read", {
      file_path: "/home/dev/acme-shop/src/cart/cart.ts",
    }),
    make.result("call-2", "Read", cartFile),
    make.reasoning(null),
    make.call("call-3", "Edit", {
      file_path: "/home/dev/acme-shop/src/cart/cart.ts",
      old_string:
        "export const removeCoupon = (state: Cart): Cart => ({ ...state, coupon: null })",
      new_string:
        "export const removeCoupon = (state: Cart): Cart => {\n  const next = { ...state, coupon: null };\n  return { ...next, total: totalOf(next) };\n}",
    }),
    make.result(
      "call-3",
      "Edit",
      "The string to replace was not found in the file.",
      true,
    ),
    make.call("call-4", "Edit", {
      file_path: "/home/dev/acme-shop/src/cart/cart.ts",
      old_string:
        "export const removeCoupon = (state: Cart): Cart => ({ ...state, coupon: null });",
      new_string:
        "export const removeCoupon = (state: Cart): Cart => {\n  const next = { ...state, coupon: null };\n  return { ...next, total: totalOf(next) };\n};",
    }),
    make.result(
      "call-4",
      "Edit",
      "The file /home/dev/acme-shop/src/cart/cart.ts has been updated.",
    ),
    make.result(
      "call-0",
      "Bash",
      "A result whose call was in an earlier segment.",
    ),
  ];
  const looking = Array.from({ length: 48 }, (_, at) => {
    const callId = `call-${10 + at}`;
    const read = at % 3 === 0;
    const name = read ? "Read" : at % 3 === 1 ? "Grep" : "Bash";
    const input = read
      ? { file_path: `/home/dev/acme-shop/src/checkout/step-${at}.ts` }
      : at % 3 === 1
        ? { pattern: `coupon${at}`, path: "src" }
        : { command: `bun test src/checkout/step-${at}.test.ts` };
    const output = read
      ? cartFile
          .split("\n")
          .slice(0, 12 + (at % 20))
          .join("\n")
      : at % 3 === 1
        ? `src/checkout/step-${at}.ts:${at + 4}:  coupon${at}`
        : `✓ step ${at} keeps its total\n\n1 pass\n0 fail`;
    return [make.call(callId, name, input), make.result(callId, name, output)];
  }).flat();
  const closing = [
    make.user([
      text(
        "<system-reminder>\nThe user has not changed any file since your last edit.\n</system-reminder>",
      ),
    ]),
    make.call("call-90", "Bash", {
      command: "bun test",
      description: "Run every test",
    }),
    make.result(
      "call-90",
      "Bash",
      `${Array.from({ length: 40 }, (_, at) => `✓ cart ${at + 1}`).join("\n")}\n\n42 pass\n0 fail`,
      false,
      18_204,
    ),
    make.reasoning(
      "Every test passes, and the new one fails without the fix. I can answer now.",
    ),
    make.assistant(answerText, 0, "output"),
    make.assistant(
      "One more thing: the coupon's code is still shown after it is removed, because the banner reads it from the URL.",
      6_120,
      "output",
    ),
  ];
  const all = [...opening, ...looking, ...closing];
  return {
    request: longTip,
    protocol: "anthropic-messages" as const,
    entries: all,
    cutCharacters: all.reduce(
      (sum, entry) =>
        sum +
        ("cut" in entry
          ? entry.cut
          : entry.parts.reduce(
              (parts, part) => parts + ("cut" in part ? part.cut : 0),
              0,
            )),
      0,
    ),
  };
};

const longRow = rowOf({
  id: longSession,
  summaries: long,
  pools: ["work"],
  title: "Fix the checkout total after a coupon is removed",
  firstPrompt: prompt,
});

const detailOf = (
  row: ReturnType<typeof rowOf>,
  summaries: ReadonlyArray<Summary>,
  segments: ReturnType<typeof segmentsOf>,
  transcript: ReturnType<typeof longTranscript> | null,
  requestsCut = 0,
) =>
  answer("sessions", "session", {
    session: row,
    requests: [...summaries],
    requestsCut,
    segments: [...segments],
    transcript:
      transcript === null
        ? null
        : { ...transcript, entries: [...transcript.entries] },
  });

/** An earlier segment's tip as the inspector answers it: its record, and its conversation's parts. */
const inspected = (summary: Summary, session: string) => {
  const make = entries();
  const input = [
    make.user([
      text(
        "Start with the cart: the coupon tests are flaky on the CI and pass locally.",
      ),
    ]),
    make.reasoning("The flaky tests share a cart between them."),
    make.call("early-1", "Bash", {
      command: "bun test src/cart --rerun-each 5",
    }),
    make.result("early-1", "Bash", "✗ coupon applies once (1 of 5 runs)"),
    make.assistant(
      "The coupon tests share one cart, so one test's coupon leaks into the next. I gave each test its own cart.",
    ),
  ];
  return answer("requests", "request", {
    request: {
      id: summary.id,
      startedAt: summary.startedAt,
      firstByteMs: summary.firstByteMs,
      durationMs: summary.durationMs,
      session,
      sessionSource: "header",
      machine: "tower",
      project: "acme/shop",
      client: "claude-code",
      clientVersion: "2.1.322",
      userAgent: "claude-cli/2.1.322",
      hubKey: "tower",
      pool: "work",
      divertedFrom: summary.divertedFrom,
      follows: summary.follows,
      loginFingerprint: null,
      refusalReset: null,
      provider: "anthropic",
      protocol: "anthropic-messages",
      origin: summary.origin,
      operation: summary.operation,
      purpose: summary.purpose,
      model: summary.model,
      servedModel: summary.servedModel,
      stream: true,
      outcome: summary.outcome,
      upstreamStatus: summary.upstreamStatus,
      errorType: summary.errorType,
      errorMessage: "",
      stopReason: summary.stopReason,
      usageReported: summary.promptSize !== null,
      inputTokens: 0,
      cacheReadTokens: summary.promptSize ?? 0,
      cacheWriteShortTokens: 0,
      cacheWriteLongTokens: 0,
      outputTokens: summary.outputTokens ?? 0,
      reasoningTokens: 0,
      serviceTier: "standard",
      costUsd: summary.costUsd,
      providerRequestId: "req_0001",
      rateLimits: {},
      clientHeaders: {},
      usage: null,
      errorBody: "",
      requestBytes: 412_000,
      responseBytes: 18_000,
      readingComplete: true,
      promptSize: summary.promptSize,
    },
    requestRole: summary.requestRole,
    segment: summary.segment,
    params: { max_tokens: 32_000 },
    tools: [{ name: "Bash", description: "Run a shell command" }],
    system: [
      make.system(
        "You are an agent that helps with software engineering. You work in the repository at /home/dev/acme-shop.",
      ),
    ],
    input,
    output: [make.assistant("I will read the cart tests first.", 0, "output")],
    cutCharacters: 0,
    followedBy: null,
  });
};

const shared: ReadonlyArray<Fixture> = [
  owner,
  displayNames,
  poolsAnswer(eightPools),
];

const sessionPath = (id: string) => `/api/sessions/${encodeURIComponent(id)}`;

const requestPath = (id: string) => `/api/requests/${id}`;

const longDetail = at(
  detailOf(longRow, long, longSegments, longTranscript()),
  sessionPath(longSession),
);

const firstTip = long.find((each) => each.id === longSegments[0]?.tip);

/** The long session, its earlier segments' tips answered by the inspector. */
export const longSessionAnswers: ReadonlyArray<Fixture> = [
  ...shared,
  longDetail,
  ...longSegments.slice(0, -1).flatMap((segment) => {
    const tip = long.find((each) => each.id === segment.tip);
    return tip === undefined
      ? []
      : [at(inspected(tip, longSession), requestPath(segment.tip))];
  }),
];

/** The long session, whose first segment's tip the inspector never answers. */
export const earlierSegmentLoading: ReadonlyArray<Fixture> = [
  ...shared,
  longDetail,
  at(never("requests", "request"), requestPath(longSegments[0]?.tip ?? "")),
];

/** The long session, whose first segment's tip the request log fails to read. */
export const earlierSegmentFailed: ReadonlyArray<Fixture> = [
  ...shared,
  longDetail,
  at(
    problem("requests", "request", {
      type: "urn:cota:request-log-unavailable",
      status: 503,
      detail: "ClickHouse did not answer within 30 seconds.",
    }),
    requestPath(firstTip?.id ?? ""),
  ),
];

/** The first segment's tip, as a story asks for it. */
export const firstSegmentTip = firstTip?.id ?? "";

const shortId = "0193a4c2-0002-7000-8000-5e5510000000";
const short = summariesOf(
  2,
  [
    { role: "main", segment: 0, promptSize: 21_400, outcome: "ok" },
    { role: "main", segment: 0, promptSize: 24_900, outcome: "ok" },
  ],
  now - 9 * minute,
  now - 8 * minute,
);

const shortTranscript = () => {
  const make = entries();
  const all = [
    make.user([text("What does `bun run check` run?")]),
    make.assistant(
      "It runs Biome, the type check, the boundaries, the docs' front matter and the design lint, in that order, and stops at the first that fails.",
      0,
      "output",
    ),
  ];
  return {
    request: short[1]?.id ?? requestId(2, 2),
    protocol: "anthropic-messages" as const,
    entries: all,
    cutCharacters: 0,
  };
};

/** The short session's id. */
export const shortSession = shortId;

/** A session of two requests and a short conversation, with no title. */
export const shortSessionAnswers: ReadonlyArray<Fixture> = [
  ...shared,
  at(
    detailOf(
      rowOf({
        id: shortId,
        summaries: short,
        pools: ["work"],
        title: null,
        firstPrompt: "What does `bun run check` run?",
      }),
      short,
      segmentsOf(short),
      shortTranscript(),
    ),
    sessionPath(shortId),
  ),
];

/** The id of a request that carried no session. */
export const requestSession = `request:${requestId(3, 1)}`;

const lone = summariesOf(
  3,
  [{ role: "main", segment: 0, promptSize: 3_800, outcome: "ok" }],
  now - 2 * minute,
  now - 2 * minute,
);

/** A request that carried no session id, which is a session of its own. */
export const requestSessionAnswers: ReadonlyArray<Fixture> = [
  ...shared,
  at(
    detailOf(
      rowOf({
        id: requestSession,
        summaries: lone,
        pools: ["work"],
        title: null,
        firstPrompt: null,
      }),
      lone,
      segmentsOf(lone),
      {
        ...shortTranscript(),
        request: lone[0]?.id ?? requestId(3, 1),
      },
    ),
    sessionPath(requestSession),
  ),
];

const twoPoolsId = "0193a4c2-0004-7000-8000-5e5510000000";
const twoPools = summariesOf(
  4,
  Array.from({ length: 30 }, (_, at): Planned => {
    if (at === 12) {
      return {
        role: "main",
        segment: 0,
        promptSize: null,
        outcome: "refused",
      };
    }
    return {
      role: at % 5 === 4 ? "subagent" : "main",
      segment: at % 5 === 4 ? null : 0,
      promptSize: 12_000 + at * 4_100,
      outcome: "ok",
      ...(at >= 13 ? { divertedFrom: "personal" } : {}),
      ...(at === 13 ? { follows: requestId(4, 13) } : {}),
    };
  }),
  now - 50 * minute,
  now - 20 * minute,
);

/** The two-pool session's id. */
export const twoPoolsSession = twoPoolsId;

/** A session that a refusal moved from one pool to another. */
export const twoPoolsAnswers: ReadonlyArray<Fixture> = [
  ...shared,
  at(
    detailOf(
      rowOf({
        id: twoPoolsId,
        summaries: twoPools,
        pools: ["personal", "work"],
        title: "Add a retry to the payment webhook",
        firstPrompt:
          "The payment webhook fails when the provider is slow. Add a retry with a backoff.",
      }),
      twoPools,
      segmentsOf(twoPools),
      shortTranscript(),
    ),
    sessionPath(twoPoolsId),
  ),
];

const silentId = "0193a4c2-0005-7000-8000-5e5510000000";
const silent = summariesOf(
  5,
  Array.from(
    { length: 6 },
    (): Planned => ({
      role: "utility",
      segment: null,
      promptSize: 900,
      outcome: "ok",
    }),
  ),
  now - 30 * minute,
  now - 29 * minute,
);

/** The id of a session with no stored conversation. */
export const silentSession = silentId;

/** A session of token counts only, which has no main request and so no conversation. */
export const silentSessionAnswers: ReadonlyArray<Fixture> = [
  ...shared,
  at(
    detailOf(
      rowOf({
        id: silentId,
        summaries: silent,
        pools: ["work"],
        title: null,
        firstPrompt: null,
      }),
      silent,
      [],
      null,
    ),
    sessionPath(silentId),
  ),
];

const cutId = "0193a4c2-0006-7000-8000-5e5510000000";

/** The id of a session past the requests the hub lists. */
export const cutSession = cutId;

/** A session longer than the hub lists, so its oldest requests are left out. */
export const cutSessionAnswers: ReadonlyArray<Fixture> = [
  ...shared,
  at(
    detailOf(
      rowOf({
        id: cutId,
        summaries: long,
        pools: ["work"],
        title: "Move the store to the new schema, one table at a time",
        firstPrompt: prompt,
        requests: long.length + 1_204,
      }),
      long,
      longSegments,
      longTranscript(),
      1_204,
    ),
    sessionPath(cutId),
  ),
];

/** A hub that takes the read of a session and never answers. */
export const loadingSession: ReadonlyArray<Fixture> = [
  ...shared,
  never("sessions", "session"),
];

/** A hub whose request log cannot be read. */
export const failedSession: ReadonlyArray<Fixture> = [
  ...shared,
  problem("sessions", "session", {
    type: "urn:cota:request-log-unavailable",
    status: 503,
    detail: "ClickHouse did not answer within 30 seconds.",
  }),
];

/** A hub that has no request with the session asked for. */
export const missingSession: ReadonlyArray<Fixture> = [
  ...shared,
  problem("sessions", "session", {
    type: "urn:cota:no-such-session",
    status: 404,
  }),
];
