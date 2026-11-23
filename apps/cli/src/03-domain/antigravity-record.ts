import { Option } from "effect";

/** A field of a protocol buffer as read: its number, its wire type, and a varint's value or the bytes of the others. */
export type Raw =
  | { readonly number: number; readonly wire: 0; readonly value: bigint }
  | {
      readonly number: number;
      readonly wire: 1 | 2 | 5;
      readonly value: Uint8Array;
    };

/** A field written out in the record form `antigravity-steps` (`docs/specs/reported-requests/spec.md`). */
export type Field =
  | readonly [number, 0, string]
  | readonly [number, 1 | 5, string]
  | readonly [number, 2, string | { readonly base64: string }];

/** A step as a reported request's item holds it. */
export interface Step {
  readonly idx: number;
  readonly step_type: number | string;
  readonly status: number | string;
  readonly metadata: ReadonlyArray<Field>;
  readonly step_payload: ReadonlyArray<Field>;
}

const mostVarint = 2n ** 64n - 1n;
const mostFieldNumber = 2 ** 29 - 1;

/** A varint in its shortest form, the only form the record form writes back exactly. */
const varintAt = (
  bytes: Uint8Array,
  at: number,
): Option.Option<readonly [value: bigint, next: number]> => {
  let value = 0n;
  for (let index = at; index < bytes.length && index < at + 10; index++) {
    const byte = bytes[index] ?? 0;
    value |= BigInt(byte & 0x7f) << BigInt(7 * (index - at));
    if ((byte & 0x80) === 0) {
      if (index > at && byte === 0) return Option.none();
      return value > mostVarint
        ? Option.none()
        : Option.some([value, index + 1]);
    }
  }
  return Option.none();
};

/**
 * A buffer's fields, or nothing when it is not one the record form writes
 * back into the same bytes: a tag, varint or length not in its shortest
 * form, a field numbered 0, a group, or bytes cut short.
 */
export const fieldsOf = (bytes: Uint8Array): Option.Option<Array<Raw>> => {
  const fields: Array<Raw> = [];
  let at = 0;
  while (at < bytes.length) {
    const key = varintAt(bytes, at);
    if (Option.isNone(key)) return Option.none();
    const [tag, afterKey] = key.value;
    const number = Number(tag >> 3n);
    const wire = Number(tag & 7n);
    if (number < 1 || number > mostFieldNumber) return Option.none();
    if (wire === 0) {
      const value = varintAt(bytes, afterKey);
      if (Option.isNone(value)) return Option.none();
      fields.push({ number, wire, value: value.value[0] });
      at = value.value[1];
    } else if (wire === 1 || wire === 5) {
      const end = afterKey + (wire === 1 ? 8 : 4);
      if (end > bytes.length) return Option.none();
      fields.push({ number, wire, value: bytes.subarray(afterKey, end) });
      at = end;
    } else if (wire === 2) {
      const length = varintAt(bytes, afterKey);
      if (Option.isNone(length)) return Option.none();
      const [size, start] = length.value;
      const end = start + Number(size);
      if (size > BigInt(bytes.length) || end > bytes.length) {
        return Option.none();
      }
      fields.push({ number, wire, value: bytes.subarray(start, end) });
      at = end;
    } else {
      return Option.none();
    }
  }
  return Option.some(fields);
};

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

const textOf = (bytes: Uint8Array): Option.Option<string> => {
  try {
    return Option.some(decoder.decode(bytes));
  } catch {
    return Option.none();
  }
};

const hexOf = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

export const writtenOut = (fields: ReadonlyArray<Raw>): Array<Field> =>
  fields.map((field): Field => {
    if (field.wire === 0) return [field.number, 0, field.value.toString()];
    if (field.wire === 2) {
      return [
        field.number,
        2,
        Option.getOrElse(textOf(field.value), () => ({
          base64: Buffer.from(field.value).toString("base64"),
        })),
      ];
    }
    return [field.number, field.wire, hexOf(field.value)];
  });

const lastOf = (
  fields: ReadonlyArray<Raw>,
  number: number,
): Option.Option<Raw> =>
  Option.fromUndefinedOr(fields.findLast((field) => field.number === number));

const varint = (fields: ReadonlyArray<Raw>, number: number) =>
  Option.flatMap(lastOf(fields, number), (field) =>
    field.wire === 0 ? Option.some(field.value) : Option.none(),
  );

const bytesAt = (fields: ReadonlyArray<Raw>, number: number) =>
  Option.flatMap(lastOf(fields, number), (field) =>
    field.wire === 2 ? Option.some(field.value) : Option.none(),
  );

