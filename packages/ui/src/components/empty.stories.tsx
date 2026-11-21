import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { Empty, EmptyDescription, EmptyTitle } from "./empty.tsx";

const meta = {
  title: "Components/Empty",
  component: Empty,
  decorators: [
    (Story) => (
      <div className="max-w-xl rounded-card border bg-surface">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Empty>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoTraffic: Story = {
  render: () => (
    <Empty>
      <EmptyTitle>No project traffic</EmptyTitle>
      <EmptyDescription>
        Nothing was logged in the last 24 hours.
      </EmptyDescription>
    </Empty>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("No project traffic")).toBeVisible();
  },
};
