import { Effect, Option, Schema, Stream } from "effect";
import { QueryFailed } from "#modules/request-log/02-application/interfaces/sql-console.ts";
import * as Sql from "#modules/request-log/03-domain/sql.ts";
import { exceptionIn } from "./client.ts";

/** The format the hub asks ClickHouse to answer SQL in, and reads line by line. */
export const format = "JSONCompactEachRowWithNamesAndTypes";

export interface Read {
  readonly columns: ReadonlyArray<Sql.Column>;
  readonly rows: ReadonlyArray<ReadonlyArray<Schema.Json>>;
  readonly truncated: boolean;
}

const newline = 0x0a;
const openingBracket = 0x5b;
const longestTrailer = 64 * 1024;

const Names = Schema.Array(Schema.String);
const Row = Schema.Array(Schema.Json);

const jsonOf = <A>(
  schema: Schema.Codec<A, unknown>,
  bytes: Uint8Array,
): Option.Option<A> => {
  try {
    const parsed: unknown = JSON.parse(decoded(bytes));
    return Schema.decodeUnknownOption(schema)(parsed);
  } catch {
    return Option.none();
  }
};

const joined = (pieces: ReadonlyArray<Uint8Array>, length: number) => {
  const line = new Uint8Array(length);
  let at = 0;
  for (const piece of pieces) {
    line.set(piece, at);
    at += piece.length;
  }
  return line;
};

const decoded = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

const failed = (detail: string) => Effect.fail(new QueryFailed({ detail }));

/**
 * Reads an answer in `JSONCompactEachRowWithNamesAndTypes` as it arrives: the
 * column names, their types, then rows, kept while they fit the limits given
 * (`Sql.fits`). At the first row that does not fit it stops reading, so it
 * never holds more than the limits and the line it is reading; a row longer
 * than what is left is known not to fit before it ends. An exception
 * ClickHouse frames after the first rows, with the answer's tag, fails it.
 */
export const read = Effect.fn("SqlAnswer.read")(function* <E>(
  body: Stream.Stream<Uint8Array, E>,
  exceptionTag: string | undefined,
  limits: Sql.Limits,
): Effect.fn.Return<Read, E | QueryFailed> {
  let pieces: Array<Uint8Array> = [];
  let pending = 0;
  let names: ReadonlyArray<string> | undefined;
  let types: ReadonlyArray<string> | undefined;
  const rows: Array<ReadonlyArray<Schema.Json>> = [];
  let kept: Sql.Kept = { rows: 0, bytes: 0 };
  let truncated = false;
  let trailer: string | undefined;
  let malformed: string | undefined;

  const room = () =>
    types === undefined ? limits.rowBytes : limits.rowBytes - kept.bytes;

  /** Takes one whole line: a row, or the start of what follows the rows. */
  const line = (bytes: Uint8Array): "more" | "stop" | "trailer" => {
    if (names === undefined || types === undefined) {
      const header = jsonOf(Names, bytes);
      if (Option.isNone(header)) {
        malformed = "ClickHouse's answer did not begin with its columns.";
        return "stop";
      }
      if (names === undefined) names = header.value;
      else types = header.value;
      return "more";
    }
    if (bytes[0] !== openingBracket) return "trailer";
    if (!Sql.fits(limits, kept, bytes.length)) {
      truncated = true;
      return "stop";
    }
    const row = jsonOf(Row, bytes);
    if (Option.isNone(row)) {
      malformed = "ClickHouse's answer held a row that is not JSON.";
      return "stop";
    }
    rows.push(row.value);
    kept = { rows: kept.rows + 1, bytes: kept.bytes + bytes.length };
    return "more";
  };

  const chunk = (bytes: Uint8Array): boolean => {
    if (trailer !== undefined) {
      trailer += decoded(bytes);
      return trailer.length < longestTrailer;
    }
    let from = 0;
    while (from < bytes.length) {
      const end = bytes.indexOf(newline, from);
      if (end === -1) {
        pieces.push(bytes.subarray(from));
        pending += bytes.length - from;
        break;
      }
      pieces.push(bytes.subarray(from, end));
      const whole = joined(pieces, pending + end - from);
      pieces = [];
      pending = 0;
      from = end + 1;
      const next = line(whole);
      if (next === "stop") return false;
      if (next === "trailer") {
        trailer = `${decoded(whole)}\n${decoded(bytes.subarray(from))}`;
        return trailer.length < longestTrailer;
      }
    }
    if (pending <= room()) return true;
    if (types === undefined) {
      malformed = `ClickHouse's column names or types are longer than ${limits.rowBytes} bytes.`;
      return false;
    }
    if (pieces[0]?.[0] !== openingBracket) {
      trailer = decoded(joined(pieces, pending));
      pieces = [];
      pending = 0;
      return trailer.length < longestTrailer;
    }
    truncated = true;
    return false;
  };

  let stopped = false;
  const ended = yield* body.pipe(
    Stream.runForEachWhile((bytes) =>
      Effect.sync(() => {
        stopped = !chunk(bytes);
        return !stopped;
      }),
    ),
    Effect.as(Option.none<E>()),
    Effect.catch((error) => Effect.succeedSome(error)),
  );
  // An answer that ends without a newline still has its last line to take.
  if (!stopped && Option.isNone(ended) && pending > 0) {
    const last = joined(pieces, pending);
    if (line(last) === "trailer") trailer = decoded(last);
  }
  if (malformed !== undefined) return yield* failed(malformed);
  if (truncated || trailer === undefined) {
    if (Option.isSome(ended) && !truncated)
      return yield* Effect.fail(ended.value);
    return { columns: columnsOf(names, types), rows, truncated };
  }
  const exception = exceptionIn(trailer, exceptionTag);
  return yield* failed(
    exception === undefined
      ? "ClickHouse's answer held a line that is not a row."
      : withoutVersion(exception.detail),
  );
});

const columnsOf = (
  names: ReadonlyArray<string> | undefined,
  types: ReadonlyArray<string> | undefined,
): ReadonlyArray<Sql.Column> =>
  (names ?? []).map((name, at) => ({ name, type: types?.[at] ?? "" }));

/** ClickHouse's message without the version it ends with. */
export const withoutVersion = (detail: string): string =>
  detail.replace(/\s*\(version [^()]*(\([^()]*\))?\)\s*$/, "");
