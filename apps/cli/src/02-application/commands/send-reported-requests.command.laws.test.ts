import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, DateTime, Effect, Layer, Result, Schema } from "effect";
import { TestClock } from "effect/testing";
import * as ReadHubKeys from "#02-application/queries/read-hub-keys.query.ts";
import { ReadProject } from "#02-application/queries/read-project.query.ts";
import { fromStart, readingOf } from "#03-domain/antigravity-record.ts";
import * as HubAddress from "#03-domain/hub-address.ts";
import * as Paths from "#03-domain/paths.ts";
import { bytesOf, type Limits } from "#03-domain/requests.ts";
import {
  carriesUsage,
  conversationOf,
  Plan,
  plan,
} from "#05-tests/antigravity-records.ts";
import * as InMemoryClientRecords from "#05-tests/fakes/in-memory-client-records.ts";
import * as InMemoryFiles from "#05-tests/fakes/in-memory-files.ts";
import * as InMemoryRunLock from "#05-tests/fakes/in-memory-run-lock.ts";
import * as ScriptedRequestReports from "#05-tests/fakes/scripted-request-reports.ts";
import * as Send from "./send-reported-requests.command.ts";

const variables = { HOME: "/home/me" };
const paths = Result.getOrThrow(Paths.pathsOf("linux", variables));

const folders = [
  { folder: "/data/agy", pool: "gemini" },
  { folder: "/data/agy-work", pool: "gemini-work" },
] as const;

const configuration = {
  hub: Result.getOrThrow(HubAddress.read("http://127.0.0.1:18080", false)),
  machine: "studio",
  clients: { antigravity: { reported: folders } },
};

/** A conversation as it grows: its folder, its steps, how many it holds at each run, the run each step finishes in, and the runs its files change while copied. */
const Grown = Schema.Struct({
  folder: Schema.Literals([0, 1]),
  plans: Schema.Array(Plan).check(Schema.isMaxLength(10)),
  shown: Schema.Array(
    Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10 })),
  ).check(Schema.isMaxLength(7)),
  finishing: Schema.Array(
    Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 })),
  ).check(Schema.isMaxLength(10)),
  changingAt: Schema.Array(
    Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 })),
  ).check(Schema.isMaxLength(2)),
});
type Grown = typeof Grown.Type;

const Answer = Schema.Literals([
  200,
  200,
  409,
  503,
  401,
  "undecodable",
  "never",
]);

/** A run: how the hub answers its reports in turn (200 once these are used), and the minutes before it, 11 letting a waiting conversation settle. */
const Run = Schema.Struct({
  answers: Schema.Array(Answer).check(Schema.isMaxLength(4)),
  pause: Schema.Literals([1, 11]),
});
type Run = typeof Run.Type;

/**
 * Limits about as small as the generated calls (about 1.4 KB each, 0.4 KB
 * more for each step of their input), so that most runs cut their calls
 * into several reports: the bytes hold one call more than the calls allow
 * of the fixed conversations' small ones, and not two of their large ones.
 */
const Case = Schema.Struct({
  calls: Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: 4 })),
  bytes: Schema.Int.check(Schema.isBetween({ minimum: 7_500, maximum: 9_000 })),
  grown: Schema.Array(Grown).check(Schema.isMaxLength(3)),
  runs: Schema.Array(Run).check(Schema.isMaxLength(5)),
});
type Case = typeof Case.Type;

/**
 * Conversations every case begins with, so that each law's mutants meet
 * what kills them whatever the seed: one of a second folder whose files
 * change while the first run copies them, one of seven calls that comes
 * at the second run, whose first report the hub refuses, and one of two
 * calls too large to share a report.
 */
const fixed: ReadonlyArray<Grown> = [
  {
    folder: 1,
    plans: [plan("user"), plan("model"), plan("tool"), plan("model")],
    shown: [4],
    finishing: [],
    changingAt: [0],
  },
  {
    folder: 0,
    plans: [
      plan("user"),
      ...Array.from({ length: 7 }, () => [plan("model"), plan("tool")]).flat(),
    ],
    shown: [0, 15],
    finishing: [],
    changingAt: [],
  },
  {
    folder: 1,
    plans: [
      plan("user"),
      ...Array.from({ length: 2 }, () => [
        ...Array.from({ length: 10 }, () => plan("other")),
        plan("model"),
      ]).flat(),
    ],
    shown: [23],
    finishing: [],
    changingAt: [],
  },
];
const fixedRuns: ReadonlyArray<Run> = [
  { answers: [], pause: 1 },
  { answers: [503], pause: 1 },
];

/** Runs after the generated ones, the hub storing everything, until every conversation is reported to its end. */
const flush: ReadonlyArray<Run> = Array.from({ length: 4 }, () => ({
  answers: [],
  pause: 11,
}));

const idOf = (index: number) => `conversation-${index}`;

