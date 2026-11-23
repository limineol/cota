import {
  Arbitrary,
  Context,
  DateTime,
  Effect,
  HashMap,
  Layer,
  Option,
  Schema,
} from "effect";
import * as ReportRequests from "#modules/request-log/02-application/commands/report-requests.command.ts";
import { RequestsRepository } from "#modules/request-log/02-application/interfaces/requests.repository.ts";
import type * as Report from "#modules/request-log/03-domain/report.ts";
import * as PriceLists from "#modules/request-log/04-infrastructure/prices/prices.ts";
import { HubKeyName, PoolId } from "#shared/03-domain/ids.ts";
import type * as Pool from "#shared/03-domain/pool.entity.ts";
import type * as Usage from "#shared/03-domain/usage.ts";
import * as Steps from "./antigravity-steps.ts";
import * as InMemoryReportedThrough from "./fakes/in-memory-reported-through.ts";
import * as InMemoryRequests from "./fakes/in-memory-requests.repository.ts";

export const int = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

export const pick = <const A extends readonly [unknown, ...Array<unknown>]>(
  values: A,
): Arbitrary.Arbitrary<A[number]> =>
  int(0, values.length - 1).pipe(
    Arbitrary.map((index): A[number] => values[index] ?? values[0]),
  );

const boolean = Arbitrary.schema(Schema.Boolean);

/** The hub's clock while reports are generated and sent. */
export const now = DateTime.makeUnsafe("2026-11-20T12:00:00Z");

const nowMs = DateTime.toEpochMillis(now);

export const observed: Pool.ObservedPool = {
  kind: "observed",
  id: PoolId.make("gemini"),
  provider: "google",
  prices: Option.some("google"),
  ownPrices: {},
};

/** A pool of each kind: the observed one reports bill, and two others no report may. */
export const pools: ReadonlyArray<Pool.Pool> = [
  observed,
  {
    kind: "subscription",
    id: PoolId.make("claude"),
    protocol: "anthropic-messages",
    provider: "anthropic",
    baseUrl: "https://provider.example",
    keptLogin: Option.none(),
    fallback: Option.none(),
    prices: Option.some("anthropic"),
    ownPrices: {},
  },
  {
    kind: "keyed",
    id: PoolId.make("console"),
    protocol: "anthropic-messages",
    provider: "anthropic",
    baseUrl: "https://provider.example",
    key: Option.none(),
    prices: Option.some("anthropic"),
    ownPrices: {},
  },
];

export const poolsById = (all: ReadonlyArray<Pool.Pool> = pools) =>
  HashMap.fromIterable(all.map((pool) => [pool.id, pool] as const));

export const reporters: readonly [Report.Reporter, ...Array<Report.Reporter>] =
  [
    { _tag: "Owner" },
    { _tag: "HubKey", name: HubKeyName.make("fleet") },
    { _tag: "HubKey", name: HubKeyName.make("clients") },
  ];

const usage = Arbitrary.all({
  input: int(0, 40_000),
  cacheRead: int(0, 40_000),
  output: int(0, 4_000),
  reasoning: int(0, 4_000),
  given: boolean,
}).pipe(
  Arbitrary.map(
    ({ given, ...tokens }): Option.Option<Usage.Reported> =>
      given
        ? Option.some({
            tokens: {
              input: tokens.input,
              cacheRead: tokens.cacheRead,
              cacheWriteShort: 0,
              cacheWriteLong: 0,
              output: tokens.output,
            },
            reasoning: Math.min(tokens.reasoning, tokens.output),
            reported: JSON.stringify({ promptTokenCount: tokens.input }),
          })
        : Option.none(),
  ),
);

const generatedCall = Arbitrary.all({
  input: Arbitrary.array(pick(["user", "result", "compaction"]), {
    maxLength: 3,
  }),
  said: pick(["hello", "read the notes", "again", "more please"]),
  thinks: boolean,
  calls: int(0, 2),
  model: pick([
    "gemini-3-pro-preview",
    "gemini-3-flash-preview",
    "",
    "a-model-no-list-knows",
  ]),
  usage,
  lasted: int(0, 120_000),
  outcome: pick(["ok", "ok", "error", "cancelled"]),
});

/** Conversations of generated model calls, each in a session of its own. */
export const conversations = Arbitrary.array(
  Arbitrary.all({
    first: int(0, 3),
    calls: Arbitrary.array(generatedCall, { minLength: 1, maxLength: 5 }),
  }),
  { minLength: 1, maxLength: 3 },
);

type Generated =
  typeof conversations extends Arbitrary.Arbitrary<infer A> ? A : never;

