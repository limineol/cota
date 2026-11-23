import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "@effect/vitest";
import {
  Arbitrary,
  Context,
  DateTime,
  Effect,
  Exit,
  Layer,
  Option,
  Schema,
  Scope,
} from "effect";
import { TestClock } from "effect/testing";
import * as RecordRequest from "#modules/request-log/02-application/commands/record-request.command.ts";
import { ReportedThrough } from "#modules/request-log/02-application/interfaces/reported-through.ts";
import { RequestsRepository } from "#modules/request-log/02-application/interfaces/requests.repository.ts";
import * as Report from "#modules/request-log/03-domain/report.ts";
import * as StoredItems from "#modules/request-log/03-domain/stored-items.ts";
import * as Title from "#modules/request-log/03-domain/title.ts";
import * as SqliteReportedThrough from "#modules/request-log/04-infrastructure/persistence/sqlite/sqlite-reported-through.ts";
import * as PriceLists from "#modules/request-log/04-infrastructure/prices/prices.ts";
import * as Steps from "#modules/request-log/05-tests/antigravity-steps.ts";
import * as InMemoryRequests from "#modules/request-log/05-tests/fakes/in-memory-requests.repository.ts";
import * as Reports from "#modules/request-log/05-tests/reports.ts";
import * as Conversation from "#shared/03-domain/conversation.ts";
import { PoolId } from "#shared/03-domain/ids.ts";
import type * as Pool from "#shared/03-domain/pool.entity.ts";
import { compareText } from "#shared/03-domain/text.ts";
import * as HubStore from "#shared/04-infrastructure/hub-store/hub-store.ts";
import * as Harness from "#shared/05-tests/harness.ts";
import * as ReportRequests from "./report-requests.command.ts";

const { int, pick } = Reports;

type World = Effect.Success<ReturnType<typeof Reports.started>>;

const atNow = TestClock.setTime(DateTime.toEpochMillis(Reports.now));

const idOf = (call: Report.Call) =>
  Report.idOf("antigravity", call.call, call.startedAt);

const callerOf = (
  reporter: Report.Reporter,
  machine = "studio",
): Report.Caller => ({ reporter, machine });

const byText =
  <A>(textOf: (value: A) => string) =>
  (one: A, other: A) =>
    compareText(textOf(one), textOf(other));

/** What the log holds, in an order of its own, as a log is compared with another. */
const logOf = (memory: InMemoryRequests.InMemory) => ({
  requests: [...memory.requests]
    .sort(byText(({ request }) => request.id))
    .map(({ request, cost }) => ({
      request: StoredItems.storedOf(request),
      cost,
    })),
  requestItems: [...memory.requestItems].sort(
    byText(({ requestId }) => requestId),
  ),
  items: [...memory.items].sort(
    byText(({ session, digest }) => `${session} ${digest}`),
  ),
});

const holds = (memory: InMemoryRequests.InMemory, id: string) =>
  memory.requests.some(({ request }) => request.id === id) &&
  memory.requestItems.some(({ requestId }) => requestId === id);

/**
 * Sends a report until it is answered 200, each attempt meeting the next of
 * `faults` when it stores, and gives each answer to `answered`.
 */
const delivered = (
  world: World,
  calls: ReadonlyArray<Report.Call>,
  reporter: Report.Reporter,
  faults: Array<InMemoryRequests.Fault>,
  answered: (calls: ReadonlyArray<Report.Call>) => void = () => {},
) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 50; attempt++) {
      world.memory.faults.splice(0, Infinity, faults.shift() ?? "none");
      const answer = yield* Effect.result(
        world.reportRequests.execute(
          Reports.reportOf(calls),
          callerOf(reporter),
        ),
      );
      world.memory.faults.splice(0);
      if (answer._tag === "Success") {
        answered(calls);
        return answer.success;
      }
      expect(answer.failure._tag).toBe("RequestLogUnavailable");
    }
    return yield* Effect.die("a report was never stored");
  });

