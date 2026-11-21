import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import type { Tint } from "#lib/hue.ts";
import {
  BlockColumns,
  type ColumnsLayout,
  type Series,
} from "./block-columns.tsx";

const tints: ReadonlyArray<Tint> = [1, 2, 3, 4, 5, 6, 7, 8];

const seriesOf = (count: number): ReadonlyArray<Series> =>
  tints.slice(0, count).map((tint, index) => ({
    key: `pool-${index + 1}`,
    label: `pool ${index + 1}`,
    tint,
  }));

const hour = (at: number) => `${String(at % 24).padStart(2, "0")}:00`;

const layoutOf = (
  hours: number,
  pools: number,
  unit: number,
): ColumnsLayout => ({
  unit: `${unit}K tokens`,
  columns: Array.from({ length: hours }, (_, at) => {
    const values = Array.from({ length: pools }, (_, pool) =>
      Math.max(
        0,
        Math.round(40 * Math.sin((at + pool * 3) / 4) + 30 - pool * 6),
      ),
    );
    let running = 0;
    let placed = 0;
    const parts = values.map((value) => {
      running += value;
      const upTo = Math.round(running / unit);
      const blocks = upTo - placed;
      placed = upTo;
      return { blocks, value: value === 0 ? null : `${value}K` };
    });
    return {
      key: String(at),
      label: `${hour(at)}–${hour(at + 1)}`,
      tick: hour(at),
      total: `${running}K`,
      parts,
    };
  }),
});

const fixed =
  (layout: ColumnsLayout): ((capacity: number) => ColumnsLayout) =>
  () =>
    layout;

const meta = {
  title: "Components/BlockColumns",
  component: BlockColumns,
  args: {
    series: seriesOf(3),
    fit: fixed(layoutOf(24, 3, 10)),
    label: "Tokens over time, by pool",
    empty: "No traffic in this range.",
  },
  decorators: [
    (Story) => (
      <div className="max-w-3xl rounded-card border bg-surface p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof BlockColumns>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ThreePools: Story = {
  play: async ({ canvas, userEvent }) => {
    await expect(await canvas.findByText("10K tokens")).toBeVisible();
    await userEvent.tab();
    await userEvent.keyboard("{ArrowRight}");
    await expect(await canvas.findByText("00:00–01:00")).toBeVisible();
    await userEvent.keyboard("{End}");
    await expect(await canvas.findByText("23:00–00:00")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect(await canvas.findByText("10K tokens")).toBeVisible();
  },
};

export const OnePool: Story = {
  args: { series: seriesOf(1), fit: fixed(layoutOf(24, 1, 5)) },
};

export const EightPools: Story = {
  args: { series: seriesOf(8), fit: fixed(layoutOf(48, 8, 20)) },
};

export const Empty: Story = {
  args: {
    fit: fixed({
      unit: "1 token",
      columns: layoutOf(24, 3, 10).columns.map((column) => ({
        ...column,
        total: "0",
        parts: column.parts.map(() => ({ blocks: 0, value: null })),
      })),
    }),
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("No traffic in this range."),
    ).toBeVisible();
  },
};

export const Narrow: Story = {
  args: { fit: (capacity) => layoutOf(Math.min(48, capacity), 3, 10) },
  decorators: [
    (Story) => (
      <div className="w-56">
        <Story />
      </div>
    ),
  ],
};
