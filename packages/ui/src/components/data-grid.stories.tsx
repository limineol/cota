import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, waitFor, within } from "storybook/test";
import { CopyButton } from "./copy-button.tsx";
import {
  DataGrid,
  type DataGridCell,
  type DataGridColumn,
  DataGridFoot,
  DataGridInspector,
  DataGridMessage,
  DataGridPanel,
  DataGridText,
  type DataGridValue,
  dataGridOverscan,
  dataGridRowHeight,
} from "./data-grid.tsx";
import { JsonView } from "./json-view.tsx";

type Raw = string | number | null;

const columns: ReadonlyArray<DataGridColumn> = [
  {
    name: "started_at",
    type: "DateTime64(3, 'UTC')",
    numeric: false,
    width: "lg",
  },
  { name: "pool", type: "LowCardinality(String)", numeric: false, width: "sm" },
  { name: "requests", type: "UInt64", numeric: true, width: "xs" },
  {
    name: "cost_usd",
    type: "Nullable(Decimal(18, 12))",
    numeric: true,
    width: "md",
  },
  { name: "error_message", type: "String", numeric: false, width: "xl" },
  { name: "usage", type: "String", numeric: false, width: "lg" },
];

const usage =
  '{"input_tokens":1204,"cache_read_input_tokens":88213,"output_tokens":512}';

const mixed: ReadonlyArray<ReadonlyArray<Raw>> = [
  ["2026-11-16T09:12:04.118Z", "work", "412", "1.204000000000", "", usage],
  ["2026-11-16T09:13:51.002Z", "personal", "38", null, "NULL", "{}"],
  [
    "2026-11-16T09:20:17.940Z",
    "codex",
    "7",
    "0.031500000000",
    'The provider of pool "codex" sent no answer within 5m. Raise relay.first_byte_timeout in the hub\'s configuration if it needs longer.',
    "",
  ],
];

const shown = (raw: Raw): DataGridValue => {
  if (raw === null) return { kind: "null" };
  if (raw === "") return { kind: "empty" };
  return { kind: "text", text: String(raw) };
};

const drawnOf =
  (rows: number) =>
  ({ top, height }: { top: number; height: number }) => ({
    first: Math.max(0, Math.floor(top / dataGridRowHeight) - dataGridOverscan),
    last: Math.min(
      rows,
      Math.ceil((top + height) / dataGridRowHeight) + dataGridOverscan,
    ),
  });

function Answer({
  rows,
  onInspect,
}: {
  rows: ReadonlyArray<ReadonlyArray<Raw>>;
  onInspect: (cell: DataGridCell) => void;
}) {
  const [inspected, setInspected] = useState<DataGridCell | null>(null);
  const raw =
    inspected === null ? undefined : rows[inspected.row]?.[inspected.column];
  return (
    <DataGridPanel className="max-w-4xl">
      <DataGrid
        label="The answer"
        columns={columns}
        rows={rows.length}
        drawn={drawnOf(rows.length)}
        cell={(row, column) => shown(rows[row]?.[column] ?? null)}
        inspected={inspected}
        onInspect={(cell) => {
          setInspected(cell);
          onInspect(cell);
        }}
      />
      <DataGridFoot>
        <span>
          <strong>{rows.length.toLocaleString("en-US")}</strong> rows
        </span>
        <span>84 ms</span>
      </DataGridFoot>
      {inspected === null ? null : (
        <DataGridInspector
          title={
            <>
              Row {inspected.row + 1} ·{" "}
              <strong>{columns[inspected.column]?.name}</strong>{" "}
              <code>{columns[inspected.column]?.type}</code>
            </>
          }
          actions={
            <CopyButton
              label="Copy the value"
              copied="The value is copied."
              value={() => String(raw ?? "")}
            />
          }
          onClose={() => setInspected(null)}
        >
          {typeof raw === "string" && raw.startsWith("{") ? (
            <JsonView
              value={JSON.parse(raw)}
              className="max-h-80 overflow-auto"
            />
          ) : (
            <DataGridText>{raw === null ? "NULL" : String(raw)}</DataGridText>
          )}
        </DataGridInspector>
      )}
    </DataGridPanel>
  );
}

const meta = {
  title: "Components/DataGrid",
  component: Answer,
  args: { rows: mixed, onInspect: fn() },
} satisfies Meta<typeof Answer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MixedValues: Story = {
  play: async ({ canvas }) => {
    const grid = canvas.getByRole("grid", { name: "The answer" });
    await expect(grid).toHaveAttribute("aria-rowcount", "4");
    await expect(within(grid).getByText("null")).toBeInTheDocument();
    await expect(within(grid).getAllByText("NULL")).toHaveLength(2);
    await expect(within(grid).getAllByText("empty string")).toHaveLength(2);
  },
};

const many = Array.from(
  { length: 5000 },
  (_, row): ReadonlyArray<Raw> => [
    new Date(Date.UTC(2026, 10, 16, 9, 0, row)).toISOString(),
    ["work", "personal", "codex"][row % 3] ?? "work",
    String((row * 37) % 900),
    row % 7 === 0 ? null : (((row * 13) % 400) / 100).toFixed(12),
    row % 11 === 0 ? "Overloaded" : "",
    "",
  ],
);

export const FiveThousandRows: Story = {
  args: { rows: many },
  play: async ({ canvas }) => {
    const grid = canvas.getByRole("grid", { name: "The answer" });
    await expect(grid).toHaveAttribute("aria-rowcount", "5001");
    await expect(within(grid).getAllByRole("row").length).toBeLessThan(60);
  },
};

export const ArrowsAndEnterInspect: Story = {
  play: async ({ args, canvas, userEvent }) => {
    const grid = canvas.getByRole("grid", { name: "The answer" });
    const [first] = within(grid).getAllByRole("gridcell");
    if (first === undefined) throw new Error("The grid drew no cell.");
    await userEvent.click(first);
    await expect(args.onInspect).toHaveBeenLastCalledWith({
      row: 0,
      column: 0,
    });
    await userEvent.keyboard("{ArrowRight}{ArrowRight}{ArrowDown}");
    await waitFor(() =>
      expect(within(grid).getByText("38").closest("td")).toHaveFocus(),
    );
    await userEvent.keyboard("{Enter}");
    await expect(args.onInspect).toHaveBeenLastCalledWith({
      row: 1,
      column: 2,
    });
  },
};

export const AJsonValueInspected: Story = {
  play: async ({ canvas, userEvent }) => {
    const grid = canvas.getByRole("grid", { name: "The answer" });
    await userEvent.click(within(grid).getByText(usage));
    const inspector = canvas.getByRole("region", {
      name: "The value inspected",
    });
    await expect(
      within(inspector).getByText('"cache_read_input_tokens"'),
    ).toBeVisible();
    await userEvent.click(
      within(inspector).getByRole("button", { name: "Close the value" }),
    );
    await expect(
      canvas.queryByRole("region", { name: "The value inspected" }),
    ).toBeNull();
  },
};

export const NoRows: Story = {
  render: () => (
    <DataGridPanel className="max-w-4xl">
      <DataGridMessage>
        <p>The query answered no rows.</p>
      </DataGridMessage>
      <DataGridFoot>
        <span>
          <strong>0</strong> rows
        </span>
        <span>12 ms</span>
      </DataGridFoot>
    </DataGridPanel>
  ),
};