const once = (
  reports: ReadonlyArray<ReadonlyArray<Report.Call>>,
  reporter: Report.Reporter,
) =>
  Effect.gen(function* () {
    const world = yield* Reports.started();
    for (const report of reports) yield* delivered(world, report, reporter, []);
    return world;
  });

const deliveries = Arbitrary.all({
  plan: Reports.reported,
  reporter: pick(Reports.reporters),
  againBy: pick(Reports.reporters),
  faults: Arbitrary.array(
    pick(["none", "unreached", "lost", "cut", "declined"]),
    { maxLength: 20 },
  ),
  again: Arbitrary.array(
    Arbitrary.all({ after: int(0, 8), from: int(0, 30), length: int(1, 6) }),
    { maxLength: 4 },
  ),
});

/**
 * Each report sent until it is stored, through faults, and after some of them
 * a run of the calls sent so far sent again, by a reporter that may be
 * another: whole reports, parts of them, and several together.
 */
const deliveredMany = (
  generated: typeof deliveries extends Arbitrary.Arbitrary<infer A> ? A : never,
  answered?: (calls: ReadonlyArray<Report.Call>) => void,
) =>
  Effect.gen(function* () {
    const world = yield* Reports.started();
    const faults = [...generated.faults];
    const sent: Array<Report.Call> = [];
    for (const [at, report] of generated.plan.reports.entries()) {
      yield* delivered(world, report, generated.reporter, faults, answered);
      sent.push(...report);
      for (const again of generated.again) {
        if (again.after !== at) continue;
        const from = again.from % sent.length;
        yield* delivered(
          world,
          sent.slice(from, from + again.length),
          generated.againBy,
          faults,
          answered,
        );
      }
    }
    return world;
  });

const digestOf = (step: Schema.JsonObject) =>
  Conversation.itemOf({ parts: [], takenOut: [], textOf: () => "" }, step)
    .digest;

