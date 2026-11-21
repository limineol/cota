import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { BlockMeter } from "./block-meter.tsx";
import {
  Pace,
  QuotaWindow,
  QuotaWindowFoot,
  QuotaWindowHead,
  QuotaWindowLabel,
  QuotaWindowReset,
  QuotaWindowUsed,
} from "./quota-window.tsx";

const fillsOf = (used: number) =>
  Array.from({ length: 20 }, (_, index) =>
    Math.min(1, Math.max(0, used / 5 - index)),
  );

const meta = {
  title: "Components/QuotaWindow",
  component: QuotaWindow,
  decorators: [
    (Story) => (
      <div className="max-w-md rounded-card border bg-surface p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof QuotaWindow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OnACard: Story = {
  render: () => (
    <QuotaWindow>
      <QuotaWindowHead>
        <QuotaWindowLabel>5-hour</QuotaWindowLabel>
        <QuotaWindowUsed>41% used</QuotaWindowUsed>
        <QuotaWindowReset title="Resets at 18:00">
          Resets in 2h 14m
        </QuotaWindowReset>
      </QuotaWindowHead>
      <BlockMeter
        blocks={fillsOf(41)}
        pace={0.55}
        severity="normal"
        hue={1}
        label="personal, 5-hour window"
        valueText="41% used, 14% in reserve"
      />
    </QuotaWindow>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Resets in 2h 14m")).toHaveAttribute(
      "title",
      "Resets at 18:00",
    );
  },
};

export const InDetail: Story = {
  render: () => (
    <QuotaWindow size="detail">
      <QuotaWindowHead>
        <QuotaWindowLabel>Weekly</QuotaWindowLabel>
        <QuotaWindowUsed>86% used</QuotaWindowUsed>
        <QuotaWindowReset>Resets in 1d 4h</QuotaWindowReset>
      </QuotaWindowHead>
      <BlockMeter
        blocks={fillsOf(86)}
        pace={0.7}
        severity="near"
        hue={2}
        size="detail"
        label="work, weekly window"
        valueText="86% used, 16% ahead of pace"
      />
      <QuotaWindowFoot>
        <Pace tone="danger">16% ahead of pace · empties in 9h 12m</Pace>
        <span>Resets Mon 17 Nov, 09:00</span>
      </QuotaWindowFoot>
    </QuotaWindow>
  ),
};

export const Paces: Story = {
  render: () => (
    <div className="flex flex-col gap-1">
      <Pace tone="ok">On pace</Pace>
      <Pace tone="ok">37% in reserve</Pace>
      <Pace tone="warn">8% ahead of pace · empties in 2d 3h</Pace>
      <Pace tone="danger">Full until the reset</Pace>
    </div>
  ),
};
