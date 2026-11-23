import { Option, Result, Schema } from "effect";
import {
  type After,
  type From,
  fromStart,
  type ModelCall,
  type Reason,
  reasons,
} from "./antigravity-record.ts";
import type { Configuration, ReportedFolder } from "./configuration.ts";
import type { System, Variables } from "./system.ts";

/** A file's size in bytes and when it last changed, in milliseconds since the epoch. */
export interface Stamp {
  readonly size: number;
  readonly changedAt: number;
}

/** A conversation's database and its `-wal`, by their stamps. */
export interface Stamps {
  readonly db: Stamp;
  readonly wal: Option.Option<Stamp>;
}

export const sameStamps = (one: Stamps, other: Stamps): boolean => {
  const same = (a: Stamp, b: Stamp) =>
    a.size === b.size && a.changedAt === b.changedAt;
  return (
    same(one.db, other.db) &&
    Option.isSome(one.wal) === Option.isSome(other.wal) &&
    (Option.isNone(one.wal) ||
      Option.isNone(other.wal) ||
      same(one.wal.value, other.wal.value))
  );
};

/** Where the request reporter stands in one conversation (`docs/specs/request-reporter/spec.md`, The cursor). */
export interface ReportCursor {
  readonly from: From;
  /** The stamps of the last read whose every call the hub stored. */
  readonly stamps: Option.Option<Stamps>;
  readonly waiting: Option.Option<{
    readonly since: number;
    readonly stamps: Stamps;
  }>;
  readonly notReported: Option.Option<{
    readonly reason: Reason;
    readonly step: Option.Option<number>;
  }>;
}

export const firstCursor: ReportCursor = {
  from: fromStart,
  stamps: Option.none(),
  waiting: Option.none(),
  notReported: Option.none(),
};

export interface FolderState {
  readonly ranAt: Option.Option<string>;
  readonly goodAt: Option.Option<string>;
  readonly through: Option.Option<string>;
  readonly conversations: ReadonlyMap<string, ReportCursor>;
}

export const unreadFolder: FolderState = {
  ranAt: Option.none(),
  goodAt: Option.none(),
  through: Option.none(),
  conversations: new Map(),
};

/** `requests.json`: each kept folder's state, by the folder as kept. */
export type State = ReadonlyMap<string, FolderState>;

/** How long a conversation waiting on a step not finished must stay unchanged to be settled. */
export const settleAfter = 10 * 60 * 1000;

/** Whether a conversation is read this run. */
export const isDue = (
  cursor: Option.Option<ReportCursor>,
  stamps: Stamps,
): boolean =>
  Option.match(cursor, {
    onNone: () => true,
    onSome: (each) =>
      Option.isSome(each.waiting) ||
      !Option.exists(each.stamps, (kept) => sameStamps(kept, stamps)),
  });

/** Whether a waiting conversation's files have stayed as they were for long enough to read through its steps not finished. */
export const isSettled = (
  cursor: ReportCursor,
  stamps: Stamps,
  now: number,
): boolean =>
  Option.exists(
    cursor.waiting,
    (waiting) =>
      sameStamps(waiting.stamps, stamps) && now - waiting.since >= settleAfter,
  );