describe("reported requests laws", () => {
  it.effect.prop(
    "L9: however a report is delivered again, by its reporter or another, in part, with others, or after a delivery stored in part, the log holds each call once, with the rows one delivery of each call gives",
    { generated: deliveries },
    ({ generated }) =>
      Effect.gen(function* () {
        yield* atNow;
        const many = yield* deliveredMany(generated);
        const single = yield* once(generated.plan.reports, generated.reporter);
        expect(logOf(many.memory)).toEqual(logOf(single.memory));
      }).pipe(Effect.scoped),
    { arbitrary: { runs: 150 } },
  );

  it.effect.prop(
    "L10: a report answered 200 has every one of its calls held in the log at the moment of the answer",
    { generated: deliveries },
    ({ generated }) =>
      Effect.gen(function* () {
        yield* atNow;
        const missing: Array<string> = [];
        let world: World | undefined;
        const answered = (calls: ReadonlyArray<Report.Call>) => {
          for (const call of calls) {
            const id = idOf(call);
            if (world !== undefined && !holds(world.memory, id)) {
              missing.push(call.call);
            }
          }
        };
        world = yield* Reports.started();
        const faults = [...generated.faults];
        for (const report of generated.plan.reports) {
          yield* delivered(world, report, generated.reporter, faults, answered);
        }
        expect(missing).toEqual([]);
      }).pipe(Effect.scoped),
    { arbitrary: { runs: 150 } },
  );

  it.effect.prop(
    "L12: for any conversation in any cut into reports, each call's input part is every item of the calls before it and its own input, in order, its output part its own, and each item is stored once per session",
    { plan: Reports.reported, reporter: pick(Reports.reporters) },
    ({ plan, reporter }) =>
      Effect.gen(function* () {
        yield* atNow;
        const world = yield* once(plan.reports, reporter);
        const sessions = new Map<string, Array<Conversation.Digest>>();
        for (const call of plan.calls) {
          const before = sessions.get(call.session) ?? [];
          const input = call.input.map(digestOf);
          const output = call.output.map(digestOf);
          const row = world.memory.requestItems.find(
            ({ requestId }) => requestId === idOf(call),
          );
          expect(row?.input).toEqual([...before, ...input]);
          expect(row?.output).toEqual(output);
          sessions.set(call.session, [...before, ...input, ...output]);
        }
        const kept = world.memory.items.map(
          ({ session, digest }) => `${session} ${digest}`,
        );
        expect(new Set(kept).size).toBe(kept.length);
        expect(kept.toSorted()).toEqual(
          [...sessions.entries()]
            .flatMap(([session, digests]) =>
              digests.map((digest) => `${session} ${digest}`),
            )
            .toSorted(),
        );
      }).pipe(Effect.scoped),
    { arbitrary: { runs: 150 } },
  );

  it.effect.prop(
    "L13: every stored reported request has its record form as its protocol, its purpose compaction exactly when its output is a compaction's step, and the empty value of every other column the forwarded origin holds",
    { plan: Reports.reported, reporter: pick(Reports.reporters) },
    ({ plan, reporter }) =>
      Effect.gen(function* () {
        yield* atNow;
        const world = yield* once(plan.reports, reporter);
        expect(world.memory.requests).toHaveLength(plan.calls.length);
        const compactions = new Set(
          plan.calls
            .filter((call) => call.output.some((step) => step.step_type === 23))
            .map((call) =>
              Report.idOf("antigravity", call.call, call.startedAt),
            ),
        );
        for (const { request } of world.memory.requests) {
          const {
            protocol,
            firstByteMs,
            follows,
            refusalReset,
            sessionSource,
            userAgent,
            divertedFrom,
            loginFingerprint,
            purpose,
            servedModel,
            serviceTier,
            errorBody,
            stream,
            upstreamStatus,
            rateLimits,
            clientHeaders,
            requestBytes,
            responseBytes,
            readingComplete,
          } = StoredItems.storedOf(request);
          expect({
            protocol,
            firstByteMs,
            follows,
            refusalReset,
            sessionSource,
            userAgent,
            divertedFrom,
            loginFingerprint,
            purpose,
            servedModel,
            serviceTier,
            errorBody,
            stream,
            upstreamStatus,
            rateLimits,
            clientHeaders,
            requestBytes,
            responseBytes,
            readingComplete,
          }).toEqual({
            protocol: "antigravity-steps",
            firstByteMs: Option.none(),
            follows: Option.none(),
            refusalReset: Option.none(),
            sessionSource: "",
            userAgent: "",
            divertedFrom: Option.none(),
            loginFingerprint: Option.none(),
            purpose: compactions.has(request.id) ? "compaction" : "",
            servedModel: "",
            serviceTier: "",
            errorBody: "",
            stream: false,
            upstreamStatus: 0,
            rateLimits: {},
            clientHeaders: {},
            requestBytes: 0,
            responseBytes: 0,
            readingComplete: true,
          });
        }
      }).pipe(Effect.scoped),
    { arbitrary: { runs: 100 } },
  );

  it.effect.prop(
    "L7: the stored requests' hub key is the caller's hub key's name, empty for the owner, and their machine the caller's x-cota-machine, whatever the report holds",
    {
      plan: Reports.reported,
      reporter: pick(Reports.reporters),
      machine: Arbitrary.all({
        name: pick(["studio", "  laptop ", "build-7", "a".repeat(240)]),
        other: Arbitrary.schema(Schema.String),
        given: Arbitrary.schema(Schema.Boolean),
      }),
    },
    ({ plan, reporter, machine }) =>
      Effect.gen(function* () {
        yield* atNow;
        const header = machine.given ? machine.other : machine.name;
        if (Title.keptOf(header) === "") return;
        const world = yield* Reports.started();
        for (const report of plan.reports) {
          yield* world.reportRequests
            .execute(Reports.reportOf(report), callerOf(reporter, header))
            .pipe(Effect.orDie);
        }
        const stored = world.memory.requests.map(({ request }) => {
          const { hubKey, machine } = StoredItems.storedOf(request);
          return { hubKey, machine };
        });
        expect(stored).toEqual(
          plan.calls.map(() => ({
            hubKey: reporter._tag === "Owner" ? "" : reporter.name,
            machine: Title.keptOf(header),
          })),
        );
      }).pipe(Effect.scoped),
    { arbitrary: { runs: 100 } },
  );
});

