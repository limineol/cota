import { Option, Schema } from "effect";

const FieldNumber = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: 2 ** 29 - 1 }),
);

const mostVarint = 2n ** 64n - 1n;

const Digits = Schema.String.check(
  Schema.isPattern(/^(?:0|[1-9][0-9]{0,19})$/),
  Schema.makeFilter((digits: string) => BigInt(digits) <= mostVarint, {
    expected: "a whole number from 0 to 2^64 - 1",
  }),
);

const base64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const Base64 = Schema.Struct({
  base64: Schema.String.check(Schema.isPattern(base64)),
});

/**
 * One field of a protocol buffer, written out without a schema: its number,
 * its wire type, and its value (a varint's decimal digits, a fixed 64 or 32
 * bits' bytes in hex, a length-delimited value's bytes as text when they are
 * UTF-8, else as base64).
 */
export const Field = Schema.Union([
  Schema.Tuple([FieldNumber, Schema.Literal(0), Digits]),
  Schema.Tuple([
    FieldNumber,
    Schema.Literal(1),
    Schema.String.check(Schema.isPattern(/^[0-9a-f]{16}$/)),
  ]),
  Schema.Tuple([
    FieldNumber,
    Schema.Literal(5),
    Schema.String.check(Schema.isPattern(/^[0-9a-f]{8}$/)),
  ]),
  Schema.Tuple([
    FieldNumber,
    Schema.Literal(2),
    Schema.Union([Schema.String, Base64]),
  ]),
]);
export type Field = typeof Field.Type;

const Column = Schema.Union([Schema.Finite, Schema.String]);

/** One step of an Antigravity conversation's record, as a reported request's item holds it (`docs/specs/reported-requests/spec.md`, The record form). */
export const Step = Schema.Struct({
  idx: Schema.Int.check(
    Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  ),
  step_type: Column,
  status: Column,
  metadata: Schema.Array(Field),
  step_payload: Schema.Array(Field),
});
export type Step = typeof Step.Type;

/** A step, or nothing for a value that is not one: a key it does not have is refused, never dropped. */
export const stepOf = (item: unknown): Option.Option<Step> =>
  Schema.decodeUnknownOption(Step)(item, { onExcessProperty: "error" });

/** A field as the table reads it: its number, and the bytes of a length-delimited value. */
interface Read {
  readonly number: number;
  readonly bytes: Option.Option<Uint8Array>;
}

const encoder = new TextEncoder();

const readOf = ([number, wire, value]: Field): Read => {
  if (wire !== 2) return { number, bytes: Option.none() };
  return {
    number,
    bytes: Option.some(
      typeof value === "string"
        ? encoder.encode(value)
        : new Uint8Array(Buffer.from(value.base64, "base64")),
    ),
  };
};

const varintAt = (
  bytes: Uint8Array,
  at: number,
): Option.Option<readonly [value: number, next: number]> => {
  let value = 0;
  let scale = 1;
  for (let index = at; index < bytes.length && index < at + 10; index++) {
    const byte = bytes[index] ?? 0;
    value += (byte & 0x7f) * scale;
    scale *= 128;
    if ((byte & 0x80) === 0) return Option.some([value, index + 1]);
  }
  return Option.none();
};

/**
 * The fields of a length-delimited value read as a protocol buffer by the
 * record form's rules: nothing when it is not one, has a field numbered 0 or
 * uses the deprecated groups.
 */
const fieldsOf = (bytes: Uint8Array): Option.Option<ReadonlyArray<Read>> => {
  const fields: Array<Read> = [];
  let at = 0;
  while (at < bytes.length) {
    const key = varintAt(bytes, at);
    if (Option.isNone(key)) return Option.none();
    const [tag, next] = key.value;
    const number = Math.floor(tag / 8);
    const wire = tag % 8;
    if (number === 0 || number > 2 ** 29 - 1) return Option.none();
    if (wire === 0) {
      const value = varintAt(bytes, next);
      if (Option.isNone(value)) return Option.none();
      fields.push({ number, bytes: Option.none() });
      at = value.value[1];
    } else if (wire === 1 || wire === 5) {
      at = next + (wire === 1 ? 8 : 4);
      if (at > bytes.length) return Option.none();
      fields.push({ number, bytes: Option.none() });
    } else if (wire === 2) {
      const length = varintAt(bytes, next);
      if (Option.isNone(length)) return Option.none();
      const [size, start] = length.value;
      if (start + size > bytes.length) return Option.none();
      fields.push({
        number,
        bytes: Option.some(bytes.subarray(start, start + size)),
      });
      at = start + size;
    } else {
      return Option.none();
    }
  }
  return Option.some(fields);
};

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