const inputStep = (
  kind: "user" | "result" | "compaction",
  idx: number,
  said: string,
) => {
  switch (kind) {
    case "user":
      return Steps.userMessage(idx, `${said} ${idx}`);
    case "result":
      return Steps.toolResult(
        idx,
        {
          id: `tool-${idx}`,
          name: "read_file",
          arguments: '{"path":"notes.txt"}',
        },
        `line ${idx}`,
      );
    case "compaction":
      return Steps.compaction(idx, `summary up to ${idx}`);
  }
};

/**
 * Each conversation's calls as a report gives them, in its order: call keys
 * unique across sessions, starts ten minutes apart, steps in increasing idx,
 * each call's `after` the one before it.
 */
export const callsOf = (
  generated: Generated,
): ReadonlyArray<ReadonlyArray<Report.Call>> =>
  generated.map((conversation, at) => {
    const session = `conversation-${at}`;
    let idx = conversation.first;
    let before = Option.none<Report.After>();
    return conversation.calls.map((each, place): Report.Call => {
      const startedAt = DateTime.makeUnsafe(
        nowMs - 3 * 24 * 3_600_000 + at * 60_000 + place * 600_000,
      );
      const input = each.input.map((kind) => inputStep(kind, idx++, each.said));
      const output = Steps.modelOutput(idx++, {
        text: `${each.said}, answered`,
        ...(each.thinks ? { thoughts: "thinking it over" } : {}),
        calls: Array.from({ length: each.calls }, (_, call) => ({
          id: `call-${place}-${call}`,
          name: "read_file",
          arguments: `{"path":"notes-${call}.txt"}`,
        })),
      });
      const call: Report.Call = {
        call: `${session}/call-${place}`,
        after: before,
        session,
        project: "garden",
        clientVersion: "1.4.0",
        model: each.model,
        startedAt,
        finishedAt: DateTime.makeUnsafe(
          DateTime.toEpochMillis(startedAt) + each.lasted,
        ),
        outcome: each.outcome,
        errorType: each.outcome === "ok" ? "" : "cota_reported_unknown",
        errorMessage: each.outcome === "ok" ? "" : "It stopped.",
        stopReason: each.outcome === "ok" ? "STOP" : "",
        providerRequestId: "",
        usage: each.usage,
        input,
        output: [output],
      };
      before = Option.some({ call: call.call, startedAt });
      return call;
    });
  });

/** Every call of the conversations, interleaved by `picks` while each conversation keeps its order. */
export const interleaved = (
  calls: ReadonlyArray<ReadonlyArray<Report.Call>>,
  picks: ReadonlyArray<number>,
): ReadonlyArray<Report.Call> => {
  const left = calls.map((each) => [...each]);
  const all: Array<Report.Call> = [];
  let turn = 0;
  while (left.some((each) => each.length > 0)) {
    const open = left.filter((each) => each.length > 0);
    const from = open[(picks[turn++] ?? 0) % open.length];
    const next = from?.shift();
    if (next !== undefined) all.push(next);
  }
  return all;
};

/** The calls cut into consecutive reports, after each call whose `cuts` is true, and after the last. */
export const cut = (
  calls: ReadonlyArray<Report.Call>,
  cuts: ReadonlyArray<boolean>,
): ReadonlyArray<ReadonlyArray<Report.Call>> => {
  const reports: Array<Array<Report.Call>> = [[]];
  calls.forEach((call, at) => {
    reports.at(-1)?.push(call);
    if (cuts[at] === true && at < calls.length - 1) reports.push([]);
  });
  return reports;
};

/** Conversations interleaved and cut into reports. */
export const reported = Arbitrary.all({
  conversations,
  picks: Arbitrary.array(int(0, 2), { maxLength: 15 }),
  cuts: Arbitrary.array(boolean, { maxLength: 15 }),
}).pipe(
  Arbitrary.map(({ conversations, picks, cuts }) => {
    const calls = interleaved(callsOf(conversations), picks);
    return { calls, reports: cut(calls, cuts) };
  }),
);

export const reportOf = (
  calls: ReadonlyArray<Report.Call>,
  through: Option.Option<DateTime.Utc> = Option.none(),
): Report.Report => ({
  client: "antigravity",
  pool: observed.id,
  through,
  calls,
});

/** `ReportRequests` over an in-memory repository and reported through, priced from the shipped lists, with the clock at `now`. */
export const started = (all: ReadonlyArray<Pool.Pool> = pools) =>
  Effect.gen(function* () {
    const { memory, repository } = yield* InMemoryRequests.make();
    const context = yield* Layer.build(
      ReportRequests.layer(poolsById(all)).pipe(
        Layer.provide(Layer.succeed(RequestsRepository, repository)),
        Layer.provide(PriceLists.layer(poolsById(all))),
        Layer.provideMerge(InMemoryReportedThrough.layer),
      ),
    );
    return {
      memory,
      through: Context.get(
        context,
        InMemoryReportedThrough.InMemoryReportedThrough,
      ),
      reportRequests: Context.get(context, ReportRequests.ReportRequests),
    };
  });