/** The cursor after a reading every call of which the hub stored. */
export const cursorAfter = (
  cursor: ReportCursor,
  stamps: Stamps,
  waiting: boolean,
  stopped: ReportCursor["notReported"],
  now: number,
): ReportCursor => ({
  ...cursor,
  stamps: Option.some(stamps),
  waiting: waiting
    ? Option.some(
        Option.match(cursor.waiting, {
          onNone: () => ({ since: now, stamps }),
          onSome: (kept) =>
            sameStamps(kept.stamps, stamps) ? kept : { since: now, stamps },
        }),
      )
    : Option.none(),
  notReported: stopped,
});

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const StampFile = Schema.Struct({ size: Count, changedAt: Schema.Finite });
const StampsFile = Schema.Struct({
  db: StampFile,
  wal: Schema.NullOr(StampFile),
});
const CursorFile = Schema.Struct({
  step: Schema.Int.check(Schema.isGreaterThanOrEqualTo(-1)),
  call: Schema.NullOr(
    Schema.Struct({ call: Schema.String, startedAt: Schema.Finite }),
  ),
  stamps: Schema.NullOr(StampsFile),
  waiting: Schema.NullOr(
    Schema.Struct({ since: Schema.Finite, stamps: StampsFile }),
  ),
  notReported: Schema.NullOr(
    Schema.Struct({
      reason: Schema.Literals(reasons),
      step: Schema.NullOr(Schema.Int),
    }),
  ),
});
const File = Schema.Struct({
  folders: Schema.Record(
    Schema.String,
    Schema.Struct({
      ranAt: Schema.NullOr(Schema.String),
      goodAt: Schema.NullOr(Schema.String),
      through: Schema.NullOr(Schema.String),
      conversations: Schema.Record(Schema.String, CursorFile),
    }),
  ),
});

type StampsFile = typeof StampsFile.Type;

const stampsOf = (file: StampsFile): Stamps => ({
  db: file.db,
  wal: Option.fromNullOr(file.wal),
});

const stampsFileOf = (stamps: Stamps): StampsFile => ({
  db: stamps.db,
  wal: Option.getOrNull(stamps.wal),
});

/** `requests.json` read: an empty state when there is none, nothing when it does not read. */
export const stateOf = (text: Option.Option<string>): Option.Option<State> => {
  if (Option.isNone(text)) return Option.some(new Map());
  let json: unknown;
  try {
    json = JSON.parse(text.value);
  } catch {
    return Option.none();
  }
  const decoded = Schema.decodeUnknownResult(File)(json);
  if (Result.isFailure(decoded)) return Option.none();
  return Option.some(
    new Map(
      Object.entries(decoded.success.folders).map(([folder, state]) => [
        folder,
        {
          ranAt: Option.fromNullOr(state.ranAt),
          goodAt: Option.fromNullOr(state.goodAt),
          through: Option.fromNullOr(state.through),
          conversations: new Map(
            Object.entries(state.conversations).map(([id, cursor]) => [
              id,
              {
                from: {
                  step: cursor.step,
                  last: Option.fromNullOr(cursor.call),
                },
                stamps: Option.map(Option.fromNullOr(cursor.stamps), stampsOf),
                waiting: Option.map(
                  Option.fromNullOr(cursor.waiting),
                  (waiting) => ({
                    since: waiting.since,
                    stamps: stampsOf(waiting.stamps),
                  }),
                ),
                notReported: Option.map(
                  Option.fromNullOr(cursor.notReported),
                  (stop) => ({
                    reason: stop.reason,
                    step: Option.fromNullOr(stop.step),
                  }),
                ),
              },
            ]),
          ),
        },
      ]),
    ),
  );
};

export const textOf = (state: State): string =>
  `${JSON.stringify({
    folders: Object.fromEntries(
      [...state].map(([folder, each]) => [
        folder,
        {
          ranAt: Option.getOrNull(each.ranAt),
          goodAt: Option.getOrNull(each.goodAt),
          through: Option.getOrNull(each.through),
          conversations: Object.fromEntries(
            [...each.conversations].map(([id, cursor]) => [
              id,
              {
                step: cursor.from.step,
                call: Option.getOrNull(cursor.from.last),
                stamps: Option.getOrNull(
                  Option.map(cursor.stamps, stampsFileOf),
                ),
                waiting: Option.getOrNull(
                  Option.map(cursor.waiting, (waiting) => ({
                    since: waiting.since,
                    stamps: stampsFileOf(waiting.stamps),
                  })),
                ),
                notReported: Option.getOrNull(
                  Option.map(cursor.notReported, (stop) => ({
                    reason: stop.reason,
                    step: Option.getOrNull(stop.step),
                  })),
                ),
              },
            ]),
          ),
        },
      ]),
    ),
  })}\n`;