const defects = [
  "call key twice",
  "finished before started",
  "lasted too long",
  "started ahead",
  "started before 2020",
  "more reasoning than output",
  "not a step",
  "no output",
  "two outputs",
  "steps out of order",
  "call before in another session",
  "call before at another start",
  "call before never stored",
  "pool not observed",
  "no such pool",
  "no machine",
  "through ahead",
  "values the log cannot hold",
] as const;

type Defect = (typeof defects)[number];

const minutes = (at: DateTime.Utc, count: number) =>
  DateTime.makeUnsafe(DateTime.toEpochMillis(at) + count * 60_000);

/** A report of the calls given with a defect in its call at `at`, and how it is sent. */
const defective = (
  calls: ReadonlyArray<Report.Call>,
  defect: Defect,
  at: number,
  world: World,
  reporter: Report.Reporter,
): { readonly report: Report.Report; readonly caller: Report.Caller } => {
  const place = Math.min(at, calls.length - 1);
  const call = calls[place];
  const report = Reports.reportOf(calls, Option.some(Reports.now));
  const caller = callerOf(reporter);
  if (call === undefined) return { report, caller };
  const changed = (changes: Partial<Report.Call>) => ({
    report: {
      ...report,
      calls: calls.map((each, index) =>
        index === place ? { ...each, ...changes } : each,
      ),
    },
    caller,
  });
  const lastIdx = Math.max(
    ...[...call.input, ...call.output].map((step) => Number(step.idx)),
  );
  switch (defect) {
    case "call key twice":
      return {
        report: { ...report, calls: [...calls, call] },
        caller,
      };
    case "finished before started":
      return changed({ finishedAt: minutes(call.startedAt, -1) });
    case "lasted too long":
      return changed({
        finishedAt: DateTime.makeUnsafe(
          DateTime.toEpochMillis(call.startedAt) + 4_294_967_296,
        ),
      });
    case "started ahead":
      return changed({
        startedAt: minutes(Reports.now, 6),
        finishedAt: minutes(Reports.now, 7),
      });
    case "started before 2020":
      return changed({
        startedAt: DateTime.makeUnsafe("2019-12-31T23:59:00Z"),
        finishedAt: DateTime.makeUnsafe("2019-12-31T23:59:30Z"),
      });
    case "more reasoning than output":
      return changed({
        usage: Option.some({
          tokens: {
            input: 10,
            cacheRead: 0,
            cacheWriteShort: 0,
            cacheWriteLong: 0,
            output: 4,
          },
          reasoning: 5,
          reported: "{}",
        }),
      });
    case "not a step":
      return changed({ input: [...call.input, { idx: lastIdx + 1 }] });
    case "no output":
      return changed({ output: [] });
    case "two outputs":
      return changed({
        output: [
          ...call.output,
          Steps.modelOutput(lastIdx + 1, { text: "and" }),
        ],
      });
    case "steps out of order":
      return changed({
        input: [...call.input, Steps.userMessage(lastIdx + 1, "late")],
      });
    case "call before in another session":
      return changed({
        session: "another-conversation",
        after: Option.some({ call: "elsewhere", startedAt: call.startedAt }),
      });
    case "call before at another start":
      return changed({
        after: Option.some({
          call: Option.match(call.after, {
            onNone: () => "never-sent",
            onSome: ({ call }) => call,
          }),
          startedAt: minutes(call.startedAt, -1_000),
        }),
      });
    case "call before never stored":
      return changed({
        after: Option.some({ call: "never-sent", startedAt: call.startedAt }),
      });
    case "pool not observed":
      return { report: { ...report, pool: PoolId.make("claude") }, caller };
    case "no such pool":
      return { report: { ...report, pool: PoolId.make("nowhere") }, caller };
    case "no machine":
      return { report, caller: callerOf(reporter, " \t ") };
    case "through ahead":
      return {
        report: { ...report, through: Option.some(minutes(Reports.now, 6)) },
        caller,
      };
    case "values the log cannot hold": {
      const id = idOf(call);
      world.memory.holds = ({ request }) => request.id !== id;
      return { report, caller };
    }
  }
};

