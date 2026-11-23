import { Option, Result } from "effect";

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
  /** Every step after the one read after (`readAfter`), in order of `idx`. */
  readonly steps: ReadonlyArray<RecordStep>;
  /** The last user's message at or before the step read after, for its workspace. */
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
  /** Where the conversation's reading starts once the hub stores this call and those read before it. */
  readonly next: From;
}

/** What a reading of a conversation gave: its model calls in order, where it stopped and why, whether it waits on a step not finished, and where the next reading starts once the hub stores every call. */
export interface Reading {
  readonly calls: ReadonlyArray<ModelCall>;
  readonly stopped: Option.Option<Stop>;
  readonly waiting: boolean;
  readonly next: From;
}

/** A step a reading went past while it was not finished and carried no usage, with the step and key of the call before it: it may still finish as a model call. */
export interface Passed {
  readonly idx: number;
  readonly step: number;
  readonly last: Option.Option<After>;
}

/** Where a conversation's reading starts: after the step of the last call stored (`-1` for none), with the steps it went past. */
export interface From {
  readonly step: number;
  readonly last: Option.Option<After>;
  readonly passed: ReadonlyArray<Passed>;
}

export const fromStart: From = { step: -1, last: Option.none(), passed: [] };

/** The step after which a reading needs the record's steps: its cursor's, or an earlier one where a step it went past follows it. */
export const readAfter = (from: From): number =>
  Math.min(from.step, ...from.passed.map(({ step }) => step));

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

const isUnfinished = (row: RecordStep) =>
  typeof row.status === "number" &&
  record.unfinished.some((status) => status === row.status);

const workspaceOfRow = (row: RecordStep) =>
  Option.flatMap(Option.fromNullOr(row.payload), (payload) =>
    Option.flatMap(fieldsOf(payload), workspaceOf),
  );

/**
 * Reads a conversation's record from where its cursor stands into its model
 * calls (`docs/specs/request-reporter/spec.md`, The Antigravity reader).
 * It first looks again at each step it went past: one now done with usage is
 * a model call, read before the newer ones. Unsettled, it stops at the first
 * step not finished and waits; settled, it reads through it.
 */
