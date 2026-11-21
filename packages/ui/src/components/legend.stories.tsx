import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { Legend, LegendItem } from "./legend.tsx";
import { PoolMark } from "./pool-mark.tsx";

const meta = {
  title: "Components/Legend",
  component: Legend,
} satisfies Meta<typeof Legend>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Pools: Story = {
  render: () => (
    <Legend aria-label="Pools in this chart">
      <LegendItem>
        <PoolMark hue={1} name="personal" />
        personal
      </LegendItem>
      <LegendItem>
        <PoolMark hue={2} name="work" />
        work
      </LegendItem>
      <LegendItem>
        <PoolMark hue={3} name="acme/shop" />
        acme/shop
      </LegendItem>
    </Legend>
  ),
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("list", { name: "Pools in this chart" }),
    ).toBeVisible();
    await expect(canvas.getAllByRole("listitem")).toHaveLength(3);
  },
};
