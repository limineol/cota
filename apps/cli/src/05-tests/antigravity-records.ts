import { Option, Schema } from "effect";
import type { RecordStep } from "#03-domain/antigravity-record.ts";
import type { Conversation } from "./fakes/in-memory-client-records.ts";

/** A field of a constructed protocol buffer: a varint, a fixed 64 or 32 bits, text, raw bytes, or a message of its own. */
export type Built =
  | { readonly number: number; readonly varint: bigint }
  | { readonly number: number; readonly fixed64: bigint }
  | { readonly number: number; readonly fixed32: number }
  | { readonly number: number; readonly text: string }
  | { readonly number: number; readonly bytes: Uint8Array }
  | { readonly number: number; readonly message: ReadonlyArray<Built> };

const varintBytes = (value: bigint): Array<number> => {
  const bytes: Array<number> = [];
  let rest = value;
  while (rest >= 0x80n) {
    bytes.push(Number(rest & 0x7fn) | 0x80);
    rest >>= 7n;
  }
  bytes.push(Number(rest));
  return bytes;
};

const littleEndian = (value: bigint, size: number): Array<number> =>
  Array.from({ length: size }, (_, index) =>
    Number((value >> BigInt(8 * index)) & 0xffn),
  );

const encoder = new TextEncoder();

/** The bytes of a constructed protocol buffer, every varint in its shortest form. */
export const encode = (fields: ReadonlyArray<Built>): Uint8Array => {
  const bytes: Array<number> = [];
  for (const field of fields) {
    const key = (wire: number) =>
      varintBytes((BigInt(field.number) << 3n) | BigInt(wire));
    if ("varint" in field) {
      bytes.push(...key(0), ...varintBytes(field.varint));
    } else if ("fixed64" in field) {
      bytes.push(...key(1), ...littleEndian(field.fixed64, 8));
    } else if ("fixed32" in field) {
      bytes.push(...key(5), ...littleEndian(BigInt(field.fixed32), 4));
    } else {
      const payload =
        "text" in field
          ? encoder.encode(field.text)
          : "bytes" in field
            ? field.bytes
            : encode(field.message);
      bytes.push(...key(2), ...varintBytes(BigInt(payload.length)));
      for (const byte of payload) bytes.push(byte);
    }
  }
  return new Uint8Array(bytes);
};

/** The two models a generated conversation uses, by the number the record gives each and its name. */
export const models = [
  { number: 1534n, name: "gemini-4-neon" },
  { number: 1535n, name: "gemini-4-flash" },
] as const;

/** Texts as a conversation holds them: plain, with characters of two to four bytes, a byte order mark, and empty. */
const Text = Schema.Literals([
  "Read notes.txt",
  "Café — naïve 🚀",
  "﻿starts with a byte order mark",
  "",
]);

/** One step of a generated conversation: what it is, and what it holds. */
export const Plan = Schema.Struct({
  kind: Schema.Literals(["user", "model", "tool", "compaction", "other"]),
  text: Text,
  model: Schema.Literals([0, 1]),
  workspace: Schema.Literals([0, 1]),
  input: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 200_000 })),
  cacheRead: Schema.Int.check(
    Schema.isBetween({ minimum: 0, maximum: 200_000 }),
  ),
  cacheWrite: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 9 })),
  reasoning: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 5_000 })),
  answer: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 5_000 })),
  /** Milliseconds the step took, 0 for one with no completed time. */
  took: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 90_000 })),
});
export type Plan = typeof Plan.Type;

/** A plan with every field given, for the fixed parts of a generated conversation. */
export const plan = (kind: Plan["kind"], over: Partial<Plan> = {}): Plan => ({
  kind,
  text: "Read notes.txt",
  model: 0,
  workspace: 0,
  input: 1200,
  cacheRead: 300,
  cacheWrite: 0,
  reasoning: 40,
  answer: 80,
  took: 1500,
  ...over,
});

export const stepTypes = {
  user: 14,
  model: 15,
  tool: 132,
  compaction: 23,
  other: 17,
} as const;

/** When the conversation began, in seconds: 2026-11-10, before the clock of the harness's hub. */
const began = 1_794_268_800n;

const timeOf = (millis: bigint): ReadonlyArray<Built> => [
  { number: 1, varint: millis / 1000n },
  { number: 2, varint: (millis % 1000n) * 1_000_000n },
];

/** When a step was made, in milliseconds since the epoch. */
export const madeAt = (idx: number): number =>
  Number(began) * 1000 + idx * 61_000 + 250;

/** When a step that took `took` milliseconds finished, as the reader reads it. */
export const finishedAt = (idx: number, took: number): number =>
  madeAt(idx) + took;

export const workspaces = ["/work/acme-api", "/work/café notes"] as const;

export const carriesUsage = (kind: Plan["kind"]) =>
  kind === "model" || kind === "compaction";

