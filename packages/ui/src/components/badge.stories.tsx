import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { Badge } from "./badge.tsx";

const meta = {
  title: "Components/Badge",
  component: Badge,
  args: { children: "Max 20x" },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Plan: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Max 20x")).toBeVisible();
  },
};

export const Kind: Story = { args: { children: "Keyed" } };

export const Live: Story = {
  args: { variant: "live", children: "2 active sessions" },
};

export const AnError: Story = {
  args: { variant: "danger", children: "Error 529" },
};

export const Together: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Badge>Pro</Badge>
      <Badge variant="live">1 active session</Badge>
      <Badge>Refused 429</Badge>
      <Badge variant="danger">Error 529</Badge>
    </div>
  ),
};
