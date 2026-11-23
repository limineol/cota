import { Arbitrary, DateTime, Effect, Option, Schema } from "effect";
import { shipped } from "#modules/relay/04-infrastructure/protocols/protocols.ts";
import type { PricedRequest } from "#modules/request-log/02-application/interfaces/requests.repository.ts";
import type { SessionTitles } from "#modules/request-log/02-application/interfaces/session-titles.ts";
import type { RequestRole } from "#modules/request-log/03-domain/request-role.ts";
import * as Search from "#modules/request-log/03-domain/search.ts";
import type {
  SessionRequest,
  Shape,
} from "#modules/request-log/03-domain/session.ts";
import * as StoredItems from "#modules/request-log/03-domain/stored-items.ts";
import type * as Title from "#modules/request-log/03-domain/title.ts";
import * as Conversation from "#shared/03-domain/conversation.ts";
import { LoginFingerprint, PoolId } from "#shared/03-domain/ids.ts";
import type { ProtocolName } from "#shared/03-domain/protocol-name.ts";
import * as Request from "#shared/03-domain/request.entity.ts";
import { compareText } from "#shared/03-domain/text.ts";
import type { Held } from "./fakes/in-memory-request-log-reader.ts";
import { requestLog, span } from "./traffic.ts";

const int = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

export const pick = <const A extends readonly [unknown, ...Array<unknown>]>(
  values: A,
): Arbitrary.Arbitrary<A[number]> =>
  int(0, values.length - 1).pipe(
    Arbitrary.map((index): A[number] => values[index] ?? values[0]),
  );

export const digestOf = (character: string) =>
  Conversation.Digest.make(character.repeat(32));

const titleShape: Schema.JsonObject = {
  output_config: {
    format: {
      type: "json_schema",
      schema: {
        type: "object",
        properties: { title: { type: "string" } },
        required: ["title"],
      },
    },
  },
};

/** Params that ask for a structured answer, but not for a title alone. */
const nearTitles: ReadonlyArray<Schema.JsonObject> = [
  {
    output_config: {
      format: {
        type: "json_schema",
        schema: { required: ["title", "summary"] },
      },
    },
  },
  {
    output_config: {
      format: { type: "text", schema: { required: ["title"] } },
    },
  },
  { output_config: { effort: "medium" } },
];

const shape: Arbitrary.Arbitrary<Shape> = Arbitrary.all({
  system: pick([
    [],
    [],
    [digestOf("a")],
    [digestOf("a"), digestOf("b")],
    [digestOf("b")],
  ]),
  firstInput: pick([
    Option.none<Conversation.Digest>(),
    Option.some(digestOf("c")),
    Option.some(digestOf("d")),
  ]),
  tools: pick([0, 1, 1, 3]),
  inputTypes: pick([[], [], ["additional_tools"]]),
  params: pick([{}, {}, {}, titleShape, ...nearTitles]),
});

/** Prompt sizes around halves of each other, so that a drop to just under, at and just over half is common. */
const promptSize = pick([
  Option.none<number>(),
  Option.some(0),
  Option.some(49),
  Option.some(50),
  Option.some(51),
  Option.some(100),
  Option.some(100),
  Option.some(101),
  Option.some(200),
  Option.some(1_000),
  Option.some(2_000),
]);

const generated = Arbitrary.all({
  minute: int(0, 12),
  protocol: pick(["anthropic-messages", "chatgpt-codex", "openai-chat"]),
  purpose: pick([
    "",
    "",
    "main",
    "main",
    "auxiliary",
    "quota_probe",
    "turn",
    "turn",
    "review",
  ]),
  agentId: pick(["", "", "", "agent-7"]),
  subagent: pick(["", "", "", "review"]),
  outcome: pick(["ok", "ok", "ok", "error", "refused", "cancelled"]),
  promptSize,
  conversation: Arbitrary.all({ has: pick([true, true, true, false]), shape }),
});

const hex = (value: number, digits: number) =>
  value.toString(16).padStart(digits, "0");

/** The id of the `index`th generated request, a UUID version 7. */
export const idOf = (index: number, minute = 0): Request.RequestId =>
  Request.RequestId.make(
    `0190${hex(minute, 4)}-0000-7000-8000-${hex(index, 12)}`,
  );

