import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import type { Hue } from "#lib/hue.ts";
import { BlockMeter } from "./block-meter.tsx";

const fillsOf = (used: number) =>
  Array.from({ length: 20 }, (_, index) =>
    Math.min(1, Math.max(0, used / 5 - index)),
  );

const meta = {
  title: "Components/BlockMeter",
  component: BlockMeter,
  args: {
    blocks: fillsOf(12),
    pace: 0.45,
    severity: "normal",
    hue: 1,
    label: "personal, 5-hour window",
    valueText: "12% used, 33% in reserve",
  },
  decorators: [
    (Story) => (
      <div className="max-w-sm rounded-card border bg-surface p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof BlockMeter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const InReserve: Story = {
  play: async ({ canvas }) => {
    const meter = canvas.getByRole("meter", {
      name: "personal, 5-hour window",
    });
    await expect(meter).toHaveAttribute("aria-valuenow", "12");
    await expect(meter).toHaveAttribute(
      "aria-valuetext",
      "12% used, 33% in reserve",
    );
  },
};

export const Empty: Story = {
  args: {
    blocks: fillsOf(0),
    pace: 0.02,
    valueText: "0% used, on pace",
  },
};

export const AheadOfPace: Story = {
  args: {
    blocks: fillsOf(64),
    pace: 0.4,
    valueText: "64% used, 24% ahead of pace, empties in 1h 12m",
  },
};

export const NearTheLimit: Story = {
  args: {
    blocks: fillsOf(86.5),
    pace: 0.7,
    severity: "near",
    valueText: "87% used, 17% ahead of pace, empties in 32m",
  },
};

export const AtTheLimit: Story = {
  args: {
    blocks: fillsOf(100),
    pace: 0.8,
    severity: "full",
    valueText: "100% used, full until the reset in 58m",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("meter")).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
  },
};

export const Unplaced: Story = {
  args: {
    blocks: fillsOf(30),
    pace: null,
    valueText: "30% used",
  },
};

export const Detail: Story = {
  args: { size: "detail", blocks: fillsOf(41.4), pace: 0.38 },
};

const hues: ReadonlyArray<Hue> = [1, 2, 3, 4, 5, 6, 7, 8, "neutral"];

export const EveryPool: Story = {
  render: (args) => (
    <div className="flex flex-col gap-4">
      {hues.map((hue, index) => (
        <BlockMeter
          key={hue}
          {...args}
          hue={hue}
          label={`pool ${index + 1}, weekly window`}
          blocks={fillsOf(8 + index * 9)}
          pace={0.15 + index * 0.08}
        />
      ))}
    </div>
  ),
};

export const Narrow: Story = {
  args: { blocks: fillsOf(57), pace: 0.5 },
  decorators: [
    (Story) => (
      <div className="w-32">
        <Story />
      </div>
    ),
  ],
};
