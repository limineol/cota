import { Button } from "@cota/ui/components/button";
import {
  SchemaColumn,
  SchemaHead,
  SchemaNote,
  SchemaRail,
  SchemaSkeleton,
  SchemaTable,
  SchemaTables,
} from "@cota/ui/components/schema-tree";
import { SearchField } from "@cota/ui/components/search-field";
import { Predicate } from "effect";
import { useState } from "react";
import { tokens } from "#shared/domain/quantities.ts";
import { counted } from "#shared/words.ts";
import { type SchemaTable as Table, useSchema } from "./queries.ts";

const units = ["KiB", "MiB", "GiB", "TiB"] as const;

/** A size in bytes, in the largest binary unit under which it is at least one, with at most one decimal. */
export const sizeOf = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  let size = bytes / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${Math.round(size * 10) / 10} ${units[unit]}`;
};

const figureOf = (table: Table) =>
  [
    table.rows === null ? table.engine : tokens(table.rows),
    table.bytes === null ? null : sizeOf(table.bytes),
  ]
    .filter(Predicate.isNotNull)
    .join(" · ");

const aboutOf = (table: Table) =>
  [
    table.engine,
    table.rows === null ? null : `${counted(table.rows)} rows`,
    table.bytes === null ? null : sizeOf(table.bytes),
  ]
    .filter(Predicate.isNotNull)
    .join(" · ");

/** The tables whose name or a column's has `needle`; a table found by a column's name keeps only the columns found. */
const found = (tables: ReadonlyArray<Table>, needle: string) => {
  if (needle === "") return tables.map((table) => ({ table, opened: false }));
  return tables.flatMap((table) => {
    if (table.name.toLowerCase().includes(needle)) {
      return [{ table, opened: false }];
    }
    const columns = table.columns.filter((column) =>
      column.name.toLowerCase().includes(needle),
    );
    return columns.length === 0
      ? []
      : [{ table: { ...table, columns }, opened: true }];
  });
};

/**
 * The request log's tables beside the editor: each opens to its columns, and
 * a click on a name hands it to `onInsert`. It reads and fails on its own.
 */
export function Schema({
  open,
  onInsert,
}: {
  readonly open: boolean;
  readonly onInsert: (name: string) => void;
}) {
  const schema = useSchema();
  const [filter, setFilter] = useState("");
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const needle = filter.trim().toLowerCase();
  const shown =
    schema.data === undefined ? [] : found(schema.data.tables, needle);

  const body = () => {
    if (schema.isPending) return <SchemaSkeleton />;
    if (schema.isError) {
      return (
        <>
          <SchemaNote>
            {Predicate.isTagged(schema.error, "SqlUnavailableProblem")
              ? "SQL is unavailable on this hub, so its tables cannot be read."
              : "The hub could not read the tables. The editor still runs SQL."}
          </SchemaNote>
          <div className="px-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void schema.refetch()}
            >
              Try again
            </Button>
          </div>
        </>
      );
    }
    if (schema.data.tables.length === 0) {
      return <SchemaNote>The database has no tables yet.</SchemaNote>;
    }
    if (shown.length === 0) {
      return (
        <SchemaNote>
          No table or column has “{filter.trim()}” in its name.
        </SchemaNote>
      );
    }
    return (
      <SchemaTables aria-label="Tables">
        {shown.map(({ table, opened: byFilter }) => (
          <SchemaTable
            key={table.name}
            name={table.name}
            figure={figureOf(table)}
            about={
              <>
                <p>{aboutOf(table)}</p>
                {table.comment === "" ? null : <p>{table.comment}</p>}
              </>
            }
            open={byFilter !== opened.has(table.name)}
            onOpenChange={() => {
              const changed = new Set(opened);
              if (changed.has(table.name)) changed.delete(table.name);
              else changed.add(table.name);
              setOpened(changed);
            }}
            onInsert={() => onInsert(table.name)}
          >
            {table.columns.map((column) => (
              <SchemaColumn
                key={column.name}
                name={column.name}
                type={column.type}
                comment={column.comment}
                onInsert={() => onInsert(column.name)}
              />
            ))}
          </SchemaTable>
        ))}
      </SchemaTables>
    );
  };

  return (
    <SchemaRail open={open} id="sql-schema" aria-labelledby="sql-schema-title">
      <SchemaHead>
        <h2 id="sql-schema-title">Schema</h2>
        {schema.data === undefined ? null : <span>{schema.data.database}</span>}
      </SchemaHead>
      <SearchField
        aria-label="Filter tables and columns"
        placeholder="Filter tables and columns"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        onSubmit={() => undefined}
      />
      {body()}
    </SchemaRail>
  );
}