const start = Date.UTC(2026, 10, 12);

/**
 * A generated session's requests, in no order: client words of every kind,
 * threads that share system prompts or first items, ties of time and of
 * prompt size, and requests without a conversation.
 */
export const sessionRequests = (maxLength: number, from = 0) =>
  Arbitrary.array(generated, { maxLength }).pipe(
    Arbitrary.map((requests) =>
      requests.map(
        (each, index): SessionRequest => ({
          id: idOf(from + index, each.minute),
          startedAt: DateTime.makeUnsafe(start + each.minute * 60_000),
          protocol: each.protocol,
          purpose: each.purpose,
          outcome: each.outcome,
          promptSize: each.promptSize,
          clientHeaders: {
            "x-claude-code-agent-id": each.agentId,
            "x-openai-subagent": each.subagent,
          },
          conversation: each.conversation.has
            ? Option.some(each.conversation.shape)
            : Option.none(),
        }),
      ),
    ),
  );

/** A session's main conversation: requests in order, most of them `main`. */
export const mainConversation = Arbitrary.array(
  Arbitrary.all({
    requestRole: pick<readonly [RequestRole, ...Array<RequestRole>]>([
      "main",
      "main",
      "main",
      "main",
      "subagent",
      "utility",
    ]),
    outcome: pick(["ok", "ok", "ok", "ok", "error", "cancelled"]),
    promptSize,
  }),
  { maxLength: 30 },
).pipe(
  Arbitrary.map((requests) =>
    requests.map(({ requestRole, outcome, promptSize }, index) => ({
      requestRole,
      request: {
        id: idOf(index, index),
        startedAt: DateTime.makeUnsafe(start + index * 60_000),
        protocol: "anthropic-messages" as const,
        purpose: requestRole,
        outcome,
        promptSize,
        clientHeaders: {},
        conversation: Option.none(),
      },
    })),
  ),
);

/** Shuffles by generated keys. */
export const shuffled = <A>(
  items: ReadonlyArray<A>,
  keys: ReadonlyArray<number>,
) =>
  items
    .map((item, index) => ({ item, key: keys[index] ?? index }))
    .sort((one, other) => one.key - other.key)
    .map(({ item }) => item);

export const shuffleKeys = Arbitrary.array(int(0, 1_000), {
  minLength: 40,
  maxLength: 40,
});

/** How a protocol's request bodies split into a conversation. */
export const rulesOf = (protocol: ProtocolName) =>
  Option.getOrThrow(
    shipped[protocol].conversation(
      shipped[protocol].describe({
        method: "POST",
        path: {
          "anthropic-messages": "/v1/messages",
          "chatgpt-codex": "/responses",
          "openai-chat": "/chat/completions",
        }[protocol],
        headers: {},
        body: Option.none(),
      }),
    ),
  );

const asks = {
  title: titleShape,
  near: nearTitles[0] ?? {},
  nothing: {},
} as const;

const said = Arbitrary.all({
  protocol: pick([
    "anthropic-messages",
    "anthropic-messages",
    "anthropic-messages",
    "chatgpt-codex",
    "openai-chat",
  ]),
  session: pick([
    "s1",
    "s2",
    "s3",
    "s4",
    "s5",
    "s6",
    "s7",
    "s\\8\tnine\r\nten",
    "request:x",
    "",
  ]),
  purpose: pick(["", "", "main", "auxiliary", "turn"]),
  subagent: pick([false, false, false, true]),
  conversation: pick([true, true, true, true, false]),
  system: pick(["", "You are Claude Code.", "Name this conversation."]),
  tools: pick([false, true, true]),
  additionalTools: pick([false, true]),
  earlier: int(0, 2),
  reminder: pick([false, true]),
  ask: pick(["nothing", "nothing", "nothing", "title", "title", "near"]),
  prompt: pick(["short", "short", "long", "none"]),
  words: Arbitrary.array(int(0, 10), { maxLength: 3 }),
  answer: pick(["title", "title", "long", "blank", "text"]),
  diverted: pick([false, false, false, true]),
});

