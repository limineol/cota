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
  readingOf(recordOf(conversation, held, from.step), from, true);

const fromAfter = (from: From, calls: ReadonlyArray<ModelCall>): From => {
  const last = calls.at(-1);
  return last === undefined
    ? from
    : {
        step: last.step,
        last: Option.some({ call: last.call, startedAt: last.startedAt }),
      };
};

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
    "J19: For any record appended to step by step and read in runs cut anywhere (between steps, on an unfinished step, after a compaction), the model calls read run by run, each with its new items, are those of reading the whole record once, but for a step reported unfinished, which stays as it was reported.",
    {
      tail: Arbitrary.schema(Tail),
      cuts: Arbitrary.schema(
        Schema.Array(
          Schema.Struct({
            at: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 20 })),
            settled: Schema.Boolean,
          }),
        ).check(Schema.isMaxLength(8)),
      ),
      finishing: Arbitrary.schema(
        Schema.Array(
          Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4 })),
        ).check(Schema.isMaxLength(20)),
      ),
    },
    ({ tail, cuts, finishing }) =>
      Effect.sync(() => {
        const plans = [...every, ...tail];
        // Runs cut after the first user's message, before its call, and on
        // the tool's step while it and the call are not finished, then the
        // generated ones.
        const runs = [
          { at: 1, settled: false },
          { at: 3, settled: false },
          ...[...cuts].sort((one, other) => one.at - other.at),
        ];
        const finishesAt = plans.map((_, idx) =>
          idx === 1 || idx === 2 ? 2 : (finishing[idx] ?? 0),
        );
        let from = fromStart;
        const got: Array<ModelCall> = [];
        let seen = 0;
        [...runs, { at: plans.length, settled: true }].forEach((run, index) => {
          seen = Math.max(seen, Math.min(run.at, plans.length));
          const last = index === runs.length;
          const shown = plans.slice(0, seen);
          const held = conversationOf(
            conversation,
            shown,
            shown.map((each, idx) =>
              last || index >= (finishesAt[idx] ?? 0) ? 3 : unfinishedOf(each),
            ),
          );
          const reading = readingOf(
            recordOf(conversation, held, from.step),
            from,
            run.settled,
          );
          if (!run.settled) {
            expect(reading.calls.map(({ outcome }) => outcome)).not.toContain(
              "error",
            );
          }
          got.push(...reading.calls);
          from = fromAfter(from, reading.calls);
        });

        const whole = readWhole(conversationOf(conversation, plans)).calls;
        expect(got.map(({ call }) => call)).toEqual(
          whole.map(({ call }) => call),
        );
        got.forEach((call, index) => {
          const once = whole[index];
          if (once === undefined) return;
          const steps = (items: ReadonlyArray<Step>) =>
            items.map(({ idx }) => idx);
          expect(steps(call.input)).toEqual(steps(once.input));
          expect(steps(call.output)).toEqual(steps(once.output));
          expect(call.after).toEqual(once.after);
          expect(call.workspace).toEqual(once.workspace);
          expect(call.startedAt).toBe(once.startedAt);
          if (call.outcome === "error") return;
          expect(call.output).toEqual(once.output);
          call.input.forEach((item, at) => {
            if (statusOf(item) === 3) expect(item).toEqual(once.input[at]);
          });
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
            { step: plans.length + 3, last: Option.none() },
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