const messageAt = (fields: ReadonlyArray<Raw>, number: number) =>
  Option.flatMap(bytesAt(fields, number), fieldsOf);

const textAt = (fields: ReadonlyArray<Raw>, number: number) =>
  Option.flatMap(bytesAt(fields, number), textOf);

/**
 * The fields the reader reads (`docs/specs/request-reporter/spec.md`, A
 * model call, in the record), as one conversation and public parsers of the
 * same record showed them (ADR-0029, Facts to confirm when built).
 */
export const record = {
  /** The `step_type` of a user's message, whose `step_payload` 19.12.12 is the workspace it was sent in. */
  userMessage: 14,
  workspace: [19, 12, 12],
  /** In a step's `metadata`: when it was made, finished generating and completed, each `{ 1: seconds, 2: nanoseconds }`; its usage. */
  madeAt: 1,
  generatedAt: 7,
  completedAt: 8,
  usage: 9,
  /** In the usage: the model as a number, the token counts, and the provider's response id. */
  usageModel: 1,
  input: 2,
  output: 3,
  cacheWrite: 4,
  cacheRead: 5,
  reasoning: 9,
  responseId: 11,
  /** In a `gen_metadata` row's `data`: its field 1, whose 3 is the model as a number, 19 its name and 20 a map holding `last_step_index`. */
  generation: 1,
  generationModel: 3,
  generationName: 19,
  generationMap: 20,
  /** A step's `status`: done, and not finished (pending, running, generating). */
  done: 3,
  unfinished: [1, 2, 8],
} as const;

/** One row of a conversation's `steps`, its columns as SQLite gives them. */
export interface RecordStep {
  readonly idx: number;
  readonly stepType: number | string | null;
  readonly status: number | string | null;
  readonly hasSubtrajectory: boolean;
  readonly metadata: Uint8Array | null;
  readonly payload: Uint8Array | null;
}

/** What the reader reads of one conversation's database, from a cursor on. */
export interface ClientRecord {
  /** The database's name, without `.db`. */
  readonly conversation: string;
  readonly trajectory: string;
  readonly cascade: string;
  readonly subAgent: boolean;
  readonly greatestStep: Option.Option<number>;
  /** Every step after the cursor's, in order of `idx`. */
  readonly steps: ReadonlyArray<RecordStep>;
  /** The last user's message at or before the cursor's step, for its workspace. */
  readonly lastUserMessage: Option.Option<RecordStep>;
  /** Each `gen_metadata` row's `data`. */
  readonly generations: ReadonlyArray<Uint8Array | null>;
}

/** Why a conversation is not reported, or not past a step (`docs/specs/request-reporter/spec.md`, A record it cannot read). */
export const reasons = [
  "schema",
  "sub-agent",
  "subtrajectory",
  "unreadable-step",
  "unknown-status",
  "rewritten",
  "too-large",
] as const;
export type Reason = (typeof reasons)[number];

export interface Stop {
  readonly reason: Reason;
  readonly step: Option.Option<number>;
}

/** A model call named as a report's `after` names it. */
export interface After {
  readonly call: string;
  readonly startedAt: number;
}

export interface Usage {
  readonly input: number;
  readonly cacheRead: number;
  readonly cacheWriteShort: number;
  readonly cacheWriteLong: number;
  readonly output: number;
  readonly reasoning: number;
  readonly reported: { readonly fields: ReadonlyArray<Field> };
}

/** A model call read from the record; its project is still the workspace it was made in. */
export interface ModelCall {
  readonly call: string;
  readonly after: Option.Option<After>;
  readonly step: number;
  readonly session: string;
  readonly workspace: Option.Option<string>;
  readonly model: string;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly outcome: "ok" | "error";
  readonly errorType: string;
  readonly errorMessage: string;
  readonly providerRequestId: string;
  readonly usage: Usage;
  readonly input: ReadonlyArray<Step>;
  readonly output: ReadonlyArray<Step>;
}

/** What a reading of a conversation gave: its model calls in order, where it stopped and why, and whether it waits on a step not finished. */
export interface Reading {
  readonly calls: ReadonlyArray<ModelCall>;
  readonly stopped: Option.Option<Stop>;
  readonly waiting: boolean;
}

/** Where a conversation's reading starts: after the step of the last call stored, `-1` for none. */
export interface From {
  readonly step: number;
  readonly last: Option.Option<After>;
}

export const fromStart: From = { step: -1, last: Option.none() };

export const unfinishedError = "cota_reported_unfinished";
const unfinishedMessage =
  "the step was not finished when cota reported it, and is reported as it was";