const refusals = new Set([
  "NoSuchPool",
  "PoolNotObserved",
  "ReportRefused",
  "ReportOutOfOrder",
]);

describe("a refused report", () => {
  it.effect.prop(
    "L11: a report answered with any problem but request-log-unavailable and hub-store-unavailable changes nothing in the log or the hub store",
    {
      plan: Reports.reported,
      reporter: pick(Reports.reporters),
      at: int(0, 20),
    },
    ({ plan, reporter, at }) =>
      Effect.gen(function* () {
        yield* atNow;
        const [first, ...rest] = plan.reports;
        const later = rest.flat();
        for (const defect of defects) {
          const world = yield* Reports.started();
          if (first !== undefined && later.length > 0) {
            yield* delivered(world, first, reporter, []);
          }
          const calls = later.length > 0 ? later : plan.calls;
          const place =
            defect === "values the log cannot hold" ? calls.length - 1 : at;
          const before = logOf(world.memory);
          const throughBefore = [...world.through.kept.values()];
          const { report, caller } = defective(
            calls,
            defect,
            place,
            world,
            reporter,
          );
          const answer = yield* Effect.result(
            world.reportRequests.execute(report, caller),
          );
          expect(
            answer._tag === "Failure" && refusals.has(answer.failure._tag),
            defect,
          ).toBe(true);
          expect(logOf(world.memory), defect).toEqual(before);
          expect([...world.through.kept.values()], defect).toEqual(
            throughBefore,
          );
        }
      }).pipe(Effect.scoped),
    { arbitrary: { runs: 60 } },
  );
});