/** A conversation as it is at a run, or at its end: every step it will have, finished. */
const heldAt = (grown: Grown, index: number, run: number, end: boolean) => {
  const count = end
    ? grown.plans.length
    : Math.min(
        grown.plans.length,
        Math.max(0, ...grown.shown.slice(0, run + 1)),
      );
  const shown = grown.plans.slice(0, count);
  const statuses = shown.map((each, idx) =>
    end || run >= (grown.finishing[idx] ?? 0)
      ? 3
      : carriesUsage(each.kind)
        ? 8
        : 1,
  );
  const finished = statuses.filter((status) => status === 3).length;
  return {
    ...conversationOf(idOf(index), shown, statuses, count * 100 + finished),
    changing: !end && grown.changingAt.includes(run),
  };
};

/** The calls a conversation holds that a run reads without waiting for a step to settle. */
const callsHeld = (index: number, held: InMemoryClientRecords.Conversation) =>
  readingOf(
    InMemoryClientRecords.recordOf(idOf(index), held, -1),
    fromStart,
    false,
  ).calls.map(({ call }) => call);

interface Sent {
  readonly run: number;
  readonly folder: number;
  readonly startedAt: string;
  readonly report: ScriptedRequestReports.Report;
  readonly body: string;
  readonly answer: ScriptedRequestReports.Answer;
  /** The calls the hub stored before this report. */
  readonly storedBefore: ReadonlySet<string>;
  /** The calls the folder's conversations held when the run began. */
  readonly held: ReadonlySet<string>;
}

/** Runs the request reporter over a case and records every report, what was stored before each, and what the folders held. */
const reportedOver = ({ calls, bytes, grown, runs }: Case) =>
  Effect.gen(function* () {
    const limits: Limits = { calls, bytes, body: 60_000 };
    const all = [...fixed, ...grown];
    const every = [...fixedRuns, ...runs, ...flush];
    const ends = fixedRuns.length + runs.length;
    const records = InMemoryClientRecords.make();
    let answers: Array<ScriptedRequestReports.Answer> = [];
    const hub = ScriptedRequestReports.make(() => answers.shift() ?? 200);
    const { layer: files } = InMemoryFiles.make([
      [paths.hubKeys, { kind: "directory", mode: 0o700 }],
      [
        Paths.hubKeyFile(paths, "subscription"),
        { kind: "file", text: "subscription-hub-key\n", mode: 0o600 },
      ],
    ]);
    const send = yield* Send.SendReportedRequests.pipe(
      Effect.provide(
        Send.layerOf(limits).pipe(
          Layer.provideMerge(ReadHubKeys.layer),
          Layer.provideMerge(
            Layer.mergeAll(
              files,
              records.layer,
              hub.layer,
              InMemoryRunLock.make().layer,
              Layer.succeed(
                ReadProject,
                ReadProject.of({
                  execute: () => Effect.succeed("acme-api"),
                  ofDirectory: (directory) =>
                    Effect.succeed(directory.split("/").at(-1) ?? ""),
                }),
              ),
            ),
          ),
        ),
      ),
    );

    const stored = new Set<string>();
    const sent: Array<Sent> = [];
    const changingIn = new Set<string>();
    for (const [run, { answers: given, pause }] of every.entries()) {
      const end = run >= ends;
      yield* TestClock.adjust(`${pause} minutes`);
      const startedAt = DateTime.formatIso(yield* DateTime.now);
      const held = folders.map(() => new Set<string>());
      for (const [at, { folder }] of folders.entries()) {
        const conversations = new Map<
          string,
          InMemoryClientRecords.Conversation
        >();
        all.forEach((each, index) => {
          if (each.folder !== at) return;
          const now = heldAt(each, index, run, end);
          conversations.set(idOf(index), now);
          if (now.changing) changingIn.add(`${run}:${at}`);
          for (const call of callsHeld(index, now)) held[at]?.add(call);
        });
        records.folders.set(folder, conversations);
      }
      answers = [...given];
      const before = hub.sent.length;
      yield* send.execute(paths, configuration);
      for (const each of hub.sent.slice(before)) {
        const folder = folders.findIndex(
          ({ pool }) => pool === each.report.pool,
        );
        sent.push({
          run,
          folder,
          startedAt,
          report: each.report,
          body: each.body,
          answer: each.answer,
          storedBefore: new Set(stored),
          held: held[folder] ?? new Set(),
        });
        if (each.answer === 200) {
          for (const call of each.report.calls) stored.add(call.call);
        }
      }
    }
    /** Each conversation's calls at its end, in order. */
    const ended = new Map(
      all.map((each, index) => [
        idOf(index),
        {
          folder: each.folder,
          calls: callsHeld(index, heldAt(each, index, 0, true)),
        },
      ]),
    );
    return { limits, sent, stored, ended, changingIn, runs: every.length };
  });