type Said = typeof said extends Arbitrary.Arbitrary<infer A> ? A : never;

/** Texts that search must split and lowercase as ClickHouse does: punctuation, mixed case, accents and other scripts. */
export const phrases = [
  "Fix the relay's hang-up.",
  "fetch_user_id failed: ECONNRESET",
  "Résumé of the CAFÉ order",
  "café au lait, s'il vous plaît",
  "日本語 テキスト",
  "ΣΟΦΟΣ σοφός",
  "İstanbul ISTANBUL",
  "foo—bar baz…",
  "Straße STRASSE",
  "x-cota-key at 10:42",
  "C:\\Users\\jane\ttab",
] as const;

const promptOf = (index: number, { prompt, words }: Said) => {
  const said = words.map((at) => phrases[at] ?? "").join(" ");
  return prompt === "long"
    ? `${"Fix the relay. ".repeat(40)}${said} ${index}`
    : `prompt ${said} ${index}`;
};

const answerOf = (index: number, { answer }: Said) =>
  ({
    title: JSON.stringify({ title: `title ${index}` }),
    long: JSON.stringify({ title: `  ${"Relay hang-up ".repeat(20)}${index}` }),
    blank: JSON.stringify({ title: "   " }),
    text: `Answered ${index}`,
  })[answer];

/** A body and the output read from its answer, in a protocol's shapes. */
const exchangeOf = (
  index: number,
  each: Said,
): { body: Schema.JsonObject; output: ReadonlyArray<Schema.Json> } => {
  const prompt = promptOf(index, each);
  const earlier = Array.from({ length: each.earlier }, (_, turn) => turn);
  switch (each.protocol) {
    case "anthropic-messages":
      return {
        body: {
          model: "claude-opus-5-5",
          ...(each.system === ""
            ? {}
            : { system: [{ type: "text", text: each.system }] }),
          ...(each.tools
            ? { tools: [{ name: "read", input_schema: { type: "object" } }] }
            : {}),
          messages: [
            ...earlier.flatMap((turn) => [
              { role: "user", content: `earlier ${turn}` },
              {
                role: "assistant",
                content: [{ type: "text", text: `answer ${turn}` }],
              },
            ]),
            ...(each.prompt === "none"
              ? []
              : [
                  {
                    role: "user",
                    content: [
                      ...(each.reminder
                        ? [{ type: "text", text: "<system-reminder>" }]
                        : []),
                      { type: "text", text: prompt },
                    ],
                  },
                ]),
          ],
          ...asks[each.ask],
        },
        output: [
          {
            role: "assistant",
            content: [{ type: "text", text: answerOf(index, each) }],
          },
        ],
      };
    case "chatgpt-codex":
      return {
        body: {
          model: "gpt-5.5",
          ...(each.system === "" ? {} : { instructions: each.system }),
          tools: each.tools ? [{ type: "function", name: "read" }] : [],
          input: [
            ...(each.additionalTools
              ? [{ type: "additional_tools", role: "developer", tools: [] }]
              : []),
            {
              type: "message",
              role: "user",
              content: [
                { type: "input_text", text: "# AGENTS.md instructions" },
                { type: "input_text", text: "<environment_context>" },
              ],
            },
            ...(each.prompt === "none"
              ? []
              : [
                  {
                    type: "message",
                    role: "user",
                    content: [{ type: "input_text", text: prompt }],
                  },
                ]),
          ],
        },
        output: [],
      };
    case "openai-chat":
      return {
        body: {
          model: "gpt-5.5",
          ...(each.tools
            ? { tools: [{ type: "function", function: { name: "read" } }] }
            : {}),
          messages: [
            ...(each.system === ""
              ? []
              : [{ role: "system", content: each.system }]),
            ...(each.prompt === "none"
              ? []
              : [{ role: "user", content: prompt }]),
          ],
        },
        output: [],
      };
  }
};

/**
 * What a request sent again after its session's request before it was refused
 * records, and the answer's own fields.
 */
