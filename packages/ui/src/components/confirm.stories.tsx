import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn } from "storybook/test";
import { Confirm } from "./confirm.tsx";

const meta = {
  title: "Components/Confirm",
  component: Confirm,
  args: {
    question:
      "Forget the quota login of personal? Its quota windows are no longer read until a login is given again.",
    confirm: "Forget it",
    onConfirm: fn(),
    onCancel: fn(),
  },
} satisfies Meta<typeof Confirm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Asked: Story = {
  play: async ({ canvas, args }) => {
    const group = canvas.getByRole("group", {
      name: /^Forget the quota login/,
    });
    await expect(group).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await expect(args.onConfirm).not.toHaveBeenCalled();
  },
};

export const EscapeKeeps: Story = {
  play: async ({ canvas, args, userEvent }) => {
    await expect(canvas.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect(args.onCancel).toHaveBeenCalledOnce();
  },
};

export const Pending: Story = {
  args: { pending: true },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("button", { name: "Forget it" }),
    ).toBeDisabled();
  },
};
