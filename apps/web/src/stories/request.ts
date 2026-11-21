import { answer, at, type Fixture, never, problem } from "./fake-api.ts";
import { displayNames, owner } from "./fixtures.ts";
import { eightPools, now, poolsAnswer } from "./overview.ts";
import { entries, text } from "./session.ts";

const minute = 60_000;

const iso = (moment: number) => new Date(moment).toISOString();

const session = "0193a4c2-0001-7000-8000-5e5510000000";

const id = (n: number) =>
  `0193a4c2-0009-7000-8000-${n.toString(16).padStart(12, "0")}`;

type Inspected = Parameters<typeof answer<"requests", "request">>[2];
type Logged = Inspected["request"];

const recordOf = (n: number, changes: Partial<Logged> = {}): Logged => ({
  id: id(n),
  startedAt: iso(now - 12 * minute),
  firstByteMs: 812,
  durationMs: 21_734,
  session,
  sessionSource: "x-claude-code-session-id",
  machine: "tower",
  project: "acme/shop",
  client: "claude-code",
  clientVersion: "2.1.322",
  userAgent: "claude-cli/2.1.322 (external, cli)",
  hubKey: "tower",
  pool: "work",
  divertedFrom: null,
  follows: null,
  loginFingerprint: "fp_5c1e0a",
  refusalReset: null,
  provider: "anthropic",
  protocol: "anthropic-messages",
  operation: "messages",
  purpose: "main",
  model: "claude-opus-4-5",
  servedModel: "",
  stream: true,
  outcome: "ok",
  upstreamStatus: 200,
  errorType: "",
  errorMessage: "",
  stopReason: "tool_use",
  usageReported: true,
  inputTokens: 1_204,
  cacheReadTokens: 94_310,
  cacheWriteShortTokens: 2_188,
  cacheWriteLongTokens: 0,
  outputTokens: 1_612,
  reasoningTokens: 388,
  serviceTier: "standard",
  costUsd: "0.102394500000",
  providerRequestId: "req_011CV4mZ8p2xYbW6r7Q1aT3k",
  rateLimits: {
    "anthropic-ratelimit-unified-status": "allowed",
    "anthropic-ratelimit-unified-5h-utilization": "0.41",
    "anthropic-ratelimit-unified-5h-reset": "1763229600",
    "anthropic-ratelimit-unified-7d-utilization": "0.18",
    "anthropic-ratelimit-unified-7d-reset": "1763661600",
  },
  clientHeaders: {
    "anthropic-beta": "interleaved-thinking-2025-05-14,context-1m-2025-08-07",
    "anthropic-version": "2023-06-01",
    "x-app": "cli",
  },
  usage: {
    input_tokens: 1204,
    cache_read_input_tokens: 94310,
    cache_creation_input_tokens: 2188,
    cache_creation: {
      ephemeral_5m_input_tokens: 2188,
      ephemeral_1h_input_tokens: 0,
    },
    output_tokens: 1612,
    service_tier: "standard",
  },
  errorBody: "",
  requestBytes: 412_088,
  responseBytes: 18_204,
  readingComplete: true,
  promptSize: 97_702,
  ...changes,
});

const toolDescription =
  "Executes a given bash command in a persistent shell session with optional timeout, ensuring proper handling and security measures. Before executing the command, verify that the parent directory exists. Always quote file paths that contain spaces. Prefer the dedicated tools for reading, searching and editing files over their shell commands.";