describe("request reporter laws", () => {
  it.effect.prop(
    "J20: For any sequence of appends and runs whose reports are answered 200, refused, failed or never, a call is among those each run sends until a report holding it is answered 200, and among none after, a call reported unfinished among them, whatever its step becomes; each report names as `after` the call stored before it, or one earlier in it.",
    { drawn: Arbitrary.schema(Case) },
    ({ drawn }) =>
      Effect.gen(function* () {
        const { sent, stored, ended, changingIn, runs } =
          yield* reportedOver(drawn);
        for (const { report, storedBefore } of sent) {
          const earlier = new Set<string>();
          for (const call of report.calls) {
            expect(storedBefore.has(call.call)).toBe(false);
            const calls = ended.get(call.session)?.calls ?? [];
            const before = calls[calls.indexOf(call.call) - 1];
            expect(call.after?.call).toBe(before);
            if (call.after !== null) {
              expect(
                storedBefore.has(call.after.call) ||
                  earlier.has(call.after.call),
              ).toBe(true);
            }
            earlier.add(call.call);
          }
        }
        // A run every report of which a folder's hub stored, and that no
        // answer stopped before it, sent each call the folder held that
        // could be read.
        for (let run = 0; run < runs; run += 1) {
          const ofRun = sent.filter((each) => each.run === run);
          const stopped = ofRun.findIndex(
            ({ answer }) => answer === "never" || answer === 401,
          );
          for (const at of folders.keys()) {
            const own = ofRun.filter(({ folder }) => folder === at);
            const stoppedBefore =
              stopped >= 0 && (ofRun[stopped]?.folder ?? at) < at;
            if (
              stoppedBefore ||
              changingIn.has(`${run}:${at}`) ||
              own.some(({ answer }) => answer !== 200)
            ) {
              continue;
            }
            const last = own.at(-1);
            const after = new Set([
              ...(last?.storedBefore ?? []),
              ...(last?.report.calls.map(({ call }) => call) ?? []),
            ]);
            for (const call of last?.held ?? []) {
              expect(after.has(call)).toBe(true);
            }
          }
        }
        expect([...stored].sort()).toEqual(
          [...ended.values()].flatMap(({ calls }) => calls).sort(),
        );
      }),
    { arbitrary: { runs: 100 } },
  );

  it.effect.prop(
    "J21: Every report holds calls of one folder, at most 200 and 8 MiB but for a call alone over it, in order, and no report's body is over 64 MiB.",
    { drawn: Arbitrary.schema(Case) },
    ({ drawn }) =>
      Effect.gen(function* () {
        const { limits, sent, ended } = yield* reportedOver(drawn);
        const runs = new Set(sent.map(({ run }) => run));
        for (const run of runs) {
          for (const at of folders.keys()) {
            const own = sent.filter(
              (each) => each.run === run && each.folder === at,
            );
            const order: Array<readonly [string, number]> = [];
            for (const { report, body } of own) {
              expect(report.calls.length).toBeLessThanOrEqual(limits.calls);
              expect(report.calls.length > 0 || report.through !== null).toBe(
                true,
              );
              if (report.calls.length > 1) {
                expect(bytesOf(body)).toBeLessThanOrEqual(limits.bytes);
              }
              expect(bytesOf(body)).toBeLessThanOrEqual(limits.body);
              for (const call of report.calls) {
                const conversation = ended.get(call.session);
                expect(conversation?.folder).toBe(at);
                order.push([
                  call.session,
                  conversation?.calls.indexOf(call.call) ?? -1,
                ]);
              }
            }
            const sorted = [...order].sort(([one, at1], [other, at2]) =>
              one === other ? at1 - at2 : one < other ? -1 : 1,
            );
            expect(order).toEqual(sorted);
            expect(new Set(order.map((each) => each.join(":"))).size).toBe(
              order.length,
            );
          }
        }
      }),
    { arbitrary: { runs: 100 } },
  );

  it.effect.prop(
    "J26: A report carries a folder's `through` only when every call the folder's readable conversations held when the run began reading it has been answered 200, and that `through` is the moment the run began.",
    { drawn: Arbitrary.schema(Case) },
    ({ drawn }) =>
      Effect.gen(function* () {
        const { sent } = yield* reportedOver(drawn);
        for (const { report, storedBefore, held, startedAt } of sent) {
          if (report.through === null) continue;
          expect(report.through).toBe(startedAt);
          const answered = new Set([
            ...storedBefore,
            ...report.calls.map(({ call }) => call),
          ]);
          for (const call of held) expect(answered.has(call)).toBe(true);
        }
        // Every folder is caught up with in the end.
        for (const at of folders.keys()) {
          expect(
            sent.some(
              ({ folder, report, answer }) =>
                folder === at && report.through !== null && answer === 200,
            ),
          ).toBe(true);
        }
      }),
    { arbitrary: { runs: 100 } },
  );
});
