import type { Schema } from "effect";
import {
  type Field,
  table,
} from "#modules/request-log/03-domain/antigravity-steps.ts";

/** A field of a constructed protocol buffer: a varint, a fixed 32 or 64 bits, text, raw bytes, or a message of its own. */
export type Built =
  | { readonly number: number; readonly varint: bigint }
  | { readonly number: number; readonly fixed64: bigint }
  | { readonly number: number; readonly fixed32: number }
  | { readonly number: number; readonly text: string }
  | { readonly number: number; readonly bytes: Uint8Array }
  | { readonly number: number; readonly message: ReadonlyArray<Built> };

const varintBytes = (value: bigint): ReadonlyArray<number> => {
  const bytes: Array<number> = [];
  let rest = value;
  while (rest >= 0x80n) {
    bytes.push(Number(rest & 0x7fn) | 0x80);
    rest >>= 7n;
  }
  bytes.push(Number(rest));
  return bytes;
};

const littleEndian = (value: bigint, size: number): ReadonlyArray<number> =>
  Array.from({ length: size }, (_, index) =>
    Number((value >> BigInt(8 * index)) & 0xffn),
  );

const encoder = new TextEncoder();

const payloadOf = (field: Built): Uint8Array =>
  "text" in field
    ? encoder.encode(field.text)
    : "bytes" in field
      ? field.bytes
      : "message" in field
        ? encode(field.message)
        : new Uint8Array();

/** The bytes of a constructed protocol buffer. */
export const encode = (fields: ReadonlyArray<Built>): Uint8Array => {
  const chunks: Array<Uint8Array> = [];
  for (const field of fields) {
    const key = (wire: number) =>
      varintBytes((BigInt(field.number) << 3n) | BigInt(wire));
    if ("varint" in field) {
      chunks.push(new Uint8Array([...key(0), ...varintBytes(field.varint)]));
    } else if ("fixed64" in field) {
      chunks.push(
        new Uint8Array([...key(1), ...littleEndian(field.fixed64, 8)]),
      );
    } else if ("fixed32" in field) {
      chunks.push(
        new Uint8Array([...key(5), ...littleEndian(BigInt(field.fixed32), 4)]),
      );
    } else {
      const payload = payloadOf(field);
      chunks.push(
        new Uint8Array([...key(2), ...varintBytes(BigInt(payload.length))]),
        payload,
      );
    }
  }
  return new Uint8Array(Buffer.concat(chunks));
};

const decoder = new TextDecoder("utf-8", { fatal: true });

const hexOf = (bytes: ReadonlyArray<number>) =>
  bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");

/** A length-delimited value as the record form writes it: its text when its bytes are UTF-8, else its base64. */
export const delimitedOf = (bytes: Uint8Array): string | { base64: string } => {
  try {
    return decoder.decode(bytes);
  } catch {
    return { base64: Buffer.from(bytes).toString("base64") };
  }
};

/** A constructed protocol buffer written out field by field, as the record form keeps one. */
export const fieldsOf = (fields: ReadonlyArray<Built>): Array<Field> =>
  fields.map((field): Field => {
    if ("varint" in field) return [field.number, 0, String(field.varint)];
    if ("fixed64" in field) {
      return [field.number, 1, hexOf(littleEndian(field.fixed64, 8))];
    }
    if ("fixed32" in field) {
      return [field.number, 5, hexOf(littleEndian(BigInt(field.fixed32), 4))];
    }
    return [field.number, 2, delimitedOf(payloadOf(field))];
  });

/** A step with the given columns and buffers, as a reported request's item. */
export const step = (
  idx: number,
  stepType: number | string,
  payload: ReadonlyArray<Built>,
  metadata: ReadonlyArray<Built> = [{ number: 3, varint: 2n }],
): Schema.JsonObject => ({
  idx,
  step_type: stepType,
  status: 3,
  metadata: fieldsOf(metadata),
  step_payload: fieldsOf([
    { number: 1, varint: BigInt(typeof stepType === "number" ? stepType : 0) },
    { number: 4, varint: 3n },
    ...payload,
  ]),
});

export const userMessage = (idx: number, text: string) =>
  step(idx, table.userMessage.stepType, [
    {
      number: table.userMessage.payload,
      message: [
        { number: table.userMessage.text, text },
        { number: 3, message: [{ number: 1, text }] },
        { number: 4, text: "" },
      ],
    },
  ]);

export interface Call {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
}

const callFields = (call: Call): ReadonlyArray<Built> => [
  { number: table.toolCall.id, text: call.id },
  { number: table.toolCall.name, text: call.name },
  { number: table.toolCall.arguments, text: call.arguments },
];

export const modelOutput = (
  idx: number,
  said: {
    readonly text?: string;
    readonly thoughts?: string;
    readonly calls?: ReadonlyArray<Call>;
  },
) =>
  step(
    idx,
    table.modelOutput.stepType,
    [
      {
        number: table.modelOutput.payload,
        message: [
          ...(said.text === undefined
            ? []
            : [{ number: table.modelOutput.text, text: said.text }]),
          ...(said.thoughts === undefined
            ? []
            : [{ number: table.modelOutput.thoughts, text: said.thoughts }]),
          { number: 6, text: "response-1" },
          ...(said.calls ?? []).map((call) => ({
            number: table.modelOutput.toolCall,
            message: [
              ...callFields(call),
              { number: 7, bytes: new Uint8Array([0xff, 0x00, 0x9c]) },
            ],
          })),
          { number: 12, varint: 2n },
        ],
      },
    ],
    [
      { number: 1, message: [{ number: 1, varint: 1_800_000_000n }] },
      {
        number: 9,
        message: [
          { number: 2, varint: 1_200n },
          { number: 3, varint: 80n },
        ],
      },
    ],
  );

export const toolResult = (idx: number, call: Call, result: string) =>
  step(
    idx,
    table.toolResult.stepType,
    [
      {
        number: table.toolResult.payload,
        message: [
          {
            number: 1,
            message: [
              { number: 1, text: "Path" },
              { number: 2, text: "notes.txt" },
            ],
          },
          {
            number: table.toolResult.result,
            message: [{ number: table.toolResult.text, text: result }],
          },
        ],
      },
    ],
    [{ number: table.toolResult.call, message: callFields(call) }],
  );

/** A task's notification, of the kind `kind`, that the command `call` started has ended. */
export const taskNotification = (
  idx: number,
  call: Call,
  text: string,
  kind: string = table.taskNotification.kindWord,
) =>
  step(idx, table.taskNotification.stepType, [
    {
      number: table.taskNotification.payload,
      message: [
        { number: table.taskNotification.text, text },
        { number: 2, message: [{ number: 1, text: "Counting finished" }] },
        { number: table.taskNotification.kind, text: kind },
        {
          number: table.taskNotification.task,
          message: [
            { number: 1, text: "task-1" },
            { number: 5, varint: 3n },
            {
              number: table.taskNotification.origin,
              message: [
                {
                  number: table.taskNotification.started,
                  message: [
                    { number: 2, varint: BigInt(idx) },
                    {
                      number: table.taskNotification.call,
                      message: callFields(call),
                    },
                  ],
                },
              ],
            },
            { number: 4, text: "Task finished." },
          ],
        },
      ],
    },
  ]);

export const compaction = (idx: number, summary: string) =>
  step(idx, table.compaction.stepType, [
    {
      number: table.compaction.payload,
      message: [
        { number: table.compaction.summary, text: summary },
        { number: 12, varint: BigInt(idx) },
      ],
    },
  ]);