const conversation = () => {
  const make = entries();
  return {
    system: [
      make.system(
        "You are an agent that helps with software engineering. You work in the repository at /home/dev/acme-shop.",
      ),
    ],
    input: [
      make.user([
        text(
          "The checkout page shows the old total after a coupon is removed. Find out why and fix it, with a test that would have caught it.",
        ),
      ]),
      make.reasoning("The total is worked out in the cart's reducer."),
      make.call("call-1", "Bash", { command: 'rg -n "total" src/cart' }),
      make.result(
        "call-1",
        "Bash",
        "src/cart/cart.ts:7: return { ...next, total: totalOf(next) };",
      ),
      make.call("call-2", "Read", { file_path: "src/cart/cart.ts" }),
      make.result(
        "call-2",
        "Read",
        "export const removeCoupon = (state: Cart): Cart => ({ ...state, coupon: null });",
      ),
    ],
    output: [
      make.reasoning(
        "removeCoupon keeps the discounted total; it has to work the total out again.",
      ),
      make.assistant(
        "`removeCoupon` clears the coupon but keeps the discounted total. I will work the total out again when the coupon goes, and add a test.",
        0,
        "output",
      ),
      make.call("call-3", "Edit", {
        file_path: "src/cart/cart.ts",
        old_string: "({ ...state, coupon: null })",
        new_string: "withTotal({ ...state, coupon: null })",
      }),
    ],
  };
};

const inspectedOf = (
  record: Logged,
  changes: Partial<Omit<Inspected, "request">> = {},
): Inspected => {
  const parts = conversation();
  return {
    request: record,
    requestRole: "main",
    segment: 2,
    params: {
      max_tokens: 32000,
      stream: true,
      thinking: { type: "enabled", budget_tokens: 16000 },
      metadata: { user_id: "user_5c1e0a_account__session_0193a4c2" },
      temperature: null,
    },
    tools: [
      { name: "Bash", description: toolDescription },
      { name: "Read", description: "Reads a file from the local filesystem." },
      { name: "Edit", description: "Replaces a string in a file." },
      { name: "mcp__docs__search", description: null },
    ],
    system: parts.system,
    input: parts.input,
    output: parts.output,
    cutCharacters: 0,
    followedBy: null,
    ...changes,
  };
};

const shared: ReadonlyArray<Fixture> = [
  owner,
  displayNames,
  poolsAnswer(eightPools),
];

const inspector = (inspected: Inspected) =>
  at(
    answer("requests", "request", inspected),
    `/api/requests/${inspected.request.id}`,
  );

export const answeredRequest = id(1);

/** A main request that answered, with its conversation, tools, params and usage. */
export const answeredAnswers: ReadonlyArray<Fixture> = [
  ...shared,
  inspector(inspectedOf(recordOf(1))),
];

export const failedRequest = id(2);

const overloaded = JSON.stringify({
  type: "error",
  error: { type: "overloaded_error", message: "Overloaded" },
  request_id: "req_011CV4n2Qx7Lk3cM9dP0sR1t",
});

/** A main request the provider failed with a 529. */
export const failedAnswers: ReadonlyArray<Fixture> = [
  ...shared,
  inspector(
    inspectedOf(
      recordOf(2, {
        outcome: "error",
        upstreamStatus: 529,
        errorType: "overloaded_error",
        errorMessage: "Overloaded",
        errorBody: overloaded,
        stopReason: "",
        firstByteMs: 1_402,
        durationMs: 1_409,
        usageReported: false,
        inputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteShortTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        costUsd: null,
        usage: null,
        rateLimits: {},
        responseBytes: 212,
        promptSize: null,
      }),
      { output: [] },
    ),
  ),
];

export const refusedRequest = id(3);
export const divertedRequest = id(4);

const refusal =
  "This request would exceed your account's rate limit. Please try again later.";

/** A request the provider refused, which the hub sent again to the fallback pool. */
export const refusedAnswers: ReadonlyArray<Fixture> = [
  ...shared,
  inspector(
    inspectedOf(
      recordOf(3, {
        pool: "personal",
        outcome: "refused",
        upstreamStatus: 429,
        errorType: "rate_limit_error",
        errorMessage: refusal,
        errorBody: JSON.stringify({
          type: "error",
          error: { type: "rate_limit_error", message: refusal },
        }),
        refusalReset: iso(now + 94 * minute),
        stopReason: "",
        firstByteMs: 388,
        durationMs: 391,
        usageReported: false,
        inputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteShortTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        costUsd: null,
        usage: null,
        responseBytes: 0,
        promptSize: null,
      }),
      { output: [], followedBy: divertedRequest },
    ),
  ),
];

