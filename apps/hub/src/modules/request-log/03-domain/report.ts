import { DateTime, Duration, Effect, Option, Schema } from "effect";
import type { ReportedClient } from "#shared/03-domain/client.ts";
import * as Conversation from "#shared/03-domain/conversation.ts";
import type { HubKeyName, PoolId } from "#shared/03-domain/ids.ts";
import type { RecordForm } from "#shared/03-domain/record-form.ts";
import type * as Request from "#shared/03-domain/request.entity.ts";
import { cut } from "#shared/03-domain/text.ts";
import type * as Usage from "#shared/03-domain/usage.ts";
import * as AntigravitySteps from "./antigravity-steps.ts";
import { stampedIdOf } from "./stamped-id.ts";
import type * as StoredItems from "./stored-items.ts";
import * as Title from "./title.ts";

/** Who reported a request: the owner, or a hub key by its name. */
export type Reporter =
  | { readonly _tag: "Owner" }
  | { readonly _tag: "HubKey"; readonly name: HubKeyName };

/** `key:<the hub key's name>`, or `owner`, as a reported request's id is made from it. */
export const reporterText = (reporter: Reporter): string =>
  reporter._tag === "Owner" ? "owner" : `key:${reporter.name}`;

/** The name of the hub key that reported, or `owner`, as reported through keeps it. */
export const reportedByText = (reporter: Reporter): string =>
  reporter._tag === "Owner" ? "owner" : reporter.name;

/**
 * A reported request's id (L8): a UUID version 7 stamped with the call's
 * start, whose other bits are the SHA-256 of `cota-report:` and the JSON of
 * `[<reporter>, <client>, <call key>]`. A hub key's name and a call key may
 * hold any character, so the parts are written as JSON strings, which no two
 * different parts share.
 */
export const idOf = (
  reporter: Reporter,
  client: ReportedClient,
  callKey: string,
  startedAt: DateTime.Utc,
): Request.RequestId =>
  stampedIdOf(
    `cota-report:${JSON.stringify([reporterText(reporter), client, callKey])}`,
    startedAt,
  );

/** The record form a reported client's items are kept in. */
export const formOf: Readonly<Record<ReportedClient, RecordForm>> = {
  antigravity: "antigravity-steps",
};

/** The call before a call, by its call key and its start. */
export interface After {
  readonly call: string;
  readonly startedAt: DateTime.Utc;
}

/** One model call of a report, as the API decoded it (`docs/specs/reported-requests/spec.md`, A report). */
export interface Call {
  readonly call: string;
  readonly after: Option.Option<After>;
  readonly session: string;
  readonly project: string;
  readonly clientVersion: string;
  readonly model: string;
  readonly startedAt: DateTime.Utc;
  readonly finishedAt: DateTime.Utc;
  readonly outcome: "ok" | "error" | "cancelled";
  readonly errorType: string;
  readonly errorMessage: string;
  readonly stopReason: string;
  readonly providerRequestId: string;
  readonly usage: Option.Option<Usage.Reported>;
  readonly input: ReadonlyArray<Schema.JsonObject>;
  readonly output: ReadonlyArray<Schema.JsonObject>;
}

export interface Report {
  readonly client: ReportedClient;
  readonly pool: PoolId;
  readonly through: Option.Option<DateTime.Utc>;
  readonly calls: ReadonlyArray<Call>;
}

/** A report's caller, as the hub decided it, and the `x-cota-machine` it gave, as given. */
export interface Caller {
  readonly reporter: Reporter;
  readonly machine: string;
}

/** The report breaks one of the checks, and nothing of it is stored. */
export class ReportRefused extends Schema.TaggedError<
  ReportRefused,
  { readonly brand: unique symbol }
>()("ReportRefused", { detail: Schema.String }) {
  override get message(): string {
    return this.detail;
  }
}

/** A call's call before is neither earlier in the report nor held in the log in its session. */
export class ReportOutOfOrder extends Schema.TaggedError<
  ReportOutOfOrder,
  { readonly brand: unique symbol }
