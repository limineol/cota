import { Context, Effect, Layer, Schema, Stream } from "effect";
import {
  type ArchiveSession,
  RequestLogArchive,
  RequestLogArchiveFailed,
} from "#modules/request-log/02-application/interfaces/request-log-archive.ts";
import * as Archive from "#modules/request-log/03-domain/archive.ts";

/**
 * A row of the scripted log, the same for every table: `id` is what holds it
 * (a request's id, an item's session and digest), `at` its own time, which
 * places it in a day, and `text` the rest of its values. The log keeps one
 * row per id, an item's earliest copy, as `items FINAL` does.
 */
export const Row = Schema.Struct({
  id: Schema.String,
  at: Schema.Int,
  text: Schema.String,
});
export type Row = typeof Row.Type;

export type Log = Record<Archive.Table, Array<Row>>;

export type Op =
  | "summaries"
  | "source"
  | "export"
  | "load"
  | "logged"
  | "lacking";

/**
 * What the `at`-th call of an operation does instead of answering: it fails;
 * an export breaks off after its first row; `logged` disagrees, answering
 * one row more, as when a row is written to the day between the export and
 * the check, or differs, answering the same count with another checksum;
 * `lacking` leaves out, answering one row more, as when an add left a row
 * out. Any other fault fails the call.
 */
export interface Fault {
  readonly op: Op;
  readonly at: number;
  readonly how: "fails" | "breaks off" | "disagrees" | "differs" | "leaves out";
}

export interface Loaded {
  readonly session: number;
  readonly table: Archive.Table;
  readonly bytes: string;
  readonly measure: Archive.Measure;
}

export interface Checked {
  readonly session: number;
  readonly day: Archive.Day;
  readonly table: Archive.Table;
  readonly logged: Archive.Logged;
}

/** The scripted log and its faults, how many times each operation was called, and every load and check it answered, for tests to look into. */
export class ScriptedRequestLogArchive extends Context.Service<
  ScriptedRequestLogArchive,
  {
    readonly log: Log;
    faults: ReadonlyArray<Fault>;
    readonly calls: Record<Op, number>;
    readonly loads: Array<Loaded>;
    readonly checks: Array<Checked>;
    sessions: number;
  }
>()("@cota/hub/request-log/ScriptedRequestLogArchive") {}

const mask = 2n ** 64n - 1n;

const hashOf = (text: string): bigint => {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) {
    hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) & mask;
  }
  return hash;
};

const sumOf = (rows: ReadonlyArray<Row>, part: (row: Row) => string) =>
  String(rows.reduce((sum, row) => (sum + hashOf(part(row))) & mask, 0n));

const keyOf = (row: Row) => `${row.id}|${row.at}`;
const valuesOf = (row: Row) => `${row.id}|${row.at}|${row.text}`;

export const dayOf = (at: number): Archive.Day =>
  Archive.Day.make(new Date(at).toISOString().slice(0, 10));

export const rowsOf = (
  log: Log,
  day: Archive.Day,
  table: Archive.Table,
): ReadonlyArray<Row> => log[table].filter(({ at }) => dayOf(at) === day);

export const tallyOf = (rows: ReadonlyArray<Row>): Archive.Tally => ({
  rows: rows.length,
  fingerprint: sumOf(rows, keyOf),
});

export const measureOf = (rows: ReadonlyArray<Row>): Archive.Measure => ({
  rows: rows.length,
  checksum: sumOf(rows, valuesOf),
  fingerprint: sumOf(rows, keyOf),
});

/** The archive spec's rule, in the scripted log's terms: a row is held by a row of its table with its id that is at least as early. */
export const isHeld = (log: Log, table: Archive.Table, row: Row): boolean =>
  log[table].some(({ id, at }) => id === row.id && at <= row.at);

export const linesOf = (rows: ReadonlyArray<Row>): ReadonlyArray<string> =>
  rows.map((row) => `${JSON.stringify(row)}\n`);

const RowLine = Schema.fromJsonString(Row);

/** The rows of a file as the scripted log writes them, one JSON object per line. */
export const decodedRows = (text: string) =>
  Effect.forEach(
    text.split("\n").filter((line) => line !== ""),
    (line) => Schema.decodeEffect(RowLine)(line),
  );

export const source: Archive.Source = {
  version: "26.8.36.3",
  database: "cota",
  tables: {
    items: {
      columns: [
        { name: "session", type: "String" },
        { name: "digest", type: "UInt128" },
        { name: "first_seen", type: "DateTime64(3, 'UTC')" },
      ],
      create: "CREATE TABLE cota.items (…)",
    },
    request_items: {
      columns: [{ name: "request_id", type: "UUID" }],
      create: "CREATE TABLE cota.request_items (…)",
    },
    requests: {
      columns: [{ name: "id", type: "UUID" }],
      create: "CREATE TABLE cota.requests (…)",
    },
    session_titles: {
      columns: [{ name: "session", type: "String" }],
      create: "CREATE TABLE cota.session_titles (…)",
    },
  },
};

/** The rows `logged` answers for: the log's, or other rows as its fault says; none when it fails. */
const answeredOf = (
  rows: ReadonlyArray<Row>,
  fault: Fault | undefined,
): ReadonlyArray<Row> | undefined => {
  if (fault === undefined) return rows;
  const [first, ...rest] = rows;
  if (fault.how === "differs" && first !== undefined) {
    return [{ ...first, text: `${first.text} read otherwise` }, ...rest];
  }
  if (fault.how === "disagrees" || fault.how === "differs") {
    return [...rows, { id: "written-since", at: 0, text: "" }];
  }
  return undefined;
};