export const readingOf = (
  read: ClientRecord,
  from: From,
  settled: boolean,
): Reading => {
  const calls: Array<ModelCall> = [];
  let next = from;
  const stop = (reason: Reason, step: Option.Option<number>): Reading => ({
    calls,
    stopped: Option.some({ reason, step }),
    waiting: false,
    next,
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
  const workspaceBefore = Option.flatMap(read.lastUserMessage, workspaceOfRow);
  /** The workspace of the last user's message at or before a step. */
  const workspaceAt = (idx: number) =>
    read.steps.reduce(
      (found, row) =>
        row.idx <= idx && row.stepType === record.userMessage
          ? Option.orElse(workspaceOfRow(row), () => found)
          : found,
      workspaceBefore,
    );
  const parsedAt = (row: RecordStep): Result.Result<Parsed, Reason> => {
    if (row.hasSubtrajectory) return Result.fail("subtrajectory");
    const parsed = parsedOf(row);
    return Option.isNone(parsed)
      ? Result.fail("unreadable-step")
      : Result.succeed(parsed.value);
  };

  /** The model call of a step that carries usage, or none when the step cannot be read as one. */
  const callOf = (
    row: RecordStep,
    { step, metadata }: Parsed,
    usageField: Raw,
    before: Omit<Passed, "idx">,
    input: ReadonlyArray<Step>,
    workspace: Option.Option<string>,
  ): Option.Option<Omit<ModelCall, "next">> => {
    const unfinished = isUnfinished(row);
    const usage =
      usageField.wire === 2 ? fieldsOf(usageField.value) : Option.none();
    const startedAt = timeOf(metadata, record.madeAt);
    if (Option.isNone(usage) || Option.isNone(startedAt)) return Option.none();
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
      return Option.none();
    }
    let generation: Option.Option<Generation> = Option.none();
    let generationStep = before.step - 1;
    for (const each of generations) {
      if (Option.isNone(each.lastStep)) continue;
      const lastStep = each.lastStep.value;
      if (
        lastStep < row.idx &&
        lastStep >= before.step &&
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
    if ([...call].length > longestKey) return Option.none();
    return Option.some({
      call,
      after: before.last,
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
      input,
      output: [step],
    });
  };

  // A step gone past is looked at again: still not finished, it is kept;
  // done with usage, it is a model call after the call before it, and the
  // call before the steps kept after it; otherwise it is forgotten.
  let passed = from.passed;
  for (const { idx } of from.passed) {
    const each = passed.find((other) => other.idx === idx);
    const row = read.steps.find((one) => one.idx === idx);
    if (each === undefined || (row !== undefined && isUnfinished(row))) {
      continue;
    }
    const drop = (late: Option.Option<After>) => {
      passed = passed.flatMap((other) =>
        other.idx === idx
          ? []
          : Option.isSome(late) && other.idx > idx && other.step < idx
            ? [{ idx: other.idx, step: idx, last: late }]
            : [other],
      );
      next = { ...next, passed };
    };
    if (row === undefined || row.status !== record.done) {
      drop(Option.none());
      continue;
    }
    const parsed: Array<Parsed> = [];
    for (const step of read.steps) {
      if (step.idx <= each.step || step.idx > idx) continue;
      const one = parsedAt(step);
      if (Result.isFailure(one)) {
        return stop(one.failure, Option.some(step.idx));
      }
      parsed.push(one.success);
    }
    const own = parsed.at(-1);
    const usageField = Option.flatMap(Option.fromUndefinedOr(own), (step) =>
      lastOf(step.metadata, record.usage),
    );
    if (own === undefined || Option.isNone(usageField)) {
      drop(Option.none());
      continue;
    }
    const call = callOf(
      row,
      own,
      usageField.value,
      each,
      parsed.slice(0, -1).map(({ step }) => step),
      workspaceAt(idx),
    );
    if (Option.isNone(call)) return stop("unreadable-step", Option.some(idx));
    drop(
      Option.some({ call: call.value.call, startedAt: call.value.startedAt }),
    );
    calls.push({ ...call.value, next });
  }

  let last = from.last;
  let lastUsageStep = from.step;
  let items: Array<Step> = [];
  let workspace = workspaceAt(from.step);
  let goneBy: Array<Passed> = [];
  for (const row of read.steps) {
    if (row.idx <= from.step) continue;
    const at = Option.some(row.idx);
    const parsed = parsedAt(row);
    if (Result.isFailure(parsed)) return stop(parsed.failure, at);
    const { step, metadata, payload } = parsed.success;
    const unfinished = isUnfinished(row);
    if (unfinished && !settled) {
      return { calls, stopped: Option.none(), waiting: true, next };
    }
    if (row.stepType === record.userMessage) {
      workspace = Option.orElse(workspaceOf(payload), () => workspace);
    }
    const usageField = lastOf(metadata, record.usage);
    if (Option.isNone(usageField)) {
      items.push(step);
      if (unfinished) goneBy.push({ idx: row.idx, step: lastUsageStep, last });
      continue;
    }
    if (!unfinished && row.status !== record.done) {
      return stop("unknown-status", at);
    }
    const call = callOf(
      row,
      parsed.success,
      usageField.value,
      { step: lastUsageStep, last },
      items,
      workspace,
    );
    if (Option.isNone(call)) return stop("unreadable-step", at);
    last = Option.some({
      call: call.value.call,
      startedAt: call.value.startedAt,
    });
    passed = [...passed, ...goneBy];
    next = { step: row.idx, last, passed };
    calls.push({ ...call.value, next });
    items = [];
    goneBy = [];
    lastUsageStep = row.idx;
  }
  return { calls, stopped: Option.none(), waiting: false, next };
};