>()("ReportOutOfOrder", { detail: Schema.String }) {
  override get message(): string {
    return this.detail;
  }
}

/** The hub has no pool by the report's id. */
export class NoSuchPool extends Schema.TaggedError<
  NoSuchPool,
  { readonly brand: unique symbol }
>()("NoSuchPool", { pool: Schema.String }) {}

/** The report's pool is a pool of another kind than observed. */
export class PoolNotObserved extends Schema.TaggedError<
  PoolNotObserved,
  { readonly brand: unique symbol }
>()("PoolNotObserved", { pool: Schema.String }) {}

/** The longest a reported call may last, and its error type and message as kept. */
export const limits = {
  longestDurationMs: 4_294_967_295,
  longestErrorType: 200,
  longestErrorMessage: 64 * 1024,
  /** How far after the hub's clock a start or a `through` may be. */
  ahead: Duration.minutes(5),
  /** The earliest a start or a `through` may be. */
  earliest: DateTime.makeUnsafe("2020-01-01T00:00:00Z"),
} as const;

/** A call that passed its own checks: its steps, with their indices, and its text well-formed. */
export interface Checked {
  readonly place: number;
  readonly call: Call;
  readonly id: Request.RequestId;
  readonly input: ReadonlyArray<AntigravitySteps.Step>;
  readonly output: AntigravitySteps.Step;
}

export interface CheckedReport {
  readonly report: Report;
  /** The machine as it is kept: well-formed, trimmed and cut to 200 characters. */
  readonly machine: string;
  readonly calls: ReadonlyArray<Checked>;
}

/** A call as a problem names it: by its place in the report and its call key. */
export const nameOf = (place: number, key: string) =>
  `call ${place} (${JSON.stringify(key)})`;

const refused = (detail: string) => new ReportRefused({ detail });

const millis = DateTime.toEpochMillis;

/**
 * The checks of a whole report that need nothing but it and the hub's clock
 * (`docs/specs/reported-requests/spec.md`, Checks), the pool's apart: the
 * machine, each call's key, times, usage and steps, and each call's place
 * after its call before where the report holds it. It fails naming the first
 * call that breaks one.
 */
export const check = Effect.fn("Report.check")(function* (
  report: Report,
  caller: Caller,
) {
  const machine = Title.keptOf(caller.machine);
  if (machine === "") {
    return yield* refused(
      "The report names no machine: send its name in x-cota-machine.",
    );
  }
  const now = yield* DateTime.now;
  const latest = millis(now) + Duration.toMillis(limits.ahead);
  const inRange = (at: DateTime.Utc) =>
    millis(at) >= millis(limits.earliest) && millis(at) <= latest;
  if (Option.isSome(report.through) && !inRange(report.through.value)) {
    return yield* refused(
      "Its through is more than 5 minutes after the hub's clock, or before 2020.",
    );
  }
  const keys = new Map<string, Checked>();
  const checked: Array<Checked> = [];
  for (const [place, call] of report.calls.entries()) {
    const name = nameOf(place, call.call);
    if (keys.has(call.call)) {
      return yield* refused(`${name} has the call key of an earlier call.`);
    }
    const duration = millis(call.finishedAt) - millis(call.startedAt);
    if (duration < 0) {
      return yield* refused(`${name} finished before it started.`);
    }
    if (duration > limits.longestDurationMs) {
      return yield* refused(
        `${name} lasted more than ${limits.longestDurationMs} milliseconds.`,
      );
    }
    if (!inRange(call.startedAt)) {
      return yield* refused(
        `${name} started more than 5 minutes after the hub's clock, or before 2020.`,
      );
    }
    if (
      Option.isSome(call.usage) &&
      call.usage.value.reasoning > call.usage.value.tokens.output
    ) {
      return yield* refused(`${name} has more reasoning tokens than output.`);
    }
    const steps: Array<AntigravitySteps.Step> = [];
    for (const item of [...call.input, ...call.output]) {
      const step = AntigravitySteps.stepOf(item);
      if (Option.isNone(step)) {
        return yield* refused(
          `${name} has an item that is not a step of the record form ${formOf[report.client]}.`,
        );
      }
      steps.push(step.value);
    }
    const output = steps.slice(call.input.length);
    const [only, ...more] = output;
    if (only === undefined) return yield* refused(`${name} has no output.`);
    if (more.length > 0) {
      return yield* refused(
        `${name} has more than one step in its output: its output is the one step that carries its usage.`,
      );
    }
    if (
      steps.some((step, at) => at > 0 && step.idx <= (steps[at - 1]?.idx ?? -1))
    ) {
      return yield* refused(
        `${name} has steps that are not in increasing idx, its output after all of its input.`,
      );
    }
    const before = Option.flatMap(call.after, (after) =>
      Option.fromUndefinedOr(keys.get(after.call)),
    );
    if (Option.isSome(before) && Option.isSome(call.after)) {
      const earlier = before.value;
      if (earlier.call.session !== call.session) {
        return yield* refused(
          `${name} names as its call before a call of another session.`,
        );
      }
      if (
        millis(earlier.call.startedAt) !== millis(call.after.value.startedAt)
      ) {
        return yield* refused(
          `${name} gives its call before a start that is not that call's.`,
        );
      }
      if ((steps[0]?.idx ?? 0) <= earlier.output.idx) {
        return yield* refused(
          `${name} has a step whose idx is not after its call before's output.`,
        );
      }
    }
    const done: Checked = {
      place,
      call,
      id: idOf(caller.reporter, report.client, call.call, call.startedAt),
      input: steps.slice(0, call.input.length),
      output: only,
    };
    keys.set(call.call, done);
    checked.push(done);
  }
  return { report, machine, calls: checked } satisfies CheckedReport;
});

