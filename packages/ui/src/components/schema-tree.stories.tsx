import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn } from "storybook/test";
import {
  SchemaColumn,
  SchemaHead,
  SchemaNote,
  SchemaRail,
  SchemaSkeleton,
  SchemaTable,
  SchemaTables,
} from "./schema-tree.tsx";

const tables = [
  {
    name: "items",
    figure: "1.2M · 3.4 GiB",
    about: "ReplacingMergeTree · 1,204,551 rows · 3.4 GiB",
    columns: [
      { name: "session", type: "String", comment: "" },
      { name: "digest", type: "UInt128", comment: "" },
      { name: "text", type: "String", comment: "" },
    ],
  },
  {
    name: "requests",
    figure: "48K · 212 MiB",
    about: "MergeTree · 48,213 rows · 212 MiB",
    columns: [
      { name: "id", type: "UUID", comment: "" },
      { name: "started_at", type: "DateTime64(3, 'UTC')", comment: "" },
      { name: "pool", type: "LowCardinality(String)", comment: "" },
      {
        name: "cost_usd",
        type: "Nullable(Decimal(18, 12))",
        comment: "Null when the model has no price or usage was not reported.",
      },
    ],
  },
  {
    name: "words",
    figure: "59K · 1.1 MiB",
    about: (
      <>
        <p>MergeTree · 59,102 rows · 1.1 MiB</p>
        <p>The words of every item</p>
      </>
    ),
    columns: [{ name: "word", type: "String", comment: "" }],
  },
];

function Rail({ onInsert }: { onInsert: (name: string) => void }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set(["requests"]));
  return (
    <SchemaRail open className="w-72">
      <SchemaHead>
        <h2>Schema</h2>
        <span>cota</span>
      </SchemaHead>
      <SchemaTables aria-label="Tables">
        {tables.map((table) => (
          <SchemaTable
            key={table.name}
            name={table.name}
            figure={table.figure}
            about={table.about}
            open={open.has(table.name)}
            onOpenChange={(next) => {
              const changed = new Set(open);
              if (next) changed.add(table.name);
              else changed.delete(table.name);
              setOpen(changed);
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
    </SchemaRail>
  );
}

const meta = {
  title: "Components/SchemaTree",
  component: Rail,
  args: { onInsert: fn() },
} satisfies Meta<typeof Rail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Tables: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /^started_at/ }));
    await expect(args.onInsert).toHaveBeenCalledWith("started_at");
    const items = canvas.getByRole("button", { name: "Columns of items" });
    await expect(items).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(items);
    await expect(items).toHaveAttribute("aria-expanded", "true");
    await expect(canvas.getByRole("button", { name: /^digest/ })).toBeVisible();
  },
};

export const Loading: Story = {
  render: () => (
    <SchemaRail open className="w-72">
      <SchemaHead>
        <h2>Schema</h2>
      </SchemaHead>
      <SchemaSkeleton />
    </SchemaRail>
  ),
};

export const NoneMatch: Story = {
  render: () => (
    <SchemaRail open className="w-72">
      <SchemaHead>
        <h2>Schema</h2>
        <span>cota</span>
      </SchemaHead>
      <SchemaNote>No table or column has “latency” in its name.</SchemaNote>
    </SchemaRail>
  ),
};
