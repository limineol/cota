import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { RankItem, RankList } from "./rank-list.tsx";

const meta = {
  title: "Components/RankList",
  component: RankList,
  decorators: [
    (Story) => (
      <div className="max-w-sm rounded-card border bg-surface p-5">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RankList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TopProjects: Story = {
  render: () => (
    <RankList aria-label="Top projects">
      <RankItem label="acme/shop" value="88.2M" fraction={1} hue={2} />
      <RankItem label="cota" value="41.9M" fraction={0.48} hue={2} />
      <RankItem label="notes" value="6.1M" fraction={0.07} hue={2} />
      <RankItem label="dotfiles" value="88K" fraction={0.001} hue={2} />
    </RankList>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole("listitem")).toHaveLength(4);
  },
};

export const Neutral: Story = {
  render: () => (
    <RankList aria-label="Top models">
      <RankItem label="claude-opus-4-5" value="120M" fraction={1} />
      <RankItem label="claude-haiku-4-5" value="9.8M" fraction={0.08} />
    </RankList>
  ),
};