const textOfBytes = (bytes: Uint8Array): Option.Option<string> => {
  try {
    return Option.some(decoder.decode(bytes));
  } catch {
    return Option.none();
  }
};

const all = (
  fields: ReadonlyArray<Read>,
  number: number,
): ReadonlyArray<Uint8Array> =>
  fields.flatMap((field) =>
    field.number === number ? Option.toArray(field.bytes) : [],
  );

/** A singular field, read as protocol buffers read one: its last occurrence. */
const last = (
  fields: ReadonlyArray<Read>,
  number: number,
): Option.Option<Uint8Array> =>
  Option.fromUndefinedOr(all(fields, number).at(-1));

const messageAt = (
  fields: ReadonlyArray<Read>,
  number: number,
): Option.Option<ReadonlyArray<Read>> =>
  Option.flatMap(last(fields, number), fieldsOf);

const messageThrough = (
  fields: ReadonlyArray<Read>,
  ...path: ReadonlyArray<number>
): Option.Option<ReadonlyArray<Read>> =>
  path.reduce<Option.Option<ReadonlyArray<Read>>>(
    (at, number) => Option.flatMap(at, (each) => messageAt(each, number)),
    Option.some(fields),
  );

const textAt = (
  fields: ReadonlyArray<Read>,
  number: number,
): Option.Option<string> => Option.flatMap(last(fields, number), textOfBytes);

/**
 * Which fields of a step hold what a person reads, by its `step_type`: read
 * by trial on the conversations `docs/specs/reported-requests/spec.md` names
 * (The table of fields), no more. A step of another type, or one whose field
 * the table names is missing or unreadable, is not read.
 */
export const table = {
  /** A user's message: `step_payload` field 19, a message whose field 2 is its text. */
  userMessage: { stepType: 14, payload: 19, text: 2 },
  /** The model's output: `step_payload` field 20, a message whose field 1 is its text, field 3 its thoughts, and each field 7 a tool call. */
  modelOutput: { stepType: 15, payload: 20, text: 1, thoughts: 3, toolCall: 7 },
  /** A tool call, in the model's output and in a tool's step: field 1 its id, 2 its name, 3 its arguments as JSON text. */
  toolCall: { id: 1, name: 2, arguments: 3 },
  /** A tool's run: `metadata` field 4 the call, `step_payload` field 140 a message whose field 2 is a message whose field 1 is the result's text. */
  toolResult: { stepType: 132, call: 4, payload: 140, result: 2, text: 1 },
  /**
   * A task's notification, the end of a command that outlived its tool call:
   * `step_payload` field 114, a message whose field 1 is its text, field 3
   * its kind (`task_notification`), and field 4 the task, a message whose
   * field 12 is a message whose field 1 is a message whose field 3 is the
   * tool call that started it.
   */
  taskNotification: {
    stepType: 101,
    payload: 114,
    text: 1,
    kind: 3,
    kindWord: "task_notification",
    task: 4,
    origin: 12,
    started: 1,
    call: 3,
  },
  /** A compaction: `step_payload` field 30, a message whose field 5 is the summary. */
  compaction: { stepType: 23, payload: 30, summary: 5 },
} as const;

export interface ToolCall {
  readonly id: Option.Option<string>;
  readonly name: string;
  readonly arguments: string;
}

/** What the table reads in a step. */
export type Said =
  | { readonly kind: "user"; readonly text: string }
  | {
      readonly kind: "model";
      readonly text: Option.Option<string>;
      readonly thoughts: Option.Option<string>;
      readonly calls: ReadonlyArray<ToolCall>;
    }
  | {
      readonly kind: "result";
      readonly call: Option.Option<ToolCall>;
      readonly text: string;
    }
  | { readonly kind: "compaction"; readonly summary: string };

