import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Option, Schema } from "effect";
import {
  type Built,
  carriesUsage,
  conversationOf,
  encode,
  finishedAt,
  madeAt,
  models,
  type Plan,
  Plan as PlanSchema,
  plan,
  workspaces,
} from "#05-tests/antigravity-records.ts";
import {
  type Conversation,
  recordOf,
} from "#05-tests/fakes/in-memory-client-records.ts";
import {
  type Field,
  type From,
  fromStart,
  type ModelCall,
  type Reason,
  readAfter,
  readingOf,
  type Step,
} from "./antigravity-record.ts";

const conversation = "c0ffee00-0000-4000-8000-000000000001";

/** Every kind of step, in an order that has a call made in the workspace of the message before it, a tool's step between two calls, and a compaction. */
const every: ReadonlyArray<Plan> = [
  plan("user", { workspace: 1 }),
  plan("model"),
  plan("tool"),
  plan("model", { model: 1, reasoning: 40, answer: 80 }),
  plan("other", { text: "﻿starts with a byte order mark" }),
  plan("compaction", { model: 1 }),
  plan("user", { workspace: 0, text: "Café — naïve 🚀" }),
  plan("model", { took: 0 }),
];

const Tail = Schema.Array(PlanSchema).check(Schema.isMaxLength(12));

const readWhole = (held: Conversation, from: From = fromStart) =>
  readingOf(recordOf(conversation, held, readAfter(from)), from, true);

/** A step's status while it is not finished: a model's step is generating, any other pending. */
const unfinishedOf = (each: Plan) => (carriesUsage(each.kind) ? 8 : 1);

/** A field written out, back into its bytes, as the hub reads one (`AntigravitySteps`), without the reader's code. */
const bytesOfFields = (fields: ReadonlyArray<Field>): Uint8Array =>
  encode(
    fields.map(([number, wire, value]): Built => {
      if (wire === 0) return { number, varint: BigInt(value) };
      if (wire === 2) {
        return typeof value === "string"
          ? { number, text: value }
          : {
              number,
              bytes: new Uint8Array(Buffer.from(value.base64, "base64")),
            };
      }
      const bytes = Buffer.from(value, "hex");
      return wire === 1
        ? { number, fixed64: bytes.readBigUInt64LE() }
        : { number, fixed32: bytes.readUInt32LE() };
    }),
  );

const statusOf = (step: Step) => step.status;