/** The request the hub sent to the fallback pool after the refusal. */
export const divertedAnswers: ReadonlyArray<Fixture> = [
  ...shared,
  inspector(
    inspectedOf(
      recordOf(4, { divertedFrom: "personal", follows: refusedRequest }),
    ),
  ),
];

export const listingRequest = id(5);

/** A model listing: no conversation, no usage. */
export const listingAnswers: ReadonlyArray<Fixture> = [
  ...shared,
  inspector({
    request: recordOf(5, {
      session: `request:${id(5)}`,
      sessionSource: "",
      operation: "models",
      purpose: "",
      model: "",
      stream: false,
      stopReason: "",
      firstByteMs: 140,
      durationMs: 152,
      usageReported: false,
      inputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteShortTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      serviceTier: "",
      costUsd: null,
      usage: null,
      rateLimits: {},
      requestBytes: 0,
      responseBytes: 6_812,
      promptSize: null,
    }),
    requestRole: null,
    segment: null,
    params: null,
    tools: null,
    system: null,
    input: null,
    output: null,
    cutCharacters: 0,
    followedBy: null,
  }),
];

export const unreportedRequest = id(6);

/** A request the client hung up on before the answer's usage came. */
export const unreportedAnswers: ReadonlyArray<Fixture> = [
  ...shared,
  inspector(
    inspectedOf(
      recordOf(6, {
        outcome: "cancelled",
        stopReason: "",
        durationMs: 48_210,
        usageReported: false,
        inputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteShortTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        costUsd: null,
        usage: null,
        readingComplete: false,
        promptSize: null,
      }),
      { requestRole: "subagent", segment: null },
    ),
  ),
];

export const cutRequest = id(7);

const longOutput = `${"The suite runs every test of the cart against one shared store, so a coupon one test applies is still there when the next one starts. ".repeat(40)}`;

/** A request whose texts were cut at the inspector's 100,000 characters. */
export const cutAnswers: ReadonlyArray<Fixture> = [
  ...shared,
  inspector(
    inspectedOf(recordOf(7), {
      output: [
        {
          kind: "message",
          item: "9f00000000000077",
          part: "output",
          role: "assistant",
          parts: [text(longOutput, 241_388)],
        },
      ],
      cutCharacters: 241_388,
    }),
  ),
];

export const importedRequest = id(8);

/** A request imported from the prototype's log: its conversation in Bifrost's form, and none of what the prototype never recorded. */
export const importedAnswers: ReadonlyArray<Fixture> = [
  ...shared,
  inspector(
    inspectedOf(
      recordOf(8, {
        protocol: "bifrost-responses",
        operation: "responses",
        sessionSource: "",
        hubKey: "",
        loginFingerprint: "",
        purpose: "",
        serviceTier: "",
        providerRequestId: "",
        rateLimits: {},
        clientHeaders: {},
      }),
    ),
  ),
];

/** The request log never answers. */
export const loadingRequest: ReadonlyArray<Fixture> = [
  ...shared,
  never("requests", "request"),
];

/** The request log fails the read. */
export const failedRead: ReadonlyArray<Fixture> = [
  ...shared,
  problem("requests", "request", {
    type: "urn:cota:request-log-unavailable",
    status: 503,
    detail: "ClickHouse did not answer within 30 seconds.",
  }),
];

/** No request has the id. */
export const missingRequest: ReadonlyArray<Fixture> = [
  ...shared,
  problem("requests", "request", {
    type: "urn:cota:no-such-request",
    status: 404,
    detail: `The request log has no request "${id(99)}".`,
  }),
];

export const missingId = id(99);
