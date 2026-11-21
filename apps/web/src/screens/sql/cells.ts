import type {
  DataGridColumn,
  DataGridValue,
  DataGridWidth,
} from "@cota/ui/components/data-grid";
import { Option, Schema } from "effect";
import { textOf, type Value } from "#shared/domain/tsv.ts";
import type { RunAnswer } from "./queries.ts";

/** The most characters a cell shows; the inspector shows the rest. */
const shownCharacters = 300;

/** The rows read for a column's width: enough to see its values, few enough to stay quick. */
const sampled = 200;

const numericType =
  /^(?:(?:Nullable|LowCardinality)\()*(?:U?Int\d+|Float\d+|Decimal|BFloat16)/;

/** Whether a ClickHouse type holds numbers, such as `UInt64`, `Nullable(Decimal(18, 12))` or `Float64`. */
export const isNumeric = (type: string) => numericType.test(type);

/** The narrowest width whose characters fit, for a mono text at the grid's size. */
const widthFor = (characters: number): DataGridWidth => {
  if (characters <= 7) return "xs";
  if (characters <= 11) return "sm";
  if (characters <= 17) return "md";
  if (characters <= 27) return "lg";
  return "xl";
};

export const columnsOf = (answer: RunAnswer): ReadonlyArray<DataGridColumn> =>
  answer.columns.map((column, index) => {
    let longest = Math.max(
      column.name.length,
      Math.min(column.type.length, 16),
    );
    for (const row of answer.rows.slice(0, sampled)) {
      const value = row[index] ?? null;
      if (value !== null) longest = Math.max(longest, textOf(value).length);
    }
    return {
      name: column.name,
      type: column.type,
      numeric: isNumeric(column.type),
      width: widthFor(longest),
    };
  });

export const cellOf = (value: Value | undefined): DataGridValue => {
  if (value === undefined || value === null) return { kind: "null" };
  const text = textOf(value);
  if (text === "") return { kind: "empty" };
  return {
    kind: "text",
    text:
      text.length > shownCharacters
        ? `${text.slice(0, shownCharacters)}…`
        : text,
  };
};

const decodeJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Json),
);

/** A value's JSON, for the inspector to set out: an object or array as it came, or a string that holds one. */
export const jsonIn = (value: Value): Value | undefined => {
  if (typeof value === "object" && value !== null) return value;
  if (typeof value !== "string" || !/^\s*[[{]/.test(value)) return undefined;
  return Option.getOrUndefined(decodeJson(value));
};