/** The `metadata` of a step: when it was made and finished, its usage when it carries one and has it, and its conversation's ids. */
const metadataOf = (
  plan: Plan,
  idx: number,
  trajectory: string,
  conversation: string,
  usage: boolean,
): ReadonlyArray<Built> => [
  { number: 1, message: timeOf(BigInt(madeAt(idx))) },
  ...(plan.took === 0
    ? []
    : [
        { number: 7, message: timeOf(BigInt(madeAt(idx) + plan.took - 1)) },
        { number: 8, message: timeOf(BigInt(madeAt(idx) + plan.took)) },
      ]),
  ...(carriesUsage(plan.kind) && usage
    ? [
        {
          number: 9,
          message: [
            { number: 1, varint: models[plan.model].number },
            { number: 2, varint: BigInt(plan.input) },
            { number: 3, varint: BigInt(plan.reasoning + plan.answer) },
            { number: 4, varint: BigInt(plan.cacheWrite) },
            { number: 5, varint: BigInt(plan.cacheRead) },
            { number: 9, varint: BigInt(plan.reasoning) },
            { number: 10, varint: BigInt(plan.answer) },
            { number: 11, text: `response-${idx}` },
          ],
        },
      ]
    : []),
  {
    number: 20,
    message: [
      { number: 1, text: trajectory },
      { number: 2, varint: BigInt(idx) },
      { number: 4, text: conversation },
    ],
  },
];

/** The `step_payload` of a step: what the hub's table of fields reads for its kind, and fields of every wire type besides. A tool's result is filled in, in place, when it is done, as a command that runs on past its tool call's wait has its. */
const payloadOf = (plan: Plan, idx: number, status: number): Array<Built> => {
  const head: Array<Built> = [
    { number: 1, varint: BigInt(stepTypes[plan.kind]) },
    { number: 4, varint: BigInt(status) },
  ];
  switch (plan.kind) {
    case "user":
      return [
        ...head,
        {
          number: 19,
          message: [
            { number: 2, text: plan.text },
            {
              number: 12,
              message: [
                {
                  number: 12,
                  text: `file://${encodeURI(workspaces[plan.workspace])}`,
                },
              ],
            },
          ],
        },
      ];
    case "model":
      return [
        ...head,
        {
          number: 20,
          message: [
            { number: 1, text: plan.text },
            { number: 3, text: "thinking it over" },
            {
              number: 7,
              message: [
                { number: 1, text: `call-${idx}` },
                { number: 2, text: "read_file" },
                { number: 3, text: '{"path":"notes.txt"}' },
                { number: 7, bytes: new Uint8Array([0xff, 0x00, 0x9c]) },
              ],
            },
            { number: 14, bytes: new Uint8Array([0x80, 0x81, 0xfe]) },
          ],
        },
      ];
    case "tool":
      return [
        ...head,
        {
          number: 140,
          message: [
            {
              number: 2,
              message:
                status === 3
                  ? [{ number: 1, text: plan.text }]
                  : [{ number: 5, text: "Running" }],
            },
          ],
        },
      ];
    case "compaction":
      return [
        ...head,
        { number: 30, message: [{ number: 5, text: plan.text }] },
      ];
    case "other":
      return [
        ...head,
        { number: 2, fixed64: 0xfedcba9876543210n },
        { number: 3, fixed32: 0xdeadbeef },
        { number: 5, varint: 2n ** 64n - 1n },
        { number: 6, bytes: new Uint8Array([0xc3, 0x28, 0x00]) },
        { number: 8, text: plan.text },
        { number: 536_870_911, message: [{ number: 1, varint: 0n }] },
      ];
  }
};

/** A step of a generated conversation, with the status given (3 when done), and without its usage when `usage` is false. */
export const stepOf = (
  plan: Plan,
  idx: number,
  status: number,
  trajectory: string,
  conversation: string,
  usage = true,
): RecordStep => ({
  idx,
  stepType: stepTypes[plan.kind],
  status,
  hasSubtrajectory: false,
  metadata: encode(metadataOf(plan, idx, trajectory, conversation, usage)),
  payload: encode(payloadOf(plan, idx, status)),
});

/** The `gen_metadata` rows of a conversation: one per model step but a compaction's, naming its model and the last step before it. */
export const generationsOf = (
  plans: ReadonlyArray<Plan>,
  trajectory: string,
  conversation: string,
): ReadonlyArray<Uint8Array> =>
  plans.flatMap((plan, idx) =>
    plan.kind === "model"
      ? [
          encode([
            {
              number: 1,
              message: [
                { number: 3, varint: models[plan.model].number },
                ...[
                  ["request_id", `${trajectory}-${idx}`],
                  ["last_step_index", String(idx - 1)],
                  ["cascade_id", conversation],
                ].map(
                  ([key, value]): Built => ({
                    number: 20,
                    message: [
                      { number: 1, text: key ?? "" },
                      { number: 2, text: value ?? "" },
                    ],
                  }),
                ),
                { number: 19, text: models[plan.model].name },
              ],
            },
          ]),
        ]
      : [],
  );

/**
 * A conversation as the in-memory client records keep it, its steps with the
 * statuses given (3 where none is); a step `bare` marks has no usage yet
 * while it is not done.
 */
export const conversationOf = (
  conversation: string,
  plans: ReadonlyArray<Plan>,
  statuses: ReadonlyArray<number> = [],
  changedAt = 1,
  bare: ReadonlyArray<boolean> = [],
): Conversation => {
  const trajectory = `trajectory-of-${conversation}`;
  return {
    trajectory,
    cascade: conversation,
    subAgent: false,
    steps: plans.map((plan, idx) => {
      const status = statuses[idx] ?? 3;
      return stepOf(
        plan,
        idx,
        status,
        trajectory,
        conversation,
        status === 3 || bare[idx] !== true,
      );
    }),
    generations: generationsOf(plans, trajectory, conversation),
    stamps: {
      db: { size: 4096 * (plans.length + 1), changedAt },
      wal: Option.none(),
    },
  };
};