/** What a call's conversation follows: its call before's parts, by digest, and its output step's index. */
export interface Before {
  readonly id: Request.RequestId;
  readonly input: ReadonlyArray<Conversation.Digest>;
  readonly output: ReadonlyArray<Conversation.Digest>;
  readonly lastIdx: number;
}

/** The index of a call before's last step, from the content of its output; none when it is not a step. */
export const lastIdxOf = (
  outputContents: ReadonlyArray<string>,
): Option.Option<number> => {
  const decode = Schema.decodeUnknownOption(
    Schema.fromJsonString(Schema.Unknown),
  );
  return Option.map(
    Option.flatMap(
      Option.flatMap(Option.fromUndefinedOr(outputContents.at(-1)), decode),
      AntigravitySteps.stepOf,
    ),
    (step) => step.idx,
  );
};

/** One reported call as the request log keeps it: its request, its items' row and its own items. */
export interface Built {
  readonly place: number;
  /** Its call key. */
  readonly call: string;
  readonly request: Request.Request;
  readonly requestItems: StoredItems.RequestItems;
  readonly items: ReadonlyArray<StoredItems.StoredItem>;
  readonly before: Before;
}

const recordRules = (form: RecordForm): Conversation.Rules => ({
  parts: [{ part: "input", field: "steps" }],
  takenOut: [],
  textOf: form === "antigravity-steps" ? AntigravitySteps.textOf : () => "",
});

const wellFormedItem = (item: Conversation.Item): Conversation.Item => ({
  ...item,
  text: item.text.toWellFormed(),
});

/**
 * A checked call as a reported request (`docs/specs/reported-requests/spec.md`,
 * Storing): its columns, its `input` part its call before's `input` and
 * `output` and then its own input, its `output` its own, laid out as one list
 * `steps` with no overlay and no params, and each text well-formed. Its
 * conversation is kept as its items' row, which names its call before's items
 * by digest.
 */