const callOf = (fields: ReadonlyArray<Read>): ToolCall => ({
  id: textAt(fields, table.toolCall.id),
  name: Option.getOrElse(textAt(fields, table.toolCall.name), () => ""),
  arguments: Option.getOrElse(
    textAt(fields, table.toolCall.arguments),
    () => "",
  ),
});

/** What a step says, by the table; nothing for a step the table does not know. */
export const saidOf = (step: Step): Option.Option<Said> => {
  const payload = step.step_payload.map(readOf);
  switch (step.step_type) {
    case table.userMessage.stepType:
      return Option.map(
        Option.flatMap(messageAt(payload, table.userMessage.payload), (said) =>
          textAt(said, table.userMessage.text),
        ),
        (text) => ({ kind: "user", text }),
      );
    case table.modelOutput.stepType:
      return Option.map(
        messageAt(payload, table.modelOutput.payload),
        (said) => ({
          kind: "model",
          text: textAt(said, table.modelOutput.text),
          thoughts: textAt(said, table.modelOutput.thoughts),
          calls: all(said, table.modelOutput.toolCall).flatMap((bytes) =>
            Option.toArray(Option.map(fieldsOf(bytes), callOf)),
          ),
        }),
      );
    case table.toolResult.stepType:
      return Option.map(
        Option.flatMap(
          Option.flatMap(messageAt(payload, table.toolResult.payload), (said) =>
            messageAt(said, table.toolResult.result),
          ),
          (result) => textAt(result, table.toolResult.text),
        ),
        (text) => ({
          kind: "result",
          call: Option.map(
            messageAt(step.metadata.map(readOf), table.toolResult.call),
            callOf,
          ),
          text,
        }),
      );
    case table.taskNotification.stepType: {
      const notification = table.taskNotification;
      return Option.flatMap(
        Option.filter(messageAt(payload, notification.payload), (said) =>
          Option.contains(
            textAt(said, notification.kind),
            notification.kindWord,
          ),
        ),
        (said) =>
          Option.map(textAt(said, notification.text), (text) => ({
            kind: "result",
            call: Option.map(
              messageThrough(
                said,
                notification.task,
                notification.origin,
                notification.started,
                notification.call,
              ),
              callOf,
            ),
            text,
          })),
      );
    }
    case table.compaction.stepType:
      return Option.map(
        Option.flatMap(messageAt(payload, table.compaction.payload), (said) =>
          textAt(said, table.compaction.summary),
        ),
        (summary) => ({ kind: "compaction", summary }),
      );
    default:
      return Option.none();
  }
};

const textsOf = (said: Said): ReadonlyArray<string> => {
  switch (said.kind) {
    case "user":
      return [said.text];
    case "model":
      return [
        ...Option.toArray(said.text),
        ...said.calls.map((call) => call.arguments),
      ];
    case "result":
      return [said.text];
    case "compaction":
      return [said.summary];
  }
};

/**
 * What a person would read in a step, for search: its user's message, the
 * model's output and its tool calls' arguments, a tool's result, or a
 * compaction's summary, joined by line breaks; nothing for a step the table
 * does not know.
 */
export const textOf = (item: unknown): string =>
  Option.match(Option.flatMap(stepOf(item), saidOf), {
    onNone: () => "",
    onSome: (said) =>
      textsOf(said)
        .filter((text) => text !== "")
        .join("\n"),
  });

/** Whether the table reads a step as a compaction: the model call that step is the output of summarised the conversation. */
export const isCompaction = (step: Step): boolean =>
  Option.exists(saidOf(step), (said) => said.kind === "compaction");

/** The text of a user's message step; nothing for any other step. */
export const userTextOf = (item: unknown): Option.Option<string> =>
  Option.flatMap(Option.flatMap(stepOf(item), saidOf), (said) =>
    said.kind === "user" ? Option.some(said.text) : Option.none(),
  );
