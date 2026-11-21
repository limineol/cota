import { Duration, type Option, Schema } from "effect";

/** The longest text the SQL console runs, in characters (code points). */
export const longestText = 100_000;

const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0));

/**
 * The SQL console's limits, which the owner sets in `[sql]` and no caller can
 * change (`docs/specs/sql/spec.md`): how long a query runs, the memory and
 * threads it takes, how many run at once, and the rows of an answer and their
 * bytes, as ClickHouse wrote them.
 */
export const Limits = Schema.Struct({
  queryTime: Schema.Duration,
  memoryBytes: PositiveInt,
  threads: PositiveInt,
  concurrentQueries: PositiveInt,
  rows: PositiveInt,
  rowBytes: PositiveInt,
});
export type Limits = typeof Limits.Type;

export const defaults: Limits = {
  queryTime: Duration.seconds(30),
  memoryBytes: 4_000_000_000,
  threads: 4,
  concurrentQueries: 4,
  rows: 5_000,
  rowBytes: 16 * 1024 * 1024,
};

export class QueryTooLong extends Schema.TaggedError<
  QueryTooLong,
  { readonly brand: unique symbol }
>()("QueryTooLong", { characters: Schema.Int }) {}

/** What an answer holds so far: its rows, and their bytes as ClickHouse wrote them. */
export interface Kept {
  readonly rows: number;
  readonly bytes: number;
}

/** Whether a row of `bytes` bytes may join the rows kept: the cap is hard (X4). */
export const fits = (limits: Limits, kept: Kept, bytes: number): boolean =>
  kept.rows < limits.rows && kept.bytes + bytes <= limits.rowBytes;

export interface Column {
  readonly name: string;
  readonly type: string;
}

export interface Answer {
  readonly columns: ReadonlyArray<Column>;
  readonly rows: ReadonlyArray<ReadonlyArray<Schema.Json>>;
  /** Whether the query had rows the answer does not hold (X5). */
  readonly truncated: boolean;
  /** From sending the text to reading the last row, by the hub's clock. */
  readonly elapsedMs: number;
}

export interface TableColumn {
  readonly name: string;
  readonly type: string;
  readonly comment: string;
}

export interface Table {
  readonly name: string;
  readonly engine: string;
  /** ClickHouse's totals, none for a view. */
  readonly rows: Option.Option<number>;
  readonly bytes: Option.Option<number>;
  readonly comment: string;
  readonly columns: ReadonlyArray<TableColumn>;
}

/** What the SQL user can read, as it sees it. */
export interface DatabaseSchema {
  readonly database: string;
  readonly tables: ReadonlyArray<Table>;
}