const scratch = mkdtempSync(join(tmpdir(), "cota-reported-through-laws-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
let stores = 0;

const otherObserved: Pool.ObservedPool = {
  ...Reports.observed,
  id: PoolId.make("gemini-work"),
};

describe("reported through", () => {
  it.effect.prop(
    "L16: for any sequence of reports, a machine's, client's and pool's through is the greatest any of their reports gave",
    {
      sent: Arbitrary.array(
        Arbitrary.all({
          machine: pick(["studio", "laptop"]),
          pool: pick([Reports.observed.id, otherObserved.id]),
          back: int(0, 10_000),
          reporter: pick(Reports.reporters),
        }),
        { minLength: 1, maxLength: 12 },
      ),
    },
    ({ sent }) =>
      Effect.gen(function* () {
        yield* atNow;
        const pools = [...Reports.pools, otherObserved];
        const path = join(scratch, `${stores++}.sqlite`);
        const context = yield* Layer.build(
          ReportRequests.layer(Reports.poolsById(pools)).pipe(
            Layer.provideMerge(SqliteReportedThrough.layer),
            Layer.provide(
              HubStore.layer({ path, steps: SqliteReportedThrough.steps }).pipe(
                Layer.orDie,
              ),
            ),
            Layer.provide(
              Layer.effect(
                RequestsRepository,
                Effect.map(
                  InMemoryRequests.make(),
                  ({ repository }) => repository,
                ),
              ),
            ),
            Layer.provide(PriceLists.layer(Reports.poolsById(pools))),
          ),
        );
        const reportRequests = Context.get(
          context,
          ReportRequests.ReportRequests,
        );
        const greatest = new Map<string, number>();
        for (const each of sent) {
          const through = minutes(Reports.now, -each.back);
          yield* reportRequests
            .execute(
              {
                ...Reports.reportOf([], Option.some(through)),
                pool: each.pool,
              },
              callerOf(each.reporter, each.machine),
            )
            .pipe(Effect.orDie);
          const key = JSON.stringify([each.machine, "antigravity", each.pool]);
          greatest.set(
            key,
            Math.max(greatest.get(key) ?? 0, DateTime.toEpochMillis(through)),
          );
        }
        const kept = yield* Context.get(context, ReportedThrough).all.pipe(
          Effect.orDie,
        );
        expect(
          new Map(
            kept.map(({ machine, client, pool, through }) => [
              JSON.stringify([machine, client, pool]),
              DateTime.toEpochMillis(through),
            ]),
          ),
        ).toEqual(greatest);
      }).pipe(Effect.scoped),
    { arbitrary: { runs: 100 } },
  );
});

const rate = int(0, 4_000_000).pipe(Arbitrary.map(BigInt));

const priced = Arbitrary.all({
  list: Arbitrary.schema(Schema.Boolean),
  own: Arbitrary.schema(Schema.Boolean),
  input: rate,
  output: rate,
  cacheRead: rate,
});

/** The costs the writer gives forwarded requests of the same pool, model and usage, by the call each stands for. */
const writersCosts = (
  pools: ReadonlyArray<Pool.Pool>,
  calls: ReadonlyArray<Report.Call>,
) =>
  Effect.gen(function* () {
    const { memory, repository } = yield* InMemoryRequests.make();
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(
      RecordRequest.layer({
        ...RecordRequest.defaults,
        firstPause: "1 millis",
        longestPause: "8 millis",
        drainTimeout: "1 second",
      }).pipe(
        Layer.provide(Layer.succeed(RequestsRepository, repository)),
        Layer.provide(PriceLists.layer(Reports.poolsById(pools))),
      ),
      scope,
    );
    const writer = Context.get(context, RecordRequest.RecordRequest);
    const forwarded = calls.map((call) =>
      Harness.requestOf({
        protocol: "openai-chat",
        pool: Reports.observed.id,
        provider: Reports.observed.provider,
        model: call.model,
        usage: call.usage,
        session: call.session,
      }),
    );
    for (const request of forwarded) yield* writer.execute(request);
    yield* Scope.close(scope, Exit.void);
    return forwarded.map(
      ({ id }) =>
        memory.requests.find(({ request }) => request.id === id)?.cost,
    );
  });

describe("a reported request's cost", () => {
  it.effect.prop(
    "L17: a reported request's cost is the one the writer gives a request of its pool, model and usage, and none where that has no price",
    { plan: Reports.reported, price: priced },
    ({ plan, price }) =>
      Effect.gen(function* () {
        yield* atNow;
        const own = {
          base: {
            input: price.input,
            output: price.output,
            cacheRead: price.cacheRead,
          },
          tiers: [],
        };
        const pools = [
          {
            ...Reports.observed,
            prices: price.list ? Option.some("google") : Option.none(),
            ownPrices: price.own ? { "gemini-3-pro-preview": own } : {},
          },
        ];
        const world = yield* Reports.started(pools);
        const reporter = Reports.reporters[0];
        for (const report of plan.reports) {
          yield* delivered(world, report, reporter, []);
        }
        const reported = plan.calls.map(
          (call) =>
            world.memory.requests.find(
              ({ request }) => request.id === idOf(call),
            )?.cost,
        );
        expect(reported).toEqual(yield* writersCosts(pools, plan.calls));
      }).pipe(Effect.scoped),
    { arbitrary: { runs: 60 } },
  );
});

const lateSession = "conversation-late";

const startOf = (minute: number) =>
  DateTime.makeUnsafe(
    DateTime.toEpochMillis(Reports.now) - 3_600_000 + minute * 60_000,
  );

/** A call of one conversation, its call before named, steps as given, started at its minute. */
const callIn = (
  call: string,
  before: Option.Option<Report.Call>,
  input: ReadonlyArray<Schema.JsonObject>,
  output: Schema.JsonObject,
  minute: number,
): Report.Call => ({
  call,
  after: Option.map(before, ({ call, startedAt }) => ({ call, startedAt })),
  session: lateSession,
  project: "garden",
  clientVersion: "",
  model: "gemini-3-pro-preview",
  startedAt: startOf(minute),
  finishedAt: startOf(minute + 1),
  outcome: "ok",
  errorType: "",
  errorMessage: "",
  stopReason: "STOP",
  providerRequestId: "",
  usage: Option.none(),
  input,
  output: [output],
});

const rowOf = (memory: InMemoryRequests.InMemory, call: Report.Call) =>
  memory.requestItems.find(({ requestId }) => requestId === idOf(call));

describe("a call before named again", () => {
  // The first call; a later one whose input holds step 3 not yet finished;
  // and step 3 finished as a call of its own, after the first.
  const first = callIn(
    "late:1",
    Option.none(),
    [Steps.userMessage(0, "read the notes")],
    Steps.modelOutput(1, { text: "reading" }),
    0,
  );
  const unfinished = { ...Steps.modelOutput(3, { text: "half" }), status: 8 };
  const later = callIn(
    "late:4",
    Option.some(first),
    [Steps.userMessage(2, "and the plan"), unfinished],
    Steps.modelOutput(4, { text: "both read" }),
    4,
  );
  const late = callIn(
    "late:3",
    Option.some(first),
    [Steps.userMessage(2, "and the plan")],
    Steps.modelOutput(3, { text: "the plan, read" }),
    3,
  );

  it.effect(
    "L18: a call whose call before another call already names, held in the log or earlier in the report, is stored, its input part its call before's input and output and then its own input, and the other call's rows are left as they are",
    () =>
      Effect.gen(function* () {
        yield* atNow;
        for (const reports of [
          [[first, later], [late]],
          [[first, later, late]],
        ]) {
          const world = yield* Reports.started();
          for (const report of reports) {
            const answer = yield* world.reportRequests.execute(
              Reports.reportOf(report),
              callerOf(Reports.reporters[0]),
            );
            expect(answer.stored).toBe(report.length);
          }
          const digests = (call: Report.Call) => ({
            input: call.input.map(digestOf),
            output: call.output.map(digestOf),
          });
          const one = digests(first);
          expect(rowOf(world.memory, late)).toMatchObject({
            input: [...one.input, ...one.output, ...digests(late).input],
            output: digests(late).output,
          });
          expect(rowOf(world.memory, later)).toMatchObject({
            input: [...one.input, ...one.output, ...digests(later).input],
            output: digests(later).output,
          });
          expect(holds(world.memory, idOf(late))).toBe(true);
        }
      }).pipe(Effect.scoped),
  );

  it.effect(
    "L19: a report holding a call the log holds, with other content than was stored, leaves that call's rows as they were, stores its items the session does not hold, and builds each later call of the report on the call as the report gives it",
    () =>
      Effect.gen(function* () {
        yield* atNow;
        const world = yield* Reports.started();
        const caller = callerOf(Reports.reporters[0]);
        yield* world.reportRequests.execute(Reports.reportOf([first]), caller);
        const heldRequest = world.memory.requests.find(
          ({ request }) => request.id === idOf(first),
        );
        const heldRow = rowOf(world.memory, first);
        const changed: Report.Call = {
          ...first,
          output: [Steps.modelOutput(1, { text: "reading, again" })],
        };
        const next = callIn(
          "late:3",
          Option.some(changed),
          [Steps.userMessage(2, "and the plan")],
          Steps.modelOutput(3, { text: "the plan, read" }),
          3,
        );
        const answer = yield* world.reportRequests.execute(
          Reports.reportOf([changed, next]),
          caller,
        );
        expect(answer).toEqual({ stored: 1, held: 1 });
        expect(
          world.memory.requests.filter(
            ({ request }) => request.id === idOf(first),
          ),
        ).toEqual([heldRequest]);
        expect(
          world.memory.requestItems.filter(
            ({ requestId }) => requestId === idOf(first),
          ),
        ).toEqual([heldRow]);
        expect(rowOf(world.memory, next)?.input).toEqual([
          ...changed.input.map(digestOf),
          ...changed.output.map(digestOf),
          ...next.input.map(digestOf),
        ]);
        const kept = new Set(world.memory.items.map(({ digest }) => digest));
        for (const step of [...first.output, ...changed.output]) {
          expect(kept.has(digestOf(step))).toBe(true);
        }
      }).pipe(Effect.scoped),
  );
});