const divertedAfter = (
  request: Request.ForwardedRequest,
  previous: Request.RequestId | undefined,
): Partial<Request.Forwarded> => ({
  follows: Option.fromUndefinedOr(previous),
  divertedFrom: Option.some(PoolId.make("claude")),
  loginFingerprint: Option.some(LoginFingerprint.make("fingerprint-1")),
  refusalReset: Option.some(DateTime.add(request.startedAt, { hours: 5 })),
  sessionSource: "x-claude-code-session-id",
  userAgent: "claude-cli/2.1.322 (external, cli)",
  servedModel: "claude-opus-5-5-20261101",
  stream: true,
  rateLimits: { "anthropic-ratelimit-unified-status": "allowed" },
  errorBody: '{"type":"error"}',
  requestBytes: 512,
  responseBytes: 2048,
});

/**
 * A generated request log whose requests carry conversations in every
 * protocol's shapes, across a handful of sessions: main threads, subagents,
 * title requests with answers that read as a title and answers that do not,
 * utility requests, and prompts past 500 characters.
 */
export const sessionLog = (maxLength: number) =>
  Arbitrary.all({
    log: requestLog(maxLength),
    said: Arbitrary.array(said, { minLength: maxLength, maxLength }),
  }).pipe(
    Arbitrary.map(({ log, said }) => {
      const latest = new Map<string, Request.RequestId>();
      return log.map(({ request, cost }, index): PricedRequest => {
        const each = said[index] ?? said[0];
        if (each === undefined) return { request, cost };
        const previous = latest.get(each.session);
        latest.set(each.session, request.id);
        const { body, output } = exchangeOf(index, each);
        const header =
          each.protocol === "chatgpt-codex"
            ? "x-openai-subagent"
            : "x-claude-code-agent-id";
        return {
          request: {
            ...request,
            session: each.session,
            ...(each.diverted ? { stopReason: "end_turn" } : {}),
            conversation: each.conversation
              ? Conversation.read(rulesOf(each.protocol), body, output)
              : Option.none(),
            origin: {
              ...request.origin,
              protocol: each.protocol,
              purpose: each.purpose,
              clientHeaders: each.subagent ? { [header]: "agent-7" } : {},
              ...(each.diverted ? divertedAfter(request, previous) : {}),
            },
          },
          cost,
        };
      });
    }),
  );

/** Search queries over the generated sessions' words, in every case, some found nowhere. */
export const searchQueries = [
  "relay",
  "RELAY hang",
  "Hang-Up",
  "fetch user",
  "ECONNRESET failed",
  "résumé",
  "RÉSUMÉ",
  "café",
  "CAFÉ order",
  "cafe",
  "日本語",
  "テキスト 日本語",
  "σοφοσ",
  "ΣΟΦΟΣ",
  "σοφός",
  "istanbul",
  "İSTANBUL",
  "i\u0307stanbul",
  "foo—bar",
  "straße",
  "strasse",
  "10:42",
  "x cota key",
  "users JANE",
  "prompt",
  "title",
  "answer",
  "earlier",
  "the",
  "nowhere",
].map((query) => Search.SearchQuery.make(query));

export const searchQuery = int(0, searchQueries.length - 1).pipe(
  Arbitrary.map((at) => searchQueries[at] ?? Search.SearchQuery.make("relay")),
);

/** Search queries whose words are prefixes of the generated sessions' words, or one or two edits from them. */
export const tolerantQueries = [
  "rel",
  "fetc user",
  "relau",
  "relya hang",
  "econnrest",
  "usr",
  "cafe",
  "strase",
  "promt",
  "titel",
  "ans",
  "4",
  "hng up",
  "istanbu",
  "日本",
  "résum ordr",
].map((query) => Search.SearchQuery.make(query));

/** Fuzzinesses that allow no edit, one or two to the generated words, and any other. */
const fuzzy = Arbitrary.all({
  at: int(0, 9),
  thousandths: int(0, 1_000),
}).pipe(
  Arbitrary.map(
    ({ at, thousandths }) =>
      [0, 0.1, 0.2, 0.25, 0.34, 0.5, 1][at] ?? thousandths / 1_000,
  ),
);

