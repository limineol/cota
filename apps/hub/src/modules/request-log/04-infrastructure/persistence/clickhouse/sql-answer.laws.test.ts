import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Schema, Stream } from "effect";
import * as Sql from "#modules/request-log/03-domain/sql.ts";
import * as SqlAnswer from "./sql-answer.ts";

const int = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

const either = <A>(
  first: Arbitrary.Arbitrary<A>,
  second: Arbitrary.Arbitrary<A>,
): Arbitrary.Arbitrary<A> =>
  Arbitrary.schema(Schema.Boolean).pipe(
    Arbitrary.flatMap((isFirst) => (isFirst ? first : second)),
  );

const mebibyte = 1024 * 1024;
const header = '["x"]\n["String"]\n';

/** A row line of exactly `length` bytes, `length` at least 4: `["x…x"]`. */
const rowOf = (length: number) => `["${"x".repeat(length - 4)}"]`;

/**
 * Answers around the caps: about 5,000 short rows; or a few long rows and
 * then, most often, one that fills 16 MiB exactly or one longer than what is
 * left, and a few short rows; each arriving in chunks of the sizes given.
 */
const answers = either(
  Arbitrary.all({
    lengths: either(int(0, 12), int(4990, 5010)).pipe(
      Arbitrary.flatMap((count) =>
        Arbitrary.array(int(4, 24), { minLength: count, maxLength: count }),
      ),
    ),
    chunks: Arbitrary.array(int(1, 300), { minLength: 1, maxLength: 4 }),
  }),
  Arbitrary.all({
    lengths: Arbitrary.all({
      before: Arbitrary.array(int(4, 5 * mebibyte), { maxLength: 4 }),
      last: int(0, 2),
      over: int(1, 3 * mebibyte),
      after: Arbitrary.array(int(4, 64), { maxLength: 2 }),
    }).pipe(
      Arbitrary.map(({ before, last, over, after }) => {
        const rest =
          16 * mebibyte - before.reduce((sum, length) => sum + length, 0);
        const next = [[rest], [rest + over], []][last] ?? [];
        return [...before, ...next.filter((length) => length >= 4), ...after];
      }),
    ),
    chunks: Arbitrary.array(int(1, 2 * mebibyte), {
      minLength: 1,
      maxLength: 4,
    }),
  }),
);

/** Limits of a few rows and bytes, and answers of short rows around them. */
const smallAnswers = Arbitrary.all({
  limits: Arbitrary.all({ rows: int(1, 20), rowBytes: int(16, 400) }).pipe(
    Arbitrary.map(
      ({ rows, rowBytes }): Sql.Limits => ({ ...Sql.defaults, rows, rowBytes }),
    ),
  ),
  lengths: Arbitrary.array(int(4, 40), { maxLength: 30 }),
  chunks: Arbitrary.array(int(1, 50), { minLength: 1, maxLength: 4 }),
});

const chunked = (body: Uint8Array, sizes: ReadonlyArray<number>) => {
  const pieces: Array<Uint8Array> = [];
  for (let at = 0, next = 0; at < body.length; next++) {
    const size = sizes[next % sizes.length] ?? 1;
    pieces.push(body.subarray(at, at + size));
    at += size;
  }
  return pieces;
};

const readAround = ({
  lengths,
  chunks,
  limits = Sql.defaults,
}: {
  readonly lengths: ReadonlyArray<number>;
  readonly chunks: ReadonlyArray<number>;
  readonly limits?: Sql.Limits;
}) =>
  Effect.gen(function* () {
    const body = new TextEncoder().encode(
      header + lengths.map((length) => `${rowOf(length)}\n`).join(""),
    );
    let pulled = 0;
    const read = yield* SqlAnswer.read(
      Stream.fromIterable(chunked(body, chunks)).pipe(
        Stream.tap((chunk) =>
          Effect.sync(() => {
            pulled += chunk.length;
          }),
        ),
      ),
      undefined,
      limits,
    );

    const fitting: Array<number> = [];
    let bytes = 0;
    for (const length of lengths) {
      if (fitting.length === limits.rows || bytes + length > limits.rowBytes) {
        break;
      }
      fitting.push(length);
      bytes += length;
    }
    return { read, fitting, pulled };
  });

describe("reading an answer", () => {
  it.effect.prop(
    "X4: the line reader keeps the longest prefix of rows within 5,000 rows and 16 MiB, and reads at most the caps and two chunks",
    { answer: answers },
    ({ answer }) =>
      Effect.gen(function* () {
        const { read, fitting, pulled } = yield* readAround(answer);
        expect(read.columns).toEqual([{ name: "x", type: "String" }]);
        expect(read.rows.map((row) => JSON.stringify(row).length)).toEqual(
          fitting,
        );
        expect(pulled).toBeLessThanOrEqual(
          header.length + 16 * mebibyte + 5000 + 2 * Math.max(...answer.chunks),
        );
      }),
    { timeout: 120_000, arbitrary: { runs: 60 } },
  );

  it.effect.prop(
    "X5: the line reader's answer is truncated exactly when rows were left past the caps",
    { answer: answers },
    ({ answer }) =>
      Effect.gen(function* () {
        const { read, fitting } = yield* readAround(answer);
        expect(read.truncated).toBe(fitting.length < answer.lengths.length);
      }),
    { timeout: 120_000, arbitrary: { runs: 60 } },
  );

  it.effect.prop(
    "X4: with any limits, the line reader keeps the longest prefix of rows within them, and reads at most the caps and two chunks",
    { answer: smallAnswers },
    ({ answer }) =>
      Effect.gen(function* () {
        const { read, fitting, pulled } = yield* readAround(answer);
        expect(read.rows.map((row) => JSON.stringify(row).length)).toEqual(
          fitting,
        );
        expect(pulled).toBeLessThanOrEqual(
          header.length +
            answer.limits.rowBytes +
            answer.limits.rows +
            2 * Math.max(...answer.chunks),
        );
      }),
  );

  it.effect.prop(
    "X5: with any limits, the line reader's answer is truncated exactly when rows were left past them",
    { answer: smallAnswers },
    ({ answer }) =>
      Effect.gen(function* () {
        const { read, fitting } = yield* readAround(answer);
        expect(read.truncated).toBe(fitting.length < answer.lengths.length);
      }),
  );

  it.effect(
    "fails with ClickHouse's message, without its version, when an exception follows rows",
    () =>
      Effect.gen(function* () {
        const tag = "abcdefghijklmnop";
        const message =
          "Code: 395. DB::Exception: Value passed to 'throwIf' function is non-zero. (FUNCTION_THROW_IF_VALUE_IS_NON_ZERO) (version 26.8.36.3 (official build))";
        const body = `${header}["a"]\n\r\n__exception__\r\n${tag}\r\n${message}\n${message.length} ${tag}\r\n__exception__\r\n`;
        const failed = yield* SqlAnswer.read(
          Stream.make(new TextEncoder().encode(body)),
          tag,
          Sql.defaults,
        ).pipe(Effect.flip);

        expect(failed.detail).toBe(
          "Code: 395. DB::Exception: Value passed to 'throwIf' function is non-zero. (FUNCTION_THROW_IF_VALUE_IS_NON_ZERO)",
        );
      }),
  );

  it.effect("reads an empty body as an answer with no columns", () =>
    Effect.gen(function* () {
      expect(
        yield* SqlAnswer.read(Stream.empty, undefined, Sql.defaults),
      ).toEqual({
        columns: [],
        rows: [],
        truncated: false,
      });
    }),
  );
});
