/** A value of an answer's row, as `POST /api/sql` writes it in JSON. */
export type Value =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<Value>
  | { readonly [key: string]: Value };

/** A value as text: a string as it is, and anything else as its JSON. A null has no text. */
export const textOf = (value: Exclude<Value, null>): string =>
  typeof value === "string" ? value : JSON.stringify(value);

const escapes: Readonly<Record<string, string>> = {
  "\\": "\\\\",
  "\t": "\\t",
  "\n": "\\n",
  "\r": "\\r",
};

const escaped = (text: string) =>
  text.replace(/[\\\t\n\r]/g, (character) => escapes[character] ?? character);

const fieldOf = (value: Value) =>
  value === null ? "\\N" : escaped(textOf(value));

/**
 * An answer as tab-separated values, escaped as ClickHouse's `TabSeparated`
 * escapes them: a line of the column names, then a line per row, each line
 * ending in a line feed; within a field a backslash, a tab, a line feed and a
 * carriage return are written `\\`, `\t`, `\n` and `\r`, and a null is `\N`.
 */
export const tsvOf = (
  columns: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<Value>>,
): string =>
  [columns.map(escaped), ...rows.map((row) => row.map(fieldOf))]
    .map((fields) => `${fields.join("\t")}\n`)
    .join("");