/** The hub's limits for a report, and the machine's own for what it sends in one (`docs/specs/request-reporter/spec.md`). */
export interface Limits {
  readonly calls: number;
  readonly bytes: number;
  readonly body: number;
}

export const limits: Limits = {
  calls: 200,
  bytes: 8 * 1024 * 1024,
  body: 64 * 1024 * 1024,
};

const iso = (millis: number) => new Date(millis).toISOString();

const afterOf = (after: After) => ({
  call: after.call,
  startedAt: iso(after.startedAt),
});

/** A model call as a report's `calls` holds it, with its project read. */
export const wireCallOf = (call: ModelCall, project: string) => ({
  call: call.call,
  after: Option.getOrNull(Option.map(call.after, afterOf)),
  session: call.session,
  project,
  clientVersion: "",
  model: call.model,
  startedAt: iso(call.startedAt),
  finishedAt: iso(call.finishedAt),
  outcome: call.outcome,
  errorType: call.errorType,
  errorMessage: call.errorMessage,
  stopReason: "",
  providerRequestId: call.providerRequestId,
  usage: call.usage,
  input: call.input,
  output: call.output,
});

const encoder = new TextEncoder();

export const bytesOf = (text: string): number => encoder.encode(text).length;

/** A report's body around its calls, already written out. */
export const bodyOf = (
  pool: string,
  through: Option.Option<string>,
  calls: ReadonlyArray<string>,
): string =>
  `{"client":"antigravity","pool":${JSON.stringify(pool)},"through":${JSON.stringify(Option.getOrNull(through))},"calls":[${calls.join(",")}]}`;

/** The most bytes a report's body has besides its calls and the commas between them. */
const frameBytes = (pool: string) =>
  bytesOf(bodyOf(pool, Option.some(iso(0)), []));

/** Whether a call is too large to be sent at all: the report holding it alone is over the hub's limit. */
export const isTooLarge = (
  pool: string,
  call: string,
  given: Limits,
): boolean => frameBytes(pool) + bytesOf(call) > given.body;

/**
 * The calls cut into reports, in order: each at most the calls and the
 * bytes the limits give, but for a call alone over the bytes, which is a
 * report of its own.
 */
export const reportsOf = (
  pool: string,
  calls: ReadonlyArray<string>,
  given: Limits,
): ReadonlyArray<ReadonlyArray<number>> => {
  const frame = frameBytes(pool);
  const reports: Array<Array<number>> = [];
  let current: Array<number> = [];
  let size = frame;
  calls.forEach((call, index) => {
    const bytes = bytesOf(call) + (current.length > 0 ? 1 : 0);
    if (
      current.length > 0 &&
      (current.length >= given.calls || size + bytes > given.bytes)
    ) {
      reports.push(current);
      current = [];
      size = frame;
    }
    current.push(index);
    size += bytesOf(call) + (current.length > 1 ? 1 : 0);
  });
  if (current.length > 0) reports.push(current);
  return reports;
};

/** The reported clients' default data folders under a home (`docs/specs/request-reporter/spec.md`, Commands): `agy`'s and the desktop app's. */
export const defaultFoldersOf = (
  system: System,
  variables: Variables,
): ReadonlyArray<string> => {
  const windows = system === "win32";
  const home = variables[windows ? "USERPROFILE" : "HOME"];
  if (home === undefined || home === "") return [];
  const separator = windows ? "\\" : "/";
  const gemini = `${home.replace(windows ? /[\\/]+$/ : /\/+$/, "")}${separator}.gemini`;
  return [
    `${gemini}${separator}antigravity-cli`,
    `${gemini}${separator}antigravity`,
  ];
};

/** A configuration with its reported folders replaced: a client with none has no table. */
export const withFolders = (
  configuration: Configuration,
  folders: ReadonlyArray<ReportedFolder>,
): Configuration => {
  const { antigravity: _, ...others } = configuration.clients ?? {};
  const clients =
    folders.length === 0
      ? others
      : { ...others, antigravity: { reported: folders } };
  const { clients: __, ...rest } = configuration;
  return Object.keys(clients).length === 0 ? rest : { ...rest, clients };
};
