import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { PoolMark } from "./pool-mark.tsx";
import { Switcher, SwitcherItem } from "./switcher.tsx";

const pools = [
  { id: "personal", hue: 1 },
  { id: "work", hue: 2 },
  { id: "acme/shop", hue: 3 },
] as const;

const meta = {
  title: "Components/Switcher",
  component: Switcher,
} satisfies Meta<typeof Switcher>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Pools: Story = {
  render: () => (
    <Switcher aria-label="Pool">
      <SwitcherItem href="#all" current>
        All pools
      </SwitcherItem>
      {pools.map((pool) => (
        <SwitcherItem key={pool.id} href={`#${pool.id}`} current={false}>
          <PoolMark hue={pool.hue} name={pool.id} />
          {pool.id}
        </SwitcherItem>
      ))}
    </Switcher>
  ),
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("link", { name: "All pools" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      canvas.getByRole("link", { name: "work" }),
    ).not.toHaveAttribute("aria-current");
  },
};

export const Narrow: Story = {
  ...Pools,
  decorators: [
    (Story) => (
      <div className="w-60">
        <Story />
      </div>
    ),
  ],
};
