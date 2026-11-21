import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import type { Hue } from "#lib/hue.ts";
import { PoolMark } from "./pool-mark.tsx";

const meta = {
  title: "Components/PoolMark",
  component: PoolMark,
  args: { hue: 1, name: "personal" },
} satisfies Meta<typeof PoolMark>;

export default meta;
type Story = StoryObj<typeof meta>;

const pools: ReadonlyArray<{ hue: Hue; name: string }> = [
  { hue: 1, name: "personal" },
  { hue: 2, name: "work" },
  { hue: 3, name: "client" },
  { hue: 4, name: "side project" },
  { hue: 5, name: "chatgpt" },
  { hue: 6, name: "zai" },
  { hue: 7, name: "opencode" },
  { hue: 8, name: "tower" },
  { hue: "neutral", name: "lab" },
];

const ring = (
  <svg
    aria-hidden="true"
    viewBox="0 0 16 16"
    fill="currentColor"
    focusable="false"
  >
    <path d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1Zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />
  </svg>
);

export const Initial: Story = {};

export const EveryHue: Story = {
  render: () => (
    <ul className="flex flex-col gap-2 text-base">
      {pools.map((pool) => (
        <li key={pool.name} className="flex items-center gap-2">
          <PoolMark hue={pool.hue} name={pool.name} />
          {pool.name}
        </li>
      ))}
    </ul>
  ),
};

export const WithAGlyph: Story = {
  args: { glyph: ring },
  render: (args) => (
    <div className="flex items-center gap-3">
      {pools.slice(0, 3).map((pool) => (
        <PoolMark
          key={pool.name}
          {...args}
          hue={pool.hue}
          name={pool.name}
          size="md"
        />
      ))}
    </div>
  ),
};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-center gap-3">
      <PoolMark {...args} />
      <PoolMark {...args} size="md" />
    </div>
  ),
};

export const Labelled: Story = {
  args: { label: "Pool personal" },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("img", { name: "Pool personal" }),
    ).toBeVisible();
  },
};