/** A tolerance: none half the time, else any prefix and fuzziness. */
export const tolerance = Arbitrary.all({
  exact: Arbitrary.schema(Schema.Boolean),
  prefix: Arbitrary.schema(Schema.Boolean),
  fuzzy,
}).pipe(
  Arbitrary.map(
    ({ exact, prefix, fuzzy }): Search.Tolerance =>
      exact ? Search.exact : { prefix, fuzzy },
  ),
);

const anyQuery = int(0, searchQueries.length + tolerantQueries.length - 1).pipe(
  Arbitrary.map(
    (at) =>
      [...searchQueries, ...tolerantQueries][at] ??
      Search.SearchQuery.make("relay"),
  ),
);

/** A search of the generated sessions: any of their search queries, exact or tolerant, under any tolerance. */
export const search = Arbitrary.all({ query: anyQuery, tolerance }).pipe(
  Arbitrary.map(({ query, tolerance }): Search.Asked => ({ query, tolerance })),
);

/** What the repository holds once a request log is stored in its order: each session's items once, and each request's digests. */
export const heldOf = (log: ReadonlyArray<PricedRequest>): Held => {
  const known = new Map<string, Set<Conversation.Digest>>();
  const items: Array<StoredItems.StoredItem> = [];
  for (const { request } of log) {
    const session = known.get(request.session) ?? new Set();
    const fresh = StoredItems.newItems(session, request);
    for (const item of fresh) session.add(item.digest);
    known.set(request.session, session);
    items.push(...fresh);
  }
  return {
    requests: log,
    requestItems: log.flatMap(({ request }) =>
      Option.toArray(StoredItems.requestItemsOf(request)),
    ),
    items,
  };
};

/** Reports of the generated sessions, often at the same instant, some clearing the title. */
export const reports = Arbitrary.array(
  Arbitrary.all({
    session: pick(["s1", "s2", "s3", "s4", "request:x", "nobody"]),
    title: pick(["Fix the relay", "Ship it", ""]),
    minute: int(0, 2),
    machine: pick(["workstation", "laptop"]),
    reportedBy: pick(["owner", "fleet"]),
  }).pipe(
    Arbitrary.map(
      ({ minute, ...report }): Title.Report => ({
        ...report,
        reportedAt: DateTime.makeUnsafe(span.to + minute * 60_000),
      }),
    ),
  ),
  { maxLength: 8 },
);

/** The latest report, restated: greatest by time, then machine, title and reporter. */
export const latestOf = (
  session: string,
  reports: ReadonlyArray<Title.Report>,
) =>
  Option.fromUndefinedOr(
    reports
      .filter((report) => report.session === session)
      .map((report) => ({
        report,
        key: [
          DateTime.toEpochMillis(report.reportedAt),
          report.machine,
          report.title,
          report.reportedBy,
        ] as const,
      }))
      .sort(
        ({ key: one }, { key: other }) =>
          one[0] - other[0] ||
          compareText(one[1], other[1]) ||
          compareText(one[2], other[2]) ||
          compareText(one[3], other[3]),
      )
      .at(-1)?.report,
  );

/** Reports to store: some in a generated order, some of them twice. */
export const storing = Arbitrary.all({
  reports,
  keys: shuffleKeys,
  twice: Arbitrary.array(int(0, 7), { maxLength: 4 }),
});

/**
 * Stores reports in their generated order, some twice, and gives the latest
 * report of every session the titles say, and what T9 says it is.
 */
export const latestStored = (
  titles: SessionTitles["Service"],
  {
    reports,
    keys,
    twice,
  }: typeof storing extends Arbitrary.Arbitrary<infer A> ? A : never,
) =>
  Effect.gen(function* () {
    yield* titles.store([
      ...shuffled(reports, keys),
      ...twice.flatMap((at) =>
        Option.toArray(Option.fromUndefinedOr(reports[at])),
      ),
    ]);
    const sessions = ["s1", "s2", "s3", "s4", "request:x", "nobody", "never"];
    const latest = yield* titles.latest(sessions);
    return {
      found: sessions.map((session) => latest.get(session) ?? null),
      expected: sessions.map((session) =>
        Option.getOrNull(latestOf(session, reports)),
      ),
    };
  }).pipe(Effect.orDie);
