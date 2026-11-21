import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { PoolMark } from "./pool-mark.tsx";
import { Tag, Tags } from "./tag.tsx";

function SessionTags() {
  return (
    <Tags aria-label="What the session used">
      <Tag dimension="Pool" render={<a href="/sessions?pool=work" />}>
        <PoolMark hue={2} name="Work" />
        Work
      </Tag>
      <Tag dimension="Project" render={<a href="/sessions?project=acme" />}>
        acme/shop
      </Tag>
      <Tag dimension="Client" render={<a href="/sessions?client=cc" />}>
        Claude Code
      </Tag>
      <Tag dimension="Machine" render={<a href="/sessions?machine=tower" />}>
        Desk
      </Tag>
      <Tag dimension="Model" render={<a href="/sessions?model=opus" />}>
        Claude Opus 4.5
      </Tag>
      <Tag dimension="Project" render={<a href="/sessions?project=long" />}>
        acme/a-repository-whose-name-runs-past-the-header-and-then-some-more
      </Tag>
    </Tags>
  );
}

const meta = {
  title: "Components/Tag",
  component: SessionTags,
} satisfies Meta<typeof SessionTags>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ASessionsValues: Story = {
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("link", { name: "Pool Work" }),
    ).toHaveAttribute("href", "/sessions?pool=work");
  },
};

export const Narrow: Story = {
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
};