export const builtOf = (
  checked: Checked,
  report: CheckedReport,
  pool: { readonly id: PoolId; readonly provider: string },
  reporter: Reporter,
  before: Option.Option<Before>,
): Built => {
  const { call } = checked;
  const form = formOf[report.report.client];
  const rules = recordRules(form);
  const input = call.input.map((item) =>
    wellFormedItem(Conversation.itemOf(rules, item)),
  );
  const output = call.output.map((item) =>
    wellFormedItem(Conversation.itemOf(rules, item)),
  );
  const earlier = Option.match(before, {
    onNone: () => [],
    onSome: ({ input, output }) => [...input, ...output],
  });
  const session = call.session.toWellFormed();
  const request: Request.Request = {
    id: checked.id,
    startedAt: call.startedAt,
    durationMs: millis(call.finishedAt) - millis(call.startedAt),
    session,
    machine: report.machine,
    project: call.project.toWellFormed(),
    client: report.report.client,
    clientVersion: call.clientVersion.toWellFormed(),
    pool: pool.id,
    provider: pool.provider,
    operation: "generate",
    model: call.model.toWellFormed(),
    outcome: call.outcome,
    errorType: cut(call.errorType.toWellFormed(), limits.longestErrorType),
    errorMessage: cut(
      call.errorMessage.toWellFormed(),
      limits.longestErrorMessage,
    ),
    stopReason: call.stopReason.toWellFormed(),
    usage: Option.map(call.usage, (usage) => ({
      ...usage,
      reported: usage.reported.toWellFormed(),
    })),
    providerRequestId: call.providerRequestId.toWellFormed(),
    conversation: Option.none(),
    origin: {
      _tag: "reported",
      form,
      reportedBy:
        reporter._tag === "Owner" ? Option.none() : Option.some(reporter.name),
    },
  };
  const digests = (items: ReadonlyArray<Conversation.Item>) =>
    items.map(({ digest }) => digest);
  const stored = (
    items: ReadonlyArray<Conversation.Item>,
    part: "input" | "output",
    offset: number,
  ) =>
    items.map(
      (item, position): StoredItems.StoredItem => ({
        ...item,
        session,
        protocol: form,
        firstSeen: call.startedAt,
        requestId: checked.id,
        part,
        position: offset + position,
      }),
    );
  return {
    place: checked.place,
    call: call.call,
    request,
    requestItems: {
      requestId: checked.id,
      session,
      startedAt: call.startedAt,
      system: [],
      tools: [],
      input: [...earlier, ...digests(input)],
      output: digests(output),
      layout: [{ part: "input", field: "steps", layout: "list" }],
      overlay: [],
      params: {},
    },
    items: [
      ...stored(input, "input", earlier.length),
      ...stored(output, "output", 0),
    ],
    before: {
      id: checked.id,
      input: [...earlier, ...digests(input)],
      output: digests(output),
      lastIdx: checked.output.idx,
    },
  };
};

/**
 * Each checked call built in order, its call before taken from the calls
 * built before it or, failing that, from what the log holds in its session
 * (`held`): a call whose call before is neither is out of order, and one
 * whose steps are not after a held call before's output is refused.
 */
export const builtAll = Effect.fn("Report.builtAll")(function* (
  report: CheckedReport,
  pool: { readonly id: PoolId; readonly provider: string },
  reporter: Reporter,
  held: (checked: Checked) => Option.Option<Before>,
) {
  const built = new Map<string, Built>();
  const all: Array<Built> = [];
  for (const checked of report.calls) {
    let before = Option.none<Before>();
    if (Option.isSome(checked.call.after)) {
      const after = checked.call.after.value;
      const earlier = built.get(after.call);
      if (earlier !== undefined) {
        before = Option.some(earlier.before);
      } else {
        const fromLog = held(checked);
        const name = nameOf(checked.place, checked.call.call);
        if (Option.isNone(fromLog)) {
          return yield* new ReportOutOfOrder({
            detail: `${name} follows the call ${JSON.stringify(after.call)} started at ${DateTime.formatIso(after.startedAt)}, which is neither earlier in the report nor held in the log in its session: it was never stored.`,
          });
        }
        if ((checked.input[0] ?? checked.output).idx <= fromLog.value.lastIdx) {
          return yield* refused(
            `${name} has a step whose idx is not after its call before's output.`,
          );
        }
        before = fromLog;
      }
    }
    const each = builtOf(checked, report, pool, reporter, before);
    built.set(checked.call.call, each);
    all.push(each);
  }
  return all;
});