describe("the Antigravity reader's laws", () => {
  it.effect.prop(
    "J19: For any record appended to step by step and read in runs cut anywhere (between steps, on an unfinished step, after a compaction), the model calls read run by run are those of reading the whole record once, with the same usage, model, times and output, but for a step reported unfinished, which stays as it was reported, and the order a late call is read in: a step read past while not finished and without usage, which later finishes with usage, is read by the first run after it finishes, before that run's newer calls; and each call names as `after` the call of the greatest step below its own among those read before it, its input every step between the two, so that a call read past a late one names the call before that late one and holds its step as it was.",
    {
      tail: Arbitrary.schema(Tail),
      cuts: Arbitrary.schema(
        Schema.Array(
          Schema.Struct({
            at: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 25 })),
            settled: Schema.Boolean,
          }),
        ).check(Schema.isMaxLength(8)),
      ),
      finishingAt: Arbitrary.schema(
        Schema.Array(
          Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 8 })),
        ).check(Schema.isMaxLength(25)),
      ),
      bare: Arbitrary.schema(
        Schema.Array(Schema.Boolean).check(Schema.isMaxLength(25)),
      ),
    },
    ({ tail, cuts, finishingAt, bare }) =>
      Effect.sync(() => {
        // After every kind of step, a model's step and a compaction of
        // another model, a tool's step between them, and a call after them.
        const plans = [
          ...every,
          plan("model"),
          plan("tool"),
          plan("compaction", { model: 1 }),
          plan("user"),
          plan("model"),
          ...tail,
        ];
        // Runs cut after the first user's message, before its call, on the
        // tool's step while it and the call are not finished; past the second
        // call and the compaction while they are not finished and have no
        // usage yet, so that both are late and the compaction's call before
        // is the second call; and past the last model's step and compaction
        // the same way, the compaction finishing a run before the model's
        // step, so that its model is not read from the generation of a step
        // not yet a call; then the generated ones.
        const runs = [
          { at: 1, settled: false },
          { at: 3, settled: false },
          { at: 8, settled: true },
          { at: 13, settled: true },
          { at: 13, settled: false },
          ...[...cuts].sort((one, other) => one.at - other.at),
        ];
        const finishing = new Map([
          [3, 3],
          [5, 4],
          [8, 5],
          [10, 4],
        ]);
        const finishesAt = plans.map(
          (_, idx) =>
            finishing.get(idx) ?? (idx <= 12 ? 2 : (finishingAt[idx] ?? 0)),
        );
        const bareAt = plans.map((_, idx) =>
          finishing.has(idx) ? true : idx <= 12 ? false : (bare[idx] ?? false),
        );
        let from = fromStart;
        const got: Array<{ readonly call: ModelCall; readonly run: number }> =
          [];
        let seen = 0;
        const final = runs.length;
        [...runs, { at: plans.length, settled: true }].forEach((run, index) => {
          seen = Math.max(seen, Math.min(run.at, plans.length));
          const shown = plans.slice(0, seen);
          const held = conversationOf(
            conversation,
            shown,
            shown.map((each, idx) =>
              index === final || index >= (finishesAt[idx] ?? 0)
                ? 3
                : unfinishedOf(each),
            ),
            1,
            bareAt,
          );
          const reading = readingOf(
            recordOf(conversation, held, readAfter(from)),
            from,
            run.settled,
          );
          if (!run.settled) {
            expect(reading.calls.map(({ outcome }) => outcome)).not.toContain(
              "error",
            );
          }
          got.push(...reading.calls.map((call) => ({ call, run: index })));
          from = reading.next;
        });
        expect(from.passed).toEqual([]);

        const whole = readWhole(conversationOf(conversation, plans)).calls;
        expect(got.map(({ call }) => call.call).toSorted()).toEqual(
          whole.map(({ call }) => call).toSorted(),
        );
        const writtenOut = new Map(
          whole.flatMap(({ input, output }) =>
            [...input, ...output].map((step) => [step.idx, step] as const),
          ),
        );
        const steps = (items: ReadonlyArray<Step>) =>
          items.map(({ idx }) => idx);
        // A late call is one read after a call of a later step.
        const late = got.map(({ call }, index) =>
          got.slice(0, index).some((other) => other.call.step > call.step),
        );
        expect(late).toContain(true);
        got.forEach(({ call, run }, index) => {
          const once = whole.find((each) => each.call === call.call);
          if (once === undefined) return;
          expect(call.startedAt).toBe(once.startedAt);
          expect(call.workspace).toEqual(once.workspace);
          expect(steps(call.output)).toEqual(steps(once.output));
          const before = got
            .slice(0, index)
            .map((each) => each.call)
            .filter(({ step }) => step < call.step)
            .reduce<Option.Option<ModelCall>>(
              (found, each) =>
                Option.exists(found, ({ step }) => step > each.step)
                  ? found
                  : Option.some(each),
              Option.none(),
            );
          const since = Option.getOrElse(
            Option.map(before, ({ step }) => step),
            () => -1,
          );
          expect(call.after).toEqual(
            Option.map(before, ({ call, startedAt }) => ({ call, startedAt })),
          );
          expect(steps(call.input)).toEqual(
            plans.flatMap((_, idx) =>
              idx > since && idx < call.step ? [idx] : [],
            ),
          );
          if (late[index] === true) {
            expect(run).toBe(Math.min(final, finishesAt[call.step] ?? 0));
            const newer = got.findIndex(
              (each, at) => each.run === run && late[at] !== true,
            );
            if (newer >= 0) expect(newer).toBeGreaterThan(index);
          }
          if (call.outcome === "error") return;
          expect(call.output).toEqual(once.output);
          for (const item of call.input) {
            if (statusOf(item) === 3) {
              expect(item).toEqual(writtenOut.get(item.idx));
            }
          }
          expect(call.usage).toEqual(once.usage);
          expect(call.model).toBe(once.model);
        });
      }),
  );

  it.effect.prop(
    "J22: A call's usage, model, times and items are those of the record when it was read, and an item written out in the record form reads back into the step's bytes exactly.",
    { tail: Arbitrary.schema(Tail) },
    ({ tail }) =>
      Effect.sync(() => {
        const plans = [...every, ...tail];
        const held = conversationOf(conversation, plans);
        const { calls, stopped } = readWhole(held);
        expect(stopped).toEqual(Option.none());
        const usageSteps = plans.flatMap((each, idx) =>
          carriesUsage(each.kind) ? [idx] : [],
        );
        expect(calls.map(({ step }) => step)).toEqual(usageSteps);
        for (const call of calls) {
          const each = plans[call.step] ?? plan("model");
          expect(call.usage).toEqual({
            input: each.input,
            cacheRead: each.cacheRead,
            cacheWriteShort: each.cacheWrite,
            cacheWriteLong: 0,
            output: each.reasoning + each.answer,
            reasoning: each.reasoning,
            reported: call.usage.reported,
          });
          const named = models[each.model];
          expect(call.model).toBe(
            each.kind === "model" ||
              plans.some(
                (other) => other.kind === "model" && other.model === each.model,
              )
              ? named.name
              : "",
          );
          expect(call.startedAt).toBe(madeAt(call.step));
          expect(call.finishedAt).toBe(finishedAt(call.step, each.took));
          const userBefore = plans
            .slice(0, call.step)
            .findLast((other) => other.kind === "user");
          expect(call.workspace).toEqual(
            Option.fromUndefinedOr(
              userBefore === undefined
                ? undefined
                : workspaces[userBefore.workspace],
            ),
          );
          for (const item of [...call.input, ...call.output]) {
            const step = held.steps[item.idx];
            expect(bytesOfFields(item.metadata)).toEqual(step?.metadata);
            expect(bytesOfFields(item.step_payload)).toEqual(step?.payload);
            expect(item.step_type).toBe(step?.stepType);
          }
        }
      }),
  );

  it.effect.prop(
    "J24: For any record with a table or column missing, a sub-agent, a step that is not a protocol buffer or a record rewritten, the calls reported are those before it, and `cota requests show` and doctor name the conversation and the reason.",
    {
      tail: Arbitrary.schema(Tail),
      at: Arbitrary.schema(
        Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 19 })),
      ),
    },
    ({ tail, at }) =>
      Effect.sync(() => {
        const plans = [...every, ...tail];
        const valid = conversationOf(conversation, plans);
        const where = at % plans.length;
        const before = readWhole(valid).calls.filter(
          ({ step }) => step < where,
        );
        const atStep = (
          change: (
            step: Conversation["steps"][number],
          ) => Conversation["steps"][number],
        ): Conversation => ({
          ...valid,
          steps: valid.steps.map((step) =>
            step.idx === where ? change(step) : step,
          ),
        });
        const defects: ReadonlyArray<
          readonly [Conversation, Reason, "whole" | "step", From?]
        > = [
          [{ ...valid, subAgent: true }, "sub-agent", "whole"],
          [{ ...valid, cascade: "another-conversation" }, "schema", "whole"],
          [
            valid,
            "rewritten",
            "whole",
            { step: plans.length + 3, last: Option.none(), passed: [] },
          ],
          [
            atStep((step) => ({ ...step, hasSubtrajectory: true })),
            "subtrajectory",
            "step",
          ],
          [
            atStep((step) => ({ ...step, payload: null })),
            "unreadable-step",
            "step",
          ],
          // A varint not in its shortest form: 1 written in two bytes.
          [
            atStep((step) => ({
              ...step,
              metadata: new Uint8Array([
                ...(step.metadata ?? []),
                0x18,
                0x81,
                0x00,
              ]),
            })),
            "unreadable-step",
            "step",
          ],
          // A field numbered 0, a group, and a length past the end.
          [
            atStep((step) => ({
              ...step,
              payload: new Uint8Array([0x00, 0x01]),
            })),
            "unreadable-step",
            "step",
          ],
          [
            atStep((step) => ({
              ...step,
              payload: new Uint8Array([0x0b, 0x0c]),
            })),
            "unreadable-step",
            "step",
          ],
          [
            atStep((step) => ({
              ...step,
              metadata: new Uint8Array([0x0a, 0x05, 0x01]),
            })),
            "unreadable-step",
            "step",
          ],
        ];
        for (const [held, reason, extent, from] of defects) {
          const reading = readWhole(held, from ?? fromStart);
          expect(reading.stopped).toEqual(
            Option.some({
              reason,
              step: extent === "whole" ? Option.none() : Option.some(where),
            }),
          );
          expect(reading.calls.map(({ call }) => call)).toEqual(
            extent === "whole" ? [] : before.map(({ call }) => call),
          );
        }
        // A status it does not know, on the first step from there that carries usage.
        const usageAt = plans.findIndex(
          (each, idx) => idx >= where && carriesUsage(each.kind),
        );
        const unknownAt = usageAt >= 0 ? usageAt : 1;
        const unknown = readWhole({
          ...valid,
          steps: valid.steps.map((step) =>
            step.idx === unknownAt ? { ...step, status: 7 } : step,
          ),
        });
        expect(unknown.stopped).toEqual(
          Option.some({
            reason: "unknown-status",
            step: Option.some(unknownAt),
          }),
        );
        expect(unknown.calls.map(({ call }) => call)).toEqual(
          readWhole(valid)
            .calls.filter(({ step }) => step < unknownAt)
            .map(({ call }) => call),
        );
      }),
  );
});