const mostCount = 2 ** 32 - 1;
const mostReported = 64 * 1024;
const mostDuration = 2 ** 32 - 1;
const earliest = Date.UTC(2020, 0, 1);
const longestModel = 200;
const longestRequestId = 255;
const longestKey = 255;

const encoder = new TextEncoder();

const cut = (text: string, most: number) =>
  Array.from(text).slice(0, most).join("");

const timeOf = (
  metadata: ReadonlyArray<Raw>,
  number: number,
): Option.Option<number> =>
  Option.flatMap(messageAt(metadata, number), (time) => {
    const seconds = Option.getOrElse(varint(time, 1), () => 0n);
    const nanos = Option.getOrElse(varint(time, 2), () => 0n);
    if (seconds > 10n ** 12n || nanos >= 10n ** 9n) return Option.none();
    return Option.some(Number(seconds) * 1000 + Number(nanos / 1_000_000n));
  });

const countOf = (usage: ReadonlyArray<Raw>, number: number) =>
  Option.getOrElse(varint(usage, number), () => 0n);

interface Generation {
  readonly model: Option.Option<bigint>;
  readonly name: Option.Option<string>;
  readonly lastStep: Option.Option<number>;
}

const generationOf = (data: Uint8Array | null): Option.Option<Generation> =>
  Option.map(
    Option.flatMap(Option.fromNullOr(data), (bytes) =>
      Option.flatMap(fieldsOf(bytes), (top) =>
        messageAt(top, record.generation),
      ),
    ),
    (generation) => ({
      model: varint(generation, record.generationModel),
      name: textAt(generation, record.generationName),
      lastStep: Option.flatMap(
        Option.fromUndefinedOr(
          generation
            .filter((field) => field.number === record.generationMap)
            .flatMap((field) =>
              field.wire === 2 ? Option.toArray(fieldsOf(field.value)) : [],
            )
            .find((entry) =>
              Option.contains(textAt(entry, 1), "last_step_index"),
            ),
        ),
        (entry) =>
          Option.flatMap(textAt(entry, 2), (digits) =>
            /^(?:0|[1-9][0-9]{0,14})$/.test(digits)
              ? Option.some(Number(digits))
              : Option.none(),
          ),
      ),
    }),
  );

const workspaceOf = (payload: ReadonlyArray<Raw>): Option.Option<string> => {
  const [message, config, uri] = record.workspace;
  return Option.flatMap(
    Option.flatMap(messageAt(payload, message), (said) =>
      messageAt(said, config),
    ),
    (settings) => {
      const first = settings.find(
        (field) => field.number === uri && field.wire === 2,
      );
      if (first === undefined || first.wire !== 2) return Option.none();
      return Option.flatMap(textOf(first.value), (text) => {
        if (!text.startsWith("file://")) return Option.none();
        try {
          const path = decodeURIComponent(new URL(text).pathname);
          return path === "" ? Option.none() : Option.some(path);
        } catch {
          return Option.none();
        }
      });
    },
  );
};

interface Parsed {
  readonly step: Step;
  readonly metadata: ReadonlyArray<Raw>;
  readonly payload: ReadonlyArray<Raw>;
}

const parsedOf = (row: RecordStep): Option.Option<Parsed> => {
  const { stepType, status, metadata, payload } = row;
  if (
    stepType === null ||
    status === null ||
    metadata === null ||
    payload === null
  ) {
    return Option.none();
  }
  return Option.flatMap(fieldsOf(metadata), (readMetadata) =>
    Option.map(fieldsOf(payload), (readPayload) => ({
      step: {
        idx: row.idx,
        step_type: stepType,
        status,
        metadata: writtenOut(readMetadata),
        step_payload: writtenOut(readPayload),
      },
      metadata: readMetadata,
      payload: readPayload,
    })),
  );
};

/**
 * Reads a conversation's record from where its cursor stands into its model
 * calls (`docs/specs/request-reporter/spec.md`, The Antigravity reader).
 * Unsettled, it stops at the first step not finished and waits; settled, it
 * reads through it.
 */
