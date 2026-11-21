import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { BlockMix, type MixPart } from "./block-mix.tsx";

const tokens: ReadonlyArray<MixPart> = [
  {
    key: "cache-read",
    label: "Cache read",
    value: "41.2M",
    share: "86%",
    blocks: 43,
    tint: "ramp-1",
  },
  {
    key: "cache-write",
    label: "Cache write",
    value: "3.1M",
    share: "6%",
    blocks: 3,
    tint: "ramp-2",
  },
  {
    key: "input",
    label: "Uncached input",
    value: "2.6M",
    share: "5%",
    blocks: 3,
    tint: "ramp-3",
  },
  {
    key: "output",
    label: "Output",
    value: "910K",
    share: "2%",
    blocks: 1,
    tint: "ramp-4",
  },
];

const meta = {
  title: "Components/BlockMix",
  component: BlockMix,
  args: {
    parts: tokens,
    label: "Where the tokens went",
    empty: "No tokens in this range.",
  },
  decorators: [
    (Story) => (
      <div className="max-w-3xl rounded-card border bg-surface p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof BlockMix>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Tokens: Story = {
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("img", {
        name: "Where the tokens went: Cache read 41.2M, 86%; Cache write 3.1M, 6%; Uncached input 2.6M, 5%; Output 910K, 2%",
      }),
    ).toBeVisible();
  },
};

export const ATinyPart: Story = {
  args: {
    parts: [
      {
        key: "cache-read",
        label: "Cache read",
        value: "98.1M",
        share: "99%",
        blocks: 50,
        tint: "ramp-1",
      },
      {
        key: "output",
        label: "Output",
        value: "312K",
        share: "<1%",
        blocks: 0,
        tint: "ramp-4",
      },
    ],
  },
};

const hues = [1, 2, 3, 4, 5, 6, 7, 8, "neutral"] as const;
const shares = [14, 9, 7, 6, 5, 4, 3, 1, 1];

export const EveryPool: Story = {
  args: {
    label: "Tokens by pool",
    parts: hues.map((tint, index) => ({
      key: String(tint),
      label: `pool ${index + 1}`,
      value: `${shares[index] ?? 0}M`,
      share: `${(shares[index] ?? 0) * 2}%`,
      blocks: shares[index] ?? 0,
      tint,
    })),
  },
};

export const Empty: Story = {
  args: { parts: tokens.map((part) => ({ ...part, blocks: 0 })) },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole("img")).toBeNull();
    await expect(canvas.getByText("No tokens in this range.")).toBeVisible();
  },
};

export const Narrow: Story = {
  decorators: [
    (Story) => (
      <div className="w-72">
        <Story />
      </div>
    ),
  ],
};
