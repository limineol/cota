import type { Meta, StoryObj } from "@storybook/react-vite";
import { ArrowUpRight } from "lucide-react";
import { expect } from "storybook/test";
import {
  Stat,
  StatDelta,
  StatLabel,
  StatMeta,
  StatNote,
  StatUnit,
  StatValue,
} from "./stat.tsx";

const meta = {
  title: "Components/Stat",
  component: Stat,
} satisfies Meta<typeof Stat>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Totals: Story = {
  render: () => (
    <div className="grid max-w-4xl grid-cols-3 gap-3">
      <Stat variant="tile">
        <StatLabel>Requests</StatLabel>
        <StatValue>
          4,812<StatDelta direction="up">↑12%</StatDelta>
        </StatValue>
      </Stat>
      <Stat variant="tile">
        <StatLabel>Input tokens</StatLabel>
        <StatValue>
          182.4M<StatDelta direction="down">↓8%</StatDelta>
        </StatValue>
        <StatNote>91% cache reads</StatNote>
      </Stat>
      <Stat variant="tile" render={<a href="#errors" />}>
        <StatLabel>
          Errors <ArrowUpRight aria-hidden="true" />
        </StatLabel>
        <StatValue tone="danger">
          37
          <StatDelta direction="up" worse>
            ↑3.4×
          </StatDelta>
        </StatValue>
        <StatNote>1% of requests</StatNote>
      </Stat>
      <Stat variant="tile" render={<a href="#sessions" />}>
        <StatLabel>
          Sessions <ArrowUpRight aria-hidden="true" />
        </StatLabel>
        <StatValue>
          64<StatDelta direction="none">no change</StatDelta>
        </StatValue>
      </Stat>
      <Stat variant="tile">
        <StatLabel>Cost</StatLabel>
        <StatValue>
          $1,204<StatDelta direction="none">none before</StatDelta>
        </StatValue>
        <StatNote>at API list prices</StatNote>
      </Stat>
    </div>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("↑3.4×")).toHaveAttribute(
      "data-direction",
      "up",
    );
    await expect(canvas.getByText("no change")).toHaveAttribute(
      "data-direction",
      "none",
    );
  },
};

export const Panels: Story = {
  render: () => (
    <div className="grid max-w-4xl grid-cols-3 gap-3">
      <Stat variant="panel">
        <StatLabel>Today</StatLabel>
        <StatValue size="lg">
          38.2M<StatUnit>tokens</StatUnit>
        </StatValue>
        <StatMeta>
          <strong>$84.10</strong> · 1,204 requests · 92% from cache
        </StatMeta>
      </Stat>
      <Stat variant="panel">
        <StatLabel>Since Nov 2</StatLabel>
        <StatValue size="lg">
          1.4B<StatUnit>tokens</StatUnit>
        </StatValue>
        <StatMeta>
          <strong>$3,120</strong> · 41,880 requests
        </StatMeta>
        <StatNote>The request log began on Nov 2.</StatNote>
      </Stat>
      <Stat variant="panel">
        <StatLabel>Now</StatLabel>
        <StatValue size="lg">
          3<StatUnit>active sessions</StatUnit>
        </StatValue>
        <StatMeta>2 pools busy</StatMeta>
      </Stat>
    </div>
  ),
};

export const Bold: Story = {
  render: () => (
    <Stat>
      <StatLabel>Today</StatLabel>
      <StatValue size="xl">
        12.9M<StatUnit>tokens</StatUnit>
      </StatValue>
      <StatMeta>
        <strong>$28.40</strong> · 388 requests
      </StatMeta>
    </Stat>
  ),
};