export const make = (held: ScriptedRequestLogArchive["Service"]) => {
  const faultOf = (op: Op) => {
    const at = held.calls[op];
    held.calls[op] = at + 1;
    return held.faults.find((fault) => fault.op === op && fault.at === at);
  };
  const failed = (op: Op) =>
    new RequestLogArchiveFailed({ detail: `the ${op} failed` });
  // An import's writes are proven against ClickHouse, not scripted.
  const notScripted = new RequestLogArchiveFailed({
    detail: "the scripted archive does not import",
  });
  const answer = <A>(op: Op, compute: () => A) =>
    Effect.suspend(() =>
      faultOf(op) === undefined
        ? Effect.sync(compute)
        : Effect.fail(failed(op)),
    );

  const sessionOf = (session: number): ArchiveSession => {
    const loaded = new Map<Archive.Table, ReadonlyArray<Row>>();
    return {
      export: (day, table) =>
        Stream.unwrap(
          Effect.sync(() => {
            const fault = faultOf("export");
            const lines = linesOf(rowsOf(held.log, day, table)).map((line) =>
              new TextEncoder().encode(line),
            );
            if (fault?.how === "breaks off") {
              return Stream.concat(
                Stream.fromArray(lines.slice(0, 1)),
                Stream.fail(failed("export")),
              );
            }
            return fault === undefined
              ? Stream.fromArray(lines)
              : Stream.fail(failed("export"));
          }),
        ),
      load: (table, file) =>
        Effect.gen(function* () {
          if (faultOf("load") !== undefined) return yield* failed("load");
          if (loaded.has(table)) {
            return yield* new RequestLogArchiveFailed({
              detail: `archive_${table} already exists`,
            });
          }
          const chunks = yield* Stream.runCollect(file);
          const bytes = chunks
            .map((chunk) => new TextDecoder().decode(chunk))
            .join("");
          const rows = yield* decodedRows(bytes).pipe(
            Effect.mapError(
              () => new RequestLogArchiveFailed({ detail: "not JSON lines" }),
            ),
          );
          loaded.set(table, rows);
          const measure = measureOf(rows);
          held.loads.push({ session, table, bytes, measure });
          return measure;
        }),
      logged: (day, table) =>
        Effect.suspend(() => {
          const fault = faultOf("logged");
          const rows = rowsOf(held.log, day, table);
          const answered = answeredOf(rows, fault);
          if (answered === undefined) return Effect.fail(failed("logged"));
          const { rows: count, checksum } = measureOf(answered);
          held.checks.push({
            session,
            day,
            table,
            logged: { rows: count, checksum },
          });
          return Effect.succeed({ rows: count, checksum });
        }),
      lacking: (table) =>
        Effect.suspend(() => {
          const fault = faultOf("lacking");
          const count = (loaded.get(table) ?? []).filter(
            (row) => !isHeld(held.log, table, row),
          ).length;
          if (fault === undefined) return Effect.succeed(count);
          return fault.how === "leaves out"
            ? Effect.succeed(count + 1)
            : Effect.fail(failed("lacking"));
        }),
      add: (table) =>
        Effect.sync(() => {
          const lacking = (loaded.get(table) ?? []).filter(
            (row) => !isHeld(held.log, table, row),
          );
          held.log[table] = [
            ...held.log[table].filter(
              ({ id }) => !lacking.some((row) => row.id === id),
            ),
            ...lacking,
          ];
          return lacking.length;
        }),
      drop: (table) => Effect.sync(() => void loaded.delete(table)),
      make: () => Effect.fail(notScripted),
      append: () => Effect.fail(notScripted),
      measure: () => Effect.fail(notScripted),
      ofLoaded: () => Effect.fail(notScripted),
      unresolved: Effect.fail(notScripted),
    };
  };

  return RequestLogArchive.of({
    prepare: Effect.void,
    summaries: answer("summaries", () => {
      const summaries = new Map<
        Archive.Day,
        Record<Archive.Table, Archive.Tally>
      >();
      for (const table of Archive.tables) {
        for (const { at } of held.log[table]) {
          const day = dayOf(at);
          if (summaries.has(day)) continue;
          summaries.set(day, {
            items: tallyOf(rowsOf(held.log, day, "items")),
            request_items: tallyOf(rowsOf(held.log, day, "request_items")),
            requests: tallyOf(rowsOf(held.log, day, "requests")),
            session_titles: tallyOf(rowsOf(held.log, day, "session_titles")),
          });
        }
      }
      return summaries;
    }),
    source: answer("source", () => source),
    session: Effect.sync(() => {
      held.sessions += 1;
      return sessionOf(held.sessions);
    }),
    importing: () => Effect.die("the scripted archive does not import"),
  });
};

export const emptyLog = (): Log => ({
  items: [],
  request_items: [],
  requests: [],
  session_titles: [],
});

/** The request log's side of the archive over a scripted log, whose calls fail as `faults` say, and the script, for tests to look into and change. */
export const layer = (
  log: Log,
  faults: ReadonlyArray<Fault> = [],
): Layer.Layer<RequestLogArchive | ScriptedRequestLogArchive> =>
  Layer.effectContext(
    Effect.sync(() => {
      const held = ScriptedRequestLogArchive.of({
        log,
        faults,
        calls: {
          summaries: 0,
          source: 0,
          export: 0,
          load: 0,
          logged: 0,
          lacking: 0,
        },
        loads: [],
        checks: [],
        sessions: 0,
      });
      return Context.make(ScriptedRequestLogArchive, held).pipe(
        Context.add(RequestLogArchive, make(held)),
      );
    }),
  );
