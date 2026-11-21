import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn } from "storybook/test";
import { Updated } from "./updated.tsx";

const meta = {
  title: "Components/Updated",
  component: Updated,
  args: { children: "Updated just now", busy: false, onRefresh: fn() },
} satisfies Meta<typeof Updated>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Refresh now" }));
    await expect(args.onRefresh).toHaveBeenCalledOnce();
  },
};

export const Refreshing: Story = {
  args: { children: "Refreshing…", busy: true },
};