export const readingOf = (
  read: ClientRecord,
  from: From,
  settled: boolean,
): Reading => {
  const calls: Array<ModelCall> = [];
  const stop = (reason: Reason, step: Option.Option<number>): Reading => ({
    calls,
    stopped: Option.some({ reason, step }),
    waiting: false,
  });
  if (
    read.cascade !== read.conversation ||
    read.conversation === "" ||
    [...read.conversation].length > longestKey ||
    read.trajectory === ""
  ) {
    return stop("schema", Option.none());
  }
  if (read.subAgent) return stop("sub-agent", Option.none());
  if (
    from.step >= 0 &&
    Option.getOrElse(read.greatestStep, () => -1) < from.step
  ) {
    return stop("rewritten", Option.none());
  }
  const generations = read.generations.flatMap((data) =>
    Option.toArray(generationOf(data)),
  );
  let workspace = Option.flatMap(read.lastUserMessage, (row) =>
    Option.flatMap(Option.fromNullOr(row.payload), (payload) =>
      Option.flatMap(fieldsOf(payload), workspaceOf),
    ),
  );
  let last = from.last;
  let lastUsageStep = from.step;
  let items: Array<Step> = [];

  for (const row of read.steps) {
    const at = Option.some(row.idx);
    if (row.hasSubtrajectory) return stop("subtrajectory", at);
    const parsed = parsedOf(row);
    if (Option.isNone(parsed)) return stop("unreadable-step", at);
    const { step, metadata, payload } = parsed.value;
    const unfinished =
      typeof row.status === "number" &&
      record.unfinished.some((status) => status === row.status);
    if (unfinished && !settled) {
      return { calls, stopped: Option.none(), waiting: true };
    }
    if (row.stepType === record.userMessage) {
      workspace = Option.orElse(workspaceOf(payload), () => workspace);
    }
    const usageField = lastOf(metadata, record.usage);
    if (Option.isNone(usageField)) {
      items.push(step);
      continue;
    }
    if (!unfinished && row.status !== record.done) {
      return stop("unknown-status", at);
    }
    const usage =
      usageField.value.wire === 2
        ? fieldsOf(usageField.value.value)
        : Option.none();
    const startedAt = timeOf(metadata, record.madeAt);
    if (Option.isNone(usage) || Option.isNone(startedAt)) {
      return stop("unreadable-step", at);
    }
    const finishedAt = Option.getOrElse(
      Option.orElse(timeOf(metadata, record.completedAt), () =>
        timeOf(metadata, record.generatedAt),
      ),
      () => startedAt.value,
    );
    const counts = {
      input: countOf(usage.value, record.input),
      cacheRead: countOf(usage.value, record.cacheRead),
      cacheWriteShort: countOf(usage.value, record.cacheWrite),
      output: countOf(usage.value, record.output),
      reasoning: countOf(usage.value, record.reasoning),
    };
    const reported = { fields: writtenOut(usage.value) };
    if (
      Object.values(counts).some((count) => count > BigInt(mostCount)) ||
      counts.reasoning > counts.output ||
      encoder.encode(JSON.stringify(reported)).length > mostReported ||
      startedAt.value < earliest ||
      finishedAt < startedAt.value ||
      finishedAt - startedAt.value > mostDuration
    ) {
      return stop("unreadable-step", at);
    }
    let generation: Option.Option<Generation> = Option.none();
    let generationStep = lastUsageStep - 1;
    for (const each of generations) {
      if (Option.isNone(each.lastStep)) continue;
      const lastStep = each.lastStep.value;
      if (
        lastStep < row.idx &&
        lastStep >= lastUsageStep &&
        lastStep > generationStep
      ) {
        generation = Option.some(each);
        generationStep = lastStep;
      }
    }
    const named = Option.orElse(
      Option.flatMap(generation, (each) => each.name),
      () =>
        Option.flatMap(varint(usage.value, record.usageModel), (model) =>
          Option.fromUndefinedOr(
            generations.find(
              (each) =>
                Option.contains(each.model, model) && Option.isSome(each.name),
            ),
          ).pipe(Option.flatMap((each) => each.name)),
        ),
    );
    const responseId = Option.filter(
      textAt(usage.value, record.responseId),
      (text) => [...text].length <= longestRequestId,
    );
    const call = `${read.trajectory}:${row.idx}`;
    if ([...call].length > longestKey) return stop("unreadable-step", at);
    calls.push({
      call,
      after: last,
      step: row.idx,
      session: read.conversation,
      workspace,
      model: cut(
        Option.getOrElse(named, () => ""),
        longestModel,
      ),
      startedAt: startedAt.value,
      finishedAt,
      outcome: unfinished ? "error" : "ok",
      errorType: unfinished ? unfinishedError : "",
      errorMessage: unfinished ? unfinishedMessage : "",
      providerRequestId: Option.getOrElse(responseId, () => ""),
      usage: {
        input: Number(counts.input),
        cacheRead: Number(counts.cacheRead),
        cacheWriteShort: Number(counts.cacheWriteShort),
        cacheWriteLong: 0,
        output: Number(counts.output),
        reasoning: Number(counts.reasoning),
        reported,
      },
      input: items,
      output: [step],
    });
    items = [];
    last = Option.some({ call, startedAt: startedAt.value });
    lastUsageStep = row.idx;
  }
  return { calls, stopped: Option.none(), waiting: false };
};
